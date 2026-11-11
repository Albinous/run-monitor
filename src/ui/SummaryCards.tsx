import type { CleanSeries } from '../core/clean';
import { formatStep, formatValue } from '../core/format';
import { type Summary, TREND_WINDOW_FRACTION } from '../core/summary';
import { LOCALE } from './env';

/** The "Recent trend" card turns red when the mean loss grew by more than 5%. */
const TREND_WARNING = 0.05;

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const signedPercent = (fraction: number) => `${fraction >= 0 ? '+' : ''}${percent(fraction)}`;
const atStep = (step: number) => `@ step ${formatStep(step, LOCALE)}`;

interface Props {
  summary: Summary;
  series: CleanSeries;
}

/** Cards with the key numbers of a run. All of them come from raw data, never from the smoothed line. */
export function SummaryCards({ summary, series }: Props) {
  const { lossAtLastStep, lastFiniteLoss, minLoss, maxGradNorm, firstNonFinite, recentTrend } = summary;
  const lastLossIsBad = lossAtLastStep !== null && !Number.isFinite(lossAtLastStep);
  const window = `${TREND_WINDOW_FRACTION * 100}%`; // "5%"

  return (
    <div className="cards">
      <Card
        label="Last step"
        value={formatStep(summary.lastStep, LOCALE)}
        sub={`${formatStep(series.n, LOCALE)} points`}
      />
      <Card
        label="Loss at last step"
        value={formatValue(lossAtLastStep, LOCALE)}
        bad={lastLossIsBad}
        sub={
          lastLossIsBad && lastFiniteLoss
            ? `last finite ${formatValue(lastFiniteLoss.value, LOCALE)} @ ${formatStep(lastFiniteLoss.step, LOCALE)}`
            : 'raw, unsmoothed'
        }
      />
      <Card label="Min loss" value={formatValue(minLoss?.value, LOCALE)} sub={minLoss ? atStep(minLoss.step) : ''} />
      <Card
        label="Recent trend"
        value={recentTrend === null ? '—' : signedPercent(recentTrend)}
        bad={recentTrend !== null && recentTrend > TREND_WARNING}
        sub={`mean raw loss, last ${window} vs prior ${window}`}
      />
      <Card label="Last LR" value={formatValue(summary.lastLr, LOCALE)} sub="" />
      <Card
        label="Max grad norm"
        value={formatValue(maxGradNorm?.value, LOCALE)}
        sub={maxGradNorm ? atStep(maxGradNorm.step) : ''}
      />
      <Card
        label="First non-finite"
        value={firstNonFinite ? `${firstNonFinite.metric} = ${formatValue(firstNonFinite.value, LOCALE)}` : 'none'}
        bad={!!firstNonFinite}
        sub={firstNonFinite ? atStep(firstNonFinite.step) : 'all values finite'}
      />
    </div>
  );
}

interface CardProps {
  label: string;
  value: string;
  sub: string;
  /** Red card with a ⚠ sign: something is wrong with the run. */
  bad?: boolean;
}

function Card({ label, value, sub, bad }: CardProps) {
  return (
    <div className={`card${bad ? ' bad' : ''}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">
        {bad && <span aria-hidden="true">⚠ </span>}
        {value}
      </div>
      <div className="card-sub">{sub}</div>
    </div>
  );
}
