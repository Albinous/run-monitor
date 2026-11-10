import type { CleanSeries } from './clean';
import { bucketEdge, emaSmooth, m4Indices } from './downsample';
import { formatTick } from './format';
import {
  type BlockIndex, type Validity, buildBlockIndex, computeInvalid, computeSegments,
  lowerBound, rangeExtent, rangeMinPositive, upperBound,
} from './index';
import type { Metric, ScaleKind } from './types';

/** Everything derived once per (series, metric). Built lazily; the 1M run pays ~O(n) once. */
export interface MetricPrep {
  v: Float64Array;
  ix: BlockIndex;
  segs: Record<Validity, Int32Array>;
  invalid: Record<Validity, Int32Array>;
  smoothCache: Map<string, { v: Float64Array; ix: BlockIndex }>;
}

export function prepareMetric(series: CleanSeries, metric: Metric): MetricPrep {
  const v = series.values[metric];
  const g = series.report.gapThreshold;
  return {
    v,
    ix: buildBlockIndex(v),
    segs: { finite: computeSegments(series.step, v, g, 'finite'), positive: computeSegments(series.step, v, g, 'positive') },
    invalid: { finite: computeInvalid(v, 'finite'), positive: computeInvalid(v, 'positive') },
    smoothCache: new Map(),
  };
}

export interface Scale {
  kind: ScaleKind;
  d0: number; d1: number; r0: number; r1: number;
  map(v: number): number;
  invert(px: number): number;
}

export function makeScale(kind: ScaleKind, d0: number, d1: number, r0: number, r1: number): Scale {
  if (kind === 'log') {
    const l0 = Math.log10(d0), l1 = Math.log10(d1);
    return {
      kind, d0, d1, r0, r1,
      map: (v) => r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0),
      invert: (px) => 10 ** (l0 + ((px - r0) / (r1 - r0)) * (l1 - l0)),
    };
  }
  return {
    kind, d0, d1, r0, r1,
    map: (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0),
    invert: (px) => d0 + ((px - r0) / (r1 - r0)) * (d1 - d0),
  };
}

export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const e = Math.floor(Math.log10(raw));
  const f = raw / 10 ** e;
  const nfac = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nfac * 10 ** e;
}

export function linearTicks(lo: number, hi: number, count: number, minStep = 0): { values: number[]; step: number } {
  if (!(hi > lo)) return { values: [lo], step: 1 };
  const st = Math.max(minStep, niceStep(hi - lo, count));
  const values: number[] = [];
  for (let k = Math.ceil(lo / st - 1e-9); k <= Math.floor(hi / st + 1e-9); k++) {
    values.push(Number((k * st).toPrecision(12)));
  }
  return { values, step: st };
}

export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9); e++) out.push(Number((10 ** e).toPrecision(12)));
  if (out.length >= 2) return out;
  const more: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) ; e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) {
      const t = Number((m * 10 ** e).toPrecision(12));
      if (t >= lo && t <= hi) more.push(t);
    }
  return more;
}

export interface Tick { value: number; label: string; px: number }
export type MarkerKind = 'nan' | 'posInf' | 'negInf' | 'nonPositive';
export interface Marker { kind: MarkerKind; idx: number; step: number; px: number; count: number }
export interface Line { idx: Int32Array; px: Float32Array }

export interface Frame {
  plot: { left: number; top: number; width: number; height: number };
  x: Scale;
  y: Scale;
  xTicks: Tick[];
  yTicks: Tick[];
  lines: Line[];
  smoothLines: Line[];
  markers: Marker[];
  notes: string[];
  pointsInView: number;
  drawnPoints: number;
  empty: boolean;
}

export interface FrameInput {
  series: CleanSeries;
  metric: Metric;
  prep: MetricPrep;
  scale: ScaleKind;
  view: { x0: number; x1: number };
  width: number;
  height: number;
  smoothing: number;
  mode?: 'm4' | 'naive';
  locale?: string;
}

export const MARGIN = { left: 64, right: 12, top: 10, bottom: 24 };

