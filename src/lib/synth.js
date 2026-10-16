// デモ・テスト用の合成写真: 板張りの床に爪楊枝をばらまいて真上から撮った絵(グレースケール 0..1)。
// 正解(針の両端・板目)も一緒に返すので、検出の取りこぼしや誤検出をテストで数えられる。
import { mulberry32, gauss } from './rng.js';

export const DEMO_DEFAULTS = {
  W: 960,
  H: 720,
  count: 60,
  spacing: 150, // 板目の間隔 t [px]
  length: 104, // 爪楊枝の長さ l [px](r ≈ 0.69)
  width: 4.5, // 爪楊枝の太さ [px]
  angleDeg: 6, // 板目の傾き
  noise: 0.02,
  shadow: true,
  margin: 40, // 画像の外にはみ出す針も少し混ぜる
};

export function makeFloor(opts = {}) {
  const o = { ...DEMO_DEFAULTS, ...opts };
  const { W, H, spacing: t, length: L, width: wid } = o;
  const rng = mulberry32(o.seed ?? 1);
  const a = (o.angleDeg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a); // 板目の向き
  const nx = -uy, ny = ux; // 板目の法線
  const c0 = rng() * t;
  const grid = { nx, ny, c0, t };

  // 板ごとの色と木目の位相
  const tone = new Map();
  const plank = (k) => {
    if (!tone.has(k)) tone.set(k, { base: 0.5 + rng() * 0.14, ph: rng() * 100, f: 5 + rng() * 4 });
    return tone.get(k);
  };

  const gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = nx * x + ny * y - c0;
      const u = ux * x + uy * y;
      const k = Math.floor(s / t);
      const p = plank(k);
      const within = s - k * t;
      // 木目: 板に沿った縞をゆらがせる
      let v = p.base + 0.035 * Math.sin((2 * Math.PI * within) / p.f + 1.3 * Math.sin(u / 70 + p.ph)) + 0.02 * Math.sin(u / 23 + p.ph * 3);
      // 継ぎ目: 暗い溝
      const d = Math.min(within, t - within);
      if (d < 2.5) v = v * (0.45 + 0.55 * smooth(d / 2.5));
      gray[y * W + x] = v;
    }
  }

  // 針の配置(中心は画像より少し広い範囲に一様、向きは一様)
  const needles = [];
  for (let i = 0; i < o.count; i++) {
    const cx = -o.margin + rng() * (W + 2 * o.margin);
    const cy = -o.margin + rng() * (H + 2 * o.margin);
    const th = rng() * Math.PI;
    const dx = (Math.cos(th) * L) / 2, dy = (Math.sin(th) * L) / 2;
    needles.push({ x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, tone: 0.86 + rng() * 0.06 });
  }

  // 影(ぼけた暗がり)→ 針の順に描く
  if (o.shadow) {
    for (const nd of needles) {
      paintStick(gray, W, H, offset(nd, 2.2, 3), wid + 2.5, (cov, i) => { gray[i] *= 1 - 0.28 * cov; }, 1.6);
    }
  }
  for (const nd of needles) {
    paintStick(gray, W, H, nd, wid, (cov, i, uAlong) => {
      const c = nd.tone + 0.025 * Math.sin(uAlong / 6);
      gray[i] = gray[i] * (1 - cov) + c * cov;
    }, 0.5);
  }

  for (let i = 0; i < gray.length; i++) gray[i] = clamp01(gray[i] + o.noise * gauss(rng));

  // 校正用のタップ位置(画像中心に近い継ぎ目とその隣)
  const sc = nx * (W / 2) + ny * (H / 2);
  const s0 = c0 + t * Math.round((sc - c0) / t);
  const ta = { x: W / 2 + nx * (s0 - sc), y: H / 2 + ny * (s0 - sc) };
  const tb = { x: ta.x + nx * t, y: ta.y + ny * t };

  return { W, H, gray, grid, needles: needles.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })), taps: [ta, tb], length: L, spacing: t };
}

function offset(s, dx, dy) {
  return { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
}

/** 先の尖った棒を、覆う割合 cov(0..1)で塗る。soft は縁のぼけ幅。 */
function paintStick(gray, W, H, s, wid, put, soft) {
  const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
  const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
  const tip = wid * 2.2;
  const pad = wid + soft + 2;
  const x0 = Math.max(0, Math.floor(Math.min(s.x1, s.x2) - pad));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(s.x1, s.x2) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(s.y1, s.y2) - pad));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(s.y1, s.y2) + pad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x - cx, py = y - cy;
      const u = px * ux + py * uy;
      const v = Math.abs(-px * uy + py * ux);
      const e = L / 2 - Math.abs(u); // 端までの距離
      if (e < -soft) continue;
      const hw = (wid / 2) * Math.min(1, Math.max(0, e) / tip + 0.08);
      const cov = clamp01((hw - v) / (2 * soft) + 0.5) * clamp01(e / (2 * soft) + 0.5);
      if (cov > 0) put(cov, y * W + x, u);
    }
  }
}

function smooth(x) {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** グレースケールを木の色っぽい RGBA にする(画面表示用)。 */
export function grayToRGBA(gray, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const g = gray[i];
    out[i * 4] = 255 * Math.min(1, g * 1.08 + 0.06);
    out[i * 4 + 1] = 255 * Math.min(1, g * 0.92 + 0.02);
    out[i * 4 + 2] = 255 * Math.min(1, g * 0.68);
    out[i * 4 + 3] = 255;
  }
  return out;
}
