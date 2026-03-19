function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function num(n, fallback = 0) {
  return Number.isFinite(n) ? n : fallback;
}

function box(block) {
  const b = block?.box_2d;
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = b.map((v) => num(v, 0));
  return { ymin, xmin, ymax, xmax };
}

function yCenter(b) {
  return (b.ymin + b.ymax) / 2;
}

function xOverlap(a, b) {
  const left = Math.max(a.xmin, b.xmin);
  const right = Math.min(a.xmax, b.xmax);
  return Math.max(0, right - left);
}

function yOverlap(a, b) {
  const top = Math.max(a.ymin, b.ymin);
  const bottom = Math.min(a.ymax, b.ymax);
  return Math.max(0, bottom - top);
}

function unionBox(a, b) {
  return {
    ymin: Math.min(a.ymin, b.ymin),
    xmin: Math.min(a.xmin, b.xmin),
    ymax: Math.max(a.ymax, b.ymax),
    xmax: Math.max(a.xmax, b.xmax),
  };
}

function shouldInsertSpace(prevText, nextText, gap) {
  if (!prevText || !nextText) return false;
  const last = prevText.slice(-1);
  const first = nextText[0];
  if (last === ' ' || first === ' ') return false;
  // If blocks are very close, avoid adding extra space.
  if (gap <= 6) return false;
  // If punctuation, avoid spaces like "word,".
  if ([',', '.', ':', ';', ')', ']', '}', '，', '。', '：', '；', '）'].includes(first)) return false;
  if (['(', '[', '{', '（'].includes(last)) return false;
  return true;
}

/**
 * Merge OCR blocks to reduce fragmentation:
 * - Sort blocks reading order (top-to-bottom, left-to-right)
 * - Merge blocks on the same visual line
 * - Merge consecutive lines into a paragraph block when aligned
 */
export function postprocessOcrBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const normalized = blocks
    .map((b) => {
      const bb = box(b);
      if (!bb) return null;
      const text = String(b.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        ...b,
        text,
        _box: bb,
      };
    })
    .filter(Boolean);

  // Sort by y center, then x
  normalized.sort((a, b) => {
    const ay = yCenter(a._box);
    const by = yCenter(b._box);
    if (Math.abs(ay - by) > 6) return ay - by;
    return a._box.xmin - b._box.xmin;
  });

  // Step 1: merge into lines
  const lines = [];
  const LINE_Y_TOL = 10; // in 0-1000 space
  const MIN_Y_OVERLAP_RATIO = 0.35;
  const MAX_X_GAP = 18;

  for (const blk of normalized) {
    let placed = false;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const ly = line.y;
      const by = yCenter(blk._box);
      if (Math.abs(by - ly) > LINE_Y_TOL) {
        if (by > ly) break;
        continue;
      }

      const lineBox = line.box;
      const yOv = yOverlap(lineBox, blk._box);
      const minH = Math.min(lineBox.ymax - lineBox.ymin, blk._box.ymax - blk._box.ymin);
      const yOvRatio = minH > 0 ? yOv / minH : 0;
      if (yOvRatio < MIN_Y_OVERLAP_RATIO) continue;

      // If it belongs to same line, merge/append based on x position
      const gap = blk._box.xmin - lineBox.xmax;
      if (gap < -15) {
        // overlapping backward: insert by x later
      } else if (gap > MAX_X_GAP) {
        // too far: likely another column/box
        continue;
      }

      line.blocks.push(blk);
      line.box = unionBox(line.box, blk._box);
      line.y = yCenter(line.box);
      placed = true;
      break;
    }

    if (!placed) {
      lines.push({
        blocks: [blk],
        box: { ...blk._box },
        y: yCenter(blk._box),
      });
    }
  }

  // Finalize line text by x order
  const mergedLines = lines.map((line) => {
    const ordered = line.blocks.slice().sort((a, b) => a._box.xmin - b._box.xmin);
    let text = ordered[0].text;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      const gap = cur._box.xmin - prev._box.xmax;
      text += (shouldInsertSpace(text, cur.text, gap) ? ' ' : '') + cur.text;
    }
    // Use first block's style hints (lite often missing; ok)
    const ref = ordered[0];
    return {
      ...ref,
      text,
      box_2d: [line.box.ymin, line.box.xmin, line.box.ymax, line.box.xmax],
      _lineBox: line.box,
    };
  });

  // Step 2: merge lines into paragraphs when aligned
  const paras = [];
  const PARA_X_ALIGN_TOL = 18;
  const PARA_Y_GAP_TOL = 18;

  for (const ln of mergedLines) {
    const b = box(ln) || ln._lineBox;
    const h = b.ymax - b.ymin;
    const last = paras[paras.length - 1];

    if (last) {
      const lb = last._box;
      const yGap = b.ymin - lb.ymax;
      const xAligned = Math.abs(b.xmin - lb.xmin) <= PARA_X_ALIGN_TOL;
      const similarHeight = Math.abs((lb.ymax - lb.ymin) - h) <= 12;

      if (xAligned && yGap >= -2 && yGap <= Math.max(PARA_Y_GAP_TOL, h * 0.55) && similarHeight) {
        last.text = `${last.text}\n${ln.text}`;
        last._box = unionBox(lb, b);
        last.box_2d = [last._box.ymin, last._box.xmin, last._box.ymax, last._box.xmax];
        continue;
      }
    }

    paras.push({
      ...ln,
      _box: { ...b },
    });
  }

  // Cleanup private fields + clamp coordinates
  return paras.map((p) => {
    const b = p._box || box(p);
    const ymin = clamp(b.ymin, 0, 1000);
    const xmin = clamp(b.xmin, 0, 1000);
    const ymax = clamp(b.ymax, 0, 1000);
    const xmax = clamp(b.xmax, 0, 1000);
    const out = { ...p, box_2d: [ymin, xmin, ymax, xmax] };
    delete out._box;
    delete out._lineBox;
    delete out._box;
    return out;
  });
}

