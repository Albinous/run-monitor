import { beforeAll, describe, expect, it } from 'vitest';
import { type CleanSeries, cleanRun } from '../src/core/clean';
import { drawFrame } from '../src/core/draw';
import { type MetricPrep, computeFrame, prepareMetric } from '../src/core/frame';
import { formatTick } from '../src/core/format';
import { nearestIndex } from '../src/core/index';
import { summarize } from '../src/core/summary';
import { RUN_SPECS, SPIKE, baseRun } from '../src/data/generate';
import { columnExtents, frameFor, raw, recordingCtx, vertices } from './helpers';

/** Parses an en-US number label: "250,000" -> 250000. */
const parseEn = (label: string) => Number(label.replaceAll(',', ''));

const PAL = {
  bg: '#fff',
  grid: '#eee',
  axis: '#333',
  text: '#444',
  line: '#00f',
  smooth: '#000',
  nan: '#f00',
  inf: '#f00',
};

// ───────────────────────────────────────────── 1M points + single spike
describe('1M-point run: the single spike is visible at every zoom level', () => {
  let series: CleanSeries;
  let prep: MetricPrep;
  const spikeStep = SPIKE.index; // stride 1 -> step == index
  beforeAll(() => {
    series = cleanRun(RUN_SPECS.find((s) => s.id === SPIKE.runId)!.build());
    prep = prepareMetric(series, 'loss');
  });

  const frame = (x0: number, x1: number, width = 876, smoothing = 0) =>
    computeFrame({ series, metric: 'loss', prep, scale: 'linear', view: { x0, x1 }, width, height: 220, smoothing });

  it('data sanity: exactly one outlier, 1,000,000 points', () => {
    expect(series.n).toBe(1_000_000);
    const v = series.values.loss;
    let above = 0;
    // (first version used i > 100k and failed: the loss curve itself is still > 6 until ~step 105k)
    for (let i = 300_000; i < v.length; i++) if (v[i] > 6) above++;
    expect(above).toBe(1);
    expect(v[SPIKE.index]).toBe(SPIKE.value);
  });

  // zoom windows from the full 1M span down to 20 steps, centred on the spike AND with the spike near each edge
  const spans = Array.from({ length: 16 }, (_, k) => Math.round(1_000_000 / 2 ** k)).filter((s) => s >= 20);
  const placements = [0.5, 0.02, 0.98, 0.37];
  const widths = [300, 876, 1600];
  for (const width of widths) {
    it(`width ${width}px: spike reaches the top of the y-domain and is drawn at the top-most vertex (${spans.length} zoom levels × ${placements.length} placements)`, () => {
      for (const span of spans) {
        for (const p of placements) {
          let x0 = spikeStep - span * p;
          x0 = Math.max(0, Math.min(x0, 999_999 - span));
          const f = frame(x0, x0 + span, width);
          // y domain contains the spike
          expect(f.y.domainMax).toBeGreaterThanOrEqual(SPIKE.value);
          // the spike vertex is in the drawn polyline …
          const all = f.lines.flatMap((l) => [...l.idx]);
          expect(all).toContain(SPIKE.index);
          // … and it is the highest vertex on screen (smallest y px), inside the plot rect
          let minY = Infinity,
            spikeY = Number.NaN;
          for (const l of f.lines)
            for (let t = 0; t < l.idx.length; t++) {
              const y = l.px[2 * t + 1];
              if (y < minY) minY = y;
              if (l.idx[t] === SPIKE.index) spikeY = y;
            }
          expect(spikeY).toBe(minY);
          expect(spikeY).toBeGreaterThanOrEqual(f.plot.top);
          // the drawn spike is tall: >40% of plot height above the median line level (not a 1px blip)
          expect(f.y.toPixel(2) - spikeY).toBeGreaterThan(f.plot.height * 0.4);
        }
      }
    });
  }

  it('spike stays visible with heavy smoothing on (raw line is still drawn)', () => {
    const f = frame(0, 999_999, 876, 0.99);
    expect(f.lines.flatMap((l) => [...l.idx])).toContain(SPIKE.index);
    expect(f.smoothLines.length).toBeGreaterThan(0);
  });

  it('when the spike is NOT in view, the y-domain does not keep a stale max', () => {
    const f = frame(600_000, 700_000);
    expect(f.y.domainMax).toBeLessThan(SPIKE.value / 2);
  });

  it('M4 output covers exactly the same per-pixel vertical extent as drawing all points', () => {
    for (const [x0, x1] of [
      [0, 999_999],
      [400_000, 600_000],
      [499_000, 501_000],
      [123_456, 654_321],
    ]) {
      const m4 = frame(x0, x1);
      const naive = computeFrame({
        series,
        metric: 'loss',
        prep,
        scale: 'linear',
        view: { x0, x1 },
        width: 876,
        height: 220,
        smoothing: 0,
        mode: 'naive',
      });
      // windows with <= 4 points/px are drawn in full (no downsampling needed)
      expect(m4.drawnPoints).toBeLessThanOrEqual(naive.drawnPoints);
      const a = columnExtents(m4, series.step, x0, x1);
      const b = columnExtents(naive, series.step, x0, x1);
      expect(a.size).toBe(b.size);
      for (const [c, [lo, hi]] of b) {
        expect(a.get(c)).toEqual([lo, hi]);
      }
    }
  });

  it('draws at most ~4 points per pixel column', () => {
    const f = frame(0, 999_999);
    expect(f.drawnPoints).toBeLessThanOrEqual(f.plot.width * 4 + 2);
  });
});

