import { useCallback, useMemo, useRef, useState } from 'react';
import type { CleanSeries } from '../core/clean';
import { formatAgo, formatDateTime, formatStep, formatValue } from '../core/format';
import { type MetricPrep, prepareMetric } from '../core/frame';
import { nearestIndex } from '../core/index';
import { summarize } from '../core/summary';
import { METRICS, type Metric, type ScaleKind } from '../core/types';
import { Chart, type PerfSample, type View } from './Chart';
import { DataQualityPanel } from './DataQualityPanel';
import { LOCALE, PERF_HUD, RENDER_MODE, TIME_ZONE } from './env';
import { useNow, usePalettes } from './hooks';
import { SummaryCards } from './SummaryCards';
import { POLL_MS, type ReadyState } from './useRunData';

const CHART_TITLES: Record<Metric, string> = { loss: 'Loss', lr: 'Learning rate', grad_norm: 'Gradient norm' };

/** "N s ago" is updated once a second. */
const CLOCK_TICK_MS = 1000;
/** A running run whose data is older than this is marked STALE, even if no refresh has failed yet. */
const STALE_AFTER_MS = 10_000;
/** You can't zoom in closer than 10 logged points across the whole chart. */
const MIN_VISIBLE_STRIDES = 10;
/** Smoothing slider: from 0 (off) to 0.99 (very heavy), in steps of 0.01. */
const MAX_SMOOTHING = 0.99;
const SMOOTHING_STEP = 0.01;
/** Zoom buttons show half / double of the visible range. */
const BUTTON_ZOOM_IN = 0.5;
const BUTTON_ZOOM_OUT = 2;

const isoTime = (timestamp: number) => new Date(timestamp).toISOString();

/** The whole step range of the run. A run with one point still gets a range of 1 step, so the scale can't divide by 0. */
function fullView(series: CleanSeries): View {
  if (series.n === 0) return { x0: 0, x1: 1 };
  const first = series.step[0];
  const last = series.step[series.n - 1];
  return { x0: first, x1: Math.max(last, first + 1) };
}

/**
 * Zoom state shared by the three charts.
 * `zoom === null` means "show everything", so a live run stays fully visible as it grows.
 */
function useZoom(series: CleanSeries) {
  const full = useMemo(() => fullView(series), [series]);
  const fullSpan = full.x1 - full.x0;
  const minSpan = Math.max(series.report.medianStride * MIN_VISIBLE_STRIDES, Number.EPSILON);
  const [zoom, setZoom] = useState<View | null>(null);

  /** Keeps a view inside the run and not narrower than minSpan. A view as wide as the run becomes null. */
  const clamp = useCallback(
    (wanted: View): View | null => {
      const span = Math.max(minSpan, Math.min(wanted.x1 - wanted.x0, fullSpan));
      if (span >= fullSpan) return null;
      const start = Math.max(full.x0, Math.min(wanted.x0, full.x1 - span));
      return { x0: start, x1: start + span };
    },
    [full, fullSpan, minSpan],
  );

  /** factor < 1 zooms in, factor > 1 zooms out; `center` stays in place on screen. */
  const zoomAt = useCallback(
    (center: number, factor: number) => {
      setZoom((current) => {
        const view = current ?? full;
        return clamp({ x0: center - (center - view.x0) * factor, x1: center + (view.x1 - center) * factor });
      });
    },
    [clamp, full],
  );

  const pan = useCallback(
    (deltaSteps: number) => {
      setZoom((current) => (current ? clamp({ x0: current.x0 + deltaSteps, x1: current.x1 + deltaSteps }) : current));
    },
    [clamp],
  );

  const reset = useCallback(() => setZoom(null), []);

  return { view: zoom ?? full, isZoomed: zoom !== null, zoomAt, pan, reset };
}

