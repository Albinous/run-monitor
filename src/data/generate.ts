import type { RawRun, RunStatus } from '../core/types';

/** Deterministic PRNG so tests and the deployed app see identical data. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

interface BaseOpts {
  n: number;
  stride: number;
  seed: number;
  peakLr?: number;
  warmup?: number; // fraction of run
  start?: number; // initial loss
  floor?: number; // asymptotic loss
  tau?: number; // decay constant as fraction of run
  noise?: number; // relative noise
  gn?: number; // grad-norm base
}

export function baseRun(o: BaseOpts): RawRun {
  const { n, stride, seed } = o;
  const peakLr = o.peakLr ?? 3e-4;
  const warm = o.warmup ?? 0.05;
  const start = o.start ?? 10;
  const floor = o.floor ?? 2;
  const tau = o.tau ?? 0.15;
  const noise = o.noise ?? 0.03;
  const gnBase = o.gn ?? 1;
  const r = mulberry32(seed);
  const step = new Float64Array(n);
  const loss = new Float64Array(n);
  const lr = new Float64Array(n);
  const gn = new Float64Array(n);
  const total = Math.max(1, (n - 1) * stride);
  const w = warm * total;
  for (let i = 0; i < n; i++) {
    const s = i * stride;
    step[i] = s;
    // warmup from exactly 0, cosine decay to exactly 0 -> real zeros for log-scale handling
    lr[i] = s < w ? (peakLr * s) / w : peakLr * 0.5 * (1 + Math.cos((Math.PI * (s - w)) / (total - w)));
    const clean = floor + (start - floor) * Math.exp(-s / (tau * total));
    loss[i] = clean * (1 + noise * gauss(r));
    gn[i] = gnBase * Math.exp(0.25 * gauss(r)) * (0.5 + clean / start);
  }
  return { step, loss, lr, grad_norm: gn };
}

function concat(a: RawRun, b: RawRun): RawRun {
  const c = (x: Float64Array, y: Float64Array) => {
    const out = new Float64Array(x.length + y.length);
    out.set(x);
    out.set(y, x.length);
    return out;
  };
  return { step: c(a.step, b.step), loss: c(a.loss, b.loss), lr: c(a.lr, b.lr), grad_norm: c(a.grad_norm, b.grad_norm) };
}

function sliceRun(a: RawRun, from: number, to: number): RawRun {
  return {
    step: a.step.slice(from, to),
    loss: a.loss.slice(from, to),
    lr: a.lr.slice(from, to),
    grad_norm: a.grad_norm.slice(from, to),
  };
}

function pick(a: RawRun, keep: (i: number) => boolean): RawRun {
  const idx: number[] = [];
  for (let i = 0; i < a.step.length; i++) if (keep(i)) idx.push(i);
  const f = (x: Float64Array) => Float64Array.from(idx, (i) => x[i]);
  return { step: f(a.step), loss: f(a.loss), lr: f(a.lr), grad_norm: f(a.grad_norm) };
}

export interface RunSpec {
  id: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  defects: string[];
  /** Simulated server behaviour. */
  latencyMs?: number;
  alwaysFails?: boolean;
  live?: boolean;
  build: () => RawRun;
}

/** The single outlier in the 1M run. Exported so tests can assert on it. */
export const SPIKE = { runId: 'r08', index: 500_000, value: 12.5 };

