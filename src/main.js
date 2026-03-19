import { state } from "./state.js";
import { initPdfLibrary, loadPdfPages } from "./pdf.js";
import { downscaleDataUrlToMaxSide, readFileAsDataURL, showToast, wait } from "./utils.js";
import { removeTextWithGemini, ocrWithGemini } from "./gemini.js";
import { exportToPptx } from "./pptx.js";
import { postprocessOcrBlocks } from "./ocrPostprocess.js";
import {
  ensureApiKey,
  getEls,
  initStaticUiHandlers,
  renderResults,
  renderSelectionGrid,
  showSection,
  wireApiKeySave,
} from "./ui.js";

function classifyApiError(error) {
  const status = error?.status ?? error?.cause?.status;
  const msg = String(error?.message || "");
  const raw = String(error?.error?.message || "");
  const full = `${msg}\n${raw}`.toLowerCase();

  if (status === 429) {
    if (full.includes('resource_exhausted') || full.includes('quota')) {
      return { kind: 'quota', status, userMessage: '429: quota exhausted. Check AI Studio / Google Cloud console usage & quotas.' };
    }
    return { kind: 'rate', status, userMessage: '429: rate limited. Slow down requests, reduce parallel calls, or retry with backoff.' };
  }
  if (status === 403 && (full.includes('quota') || full.includes('exceeded'))) {
    return { kind: 'quota', status, userMessage: '403: quota exceeded. Check AI Studio / Google Cloud console usage & quotas.' };
  }
  return { kind: 'other', status, userMessage: error?.message || 'Request failed.' };
}

function requireCdnGlobals() {
  if (!window.pdfjsLib) console.warn("pdf.js not loaded (window.pdfjsLib missing)");
  if (!window.PptxGenJS) console.warn("pptxgenjs not loaded (window.PptxGenJS missing)");
}

async function handleFiles(els, files) {
  if (!initPdfLibrary()) return;

  state.pendingItems = [];
  const fileArray = Array.from(files);

  for (const file of fileArray) {
    if (file.type === 'application/pdf') {
      const pages = await loadPdfPages(file);
      state.pendingItems.push(...pages);
    } else if (file.type.startsWith('image/')) {
      const dataUrl = await readFileAsDataURL(file);
      state.pendingItems.push({
        type: 'image',
        name: file.name,
        thumbnail: dataUrl,
        fullImage: dataUrl,
        selected: true,
      });
    }
  }

  if (state.pendingItems.length > 0) {
    showSection(els, els.selectionSection);
    renderSelectionGrid(els);
  }
}

async function processItems(els, items) {
  state.results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = ((i + 1) / items.length) * 100;
    els.progressFill.style.width = `${progress}%`;
    els.progressText.textContent = `Processing: ${i + 1} / ${items.length}`;
    els.progressDetail.textContent = `Currently processing: ${item.name}`;

    try {
      // Default to sequential to avoid 429 (rate limit / quota bursts).
      // If you want to restore parallel, we can add a UI toggle later.
      let imageForAI = item.fullImage;
      if (state.optimizeImagesEnabled && state.optimizeMaxSidePx > 0) {
        els.progressDetail.textContent = `Optimizing image (max side ${state.optimizeMaxSidePx}px)...`;
        imageForAI = await downscaleDataUrlToMaxSide(item.fullImage, state.optimizeMaxSidePx);
        if (imageForAI !== item.fullImage) {
          console.log(`[image downscale] -> max side ${state.optimizeMaxSidePx}px`);
        }
      }

      if (!state.clearTextEnabled) {
        els.progressDetail.textContent = "Clear text disabled — skipping text removal.";
      } else {
        els.progressDetail.textContent = "AI is removing text (step 1/2)...";
      }
      let cleaned = null;
      if (state.clearTextEnabled) {
        try {
          cleaned = await removeTextWithGemini(imageForAI);
        } catch (e) {
          const info = classifyApiError(e);
          console.warn('Text removal failed:', info, e);
        }
      }

      els.progressDetail.textContent = state.clearTextEnabled
        ? "AI is recognizing text (step 2/2)..."
        : "AI is recognizing text (OCR)...";
      let ocrBlocks = [];
      try {
        ocrBlocks = await ocrWithGemini(imageForAI);
        const before = ocrBlocks?.length || 0;
        ocrBlocks = postprocessOcrBlocks(ocrBlocks);
        const after = ocrBlocks?.length || 0;
        if (before && after !== before) {
          console.log(`[ocr postprocess] blocks: ${before} -> ${after}`);
        }
      } catch (e) {
        const info = classifyApiError(e);
        console.warn('OCR failed:', info, e);
      }

      if (!cleaned && (!ocrBlocks || ocrBlocks.length === 0)) {
        throw new Error("Both text removal and OCR failed (likely quota/rate limit).");
      }

      state.results.push({
        name: item.name,
        original: item.fullImage,
        cleaned: cleaned || item.fullImage,
        textBlocks: ocrBlocks,
      });
    } catch (error) {
      const info = classifyApiError(error);
      console.error("Processing failed:", info, error);
      showToast(info.userMessage);
      state.results.push({
        name: item.name,
        original: item.fullImage,
        cleaned: item.fullImage,
        textBlocks: [],
        error: info.userMessage,
      });
    }

    // Gentle delay between pages to reduce 429s.
    if (i < items.length - 1) await wait(2500);
  }

  showSection(els, els.resultsSection);
  renderResults(els);
}

function wireHandlers(els) {
  els.dropZone.onclick = () => els.fileInput.click();
  els.fileInput.onchange = (e) => handleFiles(els, e.target.files);

  els.dropZone.ondragover = (e) => {
    e.preventDefault();
    els.dropZone.classList.add('dragover');
  };
  els.dropZone.ondragleave = () => els.dropZone.classList.remove('dragover');
  els.dropZone.ondrop = (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    handleFiles(els, e.dataTransfer.files);
  };

  els.selectAllBtn.onclick = () => {
    state.pendingItems.forEach((i) => (i.selected = true));
    renderSelectionGrid(els);
  };
  els.deselectAllBtn.onclick = () => {
    state.pendingItems.forEach((i) => (i.selected = false));
    renderSelectionGrid(els);
  };

  els.processBtn.onclick = async () => {
    const selected = state.pendingItems.filter((i) => i.selected);
    if (selected.length === 0) return showToast('Please select at least one item');
    showSection(els, els.processingSection);
    await processItems(els, selected);
  };

  els.exportBtn.onclick = async () => {
    await exportToPptx(state.results);
    showToast('PPTX exported successfully!');
  };

  els.resetBtn.onclick = () => {
    state.pendingItems = [];
    state.results = [];
    els.fileInput.value = '';
    showSection(els, els.uploadSection);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  requireCdnGlobals();
  const els = getEls();
  initStaticUiHandlers(els);
  wireApiKeySave(els);
  ensureApiKey(els);
  wireHandlers(els);
});

