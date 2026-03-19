export async function exportToPptx(results) {
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const slide = pptx.addSlide();
    slide.addImage({ data: result.cleaned, x: 0, y: 0, w: '100%', h: '100%' });

    if (result.textBlocks && result.textBlocks.length > 0) {
      result.textBlocks.forEach((block) => {
        if (!block.text || !block.text.trim()) return;
        if (!block.box_2d || block.box_2d.length !== 4) return;

        const [ymin, xmin, ymax, xmax] = block.box_2d;
        const textOptions = {
          x: `${xmin / 10}%`,
          y: `${ymin / 10}%`,
          w: `${Math.max((xmax - xmin) / 10, 5)}%`,
          h: `${Math.max((ymax - ymin) / 10, 2)}%`,
          fontSize: block.font_size_pt || 14,
          color: (block.color || "000000").replace("#", ""),
          fontFace: 'Arial',
          valign: 'top',
        };

        if (block.font_weight === 'bold') textOptions.bold = true;
        if (block.font_style === 'italic') textOptions.italic = true;
        if (block.text_align) textOptions.align = block.text_align;

        slide.addText(block.text, textOptions);
      });
    }
  }

  await pptx.writeFile({ fileName: `NotebookLM_${Date.now()}.pptx` });
}

