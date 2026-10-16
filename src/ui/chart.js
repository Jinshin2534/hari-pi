// 本数と推定値(95%区間の帯つき)の推移。π の線と 3.0〜3.3 の帯を引く。
import { s } from './dom.js';

const Y0 = 2.4, Y1 = 4.2;

export function convergenceChart(series) {
  const W = 320, H = 170, L = 34, R = 10, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const maxN = Math.max(50, ...series.map((e) => e.n));
  const X = (n) => L + (n / maxN) * pw;
  const Y = (v) => T + (1 - (Math.min(Y1, Math.max(Y0, v)) - Y0) / (Y1 - Y0)) * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '本数と推定値の推移' });

  svg.append(s('rect', { x: L, y: Y(3.3), width: pw, height: Y(3.0) - Y(3.3), class: 'chart-say' }));
  for (const v of [2.5, 3, 3.5, 4]) {
    svg.append(s('line', { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), class: 'chart-grid' }));
    svg.append(s('text', { x: L - 6, y: Y(v) + 4, class: 'chart-tick', 'text-anchor': 'end' }, v.toFixed(1)));
  }
  svg.append(s('line', { x1: L, x2: L + pw, y1: Y(Math.PI), y2: Y(Math.PI), class: 'chart-pi' }));
  svg.append(s('text', { x: L + pw - 2, y: Y(Math.PI) - 4, class: 'chart-pi-label', 'text-anchor': 'end' }, 'π'));
  svg.append(s('text', { x: L + pw, y: H - 6, class: 'chart-tick', 'text-anchor': 'end' }, `${maxN} 本`));
  svg.append(s('text', { x: L, y: H - 6, class: 'chart-tick' }, '0'));

  if (series.length) {
    const pts = [{ n: 0, lo: Y0, hi: Y1, pi: NaN }, ...series];
    const top = pts.map((e) => `${X(e.n)},${Y(Number.isFinite(e.hi) ? e.hi : Y1)}`);
    const bot = pts.map((e) => `${X(e.n)},${Y(Number.isFinite(e.lo) ? e.lo : Y0)}`).reverse();
    svg.append(s('polygon', { points: [...top, ...bot].join(' '), class: 'chart-band' }));
    const line = series.filter((e) => Number.isFinite(e.pi)).map((e) => `${X(e.n)},${Y(e.pi)}`);
    if (line.length) svg.append(s('polyline', { points: line.join(' '), class: 'chart-line' }));
    for (const e of series) if (Number.isFinite(e.pi)) svg.append(s('circle', { cx: X(e.n), cy: Y(e.pi), r: 3, class: 'chart-dot' }));
  }
  return svg;
}
