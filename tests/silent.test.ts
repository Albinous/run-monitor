import { describe, expect, it } from 'vitest';
import { cleanRun } from '../src/core/clean';
import { emaSmooth } from '../src/core/downsample';
import { formatDateTime } from '../src/core/format';
import { computeSegments } from '../src/core/index';
import { createLatest } from '../src/core/latest';
import { summarize } from '../src/core/summary';
import { RUN_SPECS } from '../src/data/generate';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('request race when switching runs quickly', () => {
  it('a slow response for run A that arrives after run B is dropped', async () => {
    const latest = createLatest<string>();
    const got: string[] = [];
    // backend that IGNORES the abort signal (worst case)
    latest.run(() => sleep(60).then(() => 'A'), (r) => r.ok && got.push(r.value));
    latest.run(() => sleep(10).then(() => 'B'), (r) => r.ok && got.push(r.value));
    await sleep(100);
    expect(got).toEqual(['B']);
  });

  it('A→B→C rapid switching delivers only C, and errors from stale requests are dropped too', async () => {
    const latest = createLatest<string>();
    const got: string[] = [];
    latest.run(() => sleep(30).then(() => { throw new Error('A failed'); }), (r) => got.push(r.ok ? r.value : 'err'));
    latest.run(() => sleep(50).then(() => 'B'), (r) => got.push(r.ok ? r.value : 'err'));
    latest.run(() => sleep(5).then(() => 'C'), (r) => got.push(r.ok ? r.value : 'err'));
    await sleep(80);
    expect(got).toEqual(['C']);
  });

  it('the previous request is aborted (network is freed)', () => {
    const latest = createLatest<string>();
    let sig: AbortSignal | undefined;
    latest.run((s) => { sig = s; return new Promise(() => {}); }, () => {});
    latest.run(() => new Promise(() => {}), () => {});
    expect(sig!.aborted).toBe(true);
  });

  it('cancel() (unmount / navigate away) drops an in-flight result', async () => {
    const latest = createLatest<string>();
    const got: string[] = [];
    latest.run(() => sleep(10).then(() => 'A'), (r) => r.ok && got.push(r.value));
    latest.cancel();
    await sleep(30);
    expect(got).toEqual([]);
  });
});

describe('locale and time zone', () => {
  const iso = '2026-11-04T23:59:00Z'; // r08 start: different calendar day in Tokyo and LA

  it('the same instant shows the correct local date with an explicit zone name', () => {
    const tokyo = formatDateTime(iso, 'en-US', 'Asia/Tokyo');
    const la = formatDateTime(iso, 'en-US', 'America/Los_Angeles');
    const utc = formatDateTime(iso, 'en-US', 'UTC');
    expect(tokyo).toMatch(/Nov 5, 2026/);
    expect(tokyo).toMatch(/GMT\+9/);
    expect(la).toMatch(/Nov 4, 2026/);
    expect(la).toMatch(/PST/);
    expect(utc).toMatch(/11:59 PM UTC/);
  });

  it('sorting by start time uses epoch ms, so locale string order cannot leak in', () => {
    const asc = [...RUN_SPECS].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const fmt = asc.map((s) => formatDateTime(s.startedAt, 'de-DE', 'UTC'));
    // de-DE strings ("4. Nov.", "10. Nov.") do NOT sort chronologically — proof that sorting strings would be wrong
    expect([...fmt].sort()).not.toEqual(fmt);
  });

  it('invalid dates say so instead of "Invalid Date" or 1970', () => {
    expect(formatDateTime('not-a-date', 'en-US')).toBe('invalid date');
  });
});

describe('smoothing that hides divergence', () => {
  it('r13: raw recent trend flags the late blow-up even though heavy EMA barely moves', () => {
    const s = cleanRun(RUN_SPECS.find((x) => x.id === 'r13')!.build());
    const v = s.values.loss;
    const sm = emaSmooth(v, computeSegments(s.step, v, s.report.gapThreshold, 'finite'), 0.99);
    const n = s.n;
    const rawEnd = v[n - 1];
    const smEnd = sm[n - 1];
    // the smoothed line understates the final loss by > 2x — this IS the silent failure
    expect(rawEnd / smEnd).toBeGreaterThan(2);
    // the summary card is computed on raw data and catches it
    expect(summarize(s).recentTrend!).toBeGreaterThan(0.2);
  });
});

describe('stale data', () => {
  it('list "last loss" for a diverged run is the value at the last step (NaN), not the last finite value', async () => {
    const { listRuns } = await import('../src/data/api');
    const { runs } = await listRuns();
    const r04 = runs.find((r) => r.id === 'r04')!;
    expect(Number.isNaN(r04.lastLoss)).toBe(true);
  });
});
