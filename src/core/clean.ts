import { METRICS, type Metric, type RawRun } from './types';

export interface NonFiniteCount {
  nan: number;
  posInf: number;
  negInf: number;
}

export interface CleanReport {
  input: number;
  /** Points whose `step` itself was NaN/Inf — cannot be placed on the x axis, dropped and counted. */
  invalidSteps: number;
  /** Duplicate steps removed. Policy: the LAST write in log order wins (resume-from-checkpoint semantics). */
  duplicatesDropped: number;
  wasUnsorted: boolean;
  medianStride: number;
  /** A step jump larger than this breaks the line instead of interpolating across missing data. */
  gapThreshold: number;
  gaps: { from: number; to: number }[];
  nonFinite: Record<Metric, NonFiniteCount>;
  /** Finite values <= 0: not representable on a log axis. */
  nonPositive: Record<Metric, number>;
}

export interface CleanSeries {
  n: number;
  /** Strictly increasing. */
  step: Float64Array;
  /** Values are copied verbatim from the raw data — never imputed, clamped or smoothed. */
  values: Record<Metric, Float64Array>;
  report: CleanReport;
}

export const GAP_FACTOR = 3;

export function cleanRun(raw: RawRun): CleanSeries {
  const N = raw.step.length;
  const rs = raw.step;
  let idx = new Uint32Array(N);
  let m = 0;
  let invalidSteps = 0;
  let sorted = true;
  let prev = -Infinity;
  for (let i = 0; i < N; i++) {
    const s = rs[i];
    if (!Number.isFinite(s)) {
      invalidSteps++;
      continue;
    }
    if (s < prev) sorted = false;
    prev = s;
    idx[m++] = i;
  }
  idx = idx.subarray(0, m);
  if (!sorted) {
    // stable: equal steps keep their original (log) order, so "last in group" == "last written"
    idx = idx.slice().sort((a, b) => rs[a] - rs[b] || a - b);
  }

  const keep = new Uint32Array(m);
  let k = 0;
  let dups = 0;
  for (let t = 0; t < m; t++) {
    if (t + 1 < m && rs[idx[t + 1]] === rs[idx[t]]) {
      dups++;
      continue;
    }
    keep[k++] = idx[t];
  }

  let step: Float64Array;
  const values = {} as Record<Metric, Float64Array>;
  if (sorted && dups === 0 && invalidSteps === 0) {
    // Fast path (the 1M run): no copy, keeps tab memory at ~1x the raw data.
    step = rs;
    for (const mt of METRICS) values[mt] = raw[mt];
  } else {
    step = new Float64Array(k);
    for (const mt of METRICS) values[mt] = new Float64Array(k);
    for (let t = 0; t < k; t++) {
      const i = keep[t];
      step[t] = rs[i];
      for (const mt of METRICS) values[mt][t] = raw[mt][i];
    }
  }

  const nonFinite = {} as Record<Metric, NonFiniteCount>;
  const nonPositive = {} as Record<Metric, number>;
  for (const mt of METRICS) {
    const v = values[mt];
    const c: NonFiniteCount = { nan: 0, posInf: 0, negInf: 0 };
    let np = 0;
    for (let t = 0; t < k; t++) {
      const x = v[t];
      if (x !== x) c.nan++;
      else if (x === Infinity) c.posInf++;
      else if (x === -Infinity) c.negInf++;
      else if (x <= 0) np++;
    }
    nonFinite[mt] = c;
    nonPositive[mt] = np;
  }

  const medianStride = median(step);
  const gapThreshold = k < 3 ? Infinity : medianStride * GAP_FACTOR;
  const gaps: { from: number; to: number }[] = [];
  for (let t = 0; t + 1 < k; t++) {
    if (step[t + 1] - step[t] > gapThreshold) gaps.push({ from: step[t], to: step[t + 1] });
  }

  return {
    n: k,
    step,
    values,
    report: { input: N, invalidSteps, duplicatesDropped: dups, wasUnsorted: !sorted, medianStride, gapThreshold, gaps, nonFinite, nonPositive },
  };
}

/** Median of consecutive differences, sampled (<=10k diffs) so it is O(1)-ish on 1M points. */
function median(step: Float64Array): number {
  const d = step.length - 1;
  if (d < 1) return 1;
  const S = Math.min(d, 10_001);
  const sample = new Float64Array(S);
  for (let j = 0; j < S; j++) {
    const t = Math.floor((j * d) / S);
    sample[j] = step[t + 1] - step[t];
  }
  sample.sort();
  return sample[Math.floor(S / 2)];
}
