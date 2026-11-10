/**
 * In-browser mock backend. Same contract a real fetch() wrapper would have: async, abortable,
 * variable latency, can fail. Runs are generated deterministically and cached ("server memory").
 */
import { cleanRun } from '../core/clean';
import { summarize } from '../core/summary';
import type { RawRun, RunMeta } from '../core/types';
import { baseRun, RUN_SPECS, type RunSpec } from './generate';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

const store = new Map<string, RawRun>();
const bootTime = Date.now();

function rawFor(spec: RunSpec): RawRun {
  if (spec.live) {
    // live run grows by 20 points/sec after page load
    const n = 3000 + Math.floor((Date.now() - bootTime) / 50);
    return baseRun({ n, stride: 10, seed: 12, tau: 2 });
  }
  let r = store.get(spec.id);
  if (!r) {
    r = spec.build();
    store.set(spec.id, r);
  }
  return r;
}

function metaFor(spec: RunSpec): RunMeta {
  const s = summarize(cleanRun(rawFor(spec)));
  return {
    id: spec.id, name: spec.name, status: spec.status, startedAt: spec.startedAt, defects: spec.defects,
    points: s.points, lastStep: s.lastStep, // value at the LAST step, even if NaN: showing the last finite value would make a diverged run look healthy.
    // (NB: a real JSON API would turn NaN into null — it would need an explicit encoding, e.g. "NaN" strings.)
    lastLoss: s.lossAtLastStep, minLoss: s.minLoss?.value ?? null,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

const jitter = () => 150 + Math.random() * 600;

export async function listRuns(signal?: AbortSignal): Promise<{ runs: RunMeta[]; fetchedAt: number }> {
  await delay(jitter(), signal);
  return { runs: RUN_SPECS.map(metaFor), fetchedAt: Date.now() };
}

export async function getRun(id: string, signal?: AbortSignal): Promise<{ meta: RunMeta; data: RawRun; fetchedAt: number }> {
  const spec = RUN_SPECS.find((s) => s.id === id);
  await delay(spec?.latencyMs ?? jitter(), signal);
  if (!spec) throw new ApiError(404, `Run "${id}" not found`);
  if (spec.alwaysFails) throw new ApiError(500, 'Internal Server Error: metrics shard unavailable');
  if (spec.live && Math.random() < 0.3) throw new ApiError(503, 'Upstream timeout while polling live run');
  return { meta: metaFor(spec), data: rawFor(spec), fetchedAt: Date.now() };
}

export const RUN_IDS = RUN_SPECS.map((s) => s.id);
