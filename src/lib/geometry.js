// 板目(等間隔の平行線)と針(線分)の幾何。
//
// grid = { nx, ny, c0, t }: 法線 (nx, ny) 方向の座標 s = nx·x + ny·y が c0 + k·t の所に線がある。

/**
 * 2点タップから板目を作る。a は継ぎ目の上の点、b は隣の継ぎ目の上の点。
 * normalAngle(画像から推定した板目の法線の向き)があればそれを使い、間隔はその方向への射影で測る。
 * なければ a→b をそのまま法線とみなす(まっすぐ隣をタップした前提)。
 */
export function buildGrid(a, b, normalAngle = null, minSpacing = 8) {
  let nx, ny;
  if (normalAngle == null) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < minSpacing) return null;
    nx = dx / len; ny = dy / len;
  } else {
    nx = Math.cos(normalAngle); ny = Math.sin(normalAngle);
  }
  const sa = nx * a.x + ny * a.y;
  const sb = nx * b.x + ny * b.y;
  const t = Math.abs(sb - sa);
  if (t < minSpacing) return null;
  return { nx, ny, c0: sa, t };
}

/** 点が何番目の板の上にあるか。 */
export function band(grid, x, y) {
  return Math.floor((grid.nx * x + grid.ny * y - grid.c0) / grid.t);
}

/** 線分が板目を1本以上またぐか。 */
export function crosses(grid, seg) {
  return band(grid, seg.x1, seg.y1) !== band(grid, seg.x2, seg.y2);
}

/** 線分と板目(線の向き)のなす角 φ ∈ [0, π/2]。 */
export function angleToSeams(grid, seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  return Math.asin(Math.min(1, Math.abs(grid.nx * dx + grid.ny * dy) / len));
}

export function segLength(seg) {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

/** 中心と向きはそのままに、長さだけ len にそろえた線分。 */
export function withLength(seg, len) {
  const cx = (seg.x1 + seg.x2) / 2, cy = (seg.y1 + seg.y2) / 2;
  const l = segLength(seg) || 1;
  const ux = (seg.x2 - seg.x1) / l, uy = (seg.y2 - seg.y1) / l;
  return { x1: cx - (ux * len) / 2, y1: cy - (uy * len) / 2, x2: cx + (ux * len) / 2, y2: cy + (uy * len) / 2 };
}

/** 点と線分の距離。 */
export function distToSeg(p, seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const l2 = dx * dx + dy * dy;
  let u = l2 ? ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / l2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (seg.x1 + u * dx), p.y - (seg.y1 + u * dy));
}

/** 画面に描くための、画像内に入る板目の線分一覧。 */
export function gridLines(grid, W, H) {
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => grid.nx * x + grid.ny * y);
  const kMin = Math.ceil((Math.min(...corners) - grid.c0) / grid.t);
  const kMax = Math.floor((Math.max(...corners) - grid.c0) / grid.t);
  const ux = -grid.ny, uy = grid.nx; // 線の向き
  const R = Math.hypot(W, H);
  const lines = [];
  for (let k = kMin; k <= kMax; k++) {
    const s = grid.c0 + k * grid.t;
    const along = ux * (W / 2) + uy * (H / 2); // 画像中心を線に射影した位置
    const px = grid.nx * s + ux * along, py = grid.ny * s + uy * along;
    lines.push({ k, x1: px - ux * R, y1: py - uy * R, x2: px + ux * R, y2: py + uy * R });
  }
  return lines;
}
