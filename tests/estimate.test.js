import { describe, it, expect } from 'vitest';
import { crossProb, wilson, solvePi, estimatePi, verdict, needlesNeeded, Z95 } from '../src/lib/estimate.js';
import { mulberry32 } from '../src/lib/rng.js';

const th10 = (10 * Math.PI) / 180;

// 針を純粋に幾何で投げる(検出なし)。角度は板目に対して [0, π) 一様、θ0 未満は数えない。
function throwNeedles(rng, count, r, theta0) {
  let n = 0, h = 0;
  for (let i = 0; i < count; i++) {
    const phi = rng() * Math.PI;
    const a = Math.min(phi, Math.PI - phi); // 板目となす角 [0, π/2]
    if (a < theta0) continue;
    const y = rng(); // 中心の位置(間隔 1 で正規化)
    const half = (r * Math.sin(a)) / 2;
    n++;
    if (Math.floor(y - half) !== Math.floor(y + half)) h++;
  }
  return { n, h, r };
}

describe('crossProb', () => {
  it('θ0 = 0, r ≤ 1 なら 2r/π', () => {
    expect(crossProb(0.7, 0, Math.PI)).toBeCloseTo((2 * 0.7) / Math.PI, 12);
    expect(crossProb(1, 0, Math.PI)).toBeCloseTo(2 / Math.PI, 12);
  });
  it('θ0 = 0, r > 1 なら長い針の公式', () => {
    const r = 1.6;
    const known = (2 / Math.PI) * (Math.acos(1 / r) + r - Math.sqrt(r * r - 1));
    expect(crossProb(r, 0, Math.PI)).toBeCloseTo(known, 12);
  });
  it('r = 1 の前後で連続', () => {
    expect(crossProb(1 + 1e-9, th10, Math.PI)).toBeCloseTo(crossProb(1, th10, Math.PI), 6);
  });
  it('平行に近い針を除いた条件付き確率がモンテカルロと合う', () => {
    const rng = mulberry32(3);
    for (const r of [0.4, 0.7, 1.3]) {
      const s = throwNeedles(rng, 400000, r, th10);
      expect(s.h / s.n).toBeCloseTo(crossProb(r, th10, Math.PI), 2);
    }
  });
  it('必ずまたぐ長さなら情報なし(null)', () => {
    expect(crossProb(10, (20 * Math.PI) / 180, Math.PI)).toBeNull();
    expect(crossProb(0, 0, Math.PI)).toBeNull();
  });
});

describe('wilson', () => {
  it('中心は割合より 1/2 寄り、0 本でも幅がある', () => {
    const [lo, hi] = wilson(0, 20);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0.1);
    const [a, b] = wilson(50, 100);
    expect((a + b) / 2).toBeCloseTo(0.5, 10);
  });
  it('既知の値(h=10, n=100)', () => {
    const [lo, hi] = wilson(10, 100, Z95);
    expect(lo).toBeCloseTo(0.0552, 3);
    expect(hi).toBeCloseTo(0.1744, 3);
  });
});

