// 確率的 Hough 変換(PPHT, Matas ら)で、エッジ画素から線分を取り出す。
// 投票は各画素の勾配の向き ±angleTol の範囲だけにする(向きのわかっているエッジなので、雑音の投票が減る)。
import { mulberry32 } from './rng.js';

export const HOUGH_DEFAULTS = {
  thetaBins: 180,
  angleTolDeg: 6,
  threshold: 14, // 1本の線とみなす最小票数
  minLength: 14, // [px]
  maxGap: 3, // 途切れを許す長さ [px]
  seed: 7,
};

/**
 * mask: Uint8Array(1 = エッジ), gx, gy: 勾配。mask は書き換える(使った画素を消す)のでコピーを渡すこと。
 * 返り値: [{ x1, y1, x2, y2, count }](端点は拾った画素への最小二乗直線の両端)
 */
export function houghSegments(mask, gx, gy, W, H, opts = {}) {
  const o = { ...HOUGH_DEFAULTS, ...opts };
  const nT = o.thetaBins;
  const cosT = new Float32Array(nT), sinT = new Float32Array(nT);
  for (let k = 0; k < nT; k++) { cosT[k] = Math.cos((k * Math.PI) / nT); sinT[k] = Math.sin((k * Math.PI) / nT); }
  const diag = Math.ceil(Math.hypot(W, H));
  const nR = 2 * diag + 1;
  const acc = new Int32Array(nT * nR);
  const tol = Math.max(1, Math.round((o.angleTolDeg / 180) * nT));

  const pts = [];
  for (let i = 0; i < W * H; i++) if (mask[i]) pts.push(i);
  const rng = mulberry32(o.seed);
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
  }
  const voted = new Uint8Array(W * H);

  // 画素 i の投票先の θ 範囲(勾配の向き=線の法線)
  const thetaCenter = (i) => {
    let a = Math.atan2(gy[i], gx[i]);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    return Math.round((a / Math.PI) * nT) % nT;
  };
  const vote = (i, d) => {
    const x = i % W, y = (i - x) / W;
    const c = thetaCenter(i);
    let best = -1, bestK = -1;
    for (let dk = -tol; dk <= tol; dk++) {
      let k = c + dk;
      if (k < 0) k += nT; else if (k >= nT) k -= nT; // θ と θ+π は同じ直線(ρ は bin の θ で測り直す)
      const rho = x * cosT[k] + y * sinT[k];
      const idx = k * nR + Math.round(rho) + diag;
      acc[idx] += d;
      if (acc[idx] > best) { best = acc[idx]; bestK = k; }
    }
    return { best, bestK };
  };

  const segs = [];
  for (const p of pts) {
    if (!mask[p]) continue;
    const { best, bestK } = vote(p, 1);
    voted[p] = 1;
    if (best < o.threshold) continue;

    // 線の向き(法線 θ に直交)に沿って両側へたどる
    const px = p % W, py = (p - px) / W;
    const dx = -sinT[bestK], dy = cosT[bestK];
    const found = [];
    const ends = [];
    for (const sgn of [1, -1]) {
      let gap = 0;
      let lastX = px, lastY = py;
      for (let s = sgn; ; s += sgn) {
        const fx = px + dx * s, fy = py + dy * s;
        const ix = Math.round(fx), iy = Math.round(fy);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) break;
        const hit = pickNeighbor(mask, W, H, ix, iy, dx, dy);
        if (hit >= 0) {
          gap = 0;
          lastX = hit % W; lastY = (hit - lastX) / W;
          found.push(hit);
        } else if (++gap > o.maxGap) break;
      }
      ends.push([lastX, lastY]);
    }
    found.push(p);
    const len = Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]);
    const good = len >= o.minLength;
    for (const i of found) {
      if (good && voted[i]) { vote(i, -1); voted[i] = 0; }
      mask[i] = 0;
    }
    if (good) segs.push(fitSegment(found, W));
  }
  return segs;
}

// 線の真上か、法線方向に1画素ずれた所にあるエッジ画素(細線化のずれを許す)。
function pickNeighbor(mask, W, H, ix, iy, dx, dy) {
  const i = iy * W + ix;
  if (mask[i]) return i;
  const ox = Math.round(-dy), oy = Math.round(dx);
  for (const s of [1, -1]) {
    const x = ix + ox * s, y = iy + oy * s;
    if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) return y * W + x;
  }
  return -1;
}

/** 画素の集まりに主成分で直線を当て、射影の両端を端点にする。 */
export function fitSegment(idx, W) {
  let mx = 0, my = 0;
  for (const i of idx) { mx += i % W; my += Math.floor(i / W); }
  mx /= idx.length; my /= idx.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of idx) {
    const x = (i % W) - mx, y = Math.floor(i / W) - my;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let tMin = Infinity, tMax = -Infinity;
  for (const i of idx) {
    const t = ((i % W) - mx) * ux + (Math.floor(i / W) - my) * uy;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  return { x1: mx + ux * tMin, y1: my + uy * tMin, x2: mx + ux * tMax, y2: my + uy * tMax, count: idx.length };
}
