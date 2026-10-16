import './style.css';
import { h } from './ui/dom.js';
import { convergenceChart } from './ui/chart.js';
import { drawStage, eventToImage, needleAt, COLORS } from './ui/stage.js';
import { estimatePi, verdict, needlesNeeded, cumulative, fmt } from './lib/estimate.js';
import { detectNeedles, summarizeShot, isCounted, THETA0_DEG } from './lib/needles.js';
import { calibrateGrid } from './lib/calibrate.js';
import { rgbaToGray } from './lib/image.js';
import { makeFloor, grayToRGBA } from './lib/synth.js';
import { angleToSeams } from './lib/geometry.js';

const THETA0 = (THETA0_DEG * Math.PI) / 180;
const MAX_SIDE = 1000; // 処理する写真の長辺 [px]
const STORE_KEY = 'hari-pi:shots:v1';

const state = {
  shots: loadShots(),
  step: 'idle', // idle | camera | calibrate | busy | review
  photo: null, // { W, H, gray, image, demo }
  taps: [],
  cal: null,
  needles: [],
  shot: null,
  mode: 'toggle', // toggle | add
  pending: null, // 手で足す針の1点目
  demoSeed: Number(new URLSearchParams(location.search).get('seed')) || 1,
  stream: null,
  message: '',
};

// ---------- 画面 ----------
const els = {};
const root = document.getElementById('app');
root.append(
  h('main', { class: 'screen' },
    h('header', { class: 'app-header' },
      h('h1', {}, '針でπ'),
      h('p', {}, '板張りの床に爪楊枝をばらまいて撮ると、線をまたいだ本数から円周率が出てくる(ビュフォンの針)。'),
    ),
    (els.board = h('section', { class: 'board', 'aria-live': 'polite' })),
    h('section', { class: 'shoot' },
      (els.instr = h('p', { class: 'instr' })),
      (els.stageWrap = h('div', { class: 'stage-wrap' },
        (els.video = h('video', { class: 'video', playsinline: true, muted: true, autoplay: true })),
        (els.canvas = h('canvas', { class: 'stage', onPointerdown: onStageTap })),
      )),
      (els.legend = h('div', { class: 'legend' },
        legendItem(COLORS.cross, 'またいだ'),
        legendItem(COLORS.nocross, 'またがない'),
        legendItem(COLORS.excluded, '数えない(点線)', true),
        legendItem(COLORS.grid, '板目', true),
      )),
      (els.shotStats = h('div', { class: 'shot-stats' })),
      (els.msg = h('p', { class: 'msg', role: 'status' })),
      (els.actions = h('div', { class: 'actions' })),
      (els.file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onChange: onFile })),
    ),
    h('details', { class: 'how' },
      h('summary', {}, 'しくみと、このアプリが言わないこと'),
      h('ol', {},
        h('li', {}, '板目(継ぎ目)の間隔 t と爪楊枝の長さ l から、1本が継ぎ目をまたぐ確率は 2l/(πt)。またいだ割合を数えれば π が逆算できる。'),
        h('li', {}, '継ぎ目を1か所、となりの継ぎ目を1か所タップして間隔を教える。向きは写真から合わせ、タップ位置も近くの継ぎ目に吸い寄せる。'),
        h('li', {}, '爪楊枝は自前の線分検出(Sobel → 確率的 Hough → 縁の対を組む)で探す。長さ l は数えた爪楊枝の長さの最頻値。'),
        h('li', {}, `板目から ${THETA0_DEG}° 未満の爪楊枝は木目と区別できないので、最初から数えない。そのぶんは式で補正している(数えない角度を除いた条件付き確率で解く)。`),
        h('li', {}, '95%区間は「またいだ割合」のばらつき(Wilson 区間)だけ。板目の間隔・爪楊枝の長さの測り誤差は入っていない。'),
        h('li', {}, '画像の端で切れた爪楊枝、長さが合わない(重なって伸び縮みした)もの、棒らしさが足りないものは数えず、除外した本数を出す。点線の爪楊枝をタップすれば数える側に入れられ、検出できなかったものは両端をタップして足せる。'),
        h('li', {}, '写真は斜めからだと継ぎ目の間隔が場所で変わってしまう。真上から撮る。写真はどこにも送らず、このブラウザの中だけで数える。'),
      ),
    ),
    h('footer', { class: 'foot' },
      (els.reset = h('button', { type: 'button', class: 'ghost', onClick: resetAll }, '集計を全部やり直す')),
    ),
  ),
);

