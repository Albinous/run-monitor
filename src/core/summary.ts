import type { CleanSeries } from './clean';
import { METRICS, type Metric } from './types';

export interface At { step: number; value: number }

export interface Summary {
  points: number;
  firstStep: number | null;
  lastStep: number | null;
  /** Value logged at the last step — may be NaN/Inf; we do NOT skip back to the last "nice" value. */
  lossAtLastStep: number | null;
  lastFiniteLoss: At | null;
  minLoss: At | null;
  lastLr: number | null;
  maxGradNorm: At | null;
  firstNonFinite: { metric: Metric; step: number; value: number } | null;
  /** Relative change of mean raw loss: last 5% of points vs the 5% before. Computed on RAW data, independent of smoothing. */
  recentTrend: number | null;
}

/** "Recent trend" compares the mean raw loss of the last 5% of points with the 5% before. */
const TREND_WINDOW_FRACTION = 0.05;
/** With fewer points per window the trend is just noise, so it is not shown. */
const MIN_TREND_WINDOW = 5;

export function summarize(series: CleanSeries): Summary {
  const count = series.n;
  const step = series.step;
  const { loss, lr, grad_norm } = series.values;
  let minLoss: At | null = null;
  let maxGradNorm: At | null = null;
  let lastFiniteLoss: At | null = null;
  let firstNonFinite: Summary['firstNonFinite'] = null;
  for (let i = 0; i < count; i++) {
    const lossValue = loss[i];
    if (Number.isFinite(lossValue)) {
      if (!minLoss || lossValue < minLoss.value) minLoss = { step: step[i], value: lossValue };
      lastFiniteLoss = { step: step[i], value: lossValue };
    }
    const gradValue = grad_norm[i];
    if (Number.isFinite(gradValue) && (!maxGradNorm || gradValue > maxGradNorm.value)) {
      maxGradNorm = { step: step[i], value: gradValue };
    }
    if (!firstNonFinite) {
      for (const metric of METRICS) {
        const value = series.values[metric][i];
        if (!Number.isFinite(value)) {
          firstNonFinite = { metric, step: step[i], value };
          break;
        }
      }
    }
  }

  let trend: number | null = null;
  const window = Math.floor(count * TREND_WINDOW_FRACTION);
  if (window >= MIN_TREND_WINDOW) {
    const meanFiniteLoss = (from: number, to: number) => {
      let sum = 0;
      let finiteCount = 0;
      for (let i = from; i < to; i++) {
        if (Number.isFinite(loss[i])) { sum += loss[i]; finiteCount++; }
      }
      return finiteCount ? sum / finiteCount : NaN;
    };
    const recent = meanFiniteLoss(count - window, count);
    const before = meanFiniteLoss(count - 2 * window, count - window);
    if (Number.isFinite(recent) && Number.isFinite(before) && before !== 0) {
      trend = (recent - before) / Math.abs(before);
    }
  }
  const last = count - 1;
  return {
    points: count,
    firstStep: count ? step[0] : null,
    lastStep: count ? step[last] : null,
    lossAtLastStep: count ? loss[last] : null,
    lastFiniteLoss,
    minLoss,
    lastLr: count ? lr[last] : null,
    maxGradNorm,
    firstNonFinite,
    recentTrend: trend,
  };
}
