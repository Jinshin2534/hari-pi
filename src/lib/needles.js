// 爪楊枝(針)の検出: Sobel → 細線化 → 板目と平行なエッジを捨てる → 確率的 Hough → 縁の対を組む →
// 重複をまとめる → 途切れをつなぐ → 明暗の断面で端を詰める → 自信のないものを除外。
import { blur3, sobel, nonMaxSuppress, quantileNonZero } from './image.js';
import { houghSegments } from './hough.js';
import { crosses, angleToSeams, segLength, withLength } from './geometry.js';

export const THETA0_DEG = 10; // 板目からこの角度未満の針は数えない(木目と区別できない)

export const DETECT_DEFAULTS = {
  theta0Deg: THETA0_DEG,
  filterMarginDeg: 3, // エッジの段階では少し狭く捨て、最後に針の角度で厳密に切る
  edgeQuantile: 0.9,
  edgeFactor: 0.45,
  minEdge: 0.012,
  maxAngleDeg: 5, // 縁の対・重複とみなす角度差
  lengthTol: 0.12, // 長さが典型から ±12% を外れたら自信なし(重なりで伸び縮みしたもの)
  minSupport: 0.7, // 断面で棒らしく見える割合
  minContrast: 0.03,
  borderMargin: 8, // 断面を見る脇の点が画像からはみ出さない距離
};

const deg = (d) => (d * Math.PI) / 180;
const TIP_K = 0.05;
const NOISE_SUPPORT = 0.4; // これ未満は針の候補ですらない
const SEAM_HALF = 4; // 継ぎ目の溝とみなす幅の半分 [px]

/**
 * gray: Float32Array, grid: 板目(向きを使う)。
 * 返り値 { needles: [{ x1,y1,x2,y2, status, paired, contrast, support }], lengthPx, edgeCount }
 * status: 'ok' | 'weak'(棒らしさが足りない) | 'length'(長さが合わない) | 'border'(画像の端で切れている) | 'parallel'(板目と平行で対象外)
 */
export function detectNeedles(gray, W, H, grid, opts = {}) {
  const o = { ...DETECT_DEFAULTS, ...opts };
  const g = blur3(gray, W, H);
  const { gx, gy, mag } = sobel(g, W, H);
  const thin = nonMaxSuppress(gx, gy, mag, W, H);
  const thr = Math.max(o.minEdge, quantileNonZero(thin, o.edgeQuantile) * o.edgeFactor);

  // 板目と平行に近いエッジ(継ぎ目・木目)を捨てる
  let seamNormal = Math.atan2(grid.ny, grid.nx);
  if (seamNormal < 0) seamNormal += Math.PI;
  const cut = deg(o.theta0Deg - o.filterMarginDeg);
  const mask = new Uint8Array(W * H);
  let edgeCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (thin[i] < thr) continue;
    let a = Math.atan2(gy[i], gx[i]);
    if (a < 0) a += Math.PI;
    let d = Math.abs(a - seamNormal);
    if (d > Math.PI / 2) d = Math.PI - d;
    if (d < cut) continue;
    mask[i] = 1;
    edgeCount++;
  }

  const maxW = Math.max(9, grid.t * 0.08);
  const img = { g, W, H, grid };
  const segs = houghSegments(mask, gx, gy, W, H).map((s) => describeEdge(s, gx, gy, mag, W, H));
  let cands = pairEdges(segs, maxW, deg(o.maxAngleDeg));
  cands = dedupe(cands, maxW, deg(o.maxAngleDeg));
  const defaultHw = median(cands.filter((c) => c.paired).map((c) => c.width / 2)) || 2;
  const prelimL = typicalLength(cands.filter((c) => c.paired).map(segLength));
  cands = joinCollinear(cands, prelimL);

  let out = cands.map((c) => refine(c, img, c.paired ? c.width / 2 : defaultHw));
  const typL = typicalLength(out.filter((c) => c.support >= o.minSupport && c.contrast >= o.minContrast).map(segLength));
  out = mergeRefined(out, maxW, deg(o.maxAngleDeg), typL, img);
  const good = out.filter((c) => c.support >= o.minSupport && c.contrast >= o.minContrast && !nearBorder(c, W, H, o.borderMargin));
  const lengthPx = typicalLength(good.map(segLength)) || typicalLength(out.map(segLength)) || 0;

  for (const c of out) {
    const L = segLength(c);
    if (angleToSeams(grid, c) < deg(o.theta0Deg)) c.status = 'parallel';
    else if (nearBorder(c, W, H, o.borderMargin)) c.status = 'border';
    else if (c.contrast < o.minContrast || c.support < o.minSupport) c.status = 'weak';
    else if (!lengthPx || Math.abs(L / lengthPx - 1) > o.lengthTol) c.status = 'length';
    else c.status = 'ok';
  }
  // 棒に見えないもの(木目・雑音の線分)と極端に短い破片は、針の候補として見せもしない
  const needles = out.filter((c) => segLength(c) >= Math.max(10, lengthPx * 0.4) && c.contrast >= o.minContrast && c.support >= NOISE_SUPPORT);
  return { needles, lengthPx, edgeCount, threshold: thr };
}

