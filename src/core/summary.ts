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

export function summarize(s: CleanSeries): Summary {
  const n = s.n;
  const { loss, lr, grad_norm } = s.values;
  let minLoss: At | null = null;
  let maxGn: At | null = null;
  let lastFinite: At | null = null;
  let firstNF: Summary['firstNonFinite'] = null;
  for (let i = 0; i < n; i++) {
    const l = loss[i];
    if (Number.isFinite(l)) {
      if (!minLoss || l < minLoss.value) minLoss = { step: s.step[i], value: l };
      lastFinite = { step: s.step[i], value: l };
    }
    const g = grad_norm[i];
    if (Number.isFinite(g) && (!maxGn || g > maxGn.value)) maxGn = { step: s.step[i], value: g };
    if (!firstNF) {
      for (const m of METRICS) {
        const x = s.values[m][i];
        if (!Number.isFinite(x)) { firstNF = { metric: m, step: s.step[i], value: x }; break; }
      }
    }
  }
  let trend: number | null = null;
  const w = Math.floor(n * 0.05);
  if (w >= 5) {
    const mean = (a: number, b: number) => {
      let sum = 0, c = 0;
      for (let i = a; i < b; i++) if (Number.isFinite(loss[i])) { sum += loss[i]; c++; }
      return c ? sum / c : NaN;
    };
    const recent = mean(n - w, n), before = mean(n - 2 * w, n - w);
    if (Number.isFinite(recent) && Number.isFinite(before) && before !== 0) trend = (recent - before) / Math.abs(before);
  }
  return {
    points: n,
    firstStep: n ? s.step[0] : null,
    lastStep: n ? s.step[n - 1] : null,
    lossAtLastStep: n ? loss[n - 1] : null,
    lastFiniteLoss: lastFinite,
    minLoss,
    lastLr: n ? lr[n - 1] : null,
    maxGradNorm: maxGn,
    firstNonFinite: firstNF,
    recentTrend: trend,
  };
}