export const RUN_SPECS: RunSpec[] = [
  { id: 'r01', name: 'baseline-125m', status: 'finished', startedAt: '2026-11-01T08:00:00Z', defects: [], build: () => baseRun({ n: 20_000, stride: 10, seed: 1 }) },
  { id: 'r02', name: 'baseline-350m (slow API)', status: 'finished', startedAt: '2026-11-01T22:45:00Z', defects: ['slow-endpoint'], latencyMs: 2500, build: () => baseRun({ n: 30_000, stride: 10, seed: 2, floor: 1.8 }) },
  {
    id: 'r03', name: 'nan-loss-sporadic', status: 'finished', startedAt: '2026-11-02T03:10:00Z', defects: ['nan'],
    build: () => {
      const r = baseRun({ n: 15_000, stride: 10, seed: 3 });
      for (const i of [1200, 4321, 7777, 7778, 12000]) r.loss[i] = NaN;
      return r;
    },
  },
  {
    id: 'r04', name: 'diverged-lr-3e-3', status: 'failed', startedAt: '2026-11-02T11:00:00Z', defects: ['divergence', 'inf', 'nan'],
    build: () => {
      const r = baseRun({ n: 12_000, stride: 10, seed: 4, peakLr: 3e-3 });
      const n = r.step.length;
      for (let i = Math.floor(n * 0.7); i < n; i++) {
        const t = (i - n * 0.7) / (n * 0.15);
        r.loss[i] = r.loss[i] * Math.exp(3 * t);
        r.grad_norm[i] = r.grad_norm[i] * Math.exp(4 * t);
        if (i >= n * 0.85) r.loss[i] = i < n * 0.86 ? Infinity : NaN;
        if (i >= n * 0.86) r.grad_norm[i] = NaN;
      }
      return r;
    },
  },
  {
    id: 'r05', name: 'resume-duplicates', status: 'finished', startedAt: '2026-11-03T06:30:00Z', defects: ['duplicates'],
    build: () => {
      // Crash at step 50k, resume from checkpoint at 40k: steps 40k..50k are logged twice.
      // The second (post-resume) write is the one that reflects the final model; we keep "last write wins".
      const first = baseRun({ n: 10_000, stride: 10, seed: 5 });
      const crashed = sliceRun(first, 0, 5000);
      for (let i = 4000; i < 5000; i++) crashed.loss[i] *= 1.4; // bad pre-crash values
      return concat(crashed, sliceRun(first, 4000, 10_000));
    },
  },
  {
    id: 'r06', name: 'unsorted-logs', status: 'finished', startedAt: '2026-11-03T14:00:00Z', defects: ['unsorted'],
    build: () => {
      const r = baseRun({ n: 8000, stride: 10, seed: 6 });
      // async logger flushes chunks of 100 out of order
      const rng = mulberry32(66);
      const chunks: number[] = [];
      for (let c = 0; c < 80; c++) chunks.push(c);
      for (let i = chunks.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [chunks[i], chunks[j]] = [chunks[j], chunks[i]];
      }
      const order = chunks.flatMap((c) => Array.from({ length: 100 }, (_, k) => c * 100 + k));
      const f = (x: Float64Array) => Float64Array.from(order, (i) => x[i]);
      return { step: f(r.step), loss: f(r.loss), lr: f(r.lr), grad_norm: f(r.grad_norm) };
    },
  },
  {
    id: 'r07', name: 'logging-gaps', status: 'finished', startedAt: '2026-11-04T09:15:00Z', defects: ['gaps'],
    build: () => {
      const r = baseRun({ n: 20_000, stride: 10, seed: 7 });
      return pick(r, (i) => !((i >= 6000 && i < 7000) || (i >= 12000 && i < 12200)));
    },
  },
  {
    id: 'r08', name: 'long-1m-spike', status: 'finished', startedAt: '2026-11-04T23:59:00Z', defects: ['1M points', 'single spike'],
    build: () => {
      const r = baseRun({ n: 1_000_000, stride: 1, seed: 8, noise: 0.02 });
      r.loss[SPIKE.index] = SPIKE.value;
      return r;
    },
  },
  {
    id: 'r09', name: 'inf-and-nan-mixed', status: 'failed', startedAt: '2026-11-05T05:00:00Z', defects: ['nan', '+inf', '-inf'],
    build: () => {
      const r = baseRun({ n: 6000, stride: 10, seed: 9 });
      r.loss[1000] = Infinity;
      r.loss[2000] = -Infinity;
      r.loss[3000] = NaN;
      r.grad_norm[3000] = NaN;
      r.grad_norm[4500] = Infinity;
      return r;
    },
  },
  {
    id: 'r10', name: 'empty-run', status: 'running', startedAt: '2026-11-10T07:00:00Z', defects: ['no points'],
    build: () => ({ step: new Float64Array(0), loss: new Float64Array(0), lr: new Float64Array(0), grad_norm: new Float64Array(0) }),
  },
  { id: 'r11', name: 'broken-endpoint', status: 'failed', startedAt: '2026-11-05T12:00:00Z', defects: ['HTTP 500'], alwaysFails: true, build: () => baseRun({ n: 100, stride: 10, seed: 11 }) },
  { id: 'r12', name: 'live-run (flaky polling)', status: 'running', startedAt: '2026-11-10T06:00:00Z', defects: ['live', 'flaky'], live: true, build: () => baseRun({ n: 3000, stride: 10, seed: 12 }) },
  {
    id: 'r13', name: 'late-divergence', status: 'finished', startedAt: '2026-11-06T01:00:00Z', defects: ['divergence hidden by smoothing'],
    build: () => {
      const r = baseRun({ n: 10_000, stride: 10, seed: 13, noise: 0.15 });
      const n = r.step.length;
      for (let i = n - 150; i < n; i++) r.loss[i] *= 1 + 4 * ((i - (n - 150)) / 150) ** 2;
      return r;
    },
  },
  { id: 'r14', name: 'sweep-lr-1e-4', status: 'finished', startedAt: '2026-11-06T10:00:00Z', defects: [], build: () => baseRun({ n: 10_000, stride: 10, seed: 14, peakLr: 1e-4, tau: 0.3 }) },
  { id: 'r15', name: 'sweep-lr-3e-4', status: 'finished', startedAt: '2026-11-06T10:05:00Z', defects: [], build: () => baseRun({ n: 10_000, stride: 10, seed: 15, peakLr: 3e-4 }) },
  { id: 'r16', name: 'sweep-lr-1e-3', status: 'finished', startedAt: '2026-11-06T10:10:00Z', defects: [], build: () => baseRun({ n: 10_000, stride: 10, seed: 16, peakLr: 1e-3, tau: 0.08, noise: 0.06 }) },
  { id: 'r17', name: 'warmup-ablation', status: 'finished', startedAt: '2026-11-07T15:30:00Z', defects: [], build: () => baseRun({ n: 5000, stride: 20, seed: 17, warmup: 0.2 }) },
  { id: 'r18', name: 'bs-512', status: 'finished', startedAt: '2026-11-08T02:00:00Z', defects: [], build: () => baseRun({ n: 25_000, stride: 4, seed: 18, noise: 0.05 }) },
  { id: 'r19', name: 'bs-1024', status: 'finished', startedAt: '2026-11-08T02:05:00Z', defects: [], build: () => baseRun({ n: 12_500, stride: 8, seed: 19, noise: 0.035 }) },
  { id: 'r20', name: 'distill-small', status: 'finished', startedAt: '2026-11-09T18:20:00Z', defects: [], build: () => baseRun({ n: 4000, stride: 25, seed: 20, start: 6, floor: 2.6 }) },
];
