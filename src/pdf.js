import { showToast } from "./utils.js";

export function initPdfLibrary() {
  try {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return true;
    }
  } catch (e) {
    console.error(e);
  }
  showToast('PDF.js loading failed, please refresh the page');
  return false;
}

export async function loadPdfPages(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const thumbnail = await renderPage(page, 0.5);
    const fullImage = await renderPage(page, 2.0, i);

    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(' ').trim();

    pages.push({
      type: 'pdf',
      name: `${file.name} - Page ${i}`,
      pageNum: i,
      thumbnail,
      fullImage,
      text,
      selected: true,
    });
  }

  return pages;
}

async function renderPage(page, scale, pageNum = null) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  // Only log for full-resolution renders to avoid spamming console.
  if (scale >= 2.0) {
    const pageLabel = pageNum ? `page ${pageNum}` : 'page';
    console.log(`[pdf render] ${pageLabel} scale=${scale} -> ${Math.round(viewport.width)}x${Math.round(viewport.height)} px`);
  }

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
}

