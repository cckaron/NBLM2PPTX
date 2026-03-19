import { state, setApiKey, setOcrModel } from "./state.js";
import { showToast } from "./utils.js";

export function getEls() {
  return {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    uploadSection: document.getElementById('upload-section'),
    selectionSection: document.getElementById('selection-section'),
    processingSection: document.getElementById('processing-section'),
    resultsSection: document.getElementById('results-section'),
    selectionGrid: document.getElementById('selection-grid'),
    resultsGrid: document.getElementById('results-grid'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    progressDetail: document.getElementById('progress-detail'),
    exportBtn: document.getElementById('export-btn'),
    resetBtn: document.getElementById('reset-btn'),
    selectAllBtn: document.getElementById('select-all-btn'),
    deselectAllBtn: document.getElementById('deselect-all-btn'),
    processBtn: document.getElementById('process-btn'),
    apiKeyModal: document.getElementById('api-key-modal'),
    apiKeyInput: document.getElementById('api-key-input'),
    saveApiKeyBtn: document.getElementById('save-api-key-btn'),
    alertHeader: document.getElementById('alert-header'),
    alertContent: document.getElementById('alert-content'),
    toolsTrigger: document.getElementById('tools-trigger'),
    toolsContent: document.getElementById('tools-content'),
    ocrModelInfo: document.getElementById('ocr-model-info'),
    clearTextModel: document.getElementById('clear-text-model'),
    ocrModel: document.getElementById('ocr-model'),
    clearTextToggle: document.getElementById('clear-text-toggle'),
    clearTextWarning: document.getElementById('clear-text-warning'),
    optimizeToggle: document.getElementById('optimize-toggle'),
    optimizeSize: document.getElementById('optimize-size'),
    clearTextStatus: document.getElementById('clear-text-status'),
  };
}

export function updateModelMapping(els) {
  if (els.clearTextModel) els.clearTextModel.textContent = state.modelImageEdit;
  if (els.ocrModel) els.ocrModel.textContent = state.modelTextGen;
  if (els.clearTextToggle) els.clearTextToggle.checked = !!state.clearTextEnabled;
  if (els.clearTextWarning) {
    els.clearTextWarning.style.display = state.clearTextEnabled ? 'none' : 'block';
  }
  if (els.optimizeToggle) els.optimizeToggle.checked = !!state.optimizeImagesEnabled;
  if (els.optimizeSize) els.optimizeSize.value = String(state.optimizeMaxSidePx);

  if (els.clearTextStatus) {
    els.clearTextStatus.textContent = state.clearTextEnabled ? 'On' : 'Off';
    els.clearTextStatus.classList.toggle('badge-on', state.clearTextEnabled);
    els.clearTextStatus.classList.toggle('badge-off', !state.clearTextEnabled);
  }
  if (els.clearTextModel) {
    els.clearTextModel.classList.toggle('code-dim', !state.clearTextEnabled);
  }
}

export function initStaticUiHandlers(els) {
  updateModelMapping(els);

  els.clearTextToggle?.addEventListener('change', (e) => {
    state.clearTextEnabled = !!e.target.checked;
    updateModelMapping(els);
  });

  els.optimizeToggle?.addEventListener('change', (e) => {
    state.optimizeImagesEnabled = !!e.target.checked;
    updateModelMapping(els);
  });

  els.optimizeSize?.addEventListener('change', (e) => {
    const val = Number(e.target.value);
    state.optimizeMaxSidePx = Number.isFinite(val) ? val : 1024;
    updateModelMapping(els);
  });

  els.alertHeader?.addEventListener('click', function () {
    this.classList.toggle('expanded');
    els.alertContent?.classList.toggle('expanded');
  });

  els.toolsTrigger?.addEventListener('click', function () {
    this.classList.toggle('active');
    els.toolsContent?.classList.toggle('active');
  });

  document.querySelectorAll('input[name="ocr-model"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      setOcrModel(mode);
      updateModelMapping(els);
      if (!els.ocrModelInfo) return;
      if (mode === 'lite') {
        els.ocrModelInfo.innerHTML =
          '⚡ <strong>Lite Model</strong> (<code>gemini-3.1-flash-lite-preview</code>): Text content and position accurate, but font size, weight, color unified → Suitable for plain text conversion';
      } else {
        els.ocrModelInfo.innerHTML =
          '🎨 <strong>Standard Model</strong> (<code>gemini-3.1-pro-preview</code>): Full detection of font size, bold, color and other styles → Preserves visual hierarchy, suitable for beautiful presentations';
      }
      console.log(`OCR model switched to: ${state.modelTextGen}`);
    });
  });
}

export function ensureApiKey(els) {
  if (state.apiKey) return;
  showApiKeyModal(els);
}

export function showApiKeyModal(els) {
  if (!els.apiKeyModal) return;
  els.apiKeyModal.classList.remove('hidden');
  els.apiKeyModal.style.display = 'flex';
}

export function hideApiKeyModal(els) {
  if (!els.apiKeyModal) return;
  els.apiKeyModal.classList.add('hidden');
  els.apiKeyModal.style.display = 'none';
}

export function wireApiKeySave(els) {
  els.saveApiKeyBtn.onclick = () => {
    const key = (els.apiKeyInput?.value || "").trim();
    if (!key) return showToast('Please enter an API Key');
    if (!key.startsWith('AIza')) return showToast('Invalid API Key format, should start with AIza');
    setApiKey(key);
    hideApiKeyModal(els);
    showToast('API Key saved');
  };
}

export function renderSelectionGrid(els) {
  els.selectionGrid.innerHTML = state.pendingItems
    .map(
      (item, idx) => `
        <div class="thumbnail-item ${item.selected ? 'selected' : ''}" data-index="${idx}">
          <div class="checkbox-wrapper" style="position: absolute; top: 0.5rem; right: 0.5rem; z-index: 10;">
            <input type="checkbox" ${item.selected ? 'checked' : ''}>
            <div class="checkbox-custom">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
          </div>
          <img src="${item.thumbnail}" alt="${item.name}">
          <p class="text-xs text-muted" style="margin-top: 0.5rem; text-align: center;">${item.name}</p>
        </div>
      `
    )
    .join('');

  document.querySelectorAll('.thumbnail-item').forEach((el) => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.index, 10);
      state.pendingItems[idx].selected = !state.pendingItems[idx].selected;
      renderSelectionGrid(els);
    };
  });
}

export function renderResults(els) {
  els.resultsGrid.innerHTML = state.results
    .map(
      (r) => `
        <div class="result-card">
          <img src="${r.cleaned}" alt="${r.name}">
          <div class="result-card-content">
            <p class="text-sm font-semibold">${r.name}</p>
            ${r.error ? `<p class="text-xs" style="color: var(--color-danger);">Error: ${r.error}</p>` : ''}
            ${r.textBlocks.length > 0 ? `<p class="text-xs text-muted">${r.textBlocks.length} text blocks</p>` : ''}
          </div>
        </div>
      `
    )
    .join('');
}

export function showSection(els, section) {
  els.uploadSection.classList.add('hidden');
  els.selectionSection.classList.add('hidden');
  els.processingSection.classList.add('hidden');
  els.resultsSection.classList.add('hidden');
  section.classList.remove('hidden');
}