function legendItem(color, label, dashed = false) {
  return h('span', { class: 'legend-item' },
    h('i', { style: `border-top: 3px ${dashed ? 'dashed' : 'solid'} ${color}` }), label);
}

function btn(label, onClick, cls = '') {
  return h('button', { type: 'button', class: cls, onClick }, label);
}

function render() {
  renderBoard();
  renderShoot();
}

function renderBoard() {
  const est = estimatePi(state.shots, THETA0);
  const v = verdict(est);
  const need = needlesNeeded(est, THETA0);
  const photos = state.shots.length;
  const excluded = state.shots.reduce((a, s) => a + s.excluded, 0);
  const demos = state.shots.filter((s) => s.demo).length;
  fill(els.board,
    h('div', { class: 'pi-row' },
      h('span', { class: 'pi-label' }, 'π ≈'),
      h('span', { class: 'pi-num' }, est && Number.isFinite(est.pi) ? est.pi.toFixed(3) : '?'),
    ),
    h('p', { class: 'pi-ci' }, est ? `95%区間 ${fmt(est.lo, 2)} 〜 ${fmt(est.hi, 2)}` : '95%区間 —'),
    h('div', { class: `verdict v-${v.level}` }, h('strong', {}, v.title), h('span', {}, v.detail)),
    h('p', { class: 'counts' },
      `写真 ${photos} 枚${demos ? `(うちデモ ${demos})` : ''} / 数えた ${est ? est.n : 0} 本 / またいだ ${est ? est.h : 0} 本 / 数えなかった ${excluded} 本`),
    convergenceChart(cumulative(state.shots, THETA0)),
    need && est && need > est.n
      ? h('p', { class: 'need' }, `区間の幅を 0.3 まで縮めるには、今の割合のままなら合計 約${need.toLocaleString()} 本(あと約${(need - est.n).toLocaleString()} 本)。`)
      : null,
  );
}

function renderShoot() {
  const st = state.step;
  els.video.hidden = st !== 'camera';
  els.canvas.hidden = !['calibrate', 'review', 'busy'].includes(st);
  els.stageWrap.hidden = st === 'idle';
  els.legend.hidden = st !== 'review';
  els.msg.textContent = state.message;
  els.reset.disabled = state.shots.length === 0;

  const instr = {
    idle: '爪楊枝を床にばらまいて、真上から撮る。継ぎ目が2本以上写るように。',
    camera: '床が画面いっぱいに入るように真上から。',
    calibrate: state.taps.length === 0
      ? '① 板の継ぎ目の上を1か所タップ'
      : '② となりの継ぎ目の上をタップ(まっすぐ隣に)',
    busy: '数えています…',
    review: state.mode === 'add'
      ? (state.pending ? '手で足す: もう一方の端をタップ' : '手で足す: 見落とした爪楊枝の片方の端をタップ')
      : '線をタップすると「数える/数えない」が切り替わる。違っていたら直してから足す。',
  }[st];
  els.instr.textContent = instr;

  const a = [];
  if (st === 'idle') {
    a.push(btn('カメラで撮る', startCamera, 'primary'));
    a.push(btn('写真を選ぶ', () => els.file.click()));
    a.push(btn('デモで撒く', () => runDemo()));
  } else if (st === 'camera') {
    a.push(btn('撮る', capture, 'primary'));
    a.push(btn('やめる', cancelShot));
  } else if (st === 'calibrate') {
    if (state.taps.length) a.push(btn('タップをやり直す', () => { state.taps = []; redraw(); render(); }));
    a.push(btn('やめる', cancelShot));
  } else if (st === 'review') {
    a.push(btn('この写真を足す', addShot, 'primary'));
    a.push(btn(state.mode === 'add' ? '手で足すのをやめる' : '見落としを手で足す', toggleAddMode));
    if (!state.photo?.demo) a.push(btn('校正をやり直す', recalibrate));
    a.push(btn('捨てる', cancelShot));
  }
  els.actions.replaceChildren(...a);

  if (st === 'review' && state.shot) {
    const s = state.shot;
    fill(els.shotStats,
      h('dl', {},
        stat('数える', `${s.n} 本`),
        stat('またいだ', `${s.h} 本`),
        stat('数えない', `${s.excluded} 本`, s.border ? `うち端で切れた ${s.border}` : ''),
        stat('長さ / 間隔', `${s.lengthPx.toFixed(0)} / ${s.spacingPx.toFixed(0)} px`, `l/t = ${s.r.toFixed(2)}`),
      ),
      s.n < 5 ? h('p', { class: 'warn' }, '数えられる爪楊枝がほとんどない。明るさの差がある床で、真上から撮り直すか、手で足す。') : null,
      s.r > 1 ? h('p', { class: 'warn' }, '爪楊枝が板目の間隔より長い。長い針の式で計算するが、区間はかなり広がる。') : null,
    );
  } else {
    els.shotStats.replaceChildren();
  }
}

