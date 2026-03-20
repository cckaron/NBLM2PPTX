export const state = {
  apiKey: localStorage.getItem('gemini_api_key') || "",
  pendingItems: [],
  results: [],
  rateLimitCount: 0,
  clearTextEnabled: false,
  optimizeImagesEnabled: true,
  optimizeMaxSidePx: 1024,
  // Clear text (image output). Cheaper option for paid tier:
  // gemini-2.5-flash-image is typically cheaper per 1K output image than 3.1 flash-image-preview.
  modelImageEdit: "gemini-3.1-flash-image-preview",
  modelTextGen: "gemini-3.1-flash-lite-preview",
};

export function setApiKey(key) {
  state.apiKey = key;
  localStorage.setItem('gemini_api_key', key);
}

export function setOcrModel(mode) {
  state.modelTextGen = mode === "standard"
    ? "gemini-3.1-pro-preview"
    : "gemini-3.1-flash-lite-preview";
}