// ───────────────────────────────────────────── NaN / Inf
describe('NaN and Infinity are never drawn as 0 nor smoothed over', () => {
  const steps = Array.from({ length: 200 }, (_, i) => i);
  const loss = steps.map((i) => 1 + 0.1 * Math.sin(i / 5)); // values in [0.9, 1.1]
  loss[50] = Number.NaN;
  loss[120] = Infinity;
  loss[121] = -Infinity;

  it('y-domain is computed from finite values only (would stretch to 0 if NaN were 0)', () => {
    const { frame } = frameFor(raw(steps, loss));
    expect(frame.y.domainMin).toBeGreaterThan(0.85);
    expect(frame.y.domainMax).toBeLessThan(1.15);
  });

  it('every drawn vertex is a finite raw value; the line breaks at NaN/±Inf', () => {
    const { frame, series } = frameFor(raw(steps, loss));
    const vs = vertices(frame, series.values.loss, series.step);
    for (const line of vs)
      for (const p of line) {
        expect(Number.isFinite(p.value)).toBe(true);
        expect(p.value).toBeGreaterThan(0.85);
      }
    // three breaks -> segments [0,50) [51,120) [122,200)
    expect(vs.map((l) => [l[0].step, l.at(-1)!.step])).toEqual([
      [0, 49],
      [51, 119],
      [122, 199],
    ]);
  });

  it('NaN / ±Inf get explicit markers at their exact steps', () => {
    const { frame } = frameFor(raw(steps, loss));
    const m = frame.markers.map((x) => [x.kind, x.step]);
    expect(m).toEqual(
      expect.arrayContaining([
        ['nan', 50],
        ['posInf', 120],
        ['negInf', 121],
      ]),
    );
    expect(frame.notes.join(' ')).toMatch(/1 NaN/);
  });

  it('the canvas never receives a NaN coordinate and never a lineTo across the NaN step', () => {
    const { frame } = frameFor(raw(steps, loss));
    const { ctx, calls } = recordingCtx();
    drawFrame(ctx as never, frame, 876, 220, PAL, false);
    for (const c of calls) for (const a of c.args) expect(Number.isFinite(a)).toBe(true);
    // a lineTo whose x is at the NaN step would mean we connected through it
    const nanX = frame.x.toPixel(50);
    const lineTos = calls.filter((c) => c.op === 'lineTo' && Math.abs(c.args[0] - nanX) < 0.01);
    // only the dashed full-height NaN marker may sit at that x
    for (const c of lineTos) expect(c.args[1]).toBe(frame.plot.top + frame.plot.height);
  });

  it('EMA smoothing restarts after NaN instead of bridging it', () => {
    const { frame, series } = frameFor(raw(steps, loss), { smoothing: 0.9 });
    const sm = vertices(frame, series.values.loss, series.step, 'smoothLines');
    expect(sm.map((l) => [l[0].step, l.at(-1)!.step])).toEqual([
      [0, 49],
      [51, 119],
      [122, 199],
    ]);
    // debiased EMA's first value after a restart equals the raw value
    const prep = frameFor(raw(steps, loss), { smoothing: 0.9 }).prep;
    const sv = [...prep.smoothCache.values()][0].values;
    expect(sv[51]).toBeCloseTo(loss[51], 12);
    expect(Number.isNaN(sv[50])).toBe(true);
  });

  it('an isolated finite point between two NaNs is still drawn (as a dot)', () => {
    const l2 = [...loss];
    l2[60] = Number.NaN;
    l2[62] = Number.NaN; // 61 is alone
    const { frame } = frameFor(raw(steps, l2));
    const { ctx, calls } = recordingCtx();
    drawFrame(ctx as never, frame, 876, 220, PAL, false);
    const x61 = frame.x.toPixel(61);
    expect(calls.some((c) => c.op === 'fillRect' && Math.abs(c.args[0] + 1.5 - x61) < 0.01)).toBe(true);
  });
});