// replaceChildren は null を "null" という文字にしてしまうので落としてから渡す
function fill(el, ...kids) {
  el.replaceChildren(...kids.filter((k) => k != null && k !== false));
}

function stat(label, value, sub = '') {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value, sub ? h('small', {}, sub) : null));
}

function redraw() {
  if (!state.photo) return;
  drawStage(els.canvas, state.photo, {
    grid: state.step === 'review' ? state.cal?.grid : null,
    needles: state.step === 'review' ? state.needles : [],
    taps: state.taps,
    pending: state.pending,
  });
}

// ---------- 撮る ----------
async function startCamera() {
  state.message = '';
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    state.step = 'camera';
  } catch (e) {
    console.error(e);
    state.message = 'カメラが使えなかった。「写真を選ぶ」から撮った写真を読み込むか、デモで試せる。';
  }
  render();
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  els.video.srcObject = null;
}

function capture() {
  const v = els.video;
  if (!v.videoWidth) return;
  setPhotoFrom(v, v.videoWidth, v.videoHeight);
  stopCamera();
}

async function onFile(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    setPhotoFrom(bmp, bmp.width, bmp.height);
  } catch (e) {
    console.error(e);
    state.message = 'この写真は読み込めなかった。';
    render();
  }
}

function setPhotoFrom(source, w, h0) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h0));
  const W = Math.round(w * k), H = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const image = ctx.getImageData(0, 0, W, H);
  state.photo = { W, H, image, gray: rgbaToGray(image.data, W, H), demo: false };
  state.taps = [];
  state.cal = null;
  state.needles = [];
  state.step = 'calibrate';
  state.message = '';
  render();
  redraw();
}

/** デモ: 合成した床と爪楊枝。校正タップは正解の継ぎ目に自動で打つ。 */
function runDemo(seed = state.demoSeed) {
  const f = makeFloor({ seed });
  state.demoSeed = seed + 1;
  const image = new ImageData(grayToRGBA(f.gray, f.W, f.H), f.W, f.H);
  state.photo = { W: f.W, H: f.H, image, gray: f.gray, demo: true, seed };
  state.taps = [];
  state.message = `デモ(合成写真 #${seed})。校正のタップは自動で打った。`;
  state.step = 'calibrate';
  render();
  return analyze(f.taps[0], f.taps[1]);
}

function onStageTap(ev) {
  const p = eventToImage(els.canvas, ev);
  tapAt(p.x, p.y);
}