function nearBorder(c, W, H, m) {
  return [c.x1, c.x2].some((x) => x < m || x > W - 1 - m) || [c.y1, c.y2].some((y) => y < m || y > H - 1 - m);
}

/** Hough の線分に、向き・中心・縁の極性(勾配が法線のどちら向きか)・強さを付ける。 */
function describeEdge(s, gx, gy, mag, W, H) {
  const L = segLength(s);
  const ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
  const nx = -uy, ny = ux;
  let dot = 0, cnt = 0;
  for (let t = 0; t <= L; t += 1) {
    let bx = Math.round(s.x1 + ux * t), by = Math.round(s.y1 + uy * t);
    // 法線方向 ±1 で一番強い画素
    let best = -1, bi = -1;
    for (let k = -1; k <= 1; k++) {
      const x = Math.round(bx + nx * k), y = Math.round(by + ny * k);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (mag[i] > best) { best = mag[i]; bi = i; }
    }
    if (bi < 0) continue;
    dot += gx[bi] * nx + gy[bi] * ny;
    cnt++;
  }
  const meanDot = cnt ? dot / cnt : 0;
  return { ...s, L, ux, uy, nx, ny, cx: (s.x1 + s.x2) / 2, cy: (s.y1 + s.y2) / 2, pol: Math.sign(meanDot), strength: Math.abs(meanDot) };
}

function angleDiff(a, b) {
  // 向き(符号なし)の角度差
  return Math.acos(Math.min(1, Math.abs(a.ux * b.ux + a.uy * b.uy)));
}

