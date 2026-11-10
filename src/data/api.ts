/**
 * In-browser mock backend. Same contract a real fetch() wrapper would have: async, abortable,
 * variable latency, can fail. Runs are generated deterministically and cached ("server memory").
 */
import { cleanRun } from '../core/clean';
import { summarize } from '../core/summary';
import type { RawRun, RunMeta } from '../core/types';
import { baseRun, RUN_SPECS, type RunSpec } from './generate';

/** Every response waits a random time between MIN and MIN + SPREAD milliseconds, like a real network. */
const MIN_LATENCY_MS = 150;
const LATENCY_SPREAD_MS = 600;
/** Share of live-run requests that fail (0.3 = 30%), to show the stale-data banner. */
const LIVE_RUN_FAILURE_RATE = 0.3;
/** The live run starts with this many points and gets one more every LIVE_RUN_MS_PER_POINT (= 20 points/s). */
const LIVE_RUN_START_POINTS = 3000;
const LIVE_RUN_MS_PER_POINT = 50;
/** Generator settings of the live run: logs every 10 steps, slow loss decay. */
const LIVE_RUN_STRIDE = 10;
const LIVE_RUN_SEED = 12;
const LIVE_RUN_DECAY = 2;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const store = new Map<string, RawRun>();
const bootTime = Date.now();

function rawFor(spec: RunSpec): RawRun {
  if (spec.live) {
    const points = LIVE_RUN_START_POINTS + Math.floor((Date.now() - bootTime) / LIVE_RUN_MS_PER_POINT);
    return baseRun({ n: points, stride: LIVE_RUN_STRIDE, seed: LIVE_RUN_SEED, tau: LIVE_RUN_DECAY });
  }
  let run = store.get(spec.id);
  if (!run) {
    run = spec.build();
    store.set(spec.id, run);
  }
  return run;
}

function metaFor(spec: RunSpec): RunMeta {
  const summary = summarize(cleanRun(rawFor(spec)));
  return {
    id: spec.id,
    name: spec.name,
    status: spec.status,
    startedAt: spec.startedAt,
    defects: spec.defects,
    points: summary.points,
    lastStep: summary.lastStep,
    // Value at the LAST step, even if NaN: showing the last finite value would make a diverged run look healthy.
    // (A real JSON API would turn NaN into null — it would need an explicit encoding, e.g. "NaN" strings.)
    lastLoss: summary.lossAtLastStep,
    minLoss: summary.minLoss?.value ?? null,
  };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

const randomLatency = () => MIN_LATENCY_MS + Math.random() * LATENCY_SPREAD_MS;

export async function listRuns(signal?: AbortSignal): Promise<{ runs: RunMeta[]; fetchedAt: number }> {
  await delay(randomLatency(), signal);
  return { runs: RUN_SPECS.map(metaFor), fetchedAt: Date.now() };
}

export async function getRun(id: string, signal?: AbortSignal): Promise<{ meta: RunMeta; data: RawRun; fetchedAt: number }> {
  const spec = RUN_SPECS.find((s) => s.id === id);
  await delay(spec?.latencyMs ?? randomLatency(), signal);
  if (!spec) throw new ApiError(404, `Run "${id}" not found`);
  if (spec.alwaysFails) throw new ApiError(500, 'Internal Server Error: metrics shard unavailable');
  if (spec.live && Math.random() < LIVE_RUN_FAILURE_RATE) throw new ApiError(503, 'Upstream timeout while polling live run');
  return { meta: metaFor(spec), data: rawFor(spec), fetchedAt: Date.now() };
}

export const RUN_IDS = RUN_SPECS.map((s) => s.id);
