// 写真の上に板目・針・タップ位置を描く。座標はすべて画像の画素。
import { gridLines, distToSeg } from '../lib/geometry.js';
import { isCounted } from '../lib/needles.js';

export const COLORS = {
  cross: '#e8590c',
  nocross: '#0f8a7e',
  excluded: '#8a8580',
  grid: '#2f5dd0',
  tap: '#2f5dd0',
};

export function drawStage(canvas, photo, view) {
  const ctx = canvas.getContext('2d');
  const { W, H } = photo;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  ctx.putImageData(photo.image, 0, 0);
  const lw = Math.max(2, W / 360);

  if (view.grid) {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = lw * 0.7;
    ctx.setLineDash([lw * 5, lw * 3]);
    for (const l of gridLines(view.grid, W, H)) line(ctx, l);
    ctx.restore();
  }

  for (const nd of view.needles ?? []) {
    ctx.save();
    ctx.lineCap = 'round';
    if (nd.status === 'parallel') {
      ctx.strokeStyle = COLORS.excluded;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = lw * 0.7;
      ctx.setLineDash([lw, lw * 2]);
    } else if (isCounted(nd)) {
      ctx.strokeStyle = nd.crosses ? COLORS.cross : COLORS.nocross;
      ctx.lineWidth = lw * 1.4;
      // 縁取りで写真の上でも見えるように
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = lw * 1.5;
    } else {
      ctx.strokeStyle = COLORS.excluded;
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 2.5, lw * 2]);
    }
    line(ctx, nd);
    if (nd.source === 'manual') {
      ctx.fillStyle = ctx.strokeStyle;
      dot(ctx, nd.x1, nd.y1, lw * 1.6);
      dot(ctx, nd.x2, nd.y2, lw * 1.6);
    }
    ctx.restore();
  }

  for (const p of view.taps ?? []) {
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = COLORS.tap;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (view.pending) {
    ctx.save();
    ctx.fillStyle = COLORS.cross;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(view.pending.x, view.pending.y, lw * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function line(ctx, l) {
  ctx.beginPath();
  ctx.moveTo(l.x1, l.y1);
  ctx.lineTo(l.x2, l.y2);
  ctx.stroke();
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 画面上の位置 → 画像の画素。 */
export function eventToImage(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * canvas.width,
    y: ((ev.clientY - r.top) / r.height) * canvas.height,
  };
}

/** タップ位置に一番近い針(画面上で tolCss px 以内)。 */
export function needleAt(canvas, needles, p, tolCss = 16) {
  const r = canvas.getBoundingClientRect();
  const tol = (tolCss * canvas.width) / (r.width || canvas.width);
  let best = null, bestD = tol;
  for (const nd of needles) {
    const d = distToSeg(p, nd);
    if (d < bestD) { best = nd; bestD = d; }
  }
  return best;
}
