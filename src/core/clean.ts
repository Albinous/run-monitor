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
  const inputCount = raw.step.length;
  const rawStep = raw.step;

  // 1. indices of points with a usable step; remember whether steps were already in order
  let order = new Uint32Array(inputCount);
  let validCount = 0;
  let invalidSteps = 0;
  let sorted = true;
  let previousStep = -Infinity;
  for (let i = 0; i < inputCount; i++) {
    const stepValue = rawStep[i];
    if (!Number.isFinite(stepValue)) {
      invalidSteps++;
      continue;
    }
    if (stepValue < previousStep) sorted = false;
    previousStep = stepValue;
    order[validCount++] = i;
  }
  order = order.subarray(0, validCount);
  if (!sorted) {
    // stable: equal steps keep their original (log) order, so "last in group" == "last written"
    order = order.slice().sort((a, b) => rawStep[a] - rawStep[b] || a - b);
  }

  // 2. drop duplicate steps, keeping the last written one
  const kept = new Uint32Array(validCount);
  let keptCount = 0;
  let duplicates = 0;
  for (let position = 0; position < validCount; position++) {
    const nextHasSameStep = position + 1 < validCount && rawStep[order[position + 1]] === rawStep[order[position]];
    if (nextHasSameStep) {
      duplicates++;
      continue;
    }
    kept[keptCount++] = order[position];
  }

  // 3. build the clean arrays
  let step: Float64Array;
  const values = {} as Record<Metric, Float64Array>;
  if (sorted && duplicates === 0 && invalidSteps === 0) {
    // Fast path (the 1M run): no copy, keeps tab memory at ~1x the raw data.
    step = rawStep;
    for (const metric of METRICS) values[metric] = raw[metric];
  } else {
    step = new Float64Array(keptCount);
    for (const metric of METRICS) values[metric] = new Float64Array(keptCount);
    for (let position = 0; position < keptCount; position++) {
      const rawIndex = kept[position];
      step[position] = rawStep[rawIndex];
      for (const metric of METRICS) values[metric][position] = raw[metric][rawIndex];
    }
  }

  // 4. count values that can't be drawn
  const nonFinite = {} as Record<Metric, NonFiniteCount>;
  const nonPositive = {} as Record<Metric, number>;
  for (const metric of METRICS) {
    const metricValues = values[metric];
    const counts: NonFiniteCount = { nan: 0, posInf: 0, negInf: 0 };
    let nonPositiveCount = 0;
    for (let i = 0; i < keptCount; i++) {
      const value = metricValues[i];
      if (value !== value) counts.nan++;
      else if (value === Infinity) counts.posInf++;
      else if (value === -Infinity) counts.negInf++;
      else if (value <= 0) nonPositiveCount++;
    }
    nonFinite[metric] = counts;
    nonPositive[metric] = nonPositiveCount;
  }

  // 5. logging gaps
  const medianStride = median(step);
  const gapThreshold = keptCount < 3 ? Infinity : medianStride * GAP_FACTOR;
  const gaps: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < keptCount; i++) {
    if (step[i + 1] - step[i] > gapThreshold) gaps.push({ from: step[i], to: step[i + 1] });
  }

  return {
    n: keptCount,
    step,
    values,
    report: {
      input: inputCount, invalidSteps, duplicatesDropped: duplicates, wasUnsorted: !sorted,
      medianStride, gapThreshold, gaps, nonFinite, nonPositive,
    },
  };
}

/** Median of consecutive differences, sampled (<=10k diffs) so it is O(1)-ish on 1M points. */
function median(step: Float64Array): number {
  const diffCount = step.length - 1;
  if (diffCount < 1) return 1;
  const sampleSize = Math.min(diffCount, 10_001);
  const sample = new Float64Array(sampleSize);
  for (let s = 0; s < sampleSize; s++) {
    const i = Math.floor((s * diffCount) / sampleSize);
    sample[s] = step[i + 1] - step[i];
  }
  sample.sort();
  return sample[Math.floor(sampleSize / 2)];
}
