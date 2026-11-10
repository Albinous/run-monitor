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

/** Sizes in CSS pixels, opacity from 0 to 1. */
const STYLE = {
  font: '11px system-ui, sans-serif',
  gridLineWidth: 1,
  /** Gap between a tick label and the plot border. */
  labelGap: 6,
  rawLineWidth: 1.25,
  smoothLineWidth: 2,
  /** With smoothing on, the raw line is dimmed to this opacity — still visible, never hidden. */
  dimmedRawOpacity: 0.4,
  nanBandOpacity: 0.55,
  nanBandDash: [3, 3],
  /** Size of the dot drawn for a single point between two NaNs. */
  lonePointSize: 3,
  /** ±∞ / ≤0 triangles: half of the base width and the height. */
  markerHalfWidth: 5,
  markerHeight: 8,
  /** Triangles sit 1 px inside the plot so the border doesn't cut them. */
  markerInset: 1,
};

/**
 * A 1 px line drawn at a whole pixel coordinate is blurred over 2 pixels.
 * Shifting it by half a pixel makes it sharp.
 */
const crisp = (pixel: number) => Math.round(pixel) + 0.5;

function strokeLines(ctx: Ctx, lines: Line[]) {
  for (const line of lines) {
    const points = line.px; // [x0, y0, x1, y1, ...]
    if (line.idx.length === 1) {
      // isolated point between two NaNs: a 1-point "line" would be invisible, draw a dot instead
      const half = STYLE.lonePointSize / 2;
      ctx.fillRect(points[0] - half, points[1] - half, STYLE.lonePointSize, STYLE.lonePointSize);
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let p = 2; p < points.length; p += 2) ctx.lineTo(points[p], points[p + 1]);
    ctx.stroke();
  }
}

export function drawFrame(ctx: Ctx, frame: Frame, width: number, height: number, palette: Palette, smoothing: boolean) {
  const { plot } = frame;
  const plotRight = plot.left + plot.width;
  const plotBottom = plot.top + plot.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  // grid + tick labels
  ctx.font = STYLE.font;
  ctx.lineWidth = STYLE.gridLineWidth;
  ctx.strokeStyle = palette.grid;
  ctx.fillStyle = palette.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of frame.yTicks) {
    const y = crisp(tick.px);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillText(tick.label, plot.left - STYLE.labelGap, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of frame.xTicks) {
    const x = crisp(tick.px);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.fillText(tick.label, x, plotBottom + STYLE.labelGap);
  }
  ctx.strokeStyle = palette.axis;
  ctx.beginPath();
  ctx.rect(plot.left + 0.5, plot.top + 0.5, plot.width, plot.height);
  ctx.stroke();

  // nothing below is allowed to paint outside the plot
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.width, plot.height);
  ctx.clip();

  // NaN: full-height dashed band — impossible to mistake for a value
  for (const marker of frame.markers) {
    if (marker.kind !== 'nan') continue;
    const x = crisp(marker.px);
    ctx.strokeStyle = palette.nan;
    ctx.globalAlpha = STYLE.nanBandOpacity;
    ctx.setLineDash(STYLE.nanBandDash);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // raw line: always drawn. With smoothing on it is dimmed, never hidden.
  ctx.strokeStyle = palette.line;
  ctx.fillStyle = palette.line;
  ctx.lineWidth = STYLE.rawLineWidth;
  ctx.globalAlpha = smoothing ? STYLE.dimmedRawOpacity : 1;
  strokeLines(ctx, frame.lines);
  ctx.globalAlpha = 1;
  if (smoothing) {
    ctx.strokeStyle = palette.smooth;
    ctx.fillStyle = palette.smooth;
    ctx.lineWidth = STYLE.smoothLineWidth;
    strokeLines(ctx, frame.smoothLines);
  }

  // ±∞ and ≤0-on-log: triangles pinned to the edge they "went off"
  for (const marker of frame.markers) {
    if (marker.kind === 'nan') continue;
    const atTop = marker.kind === 'posInf';
    const baseY = atTop ? plot.top + STYLE.markerInset : plotBottom - STYLE.markerInset;
    const tipDirection = atTop ? 1 : -1; // the tip points into the plot
    ctx.fillStyle = marker.kind === 'nonPositive' ? palette.text : palette.inf;
    ctx.beginPath();
    ctx.moveTo(marker.px - STYLE.markerHalfWidth, baseY);
    ctx.lineTo(marker.px + STYLE.markerHalfWidth, baseY);
    ctx.lineTo(marker.px, baseY + STYLE.markerHeight * tipDirection);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
