import { state } from "./state.js";
import { getGenAI } from "./genaiClient.js";
import { withExponentialBackoff } from "./retry.js";

const CLEAR_TEXT_PROMPT_PASS_1 = `Task: Produce an edited version of the input slide image with ALL readable text removed.

Hard requirements:
1) Remove every visible character and glyph: titles, body text, tiny captions, letters, numbers, punctuation, bullets, labels, logo words, and watermarks.
2) Any dark/light strokes that form readable glyph-like patterns must be removed, even when attached to icons, separators, or shapes.
3) If a region is ambiguous (text vs decoration), treat it as text and remove it.
4) Keep non-text graphics unchanged: plain shapes, icons without letters, arrows, lines, photos, colors, layout, and spacing.
5) Fill removed text regions by inpainting local background so no blank white patches remain.
6) Do NOT add any new text, symbols, or artifacts.
7) Preserve original resolution and aspect ratio.

Output: image only.`;

const CLEAR_TEXT_PROMPT_PASS_2 = `Second-pass cleanup on this already edited slide image.
Remove any residual readable text strokes still visible after first pass, especially small body text near icons, separators, and shape borders.
Keep non-text graphics and layout unchanged.
No new text, no extra symbols, no blur overlays. Output image only.`;

async function runClearTextPass(ai, imageDataUrl, prompt) {
  const response = await withExponentialBackoff(
    () =>
      ai.models.generateContent({
        model: state.modelImageEdit,
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/png", data: imageDataUrl.split(',')[1] } },
          ],
        }],
        config: {
          temperature: 0.15,
          topK: 32,
          topP: 1,
          maxOutputTokens: 4096,
          responseModalities: ['image'],
        },
      }),
    {
      maxRetries: 4,
      baseDelayMs: 900,
      onRetry: ({ attempt, delayMs }) => {
        console.warn(`[retry] clear-text 429, attempt ${attempt}, waiting ${delayMs}ms`);
      },
    }
  );

  const finishReason = response?.candidates?.[0]?.finishReason;
  if (finishReason === 'IMAGE_RECITATION') {
    throw new Error("Image processing restricted: Gemini detected potential copyright issues");
  }

  const part = response?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData?.data) {
    console.error('Image edit response:', response);
    throw new Error('Image model did not return image data.');
  }
  return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
}

export async function removeTextWithGemini(base64) {
  const ai = getGenAI();

  const pass1 = await runClearTextPass(ai, base64, CLEAR_TEXT_PROMPT_PASS_1);
  const pass2 = await runClearTextPass(ai, pass1, CLEAR_TEXT_PROMPT_PASS_2);
  return pass2;
}

export async function ocrWithGemini(base64) {
  const ai = getGenAI();

  const response = await withExponentialBackoff(
    () =>
      ai.models.generateContent({
        model: state.modelTextGen,
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Analyze this image and extract all text blocks with precise positioning and styling.
For each text block, provide:
- text: the exact text content
- box_2d: bounding box as [ymin, xmin, ymax, xmax] in 0-1000 coordinate system
- font_size_pt: estimated font size in points (typical range: 8-72)
- font_weight: "normal" or "bold"
- font_style: "normal" or "italic"
- text_align: "left", "center", or "right"
- color: hex color code like "000000" or "FFFFFF"
- line_height: line height multiplier (typically 1.0-2.0)

Return as JSON array.`,
            },
            { inlineData: { mimeType: "image/png", data: base64.split(',')[1] } },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                box_2d: { type: "ARRAY", items: { type: "NUMBER" }, minItems: 4, maxItems: 4 },
                font_size_pt: { type: "NUMBER" },
                font_weight: { type: "STRING" },
                font_style: { type: "STRING" },
                text_align: { type: "STRING" },
                color: { type: "STRING" },
                line_height: { type: "NUMBER" },
              },
            },
          },
        },
      }),
    {
      maxRetries: 4,
      baseDelayMs: 700,
      onRetry: ({ attempt, delayMs }) => {
        console.warn(`[retry] ocr 429, attempt ${attempt}, waiting ${delayMs}ms`);
      },
    }
  );

  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("OCR JSON parsing failed:", e, text);
    return [];
  }
}