/** b の範囲を a の軸に射影した区間と、a 自身の区間 [-L/2, L/2]。 */
function projRange(a, b) {
  const t1 = (b.x1 - a.cx) * a.ux + (b.y1 - a.cy) * a.uy;
  const t2 = (b.x2 - a.cx) * a.ux + (b.y2 - a.cy) * a.uy;
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

function overlapFrac(a, b) {
  const [b0, b1] = projRange(a, b);
  const ov = Math.min(a.L / 2, b1) - Math.max(-a.L / 2, b0);
  return ov / Math.min(a.L, b1 - b0 || 1);
}

/** 2本の線分から、中心線(端は両者の和集合)を作る。 */
function centerline(a, b, extra) {
  let bx = b.ux, by = b.uy;
  if (a.ux * bx + a.uy * by < 0) { bx = -bx; by = -by; }
  let ux = a.ux * a.L + bx * b.L, uy = a.uy * a.L + by * b.L;
  const n = Math.hypot(ux, uy);
  ux /= n; uy /= n;
  const mx = (a.cx * a.L + b.cx * b.L) / (a.L + b.L), my = (a.cy * a.L + b.cy * b.L) / (a.L + b.L);
  let t0 = Infinity, t1 = -Infinity;
  for (const [x, y] of [[a.x1, a.y1], [a.x2, a.y2], [b.x1, b.y1], [b.x2, b.y2]]) {
    const t = (x - mx) * ux + (y - my) * uy;
    t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  return makeCand({ x1: mx + ux * t0, y1: my + uy * t0, x2: mx + ux * t1, y2: my + uy * t1, ...extra });
}

function makeCand(c) {
  const L = segLength(c);
  const ux = (c.x2 - c.x1) / (L || 1), uy = (c.y2 - c.y1) / (L || 1);
  return { ...c, L, ux, uy, nx: -uy, ny: ux, cx: (c.x1 + c.x2) / 2, cy: (c.y1 + c.y2) / 2 };
}

/**
 * 棒の両側の縁(平行・近い・極性が逆)を対にする。強い縁どうしを優先(柔らかい影の縁より棒の縁が強い)。
 */
export function pairEdges(segs, maxW, maxAng) {
  const pairs = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (angleDiff(a, b) > maxAng) continue;
      const off = a.nx * (b.cx - a.cx) + a.ny * (b.cy - a.cy);
      const d = Math.abs(off);
      if (d < 1 || d > maxW) continue;
      if (overlapFrac(a, b) < 0.5) continue;
      // 共通の法線 a.n で見た極性が逆(明るい棒なら両縁とも内向き、暗い棒なら外向き)
      const pb = Math.sign(b.nx * a.nx + b.ny * a.ny) * b.pol;
      if (a.pol === 0 || pb !== -a.pol) continue;
      pairs.push({ i, j, d, off, score: Math.min(a.strength, b.strength) });
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  const used = new Uint8Array(segs.length);
  const out = [];
  for (const p of pairs) {
    if (used[p.i] || used[p.j]) continue;
    used[p.i] = used[p.j] = 1;
    const a = segs[p.i], b = segs[p.j];
    const bright = a.pol === Math.sign(p.off); // a の勾配が b の側(=棒の内側)を向く → 明るい棒
    out.push(centerline(a, b, { paired: true, width: p.d, bar: bright ? 1 : -1, strength: p.score }));
  }
  segs.forEach((s, i) => {
    if (!used[i]) out.push(makeCand({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, paired: false, width: 0, bar: 0, strength: s.strength }));
  });
  return out;
}

/** 同じ棒を指す候補(影の縁の取り残しなど)をまとめる。対になったもの・長いものを残す。 */
export function dedupe(cands, maxW, maxAng) {
  const order = [...cands].sort((a, b) => (b.paired - a.paired) || (b.L - a.L));
  const kept = [];
  for (const c of order) {
    const dup = kept.some((k) => {
      if (angleDiff(k, c) > maxAng * 1.4) return false;
      const d = Math.abs(k.nx * (c.cx - k.cx) + k.ny * (c.cy - k.cy));
      return d <= maxW * 1.2 && overlapFrac(k, c) > 0.3;
    });
    if (!dup) kept.push(c);
  }
  return kept;
}

/** 同じ直線上で途切れた破片(重なり・影)をつなぐ。つないだ長さが典型の 1.25 倍を超えるならつながない。 */
export function joinCollinear(cands, typicalL) {
  let list = [...cands];
  const maxGap = Math.max(8, (typicalL || 40) * 0.35);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (angleDiff(a, b) > deg(4)) continue;
        const da = Math.abs(a.nx * (b.cx - a.cx) + a.ny * (b.cy - a.cy));
        const db = Math.abs(b.nx * (a.cx - b.cx) + b.ny * (a.cy - b.cy));
        if (Math.max(da, db) > 3) continue;
        const [b0, b1] = projRange(a, b);
        const gap = Math.max(b0 - a.L / 2, -a.L / 2 - b1);
        if (gap > maxGap) continue;
        const total = Math.max(a.L / 2, b1) - Math.min(-a.L / 2, b0);
        if (typicalL && total > typicalL * 1.25) continue;
        const merged = centerline(a, b, {
          paired: a.paired || b.paired,
          width: Math.max(a.width, b.width),
          bar: a.bar || b.bar,
          strength: Math.max(a.strength, b.strength),
        });
        list.splice(j, 1);
        list[i] = merged;
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

function sample(g, W, H, x, y) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = g[y0 * W + x0], b = g[y0 * W + x1], c = g[y1 * W + x0], d = g[y1 * W + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** 軸上の位置 t における「棒らしさ」= 中心の明るさと両脇の差(棒の明暗 bar で符号をそろえる)。 */
function inGroove(grid, x, y) {
  if (!grid) return false;
  const s = grid.nx * x + grid.ny * y - grid.c0;
  return Math.abs(s - grid.t * Math.round(s / grid.t)) < SEAM_HALF;
}

function contrastAt(img, c, t, hw, bar) {
  const { g, W, H, grid } = img;
  const px = c.cx + c.ux * t, py = c.cy + c.uy * t;
  let center = 0;
  for (const v of [-hw * 0.4, 0, hw * 0.4]) center += sample(g, W, H, px + c.nx * v, py + c.ny * v);
  center /= 3;
  const side = hw + 2.5;
  // 比べる脇の点: ふつうは針に直交する向き。ただし継ぎ目の溝の上では、溝に沿った向きの点と比べる
  // (直交方向の脇は溝の外の明るい板に出てしまい、溝の上の細い先端が「棒らしくない」と誤判定される)
  let ox = c.nx * side, oy = c.ny * side;
  if (inGroove(grid, px, py)) {
    const sinPhi = Math.abs(grid.nx * c.ux + grid.ny * c.uy);
    const k = side / Math.max(sinPhi, 0.17);
    ox = -grid.ny * k; oy = grid.nx * k;
  }
  const a = sample(g, W, H, px + ox, py + oy);
  const b = sample(g, W, H, px - ox, py - oy);
  if ([center, a, b].some(Number.isNaN)) return NaN;
  // 影が片側にあっても、明るい棒ならより明るい脇、暗い棒ならより暗い脇と比べる
  return bar > 0 ? center - Math.max(a, b) : Math.min(a, b) - center;
}

/** 明暗の断面で端を詰め・伸ばし、棒らしさ(contrast の中央値)と支持率(support)を測る。 */
export function refine(c, img, hw) {
  const bars = c.bar ? [c.bar] : [1, -1];
  let best = null;
  for (const bar of bars) {
    const prof = [];
    for (let t = -c.L / 2; t <= c.L / 2; t += 1) prof.push(contrastAt(img, c, t, hw, bar));
    const valid = prof.filter((v) => !Number.isNaN(v));
    const med = median(valid) ?? 0;
    if (!best || med > best.med) best = { bar, med };
  }
  const { bar, med } = best;
  const on = (t, k = 0.3) => {
    const v = contrastAt(img, c, t, hw, bar);
    // 溝の上は溝どうしで比べるので雑音に負けやすい。低いしきい値は使わない
    if (k < 0.3 && inGroove(img.grid, c.cx + c.ux * t, c.cy + c.uy * t)) k = 0.3;
    return !Number.isNaN(v) && v > k * med;
  };
  let t0 = -c.L / 2, t1 = c.L / 2;
  if (med > 0) {
    // 端の詰め: 棒らしくない端を削る
    while (t1 - t0 > 4 && !on(t1) && !on(t1 - 1)) t1 -= 1;
    while (t1 - t0 > 4 && !on(t0) && !on(t0 + 1)) t0 += 1;
    // 伸ばし: 尖った先は縁が弱くて Hough が拾いきれない
    const ext = c.L * 0.25 + 6;
    const lim1 = t1 + ext, lim0 = t0 - ext;
    // 交差する別の棒の上では棒らしさが消えるので、先で棒が続いていれば跳び越す
    const bridge = Math.ceil(2 * hw + 6);
    const runAhead = (t, dir) => {
      for (let k = 1; k <= bridge; k++) {
        if ([0, 1, 2, 3].every((m) => on(t + dir * (k + m)))) return k;
      }
      return 0;
    };
    for (;;) {
      if (t1 < lim1 && (on(t1 + 1) || on(t1 + 2))) { t1 += 1; continue; }
      const k = t1 < lim1 ? runAhead(t1, 1) : 0;
      if (k && t1 + k <= lim1) { t1 += k; continue; }
      break;
    }
    for (;;) {
      if (t0 > lim0 && (on(t0 - 1) || on(t0 - 2))) { t0 -= 1; continue; }
      const k = t0 > lim0 ? runAhead(t0, -1) : 0;
      if (k && t0 - k >= lim0) { t0 -= k; continue; }
      break;
    }
    // 尖った先の最後の数画素は細くて薄いので、低いしきい値で 1 画素ずつだけ追う
    while (t1 < lim1 && on(t1 + 0.5, TIP_K)) t1 += 0.5;
    while (t0 > lim0 && on(t0 - 0.5, TIP_K)) t0 -= 0.5;
  }
  let hits = 0, n = 0;
  for (let t = t0; t <= t1; t += 1) { n++; if (on(t)) hits++; }
  const x1 = c.cx + c.ux * t0, y1 = c.cy + c.uy * t0, x2 = c.cx + c.ux * t1, y2 = c.cy + c.uy * t1;
  return {
    x1, y1, x2, y2,
    paired: c.paired,
    bar,
    width: c.width,
    hw,
    contrast: med,
    support: n ? hits / n : 0,
    source: 'auto',
  };
}

/**
 * 典型的な長さ(最頻値寄り): ±10% の幅に一番多く集まる長さの中央値。
 * 途切れた破片は短い側にばらけ、丸ごと見えた針は一か所に固まるので、ただの中央値より破片に引きずられない。
 */
export function typicalLength(lengths) {
  if (!lengths.length) return null;
  let best = [], bestL = 0;
  for (const L of lengths) {
    const win = lengths.filter((x) => x >= L * 0.9 && x <= L * 1.1);
    if (win.length > best.length || (win.length === best.length && L > bestL)) { best = win; bestL = L; }
  }
  return median(best);
}

/**
 * 端を詰めたあとに重なった・つながった候補(同じ棒の別の破片、影の縁から作った候補)をまとめる。
 * 線は棒らしさの強いほうに合わせ、範囲は和集合。典型の長さを大きく超えるならまとめない(別の棒)。
 */
export function mergeRefined(list, maxW, maxAng, typL, img) {
  let items = list.map((c) => makeCand(c));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (angleDiff(a, b) > maxAng) continue;
        const d = Math.abs(a.nx * (b.cx - a.cx) + a.ny * (b.cy - a.cy));
        if (d > maxW) continue;
        const [b0, b1] = projRange(a, b);
        const gap = Math.max(b0 - a.L / 2, -a.L / 2 - b1);
        if (gap > 3) continue;
        const [keep, other] = a.contrast >= b.contrast ? [a, b] : [b, a];
        const [o0, o1] = projRange(keep, other);
        const t0 = Math.min(-keep.L / 2, o0), t1 = Math.max(keep.L / 2, o1);
        if (typL && t1 - t0 > typL * 1.15) continue;
        const joined = makeCand({
          x1: keep.cx + keep.ux * t0, y1: keep.cy + keep.uy * t0,
          x2: keep.cx + keep.ux * t1, y2: keep.cy + keep.uy * t1,
          paired: keep.paired || other.paired, width: keep.width, bar: keep.bar,
        });
        items.splice(j, 1);
        items[i] = makeCand(refine(joined, img, keep.hw));
        changed = true;
        break outer;
      }
    }
  }
  return items.map(({ L, ux, uy, nx, ny, cx, cy, ...rest }) => rest);
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 数える針か(利用者の上書き forced: 'in' | 'out' を優先)。板目と平行なものは上書きしても数えない。 */
export function isCounted(nd) {
  if (nd.status === 'parallel') return false;
  if (nd.forced === 'in') return true;
  if (nd.forced === 'out') return false;
  return nd.status === 'ok';
}

/**
 * 1枚の写真の集計。長さ l は数えた針の長さの中央値、交差判定はその長さにそろえた針で行う
 * (推定式の r = l/t と判定を同じ長さにするため)。
 */
export function summarizeShot(needles, grid, theta0Deg = THETA0_DEG) {
  const counted = needles.filter((nd) => isCounted(nd) && angleToSeams(grid, nd) >= deg(theta0Deg));
  const lengthPx = median(counted.map(segLength)) ?? 0;
  let h = 0;
  for (const nd of counted) {
    nd.crosses = crosses(grid, withLength(nd, lengthPx));
    if (nd.crosses) h++;
  }
  for (const nd of needles) if (!counted.includes(nd)) nd.crosses = null;
  const parallel = needles.filter((nd) => nd.status === 'parallel').length;
  return {
    n: counted.length,
    h,
    r: grid.t > 0 ? lengthPx / grid.t : 0,
    lengthPx,
    spacingPx: grid.t,
    excluded: needles.length - counted.length - parallel, // 数えなかった候補(端で切れた + 自信なし)
    border: needles.filter((nd) => !counted.includes(nd) && nd.status === 'border').length,
    parallel,
    manual: counted.filter((nd) => nd.source === 'manual').length,
  };
}
