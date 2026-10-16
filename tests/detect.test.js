import { describe, it, expect, beforeAll } from 'vitest';
import { makeFloor } from '../src/lib/synth.js';
import { detectNeedles, summarizeShot, isCounted, typicalLength, THETA0_DEG } from '../src/lib/needles.js';
import { calibrateGrid } from '../src/lib/calibrate.js';
import { crosses, segLength } from '../src/lib/geometry.js';
import { houghSegments } from '../src/lib/hough.js';
import { sobel, nonMaxSuppress, blur3, dominantOrientation } from '../src/lib/image.js';
import { matchNeedles, visibleTruth } from './helpers/match.js';

const SEEDS = [1, 2, 3, 4];
const runs = [];

beforeAll(() => {
  for (const seed of SEEDS) {
    const f = makeFloor({ seed });
    // タップは数 px ずらす(人の指はぴったり継ぎ目に乗らない)
    const a = { x: f.taps[0].x + 3, y: f.taps[0].y - 2 };
    const b = { x: f.taps[1].x - 4, y: f.taps[1].y + 3 };
    const cal = calibrateGrid(f.gray, f.W, f.H, a, b);
    const det = detectNeedles(f.gray, f.W, f.H, cal.grid);
    const shot = summarizeShot(det.needles, cal.grid);
    runs.push({ f, cal, det, shot });
  }
}, 60000);

describe('板目の校正', () => {
  it('向きは 0.1° 以内、間隔は 0.5px 以内、ずれたタップも継ぎ目に吸着する', () => {
    for (const { f, cal } of runs) {
      const truth = Math.atan2(f.grid.ny, f.grid.nx);
      expect(Math.abs(cal.normalAngle - truth) * 180 / Math.PI).toBeLessThan(0.1);
      expect(Math.abs(cal.grid.t - f.grid.t)).toBeLessThan(0.5);
      const d = (((cal.grid.c0 - f.grid.c0) % f.grid.t) + f.grid.t * 1.5) % f.grid.t - f.grid.t / 2;
      expect(Math.abs(d)).toBeLessThan(1);
      expect(cal.snapped).toBe(true);
    }
  });
  it('継ぎ目が見えない画像ではタップを信じる(吸着しない)', () => {
    const W = 200, H = 150;
    const gray = new Float32Array(W * H).fill(0.5);
    const cal = calibrateGrid(gray, W, H, { x: 100, y: 30 }, { x: 100, y: 110 });
    expect(cal.snapped).toBe(false);
    expect(cal.grid.t).toBeCloseTo(80, 0);
  });
});

describe('針の検出(合成写真)', () => {
  it('画像に収まる針の 90% 以上を「数える」と判定する', () => {
    let vis = 0, found = 0;
    for (const { f, det } of runs) {
      const v = visibleTruth(f, THETA0_DEG);
      const m = matchNeedles(v, det.needles.filter(isCounted));
      vis += v.length;
      found += m.pairs.filter((p) => p.found).length;
    }
    expect(found / vis).toBeGreaterThan(0.9);
  });
  it('数えた針はほぼすべて本物(正解の針のどれかに対応する)', () => {
    let counted = 0, fake = 0;
    for (const { f, det } of runs) {
      const ok = det.needles.filter(isCounted);
      const m = matchNeedles(f.needles, ok);
      counted += ok.length;
      fake += m.extra.length;
    }
    expect(fake / counted).toBeLessThan(0.03);
  });
  it('対応した針の「またぐ/またがない」はほぼ正解どおりで、偏りもない', () => {
    let n = 0, wrong = 0, under = 0, over = 0;
    for (const { f, det } of runs) {
      const m = matchNeedles(visibleTruth(f, THETA0_DEG), det.needles.filter(isCounted));
      for (const p of m.pairs) {
        if (!p.found) continue;
        n++;
        const t = crosses(f.grid, p.truth);
        if (t !== p.found.crosses) { wrong++; if (t) under++; else over++; }
      }
    }
    expect(wrong / n).toBeLessThan(0.03);
    expect(Math.abs(under - over)).toBeLessThanOrEqual(3);
  });
  it('針の長さ(先端の細い所まで)は 2% 以内', () => {
    for (const { f, shot } of runs) expect(Math.abs(shot.lengthPx / f.length - 1)).toBeLessThan(0.02);
  });
  it('画像の端で切れた針は数えず、端で切れたとして除外する', () => {
    for (const { f, det } of runs) {
      const cut = f.needles.filter((t) => [t.x1, t.x2].some((x) => x < 0 || x > f.W) || [t.y1, t.y2].some((y) => y < 0 || y > f.H));
      const m = matchNeedles(cut, det.needles.filter(isCounted), { maxCenter: 20 });
      expect(m.pairs.filter((p) => p.found).length).toBe(0);
    }
    expect(runs.some((r) => r.shot.border > 0)).toBe(true);
  });
  it('板目から 10° 未満の針は数えない', () => {
    for (const { det } of runs) for (const nd of det.needles) if (nd.status === 'parallel') expect(isCounted(nd)).toBe(false);
  });
});

