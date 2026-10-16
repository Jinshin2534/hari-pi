// 検出結果と正解の針を突き合わせる(中心が近く向きがそろっているもの同士)。
import { segLength, angleToSeams } from '../../src/lib/geometry.js';

export function matchNeedles(truth, found, { maxCenter = 8, maxAngleDeg = 6 } = {}) {
  const used = new Set();
  const pairs = [];
  for (const t of truth) {
    const tc = { x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 };
    const ta = Math.atan2(t.y2 - t.y1, t.x2 - t.x1);
    let best = null, bestD = Infinity;
    found.forEach((f, i) => {
      if (used.has(i)) return;
      const fc = { x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2 };
      const d = Math.hypot(tc.x - fc.x, tc.y - fc.y);
      let da = Math.abs(ta - Math.atan2(f.y2 - f.y1, f.x2 - f.x1)) % Math.PI;
      da = Math.min(da, Math.PI - da);
      if (d < maxCenter && da < (maxAngleDeg * Math.PI) / 180 && d < bestD) { best = i; bestD = d; }
    });
    if (best != null) { used.add(best); pairs.push({ truth: t, found: found[best] }); }
    else pairs.push({ truth: t, found: null });
  }
  const extra = found.filter((_, i) => !used.has(i));
  return { pairs, extra };
}

/** 画像の中に完全に収まり、板目からθ0+余裕以上傾いている正解の針(検出できて当然のもの)。 */
export function visibleTruth(floor, theta0Deg, marginDeg = 2, border = 6) {
  const grid = floor.grid;
  return floor.needles.filter((t) => {
    const inside = [t.x1, t.x2].every((x) => x > border && x < floor.W - border) && [t.y1, t.y2].every((y) => y > border && y < floor.H - border);
    return inside && angleToSeams(grid, t) > ((theta0Deg + marginDeg) * Math.PI) / 180;
  });
}

export { segLength };
