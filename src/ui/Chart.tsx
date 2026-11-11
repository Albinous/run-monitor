import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CleanSeries } from '../core/clean';
import { type Palette, drawFrame } from '../core/draw';
import { formatStep, formatValue } from '../core/format';
import { type Frame, type MetricPrep, computeFrame } from '../core/frame';
import { nearestIndex } from '../core/index';
import type { Metric, ScaleKind } from '../core/types';
import { LOCALE, RENDER_MODE } from './env';

export interface View {
  x0: number;
  x1: number;
}

/** Charts are shorter on narrow screens so all three fit on a phone. */
const NARROW_WIDTH_PX = 600;
const CHART_HEIGHT_PX = 220;
const NARROW_CHART_HEIGHT_PX = 170;
/** Mouse wheel: one tick zooms out to 125% or in to 80% of the visible range. */
const WHEEL_ZOOM_OUT = 1.25;
const WHEEL_ZOOM_IN = 0.8;
/** Keyboard + / −: show half / double of the visible range. */
const KEY_ZOOM_IN = 0.5;
const KEY_ZOOM_OUT = 2;
/** Shift + arrow pans by 10% of the visible range. */
const KEY_PAN_FRACTION = 0.1;
/** When the cursor leaves the view, the view jumps by 25% to follow it. */
const FOLLOW_CURSOR_PAN_FRACTION = 0.25;
/** An arrow key moves the cursor by about this many pixel columns. */
const CURSOR_STEP_COLUMNS = 2;
/** Mouse movement smaller than this while the button is pressed is a click, not a drag. */
const DRAG_THRESHOLD_PX = 2;
/** Cursor dot radius and its outline width. */
const CURSOR_DOT_RADIUS = 4;
const CURSOR_DOT_OUTLINE = 2;
/** The tooltip is placed this far right of the cursor and never closer than TOOLTIP_WIDTH_PX to the right edge. */
const TOOLTIP_OFFSET_PX = 10;
const TOOLTIP_WIDTH_PX = 150;

const SCALE_OPTIONS: ScaleKind[] = ['linear', 'log'];

/** Timing of one chart render, shown in the ?perf=1 box. */
export interface PerfSample {
  metric: Metric;
  computeMs: number;
  drawMs: number;
  /** Points sent to the canvas. */
  drawn: number;
  /** Raw points in the visible step range. */
  inView: number;
}

interface Props {
  title: string;
  metric: Metric;
  series: CleanSeries;
  prep: MetricPrep;
  view: View;
  onPan: (dxSteps: number) => void;
  onZoom: (center: number, factor: number) => void;
  onReset: () => void;
  cursor: number | null;
  onCursor: (step: number | null) => void;
  smoothing: number;
  scale: ScaleKind;
  onScale: (scale: ScaleKind) => void;
  palette: Palette;
  onPerf?: (sample: PerfSample) => void;
}

/** ?render=naive: the "before" version for the performance comparison. */
const NAIVE_MODE = RENDER_MODE === 'naive';

interface CursorData {
  series: CleanSeries;
  prep: MetricPrep;
  view: View;
  scale: ScaleKind;
  palette: Palette;
}