describe('利用者の補正', () => {
  it('除外を数える側に、数えるを除外に切り替えられ、手で足した針も数える', () => {
    const { det, cal } = runs[0];
    const needles = det.needles.map((n) => ({ ...n }));
    const base = summarizeShot(needles, cal.grid);
    const okOne = needles.find((n) => n.status === 'ok');
    okOne.forced = 'out';
    expect(summarizeShot(needles, cal.grid).n).toBe(base.n - 1);
    const g = cal.grid;
    // 板目に直交する手描きの針(長さは典型と同じ)
    const L = base.lengthPx;
    const x = 300, y = 300;
    needles.push({ x1: x - g.nx * L / 2, y1: y - g.ny * L / 2, x2: x + g.nx * L / 2, y2: y + g.ny * L / 2, status: 'ok', source: 'manual' });
    const s = summarizeShot(needles, cal.grid);
    expect(s.n).toBe(base.n);
    expect(s.manual).toBe(1);
  });
  it('板目と平行な針は、手で「数える」にしても数えない', () => {
    expect(isCounted({ status: 'parallel', forced: 'in' })).toBe(false);
  });
});

describe('部品', () => {
  it('Hough: 1本の太線から両縁の2本の線分を取り出す', () => {
    const W = 120, H = 80;
    const g = new Float32Array(W * H).fill(0.3);
    for (let y = 0; y < H; y++) for (let x = 20; x < 100; x++) if (Math.abs(y - (20 + 0.4 * (x - 20))) < 2.5) g[y * W + x] = 0.9;
    const s = sobel(blur3(g, W, H), W, H);
    const thin = nonMaxSuppress(s.gx, s.gy, s.mag, W, H);
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = thin[i] > 0.05 ? 1 : 0;
    const segs = houghSegments(mask, s.gx, s.gy, W, H, { minLength: 30 });
    const long = segs.filter((q) => segLength(q) > 60);
    expect(long.length).toBe(2);
    for (const q of long) expect(Math.abs((q.y2 - q.y1) / (q.x2 - q.x1) - 0.4)).toBeLessThan(0.03);
  });
  it('板目の向きの見当: 縞模様の法線', () => {
    const W = 100, H = 100;
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 0.5 + 0.3 * Math.sin((x * 0.5 + y * 0.866) / 3);
    const s = sobel(g, W, H);
    const d = dominantOrientation(s.gx, s.gy, s.mag);
    expect(d.normalAngle * 180 / Math.PI).toBeCloseTo(60, 0);
    expect(d.strength).toBeGreaterThan(0.9);
  });
  it('典型的な長さは破片に引きずられない', () => {
    expect(typicalLength([100, 101, 99, 102, 40, 55, 61, 30, 100.5])).toBeCloseTo(100.5, 0);
    expect(typicalLength([])).toBeNull();
  });
});
