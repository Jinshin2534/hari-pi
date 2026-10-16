// ビュフォンの針の推定量と95%信頼区間。
//
// 板目の間隔 t、針の長さ l、r = l / t。針と板目のなす角 φ は [0, π/2] に一様。
// ただし板目とほぼ平行(φ < θ0)の針は木目と区別できないので、検出でも集計でも数えない。
// その条件付きで「1本が線をまたぐ確率」は
//
//   P(Π) = ∫_{θ0}^{Π/2} min(1, r sinφ) dφ / (Π/2 − θ0)
//
// ここで Π が推定したい円周率。r ≤ 1 なら P = r cosθ0 / (Π/2 − θ0)、θ0 = 0 なら見慣れた 2r/Π。
// 観測した「またいだ割合」に P(Π) が一致する Π を解いたものが推定値。

export const Z95 = 1.959963984540054;

/**
 * 条件付き交差確率。Π は未知の円周率(引数)。θ0 はラジアン(角度の測定値なので実数の π で換算してよい)。
 * r > 1 で θ0 が「必ずまたぐ角度」以上なら情報がないので null。
 */
export function crossProb(r, theta0, Pi) {
  if (!(r > 0) || !(Pi / 2 > theta0)) return null;
  if (r <= 1) return (r * Math.cos(theta0)) / (Pi / 2 - theta0);
  const phiStar = Math.asin(1 / r); // これより急な針は必ずまたぐ
  if (theta0 >= phiStar) return null;
  const partial = r * (Math.cos(theta0) - Math.cos(phiStar));
  return (partial + (Pi / 2 - phiStar)) / (Pi / 2 - theta0);
}

/** Wilson スコア区間(二項割合)。 */
export function wilson(h, n, z = Z95) {
  if (!(n > 0)) return null;
  const p = h / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const PI_MAX = 20;

/**
 * Σ n_s P_s(Π) = 期待交差数 が target になる Π を二分法で解く。
 * 解が範囲外(=いくらでも大きい/小さい Π でありうる)なら ±Infinity。
 */
export function solvePi(shots, target, theta0) {
  const lo0 = 2 * theta0 + 1e-9;
  const f = (Pi) => {
    let s = 0;
    for (const sh of shots) {
      const p = crossProb(sh.r, theta0, Pi);
      if (p == null) return NaN;
      s += sh.n * Math.min(1, p);
    }
    return s - target;
  };
  let a = Math.max(lo0, 1), b = PI_MAX;
  let fa = f(a), fb = f(b);
  if (Number.isNaN(fa) || Number.isNaN(fb)) return NaN;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Math.sign(fa) === Math.sign(fb)) {
    // 範囲内に解がない。f が減少関数(r ≤ 1)なら target が小さすぎ → Π は上限なし。
    // 増加関数(r > 1)なら逆。
    const decreasing = fa > fb;
    return (fb > 0) === decreasing ? Infinity : -Infinity;
  }
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
    if (b - a < 1e-12) break;
  }
  return (a + b) / 2;
}

/**
 * 写真ごとの集計 shots = [{ n: 数えた本数, h: またいだ本数, r: l/t }] から π を推定する。
 * 区間は「またいだ割合」の Wilson 区間を Π に写したもの(板目・長さの測り誤差は含まない)。
 */
export function estimatePi(shots, theta0) {
  const valid = shots.filter((s) => s.n > 0 && s.r > 0);
  const n = valid.reduce((a, s) => a + s.n, 0);
  const h = valid.reduce((a, s) => a + s.h, 0);
  if (n === 0) return null;
  const pi = solvePi(valid, h, theta0);
  const [pL, pU] = wilson(h, n);
  const e1 = solvePi(valid, n * pL, theta0);
  const e2 = solvePi(valid, n * pU, theta0);
  const lo = Math.min(e1, e2);
  const hi = Math.max(e1, e2);
  const rMean = valid.reduce((a, s) => a + s.r * s.n, 0) / n;
  return { n, h, pi, lo, hi, r: rMean };
}

// 「π と言ってよい」の基準: 95%区間がまるごと 3.0〜3.3 に収まる(=小数第1位が 1 と言える)。
export const SAY_LO = 3.0;
export const SAY_HI = 3.3;
export const MIN_NEEDLES = 10;

/**
 * 言えること・言えないことを言い切る。
 * level: 'none' | 'not-yet' | 'off' | 'pi'
 */
export function verdict(est) {
  if (!est || est.n < MIN_NEEDLES) {
    return { level: 'none', title: 'まだ何も言えない', detail: `数えた針が ${est ? est.n : 0} 本。せめて ${MIN_NEEDLES} 本は要る。` };
  }
  if (!Number.isFinite(est.lo) || !Number.isFinite(est.hi)) {
    return { level: 'not-yet', title: 'まだπとは言えない', detail: '区間の片側が閉じない(またいだ針が少なすぎるか多すぎる)。' };
  }
  if (est.hi < Math.PI || est.lo > Math.PI) {
    return {
      level: 'off',
      title: '区間がπを外れている',
      detail: '偶然でも5%は起きるが、板目の校正(間隔・向き)や検出の取りこぼしを疑うほうが先。',
    };
  }
  if (est.lo >= SAY_LO && est.hi <= SAY_HI) {
    return { level: 'pi', title: 'πと言ってよい', detail: '95%区間が 3.0〜3.3 に収まった。小数第1位までは「3.1」と言える。' };
  }
  return {
    level: 'not-yet',
    title: 'まだπとは言えない',
    detail: `区間が ${fmt(est.lo)}〜${fmt(est.hi)} と広く、3 とも 3.3 とも区別できない。`,
  };
}

/**
 * 今の「またいだ割合」のまま増やしたとき、区間が 3.0〜3.3 の幅(0.3)まで縮むのに要るおおよその総本数。
 * 区間の位置ではなく幅だけで見積もる(推定値がずれていれば本数を増やしても言えない)。
 */
export function needlesNeeded(est, theta0, width = SAY_HI - SAY_LO) {
  if (!est || est.h === 0 || est.h === est.n) return null;
  const p = est.h / est.n;
  const widthAt = (n) => {
    const e = estimatePi([{ n, h: p * n, r: est.r }], theta0);
    return e && Number.isFinite(e.hi) && Number.isFinite(e.lo) ? e.hi - e.lo : Infinity;
  };
  if (widthAt(est.n) <= width) return est.n;
  let a = est.n, b = Math.max(est.n * 2, 20);
  while (widthAt(b) > width) { a = b; b *= 2; if (b > 1e7) return null; }
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (widthAt(m) > width) a = m; else b = m;
  }
  return b;
}

export function fmt(x, digits = 3) {
  if (x === Infinity) return '∞';
  if (x === -Infinity) return '−∞';
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}