// ───────────────────────────────────────────── duplicates / unsorted / gaps
describe('duplicates and unsorted steps do not distort the line', () => {
  const clean = baseRun({ n: 3000, stride: 10, seed: 42 });

  it('shuffled + duplicated input produces the identical drawn line as the clean input', () => {
    const n = clean.step.length;
    const order = Array.from({ length: n }, (_, i) => i).toReversed(); // fully reversed
    // prepend STALE duplicates of 500 steps (written first, so they must lose)
    const staleDuplicateIndices = Array.from({ length: 500 }, (_, i) => 1000 + i);
    const st = [...staleDuplicateIndices.map((i) => clean.step[i]), ...order.map((i) => clean.step[i])];
    const ls = [...staleDuplicateIndices.map(() => 99), ...order.map((i) => clean.loss[i])];
    const messy = raw(st, ls);
    const a = frameFor(clean);
    const b = frameFor(messy);
    expect(b.series.report.duplicatesDropped).toBe(500);
    expect(b.series.report.wasUnsorted).toBe(true);
    expect([...b.series.step]).toEqual([...clean.step]);
    expect([...b.series.values.loss]).toEqual([...clean.loss]);
    expect(b.frame.lines.map((l) => [...l.px])).toEqual(a.frame.lines.map((l) => [...l.px]));
    expect(b.frame.y.domainMax).toBeLessThan(20); // the stale 99s did not leak into the domain
  });

  it('later write wins for duplicated steps (resume from checkpoint)', () => {
    const s = cleanRun(raw([0, 1, 2, 1, 2, 3], [5, 4, 3, 40, 30, 2]));
    expect([...s.step]).toEqual([0, 1, 2, 3]);
    expect([...s.values.loss]).toEqual([5, 40, 30, 2]);
  });

  it('the drawn polyline is strictly increasing in x', () => {
    const r06 = RUN_SPECS.find((s) => s.id === 'r06')!.build();
    const { frame } = frameFor(r06);
    for (const l of frame.lines) for (let t = 2; t < l.px.length; t += 2) expect(l.px[t]).toBeGreaterThan(l.px[t - 2]);
  });

  it('logging gaps break the line instead of interpolating', () => {
    const r07 = RUN_SPECS.find((s) => s.id === 'r07')!.build();
    const { frame, series } = frameFor(r07);
    expect(series.report.gaps).toEqual([
      { from: 59_990, to: 70_000 },
      { from: 119_990, to: 122_000 },
    ]);
    const v = vertices(frame, series.values.loss, series.step);
    expect(v.length).toBe(3);
    expect(v[0].at(-1)!.step).toBe(59_990);
    expect(v[1][0].step).toBe(70_000);
  });

  it('real r05 run: the corrupted pre-crash values are not shown', () => {
    const r05 = RUN_SPECS.find((s) => s.id === 'r05')!.build();
    const ref = baseRun({ n: 10_000, stride: 10, seed: 5 });
    const s = cleanRun(r05);
    expect([...s.values.loss]).toEqual([...ref.loss]);
  });
});

