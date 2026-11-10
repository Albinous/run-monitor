import type { Frame, Line } from './frame';

export interface Palette {
  bg: string; grid: string; axis: string; text: string; line: string; smooth: string; nan: string; inf: string;
}

/** Subset of the 2D context we use — lets tests pass a recording fake and assert on what is actually drawn. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  'clearRect' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'save' | 'restore' | 'rect' | 'clip' | 'fillText' | 'setLineDash' | 'closePath'
> & {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number; font: string;
  textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline;
};

function strokeLines(ctx: Ctx, lines: Line[]) {
  for (const l of lines) {
    const p = l.px;
    if (l.idx.length === 1) {
      // isolated point between two NaNs: a 1-point "line" would be invisible, draw a dot instead
      ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let t = 2; t < p.length; t += 2) ctx.lineTo(p[t], p[t + 1]);
    ctx.stroke();
  }
}

export function drawFrame(ctx: Ctx, f: Frame, width: number, height: number, pal: Palette, smoothing: boolean) {
  const { plot } = f;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  // grid + tick labels
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.fillStyle = pal.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of f.yTicks) {
    const yy = Math.round(t.px) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.left, yy);
    ctx.lineTo(plot.left + plot.width, yy);
    ctx.stroke();
    ctx.fillText(t.label, plot.left - 6, yy);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of f.xTicks) {
    const xx = Math.round(t.px) + 0.5;
    ctx.beginPath();
    ctx.moveTo(xx, plot.top);
    ctx.lineTo(xx, plot.top + plot.height);
    ctx.stroke();
    ctx.fillText(t.label, xx, plot.top + plot.height + 6);
  }
  ctx.strokeStyle = pal.axis;
  ctx.beginPath();
  ctx.rect(plot.left + 0.5, plot.top + 0.5, plot.width, plot.height);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.width, plot.height);
  ctx.clip();

  // NaN: full-height dashed band — impossible to mistake for a value
  for (const m of f.markers) {
    if (m.kind !== 'nan') continue;
    ctx.strokeStyle = pal.nan;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(m.px) + 0.5, plot.top);
    ctx.lineTo(Math.round(m.px) + 0.5, plot.top + plot.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // raw line: always drawn. With smoothing on it is dimmed, never hidden.
  ctx.strokeStyle = pal.line;
  ctx.fillStyle = pal.line;
  ctx.lineWidth = 1.25;
  ctx.globalAlpha = smoothing ? 0.4 : 1;
  strokeLines(ctx, f.lines);
  ctx.globalAlpha = 1;
  if (smoothing) {
    ctx.strokeStyle = pal.smooth;
    ctx.fillStyle = pal.smooth;
    ctx.lineWidth = 2;
    strokeLines(ctx, f.smoothLines);
  }

  // ±∞ and ≤0-on-log: triangles pinned to the edge they "went off"
  for (const m of f.markers) {
    if (m.kind === 'nan') continue;
    const top = m.kind === 'posInf';
    const yy = top ? plot.top + 1 : plot.top + plot.height - 1;
    const dir = top ? 1 : -1;
    ctx.fillStyle = m.kind === 'nonPositive' ? pal.text : pal.inf;
    ctx.beginPath();
    ctx.moveTo(m.px - 5, yy);
    ctx.lineTo(m.px + 5, yy);
    ctx.lineTo(m.px, yy + 8 * dir);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