/** Vertical cursor line plus a dot on the value (no dot if the value can't be drawn, e.g. NaN). */
function drawCursor(ctx: CanvasRenderingContext2D, frame: Frame, index: number, data: CursorData) {
  const cursorStep = data.series.step[index];
  if (cursorStep < data.view.x0 || cursorStep > data.view.x1) return;
  const x = Math.round(frame.x.toPixel(cursorStep)) + 0.5; // +0.5 keeps a 1 px line sharp
  ctx.save();
  ctx.strokeStyle = data.palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, frame.plot.top);
  ctx.lineTo(x, frame.plot.top + frame.plot.height);
  ctx.stroke();
  const value = data.prep.values[index];
  const drawable = Number.isFinite(value) && (data.scale === 'linear' || value > 0);
  if (drawable) {
    ctx.fillStyle = data.palette.line;
    ctx.strokeStyle = data.palette.bg;
    ctx.lineWidth = CURSOR_DOT_OUTLINE;
    ctx.beginPath();
    ctx.arc(x, frame.y.toPixel(value), CURSOR_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Sizes the canvas for the screen's pixel density: on a 2× screen a 300 px wide chart needs 600 real pixels,
 * otherwise lines look blurry. After this, drawing code can keep using CSS pixels.
 */
function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const pixelRatio = window.devicePixelRatio || 1;
  const realWidth = Math.round(width * pixelRatio);
  const realHeight = Math.round(height * pixelRatio);
  if (canvas.width !== realWidth || canvas.height !== realHeight) {
    canvas.width = realWidth;
    canvas.height = realHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return ctx;
}

export function Chart(props: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const mainCanvas = useRef<HTMLCanvasElement>(null);
  /** Transparent canvas on top, only for the cursor: moving the mouse never redraws the chart itself. */
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = width && width < NARROW_WIDTH_PX ? NARROW_CHART_HEIGHT_PX : CHART_HEIGHT_PX;

  // follow the container width (window resize, phone rotation)
  useLayoutEffect(() => {
    const element = wrapper.current!;
    setWidth(Math.floor(element.clientWidth));
    const observer = new ResizeObserver(() => setWidth(Math.floor(element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { series, metric, prep, scale, view, smoothing, palette, cursor, onPerf } = props;
  const computeMs = useRef(0);
  const frame = useMemo(() => {
    if (!width) return null;
    const started = performance.now();
    const computed = computeFrame({
      series,
      metric,
      prep,
      scale,
      view,
      width,
      height,
      smoothing,
      mode: RENDER_MODE,
      locale: LOCALE,
    });
    computeMs.current = performance.now() - started;
    performance.measure?.(`frame:${metric}`, { start: started, end: performance.now() });
    return computed;
  }, [series, prep, metric, scale, view, width, height, smoothing]);

  const cursorIndex = cursor === null ? -1 : nearestIndex(series.step, cursor);
  // Naive baseline: the cursor is drawn on the main canvas, so every hover redraws all points.
  const mainCanvasCursor = NAIVE_MODE ? cursorIndex : -1;

  // draw the chart whenever the frame, the colours or (naive mode only) the cursor change
  useEffect(() => {
    if (!frame || !mainCanvas.current) return;
    const started = performance.now();
    const ctx = setupCanvas(mainCanvas.current, width, height);
    drawFrame(ctx, frame, width, height, palette, smoothing > 0);
    if (mainCanvasCursor >= 0) drawCursor(ctx, frame, mainCanvasCursor, { series, prep, view, scale, palette });
    const drawMs = performance.now() - started;
    performance.measure?.(`draw:${metric}`, { start: started, end: performance.now() });
    onPerf?.({ metric, computeMs: computeMs.current, drawMs, drawn: frame.drawnPoints, inView: frame.pointsInView });
  }, [frame, width, height, palette, smoothing, mainCanvasCursor, series, prep, view, scale, metric, onPerf]);

  // optimised mode: only the transparent overlay is redrawn when the cursor moves
  useEffect(() => {
    if (NAIVE_MODE || !frame || !overlayCanvas.current || !width) return;
    const ctx = setupCanvas(overlayCanvas.current, width, height);
    ctx.clearRect(0, 0, width, height);
    if (cursorIndex >= 0) drawCursor(ctx, frame, cursorIndex, { series, prep, view, scale, palette });
  }, [frame, width, height, cursorIndex, series, prep, view, scale, palette]);

  // --- pointer interaction
  /** Set while the mouse button is pressed: where the last pan happened. */
  const drag = useRef<{ px: number; moved: boolean } | null>(null);
  const localX = (event: { clientX: number }) => event.clientX - wrapper.current!.getBoundingClientRect().left;

  useEffect(() => {
    const element = wrapper.current!;
    const onWheel = (event: WheelEvent) => {
      if (!frame) return;
      event.preventDefault(); // zoom the chart instead of scrolling the page
      props.onZoom(frame.x.toValue(localX(event)), event.deltaY > 0 ? WHEEL_ZOOM_OUT : WHEEL_ZOOM_IN);
    };
    element.addEventListener('wheel', onWheel, { passive: false }); // passive: false allows preventDefault
    return () => element.removeEventListener('wheel', onWheel);
  });

  const onPointerMove = (event: React.PointerEvent) => {
    if (!frame) return;
    const x = localX(event);
    if (drag.current) {
      const dragPixels = x - drag.current.px;
      if (Math.abs(dragPixels) > DRAG_THRESHOLD_PX) {
        drag.current = { px: x, moved: true };
        // dragging right shows earlier steps, so the view moves left
        props.onPan((-dragPixels / frame.plot.width) * (props.view.x1 - props.view.x0));
      }
      return;
    }
    const nearest = nearestIndex(props.series.step, frame.x.toValue(x));
    props.onCursor(nearest < 0 ? null : props.series.step[nearest]);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (!frame) return;
    const span = props.view.x1 - props.view.x0;
    const steps = props.series.step;
    const cursorStep = props.cursor ?? (props.view.x0 + props.view.x1) / 2;
    const moveCursor = (direction: number) => {
      const current = nearestIndex(steps, cursorStep);
      const stepsPerColumn = span / frame.plot.width;
      let next = nearestIndex(steps, steps[current] + direction * stepsPerColumn * CURSOR_STEP_COLUMNS);
      // zoomed in so far that 2 columns hold no new point: move to the neighbour point instead
      if (next === current) next = Math.min(steps.length - 1, Math.max(0, current + direction));
      props.onCursor(steps[next]);
      if (steps[next] < props.view.x0 || steps[next] > props.view.x1)
        props.onPan(direction * span * FOLLOW_CURSOR_PAN_FRACTION);
    };
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (event.shiftKey) props.onPan(direction * span * KEY_PAN_FRACTION);
        else moveCursor(direction);
        break;
      }
      case '+':
      case '=': {
        // "+" without Shift on most keyboards
        props.onZoom(cursorStep, KEY_ZOOM_IN);
        break;
      }
      case '-':
      case '_': {
        props.onZoom(cursorStep, KEY_ZOOM_OUT);
        break;
      }
      case '0':
      case 'Escape': {
        props.onReset();
        break;
      }
      case 'Home': {
        props.onCursor(steps[nearestIndex(steps, props.view.x0)]);
        break;
      }
      case 'End': {
        props.onCursor(steps[nearestIndex(steps, props.view.x1)]);
        break;
      }
      default: {
        return;
      } // not our key: let the browser handle it (e.g. Tab)
    }
    event.preventDefault(); // our key: don't scroll the page
  };

  const tip = (() => {
    if (!frame || cursorIndex < 0) return null;
    const cursorStep = props.series.step[cursorIndex];
    if (cursorStep < props.view.x0 || cursorStep > props.view.x1) return null;
    const left = frame.x.toPixel(cursorStep);
    return { left, value: props.prep.values[cursorIndex], step: cursorStep };
  })();

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3>{props.title}</h3>
        <div className="seg" role="radiogroup" aria-label={`${props.title} y-axis scale`}>
          {SCALE_OPTIONS.map((scale) => (
            <button
              key={scale}
              role="radio"
              aria-checked={props.scale === scale}
              className={props.scale === scale ? 'on' : ''}
              onClick={() => props.onScale(scale)}
            >
              {scale}
            </button>
          ))}
        </div>
      </figcaption>
      <div
        ref={wrapper}
        className="canvas-wrap"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${props.title} chart. Arrow keys move the cursor, Shift+arrows pan, plus and minus zoom, 0 resets.`}
        aria-describedby="chart-help"
        onPointerMove={onPointerMove}
        onPointerDown={(event) => {
          // keep receiving pointer events even if the mouse leaves the chart while dragging
          (event.target as Element).setPointerCapture?.(event.pointerId);
          drag.current = { px: localX(event), moved: false };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => {
          if (!drag.current) props.onCursor(null);
        }}
        onDoubleClick={props.onReset}
        onKeyDown={onKey}
      >
        <canvas ref={mainCanvas} aria-hidden="true" />
        {!NAIVE_MODE && <canvas ref={overlayCanvas} className="overlay" aria-hidden="true" />}
        {tip && (
          <div
            className="tip"
            style={{ left: Math.min(tip.left + TOOLTIP_OFFSET_PX, width - TOOLTIP_WIDTH_PX) }}
            aria-hidden="true"
          >
            <div>step {formatStep(tip.step, LOCALE)}</div>
            <strong className={Number.isFinite(tip.value) ? '' : 'bad'}>{formatValue(tip.value, LOCALE)}</strong>
          </div>
        )}
      </div>
      {frame && (
        <p className="chart-foot small muted">
          {frame.notes.length > 0 && <span className="warn-text">{frame.notes.join(' · ')} · </span>}
          drawing {formatStep(frame.drawnPoints, LOCALE)} of {formatStep(frame.pointsInView, LOCALE)} points in view
          {RENDER_MODE === 'm4' && frame.drawnPoints < frame.pointsInView ? ' (per-pixel first/min/max/last kept)' : ''}
        </p>
      )}
    </figure>
  );
}
