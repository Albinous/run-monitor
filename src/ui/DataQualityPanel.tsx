import { type CleanReport, GAP_FACTOR } from '../core/clean';
import { formatStep } from '../core/format';
import { METRICS } from '../core/types';
import { LOCALE } from './env';

/** How many gaps are listed as examples. */
const GAP_EXAMPLES = 3;

interface Props {
  report: CleanReport;
  /** Points left after cleaning. */
  drawnPoints: number;
}

function nonFiniteCount(report: CleanReport): number {
  let total = 0;
  for (const metric of METRICS) {
    const counts = report.nonFinite[metric];
    total += counts.nan + counts.posInf + counts.negInf;
  }
  return total;
}

/** Lists what was changed in the raw data before drawing. Opens by itself when something was wrong. */
export function DataQualityPanel({ report, drawnPoints }: Props) {
  const hasProblems =
    nonFiniteCount(report) > 0 ||
    report.duplicatesDropped > 0 ||
    report.wasUnsorted ||
    report.gaps.length > 0 ||
    report.invalidSteps > 0;

  const gapExamples = report.gaps
    .slice(0, GAP_EXAMPLES)
    .map((gap) => `${formatStep(gap.from, LOCALE)}→${formatStep(gap.to, LOCALE)}`)
    .join(', ');

  return (
    <details className="quality" open={hasProblems}>
      <summary>Data quality — what we changed before drawing</summary>
      <ul>
        <li>
          {formatStep(report.input, LOCALE)} raw points received → {formatStep(drawnPoints, LOCALE)} drawn on the step
          axis.
        </li>
        <li>{report.wasUnsorted ? 'Steps arrived out of order → sorted by step.' : 'Steps arrived in order.'}</li>
        <li>
          {report.duplicatesDropped
            ? `${formatStep(report.duplicatesDropped, LOCALE)} duplicate steps → kept the last written value (resume-from-checkpoint semantics).`
            : 'No duplicate steps.'}
        </li>
        {report.invalidSteps > 0 && <li>{report.invalidSteps} points had a non-numeric step and were dropped.</li>}
        <li>
          {report.gaps.length > 0
            ? `${report.gaps.length} logging gap(s) (> ${GAP_FACTOR}× median stride ${formatStep(report.medianStride, LOCALE)}): ` +
              `line is broken, not interpolated — e.g. ${gapExamples}.`
            : 'No logging gaps.'}
        </li>
        {METRICS.map((metric) => {
          const counts = report.nonFinite[metric];
          if (counts.nan + counts.posInf + counts.negInf === 0) return null;
          return (
            <li key={`nonfinite-${metric}`} className="bad-text">
              {metric}: {counts.nan} NaN, {counts.posInf} +∞, {counts.negInf} −∞ — shown as red markers, never as 0 and
              never smoothed over.
            </li>
          );
        })}
        {METRICS.map((metric) =>
          report.nonPositive[metric] ? (
            <li key={`nonpositive-${metric}`}>
              {metric}: {report.nonPositive[metric]} value(s) ≤ 0 — drawn on linear axis; on log axis shown as ▼ markers
              at the bottom.
            </li>
          ) : null,
        )}
      </ul>
    </details>
  );
}
