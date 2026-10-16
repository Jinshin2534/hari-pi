import { describe, it, expect } from 'vitest';
import { buildGrid, band, crosses, angleToSeams, withLength, segLength, distToSeg, gridLines } from '../src/lib/geometry.js';

describe('buildGrid', () => {
  it('向きなしなら a→b を法線、間隔は距離', () => {
    const g = buildGrid({ x: 10, y: 20 }, { x: 10, y: 120 });
    expect(g.nx).toBeCloseTo(0);
    expect(g.ny).toBeCloseTo(1);
    expect(g.t).toBeCloseTo(100);
    expect(g.c0).toBeCloseTo(20);
  });
  it('向きがあれば、斜めにタップしても間隔は法線方向に射影して測る', () => {
    const g = buildGrid({ x: 0, y: 0 }, { x: 60, y: 100 }, Math.PI / 2);
    expect(g.t).toBeCloseTo(100);
  });
  it('近すぎるタップは校正できない', () => {
    expect(buildGrid({ x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
  });
});

describe('crosses / band', () => {
  const g = buildGrid({ x: 0, y: 50 }, { x: 0, y: 150 }); // y = 50, 150, 250 ... に線
  it('線をまたぐ・またがない', () => {
    expect(crosses(g, { x1: 0, y1: 140, x2: 0, y2: 160 })).toBe(true);
    expect(crosses(g, { x1: 0, y1: 60, x2: 40, y2: 140 })).toBe(false);
    expect(crosses(g, { x1: 0, y1: 40, x2: 0, y2: 260 })).toBe(true); // 2本またいでも「またいだ」
  });
  it('負の側の板も数えられる', () => {
    expect(band(g, 0, 49)).toBe(-1);
    expect(band(g, 0, -60)).toBe(-2);
    expect(crosses(g, { x1: 0, y1: -45, x2: 0, y2: -55 })).toBe(true);
  });
});

describe('angleToSeams', () => {
  const g = buildGrid({ x: 0, y: 0 }, { x: 0, y: 100 });
  it('板目と平行なら 0、直交なら π/2', () => {
    expect(angleToSeams(g, { x1: 0, y1: 0, x2: 50, y2: 0 })).toBeCloseTo(0);
    expect(angleToSeams(g, { x1: 0, y1: 0, x2: 0, y2: 50 })).toBeCloseTo(Math.PI / 2);
    expect(angleToSeams(g, { x1: 0, y1: 0, x2: -50, y2: 50 })).toBeCloseTo(Math.PI / 4);
  });
});

describe('withLength / distToSeg / gridLines', () => {
  it('中心と向きを保って長さをそろえる', () => {
    const s = withLength({ x1: 0, y1: 0, x2: 30, y2: 40 }, 100);
    expect(segLength(s)).toBeCloseTo(100);
    expect((s.x1 + s.x2) / 2).toBeCloseTo(15);
    expect((s.y2 - s.y1) / (s.x2 - s.x1)).toBeCloseTo(40 / 30);
  });
  it('点と線分の距離(端の外は端点まで)', () => {
    const s = { x1: 0, y1: 0, x2: 10, y2: 0 };
    expect(distToSeg({ x: 5, y: 3 }, s)).toBeCloseTo(3);
    expect(distToSeg({ x: 13, y: 4 }, s)).toBeCloseTo(5);
  });
  it('画像に入る線だけを描く', () => {
    const g = buildGrid({ x: 0, y: 50 }, { x: 0, y: 150 });
    const lines = gridLines(g, 400, 300);
    expect(lines.map((l) => l.k + 0)).toEqual([0, 1, 2]);
    for (const l of lines) expect((l.y1 + l.y2) / 2).toBeCloseTo(50 + 100 * l.k);
  });
});