describe('solvePi / estimatePi', () => {
  it('期待どおりの交差数なら π を返す', () => {
    for (const r of [0.5, 0.9, 1.4]) {
      const n = 1000;
      const h = n * crossProb(r, th10, Math.PI);
      expect(solvePi([{ n, r }], h, th10)).toBeCloseTo(Math.PI, 8);
    }
  });
  it('違う r の写真を合わせても解ける', () => {
    const shots = [{ n: 300, r: 0.6 }, { n: 500, r: 0.8 }];
    const h = shots.reduce((a, s) => a + s.n * crossProb(s.r, th10, Math.PI), 0);
    expect(solvePi(shots, h, th10)).toBeCloseTo(Math.PI, 8);
  });
  it('1本もまたがなければ上側は開いたまま', () => {
    const e = estimatePi([{ n: 30, h: 0, r: 0.7 }], th10);
    expect(e.pi).toBe(Infinity);
    expect(e.hi).toBe(Infinity);
    expect(Number.isFinite(e.lo)).toBe(true);
  });
  it('本数を増やすと区間が縮む', () => {
    const p = crossProb(0.7, th10, Math.PI);
    const w = (n) => { const e = estimatePi([{ n, h: Math.round(n * p), r: 0.7 }], th10); return e.hi - e.lo; };
    expect(w(400)).toBeLessThan(w(100));
    expect(w(1600)).toBeLessThan(w(400));
    expect(w(1600) / w(400)).toBeCloseTo(0.5, 1); // 1/√n
  });
  it('95%区間が本当に約95%の確率で π を含む', () => {
    const rng = mulberry32(11);
    let hit = 0;
    const trials = 600;
    for (let i = 0; i < trials; i++) {
      const s = throwNeedles(rng, 250, 0.7, th10);
      const e = estimatePi([s], th10);
      if (e.lo <= Math.PI && Math.PI <= e.hi) hit++;
    }
    expect(hit / trials).toBeGreaterThan(0.92);
    expect(hit / trials).toBeLessThan(0.98);
  });
  it('たくさん投げれば π に近づく', () => {
    const s = throwNeedles(mulberry32(5), 200000, 0.8, th10);
    const e = estimatePi([s], th10);
    expect(Math.abs(e.pi - Math.PI)).toBeLessThan(0.03);
    expect(e.lo).toBeLessThan(Math.PI);
    expect(e.hi).toBeGreaterThan(Math.PI);
  });
});

describe('verdict', () => {
  const p = crossProb(0.7, th10, Math.PI);
  const at = (n) => estimatePi([{ n, h: Math.round(n * p), r: 0.7 }], th10);
  it('本数が少なければ何も言わない', () => {
    expect(verdict(null).level).toBe('none');
    expect(verdict(at(5)).level).toBe('none');
  });
  it('数十本では「まだπとは言えない」と言い切る', () => {
    const v = verdict(at(60));
    expect(v.level).toBe('not-yet');
    expect(v.title).toBe('まだπとは言えない');
  });
  it('区間が 3.0〜3.3 に収まれば「πと言ってよい」', () => {
    expect(verdict(at(20000)).level).toBe('pi');
  });
  it('区間が π を外れたら校正・検出を疑えと言う', () => {
    const e = estimatePi([{ n: 2000, h: Math.round(2000 * p * 1.25), r: 0.7 }], th10);
    expect(verdict(e).level).toBe('off');
  });
});

describe('needlesNeeded', () => {
  it('今の割合のまま区間幅が 0.3 になる本数(既に十分なら今の本数)', () => {
    const p = crossProb(0.7, th10, Math.PI);
    const e = estimatePi([{ n: 100, h: Math.round(100 * p), r: 0.7 }], th10);
    const need = needlesNeeded(e, th10);
    expect(need).toBeGreaterThan(500);
    const e2 = estimatePi([{ n: need, h: need * (e.h / e.n), r: 0.7 }], th10);
    expect(e2.hi - e2.lo).toBeLessThanOrEqual(0.3 + 1e-9);
  });
  it('交差 0 本では見積もれない', () => {
    expect(needlesNeeded(estimatePi([{ n: 30, h: 0, r: 0.7 }], th10), th10)).toBeNull();
  });
});

describe('cumulative', () => {
  it('写真を足すごとに本数が積み上がる', async () => {
    const { cumulative } = await import('../src/lib/estimate.js');
    const c = cumulative([{ n: 30, h: 14, r: 0.7 }, { n: 0, h: 0, r: 0 }, { n: 40, h: 19, r: 0.7 }], th10);
    expect(c.map((e) => e.n)).toEqual([30, 30, 70]);
    expect(c[2].hi - c[2].lo).toBeLessThan(c[0].hi - c[0].lo);
  });
});
