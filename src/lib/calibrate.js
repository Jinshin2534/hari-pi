// 板目の校正: 2点タップ(継ぎ目とその隣の継ぎ目)+画像からの向き合わせ。
//
// 向きが 1° ずれると、幅 1000px の写真の端では線が 17px もずれて交差判定が狂う。
// そこで「板目に沿って画素を足し合わせた断面(投影プロファイル)」が一番くっきりする角度を探す。
// 継ぎ目はその断面で鋭い谷になるので、タップ位置も近くの谷に吸着させる。
import { blur3, sobel, dominantOrientation } from './image.js';
import { buildGrid } from './geometry.js';

const deg = (d) => (d * Math.PI) / 180;

/** 法線角 ang 方向への投影プロファイル(1px ビンの平均)。step 画素おきに間引く。 */
export function projectionProfile(gray, W, H, ang, step = 2) {
  const nx = Math.cos(ang), ny = Math.sin(ang);
  const corners = [0, nx * W, ny * H, nx * W + ny * H];
  const sMin = Math.floor(Math.min(...corners));
  const len = Math.ceil(Math.max(...corners)) - sMin + 1;
  const sum = new Float64Array(len), cnt = new Float64Array(len);
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const s = nx * x + ny * y - sMin;
      const i = Math.floor(s), f = s - i;
      const v = gray[y * W + x];
      sum[i] += v * (1 - f); cnt[i] += 1 - f;
      sum[i + 1] += v * f; cnt[i + 1] += f;
    }
  }
  const prof = new Float64Array(len);
  for (let i = 0; i < len; i++) prof[i] = cnt[i] > 0 ? sum[i] / cnt[i] : NaN;
  return { prof, sMin, cnt };
}

/** 移動平均を引いた断面(ゆるやかな明るさの変化を消す)。データの少ない端は NaN。 */
export function highPass(prof, cnt, win = 21) {
  const n = prof.length;
  const out = new Float64Array(n).fill(NaN);
  const minCnt = Math.max(...cnt) * 0.25;
  for (let i = 0; i < n; i++) {
    if (!(cnt[i] >= minCnt)) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      if (cnt[j] >= minCnt) { s += prof[j]; c++; }
    }
    out[i] = prof[i] - s / c;
  }
  return out;
}

function sharpness(gray, W, H, ang) {
  const { prof, cnt } = projectionProfile(gray, W, H, ang);
  const hp = highPass(prof, cnt);
  let s = 0, c = 0;
  for (const v of hp) if (!Number.isNaN(v)) { s += v * v; c++; }
  return c ? s / c : 0;
}

/** 断面が一番くっきりする法線角を、粗→細で探す。 */
export function refineAngle(gray, W, H, ang0, rangeDeg = 4) {
  // 平らな画像では差が出ないので、はっきり良くならない限り見当の角度のまま
  let best = ang0, bestS = sharpness(gray, W, H, ang0) * 1.01 + 1e-12;
  for (let d = -rangeDeg; d <= rangeDeg + 1e-9; d += 0.25) {
    const s = sharpness(gray, W, H, ang0 + deg(d));
    if (s > bestS) { bestS = s; best = ang0 + deg(d); }
  }
  const c = best;
  for (let d = -0.3; d <= 0.3 + 1e-9; d += 0.03) {
    const s = sharpness(gray, W, H, c + deg(d));
    if (s > bestS) { bestS = s; best = c + deg(d); }
  }
  return best;
}

function interp(arr, x) {
  const i = Math.floor(x), f = x - i;
  if (i < 0 || i + 1 >= arr.length) return NaN;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

/**
 * 2点タップから板目を決める。
 * 1) 勾配の向きの平均で板目の向きの見当をつける(弱ければタップの向きを使う)
 * 2) 投影プロファイルで角度を詰める
 * 3) タップ位置を近くの谷(継ぎ目)に吸着させ、全部の継ぎ目の谷が揃うよう間隔と位相を微調整
 * 返り値 { grid, normalAngle, strength, snapped }
 */
export function calibrateGrid(gray, W, H, a, b, opts = {}) {
  const snapPx = opts.snapPx ?? 6;
  const g = blur3(gray, W, H);
  const { gx, gy, mag } = sobel(g, W, H);
  const dom = dominantOrientation(gx, gy, mag);
  const tapAng = Math.atan2(b.y - a.y, b.x - a.x);
  let ang0 = dom.normalAngle;
  let range = 4;
  if (dom.strength < 0.15) { ang0 = tapAng; range = 8; }
  let ang = refineAngle(g, W, H, ang0, range);
  // a→b の向きと法線の向きをそろえる(符号だけ)
  if (Math.cos(ang - tapAng) < 0) ang += Math.PI;
  const rough = buildGrid(a, b, ang);
  if (!rough) return null;

  const { prof, sMin, cnt } = projectionProfile(g, W, H, ang, 1);
  const hp = highPass(prof, cnt);
  const snap = (s) => {
    let best = s, bestV = Infinity;
    for (let d = -snapPx; d <= snapPx; d += 0.25) {
      const v = interp(hp, s + d - sMin);
      if (v < bestV) { bestV = v; best = s + d; }
    }
    return { s: best, v: bestV };
  };
  const nx = Math.cos(ang), ny = Math.sin(ang);
  const sa = snap(nx * a.x + ny * a.y);
  const sb = snap(nx * b.x + ny * b.y);
  // 谷がはっきりしない(継ぎ目が見えない)ならタップを信じる
  let noise = 0, c = 0;
  for (const v of hp) if (!Number.isNaN(v)) { noise += v * v; c++; }
  noise = Math.sqrt(noise / Math.max(1, c));
  const clear = sa.v < -1.5 * noise && sb.v < -1.5 * noise;
  if (!clear) return { grid: rough, normalAngle: ang, strength: dom.strength, snapped: false };

  // 全部の継ぎ目の谷の深さの和が最小になる (c0, t) を、吸着した値のまわりで探す
  let c0 = sa.s, t = sb.s - sa.s;
  let bestScore = Infinity, bestC0 = c0, bestT = t;
  const score = (cc, tt) => {
    let s = 0, n = 0;
    const lo = sMin, hi = sMin + hp.length - 1;
    for (let k = Math.ceil((lo - cc) / tt); cc + k * tt <= hi; k++) {
      const v = interp(hp, cc + k * tt - sMin);
      if (!Number.isNaN(v)) { s += v; n++; }
    }
    return n ? s / n : Infinity;
  };
  for (let dt = -0.03 * t; dt <= 0.03 * t; dt += 0.1) {
    for (let dc = -2; dc <= 2; dc += 0.25) {
      const sc = score(c0 + dc, t + dt);
      if (sc < bestScore) { bestScore = sc; bestC0 = c0 + dc; bestT = t + dt; }
    }
  }
  return {
    grid: { nx, ny, c0: bestC0, t: Math.abs(bestT) },
    normalAngle: ang,
    strength: dom.strength,
    snapped: true,
  };
}