export function RunBody({ state }: { state: ReadyState }) {
  const { meta, series, fetchedAt, lastError } = state;
  const now = useNow(CLOCK_TICK_MS);
  const dataAge = now - fetchedAt;
  const isStale = meta.status === 'running' && (lastError !== null || dataAge > STALE_AFTER_MS);

  const summary = useMemo(() => summarize(series), [series]);
  const preps = useMemo(() => {
    if (series.n === 0) return null;
    const entries = METRICS.map((metric) => [metric, prepareMetric(series, metric)]);
    return Object.fromEntries(entries) as Record<Metric, MetricPrep>;
  }, [series]);

  const { view, isZoomed, zoomAt, pan, reset } = useZoom(series);
  const [cursor, setCursor] = useState<number | null>(null);
  const [smoothing, setSmoothing] = useState(0);
  const [scales, setScales] = useState<Record<Metric, ScaleKind>>({
    loss: 'linear',
    lr: 'linear',
    grad_norm: 'linear',
  });
  const palettes = usePalettes();

  // perf samples are kept in a ref so measuring doesn't re-render the page; the HUD forces a re-render itself
  const perfSamples = useRef<Record<string, PerfSample>>({});
  const [, forceRender] = useState(0);
  const onPerf = useCallback((sample: PerfSample) => {
    perfSamples.current[sample.metric] = sample;
    if (PERF_HUD) forceRender((count) => count + 1);
  }, []);

  const cursorIndex = cursor === null ? -1 : nearestIndex(series.step, cursor);
  const viewCenter = (view.x0 + view.x1) / 2;

  return (
    <>
      <header className="run-head">
        <h1>
          {meta.name} <span className={`badge ${meta.status}`}>{meta.status}</span>
        </h1>
        <p className="muted small">
          <code>{meta.id}</code> · started{' '}
          <time dateTime={meta.startedAt} title={`UTC: ${meta.startedAt}`}>
            {formatDateTime(meta.startedAt, LOCALE, TIME_ZONE)}
          </time>{' '}
          · data as of{' '}
          <time dateTime={isoTime(fetchedAt)}>{formatDateTime(isoTime(fetchedAt), LOCALE, TIME_ZONE)}</time> (
          {formatAgo(dataAge)}){meta.status === 'running' && ` · auto-refresh every ${POLL_MS / 1000} s`}
        </p>
      </header>

      {isStale && (
        <div className="banner warn" role="alert">
          <strong>STALE DATA.</strong>{' '}
          {lastError && `Last refresh failed ${formatAgo(now - lastError.at)}: ${lastError.message}. `}
          The chart shows the run as it was {formatAgo(dataAge)}; the real run may have moved on.
        </div>
      )}

      {series.n === 0 || !preps ? (
        <div className="state">
          <h2>No points logged yet</h2>
          <p>
            This run exists but has not reported any metrics.{' '}
            {meta.status === 'running' && 'It will refresh automatically.'}
          </p>
        </div>
      ) : (
        <>
          <SummaryCards summary={summary} series={series} />
          <DataQualityPanel report={series.report} drawnPoints={series.n} />

          <div className="toolbar" role="toolbar" aria-label="Chart controls">
            <label className="smooth">
              <span>
                Smoothing (EMA) <strong>{smoothing.toFixed(2)}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={MAX_SMOOTHING}
                step={SMOOTHING_STEP}
                value={smoothing}
                onChange={(event) => setSmoothing(Number(event.target.value))}
              />
            </label>
            <div className="zoom-btns">
              <button onClick={() => zoomAt(cursor ?? viewCenter, BUTTON_ZOOM_IN)}>Zoom in</button>
              <button onClick={() => zoomAt(cursor ?? viewCenter, BUTTON_ZOOM_OUT)}>Zoom out</button>
              <button onClick={reset} disabled={!isZoomed}>
                Reset
              </button>
            </div>
            <span className="muted small">
              steps {formatStep(view.x0, LOCALE)} – {formatStep(view.x1, LOCALE)}
            </span>
          </div>
          {smoothing > 0 && (
            <p className="small warn-text">
              Smoothing lags and can hide a recent divergence. The raw line stays visible underneath; the summary cards
              use raw values only.
            </p>
          )}
          <p id="chart-help" className="sr-only">
            Focus a chart, then use arrow keys to move the cursor, Shift plus arrows to pan, plus and minus to zoom, 0
            to reset.
          </p>

          <div className="charts">
            {METRICS.map((metric) => (
              <Chart
                key={metric}
                title={CHART_TITLES[metric]}
                metric={metric}
                series={series}
                prep={preps[metric]}
                view={view}
                onPan={pan}
                onZoom={zoomAt}
                onReset={reset}
                cursor={cursor}
                onCursor={setCursor}
                smoothing={smoothing}
                scale={scales[metric]}
                onScale={(scale) => setScales((current) => ({ ...current, [metric]: scale }))}
                palette={palettes[metric]}
                onPerf={onPerf}
              />
            ))}
          </div>

          <div className="readout" aria-live="polite">
            {cursorIndex >= 0 ? (
              <>
                step <strong>{formatStep(series.step[cursorIndex], LOCALE)}</strong>
                {METRICS.map((metric) => (
                  <span key={metric}>
                    {' '}
                    · {metric} <strong>{formatValue(series.values[metric][cursorIndex], LOCALE)}</strong>
                  </span>
                ))}
              </>
            ) : (
              <span className="muted">Hover or focus a chart to read exact values.</span>
            )}
          </div>

          {PERF_HUD && <PerfHud samples={Object.values(perfSamples.current)} />}
        </>
      )}
    </>
  );
}

/** Chromium-only API, not in the TypeScript DOM types. */
const usedHeapMb = () => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1e6) : null;
};

/** Timing box shown with ?perf=1. */
function PerfHud({ samples }: { samples: PerfSample[] }) {
  const lines = samples.map(
    (sample) =>
      `${sample.metric.padEnd(9)} compute ${sample.computeMs.toFixed(1)}ms  draw ${sample.drawMs.toFixed(1)}ms  ` +
      `drawn ${sample.drawn}/${sample.inView}`,
  );
  const heap = usedHeapMb();
  return (
    <pre className="perf" aria-label="Performance">
      {[`mode=${RENDER_MODE}`, ...lines, `heap ${heap ?? 'n/a'} MB`].join('\n')}
    </pre>
  );
}