/** 画像座標でのタップ(ヘッドレス検証からも呼ぶ)。 */
function tapAt(x, y) {
  const p = { x, y };
  if (state.step === 'calibrate') {
    state.taps.push(p);
    if (state.taps.length === 2) return analyze(state.taps[0], state.taps[1]);
    redraw();
    render();
    return null;
  }
  if (state.step !== 'review') return null;
  if (state.mode === 'add') {
    if (!state.pending) { state.pending = p; }
    else {
      const nd = { x1: state.pending.x, y1: state.pending.y, x2: x, y2: y, status: 'ok', source: 'manual' };
      if (Math.hypot(nd.x2 - nd.x1, nd.y2 - nd.y1) > 8) {
        if (angleToSeams(state.cal.grid, nd) < THETA0) {
          nd.status = 'parallel';
          state.message = `板目から ${THETA0_DEG}° 未満の爪楊枝は数えない決まり(式で補正済み)。`;
        } else state.message = '';
        state.needles.push(nd);
      }
      state.pending = null;
    }
  } else {
    const nd = needleAt(els.canvas, state.needles, p);
    if (!nd) return null;
    if (nd.source === 'manual') state.needles.splice(state.needles.indexOf(nd), 1);
    else if (nd.status === 'parallel') state.message = `板目から ${THETA0_DEG}° 未満の爪楊枝は数えない決まり(式で補正済み)。`;
    else nd.forced = isCounted(nd) ? 'out' : 'in';
  }
  resummarize();
  return state.shot;
}

function analyze(a, b) {
  state.step = 'busy';
  render();
  redraw();
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        const { W, H, gray } = state.photo;
        const cal = calibrateGrid(gray, W, H, a, b);
        if (!cal) {
          state.message = '2点が近すぎる。継ぎ目と、となりの継ぎ目をタップする。';
          state.taps = [];
          state.step = 'calibrate';
          render();
          redraw();
          resolve(null);
          return;
        }
        state.cal = cal;
        state.taps = [a, b];
        const det = detectNeedles(gray, W, H, cal.grid);
        state.needles = det.needles;
        state.mode = 'toggle';
        state.pending = null;
        state.step = 'review';
        if (!cal.snapped && !state.photo.demo) {
          state.message = '継ぎ目の溝がはっきり見えなかったので、タップした位置をそのまま使った。青い点線が継ぎ目に重なっているか確かめる。';
        }
        resummarize();
        resolve(state.shot);
      } catch (e) {
        console.error(e);
        state.message = '数えるのに失敗した。撮り直してみて。';
        state.step = 'idle';
        render();
        resolve(null);
      }
    }, 30);
  });
}

function resummarize() {
  state.shot = summarizeShot(state.needles, state.cal.grid);
  render();
  redraw();
}

function toggleAddMode() {
  state.mode = state.mode === 'add' ? 'toggle' : 'add';
  state.pending = null;
  render();
  redraw();
}

function recalibrate() {
  state.taps = [];
  state.needles = [];
  state.cal = null;
  state.step = 'calibrate';
  state.message = '';
  render();
  redraw();
}

function addShot() {
  const s = state.shot;
  if (!s) return;
  if (s.n === 0) {
    state.message = '数える爪楊枝が 0 本なので足せない。';
    render();
    return;
  }
  state.shots.push({
    n: s.n, h: s.h, r: s.r, excluded: s.excluded, border: s.border, manual: s.manual,
    demo: !!state.photo.demo, at: Date.now(),
  });
  saveShots();
  const est = estimatePi(state.shots, THETA0);
  state.message = `足した(+${s.n} 本)。いまの推定 ${fmt(est.pi)}。もう一度ばらまいて撮ると区間が縮む。`;
  clearPhoto();
}

function cancelShot() {
  stopCamera();
  state.message = '';
  clearPhoto();
}

function clearPhoto() {
  state.photo = null;
  state.taps = [];
  state.cal = null;
  state.needles = [];
  state.shot = null;
  state.pending = null;
  state.mode = 'toggle';
  state.step = 'idle';
  render();
}

function resetAll() {
  state.shots = [];
  saveShots();
  state.message = '集計を空にした。';
  render();
}

function loadShots() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((s) => s && s.n > 0 && s.r > 0) : [];
  } catch {
    return [];
  }
}

function saveShots() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.shots)); } catch { /* 保存できなくても動く */ }
}

// ヘッドレス検証用
window.__app = {
  state,
  runDemo,
  tapAt,
  addShot,
  resetAll,
  estimate: () => estimatePi(state.shots, THETA0),
  verdict: () => verdict(estimatePi(state.shots, THETA0)),
};

render();