// ───────────────────────────────────────────── numbers & axis labels
describe('numbers and axis labels match the data', () => {
  it('y tick labels parse back to their tick values, ticks sit at the right pixel, all in-domain, all distinct', () => {
    for (const id of ['r01', 'r04', 'r08', 'r16']) {
      const spec = RUN_SPECS.find((s) => s.id === id)!;
      for (const metric of ['loss', 'lr', 'grad_norm'] as const) {
        const { frame } = frameFor(spec.build(), { metric });
        expect(frame.yTicks.length).toBeGreaterThanOrEqual(2);
        const labels = frame.yTicks.map((t) => t.label);
        expect(new Set(labels).size).toBe(labels.length);
        for (const t of frame.yTicks) {
          expect(t.value).toBeGreaterThanOrEqual(frame.y.domainMin);
          expect(t.value).toBeLessThanOrEqual(frame.y.domainMax);
          expect(Math.abs(parseEn(t.label) - t.value)).toBeLessThanOrEqual(Math.abs(t.value) * 1e-9 + 1e-15);
          expect(frame.y.toValue(t.px)).toBeCloseTo(t.value, 9);
        }
        for (const t of frame.xTicks) {
          expect(parseEn(t.label)).toBe(t.value);
          expect(Number.isInteger(t.value)).toBe(true);
        }
      }
    }
  });

  it('log axis ticks are exact and labelled correctly', () => {
    const { frame } = frameFor(RUN_SPECS.find((s) => s.id === 'r04')!.build(), { metric: 'grad_norm', scale: 'log' });
    for (const t of frame.yTicks) expect(parseEn(t.label)).toBeCloseTo(t.value, 12);
  });

  it('a drawn vertex sits exactly where its raw value maps on the axis', () => {
    const { frame, series } = frameFor(RUN_SPECS.find((s) => s.id === 'r03')!.build());
    for (const l of frame.lines)
      for (let t = 0; t < l.idx.length; t += 37) {
        const i = l.idx[t];
        expect(frame.y.toValue(l.px[2 * t + 1])).toBeCloseTo(series.values.loss[i], 4);
        expect(frame.x.toValue(l.px[2 * t])).toBeCloseTo(series.step[i], 1);
      }
  });

  it('summary cards equal a brute-force computation on the RAW (unsorted, duplicated) input', () => {
    for (const id of ['r03', 'r04', 'r05', 'r06', 'r09']) {
      const r = RUN_SPECS.find((s) => s.id === id)!.build();
      // independent reference: Map keyed by step, later write wins
      const m = new Map<number, number>();
      for (let i = 0; i < r.step.length; i++) m.set(r.step[i], r.loss[i]);
      const keys = [...m.keys()].toSorted((a, b) => a - b);
      const finite = keys.filter((k) => Number.isFinite(m.get(k)!));
      const min = Math.min(...finite.map((k) => m.get(k)!));
      const s = summarize(cleanRun(r));
      expect(s.points).toBe(keys.length);
      expect(s.lastStep).toBe(keys.at(-1));
      expect(Object.is(s.lossAtLastStep, m.get(keys.at(-1)!))).toBe(true);
      expect(s.minLoss!.value).toBe(min);
    }
  });

  it('diverged run: "loss at last step" is NaN, not the last pretty value', () => {
    const s = summarize(cleanRun(RUN_SPECS.find((x) => x.id === 'r04')!.build()));
    expect(Number.isNaN(s.lossAtLastStep)).toBe(true);
    expect(s.firstNonFinite?.value).toBe(Infinity);
  });

  it('hover reads the exact raw value at the nearest step', () => {
    const r = RUN_SPECS.find((s) => s.id === 'r03')!.build();
    const s = cleanRun(r);
    const i = nearestIndex(s.step, 12_004); // step 12000 has NaN (index 1200)
    expect(s.step[i]).toBe(12_000);
    expect(Number.isNaN(s.values.loss[i])).toBe(true);
  });

  it('formatting is locale-aware but never changes the number', () => {
    expect(formatTick(0.5, 0.1, 'de-DE')).toBe('0,5');
    expect(formatTick(0.5, 0.1, 'en-US')).toBe('0.5');
    expect(formatTick(250_000, 50_000, 'en-US')).toBe('250,000');
    expect(formatTick(0.0003, 0.0001, 'en-US')).toBe('3E-4');
  });
});

// ───────────────────────────────────────────── log scale with zeros
describe('log scale with zeros / negatives', () => {
  it('lr starts and ends at exactly 0: zeros are markers, not -Infinity pixels, and the domain stays positive', () => {
    const r = RUN_SPECS.find((s) => s.id === 'r01')!.build();
    expect(r.lr[0]).toBe(0);
    const { frame, series } = frameFor(r, { metric: 'lr', scale: 'log' });
    expect(frame.y.domainMin).toBeGreaterThan(0);
    for (const l of frame.lines) for (const p of l.px) expect(Number.isFinite(p)).toBe(true);
    const np = frame.markers.filter((m) => m.kind === 'nonPositive');
    expect(np.map((m) => m.step)).toEqual(expect.arrayContaining([0, series.step[series.n - 1]]));
    expect(frame.notes.join(' ')).toMatch(/≤ 0 not plottable/);
  });

  it('the same zeros ARE drawn on a linear axis', () => {
    const { frame } = frameFor(RUN_SPECS.find((s) => s.id === 'r01')!.build(), { metric: 'lr', scale: 'linear' });
    expect(frame.lines[0].idx[0]).toBe(0);
    expect(frame.markers.length).toBe(0);
  });
});