export function computeFrame(inp: FrameInput): Frame {
  const { series, prep, view, scale } = inp;
  const locale = inp.locale ?? 'en-US';
  const mode: Validity = scale === 'log' ? 'positive' : 'finite';
  const step = series.step;
  const v = prep.v;
  const plot = {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(10, Math.floor(inp.width - MARGIN.left - MARGIN.right)),
    height: Math.max(10, Math.floor(inp.height - MARGIN.top - MARGIN.bottom)),
  };
  const { x0, x1 } = view;
  const x = makeScale('linear', x0, x1, plot.left, plot.left + plot.width);
  const i0 = lowerBound(step, x0);
  const i1 = upperBound(step, x1);
  const notes: string[] = [];

  // --- y domain: exact extent of the RAW data in view (never of the downsampled or smoothed line)
  let lo: number, hi: number;
  let empty = false;
  if (scale === 'log') {
    lo = rangeMinPositive(v, prep.ix, i0, i1);
    hi = rangeExtent(v, prep.ix, i0, i1).max;
    if (!(lo < Infinity) || !(hi > 0)) empty = true;
  } else {
    const ext = rangeExtent(v, prep.ix, i0, i1);
    lo = ext.min; hi = ext.max;
    if (ext.argmin < 0) empty = true;
  }
  if (empty) {
    notes.push(i1 > i0 ? 'No drawable values in view' : 'No points in view');
    lo = scale === 'log' ? 1 : 0;
    hi = scale === 'log' ? 10 : 1;
  }
  let d0: number, d1: number;
  if (scale === 'log') {
    const span = Math.max(Math.log10(hi) - Math.log10(lo), 0.2);
    d0 = lo / 10 ** (span * 0.05); d1 = hi * 10 ** (span * 0.05);
  } else {
    const span = hi - lo;
    const pad = span > 0 ? span * 0.05 : Math.abs(hi) * 0.1 || 1;
    d0 = lo - pad; d1 = hi + pad;
  }
  const y = makeScale(scale, d0, d1, plot.top + plot.height, plot.top);

  // --- ticks
  const xt = linearTicks(x0, x1, Math.max(2, Math.floor(plot.width / 110)), 1);
  const xTicks = xt.values.map((t) => ({ value: t, label: formatTick(t, xt.step, locale), px: x.map(t) }));
  let yTicks: Tick[];
  if (scale === 'log') {
    yTicks = logTicks(d0, d1).map((t) => ({ value: t, label: formatTick(t, null, locale), px: y.map(t) }));
  } else {
    const yt = linearTicks(d0, d1, Math.max(2, Math.floor(plot.height / 40)));
    yTicks = yt.values.map((t) => ({ value: t, label: formatTick(t, yt.step, locale), px: y.map(t) }));
  }

  // --- lines (per segment, never across NaN/Inf/gap)
  const buckets = plot.width;
  const naive = inp.mode === 'naive';
  const segs = prep.segs[mode];
  const toLine = (vals: Float64Array, ix: BlockIndex): Line[] => {
    const out: Line[] = [];
    // only segments that intersect the window: binary search the first whose last step >= x0
    let lo = 0, hi = segs.length / 2;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (step[segs[2 * mid + 1] - 1] < x0) lo = mid + 1; else hi = mid;
    }
    for (let k = lo * 2; k < segs.length; k += 2) {
      const s = segs[k], e = segs[k + 1];
      if (step[s] > x1) break;
      const idx = m4Indices(step, vals, ix, s, e, x0, x1, buckets, naive);
      if (idx.length === 0) continue;
      const px = new Float32Array(idx.length * 2);
      for (let t = 0; t < idx.length; t++) {
        px[2 * t] = x.map(step[idx[t]]);
        px[2 * t + 1] = y.map(vals[idx[t]]);
      }
      out.push({ idx, px });
    }
    return out;
  };
  const lines = empty ? [] : toLine(v, prep.ix);
  let smoothLines: Line[] = [];
  if (!empty && inp.smoothing > 0) {
    const key = `${mode}:${inp.smoothing}`;
    let sm = prep.smoothCache.get(key);
    if (!sm) {
      const sv = emaSmooth(v, segs, inp.smoothing);
      sm = { v: sv, ix: buildBlockIndex(sv) };
      prep.smoothCache.set(key, sm);
    }
    smoothLines = toLine(sm.v, sm.ix);
  }

  // --- markers for values that can't be drawn as a line point (aggregated per pixel column)
  const inv = prep.invalid[mode];
  const lo2 = lowerBoundBy(inv, (i) => step[i], x0);
  const hi2 = upperBoundBy(inv, (i) => step[i], x1);
  const byCol = new Map<string, Marker>();
  const counts: Record<MarkerKind, number> = { nan: 0, posInf: 0, negInf: 0, nonPositive: 0 };
  for (let t = lo2; t < hi2; t++) {
    const i = inv[t];
    const val = v[i];
    const kind: MarkerKind = val !== val ? 'nan' : val === Infinity ? 'posInf' : val === -Infinity ? 'negInf' : 'nonPositive';
    counts[kind]++;
    const px = x.map(step[i]);
    const key = `${Math.floor(px)}:${kind}`;
    const m = byCol.get(key);
    if (m) m.count++;
    else byCol.set(key, { kind, idx: i, step: step[i], px, count: 1 });
  }
  if (counts.nan) notes.push(`${counts.nan} NaN in view`);
  if (counts.posInf) notes.push(`${counts.posInf} +∞ in view`);
  if (counts.negInf) notes.push(`${counts.negInf} −∞ in view`);
  if (counts.nonPositive) notes.push(`${counts.nonPositive} value(s) ≤ 0 not plottable on log axis`);

  let drawn = 0;
  for (const l of lines) drawn += l.idx.length;
  return {
    plot, x, y, xTicks, yTicks, lines, smoothLines, markers: [...byCol.values()], notes,
    pointsInView: i1 - i0, drawnPoints: drawn, empty,
  };
}

function lowerBoundBy(a: Int32Array, key: (i: number) => number, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(a[mid]) < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function upperBoundBy(a: Int32Array, key: (i: number) => number, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(a[mid]) <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export { bucketEdge };
