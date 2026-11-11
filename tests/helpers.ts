import { cleanRun } from '../src/core/clean';
import { type Frame, computeFrame, prepareMetric } from '../src/core/frame';
import { bucketEdge } from '../src/core/downsample';
import type { Metric, RawRun, ScaleKind } from '../src/core/types';

const toFloat64 = (values: number[]) => Float64Array.from(values);

export function raw(steps: number[], loss: number[], lr?: number[], gn?: number[]): RawRun {
  return {
    step: toFloat64(steps),
    loss: toFloat64(loss),
    lr: toFloat64(lr ?? loss.map(() => 1e-3)),
    grad_norm: toFloat64(gn ?? loss.map(() => 1)),
  };
}

export function frameFor(
  r: RawRun,
  options: Partial<{
    metric: Metric;
    scale: ScaleKind;
    x0: number;
    x1: number;
    width: number;
    smoothing: number;
    mode: 'm4' | 'naive';
    locale: string;
  }> = {},
) {
  const series = cleanRun(r);
  const metric = options.metric ?? 'loss';
  const prep = prepareMetric(series, metric);
  const frame = computeFrame({
    series,
    metric,
    prep,
    scale: options.scale ?? 'linear',
    view: { x0: options.x0 ?? series.step[0], x1: options.x1 ?? series.step[series.n - 1] },
    width: options.width ?? 876,
    height: 220,
    smoothing: options.smoothing ?? 0,
    mode: options.mode,
    locale: options.locale,
  });
  return { series, prep, frame };
}

/** All (step, value) vertices actually handed to the canvas, per line. */
export function vertices(
  frame: Frame,
  values: Float64Array,
  step: Float64Array,
  which: 'lines' | 'smoothLines' = 'lines',
) {
  return frame[which].map((l) => Array.from(l.idx, (i) => ({ i, step: step[i], value: values[i] })));
}

/**
 * Per pixel column: min/max y (in px) of vertices that fall in that column, using the same bucket edges as M4.
 * Comparing this between the M4 frame and the naive (all points) frame proves the downsampled
 * line covers exactly the same vertical extent in every column.
 */
export function columnExtents(frame: Frame, steps: Float64Array, x0: number, x1: number) {
  const W = frame.plot.width;
  const edges = Array.from({ length: W + 1 }, (_, c) => bucketEdge(x0, x1, W, c));
  const col = (s: number) => {
    let lo = 0,
      hi = W;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (edges[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  const extents = new Map<number, [number, number]>();
  for (const l of frame.lines) {
    for (let t = 0; t < l.idx.length; t++) {
      const s = steps[l.idx[t]];
      if (s < x0 || s > x1) continue; // edge-continuity points outside the window
      const c = col(s);
      const y = l.px[2 * t + 1];
      const extent = extents.get(c);
      if (extent) {
        extent[0] = Math.min(extent[0], y);
        extent[1] = Math.max(extent[1], y);
      } else {
        extents.set(c, [y, y]);
      }
    }
  }
  return extents;
}

/** Fake 2D context that records every call — assertions run against what would actually be painted. */
export function recordingCtx() {
  const calls: { op: string; args: number[] }[] = [];
  const target: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => calls.push({ op: k, args: args.filter((a) => typeof a === 'number') as number[] });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx, calls };
}
