// グレースケール画像の下ごしらえ: Sobel 勾配・細線化・しきい値・板目の向き。
// 画像は Float32Array(行優先, 0..1)と幅 W・高さ H で持つ。

export function rgbaToGray(data, W, H) {
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    g[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  }
  return g;
}

/** 3x3 二項フィルタ(ノイズを少し落とす)。 */
export function blur3(src, W, H) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = src[y * W + Math.max(0, x - 1)], r = src[y * W + Math.min(W - 1, x + 1)];
      tmp[y * W + x] = (l + 2 * src[y * W + x] + r) / 4;
    }
  }
  for (let y = 0; y < H; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) out[y * W + x] = (tmp[yu * W + x] + 2 * tmp[y * W + x] + tmp[yd * W + x]) / 4;
  }
  return out;
}

/** Sobel 勾配。端の1画素は 0。 */
export function sobel(g, W, H) {
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = g[i - W - 1], b = g[i - W], c = g[i - W + 1];
      const d = g[i - 1], f = g[i + 1];
      const p = g[i + W - 1], q = g[i + W], r = g[i + W + 1];
      const sx = (c + 2 * f + r - a - 2 * d - p) / 8;
      const sy = (p + 2 * q + r - a - 2 * b - c) / 8;
      gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag };
}

/** 勾配方向に沿った非極大抑制(エッジを1画素幅にする)。 */
export function nonMaxSuppress(gx, gy, mag, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = mag[i];
      if (m === 0) continue;
      const ang = Math.atan2(gy[i], gx[i]);
      let a = ((ang * 180) / Math.PI + 180) % 180; // 0..180
      let n1, n2;
      if (a < 22.5 || a >= 157.5) { n1 = mag[i - 1]; n2 = mag[i + 1]; }
      else if (a < 67.5) { n1 = mag[i - W - 1]; n2 = mag[i + W + 1]; }
      else if (a < 112.5) { n1 = mag[i - W]; n2 = mag[i + W]; }
      else { n1 = mag[i - W + 1]; n2 = mag[i + W - 1]; }
      if (m >= n1 && m > n2) out[i] = m;
    }
  }
  return out;
}

/** 0 でない値の分位点(大きい画像は間引いて数える)。 */
export function quantileNonZero(arr, q) {
  const step = Math.max(1, Math.floor(arr.length / 200000));
  const vals = [];
  for (let i = 0; i < arr.length; i += step) if (arr[i] > 0) vals.push(arr[i]);
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
}

/**
 * 板目の法線の向きを推定する: 勾配の向きを2倍角で強さ付き平均。継ぎ目と木目が同じ向きに揃うので効く。
 * strength は 0(向きがばらばら)〜1(全部そろっている)。
 */
export function dominantOrientation(gx, gy, mag) {
  let c = 0, s = 0, w = 0;
  for (let i = 0; i < mag.length; i++) {
    const m = mag[i];
    if (m === 0) continue;
    // cos2θ = (gx²−gy²)/m², sin2θ = 2gxgy/m² に強さ m を掛ける
    c += (gx[i] * gx[i] - gy[i] * gy[i]) / m;
    s += (2 * gx[i] * gy[i]) / m;
    w += m;
  }
  if (w === 0) return { normalAngle: 0, strength: 0 };
  let ang = Math.atan2(s, c) / 2;
  if (ang < 0) ang += Math.PI;
  return { normalAngle: ang, strength: Math.hypot(c, s) / w };
}
