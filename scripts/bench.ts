/**
 * CPU cost of computing one chart frame for the 1M-point run, naive (every point) vs M4.
 * Node, no throttling, no canvas raster — the browser trace (DevTools, CPU x4) is the real number;
 * this isolates our own JS so before/after is comparable and reproducible.
 * Run: npx vite-node scripts/bench.ts
 */
import { cleanRun } from '../src/core/clean';
import { computeFrame, prepareMetric } from '../src/core/frame';
import { RUN_SPECS } from '../src/data/generate';

const t = () => performance.now();
let t0 = t();
const raw = RUN_SPECS.find((s) => s.id === 'r08')!.build();
const tGen = t() - t0;
t0 = t();
const series = cleanRun(raw);
const tClean = t() - t0;
t0 = t();
const prep = prepareMetric(series, 'loss');
const tPrep = t() - t0;

function bench(mode: 'm4' | 'naive', x0: number, x1: number, reps = 15) {
  const times: number[] = [];
  let drawn = 0;
  for (let r = 0; r < reps; r++) {
    const s = t();
    const f = computeFrame({
      series,
      metric: 'loss',
      prep,
      scale: 'linear',
      view: { x0, x1 },
      width: 876,
      height: 220,
      smoothing: 0,
      mode,
    });
    times.push(t() - s);
    drawn = f.drawnPoints;
  }
  times.sort((a, b) => a - b);
  return { median: +times[Math.floor(reps / 2)].toFixed(2), p90: +times[Math.floor(reps * 0.9)].toFixed(2), drawn };
}

const views: [string, number, number][] = [
  ['full 1M', 0, 999_999],
  ['250k window', 375_000, 625_000],
  ['10k window', 495_000, 505_000],
];
console.log(`generate ${tGen.toFixed(0)} ms · clean ${tClean.toFixed(1)} ms · prepare(loss) ${tPrep.toFixed(1)} ms`);
console.log('view           | naive median/p90 ms (pts) | m4 median/p90 ms (pts)');
for (const [name, a, b] of views) {
  const n = bench('naive', a, b),
    m = bench('m4', a, b);
  console.log(`${name.padEnd(14)} | ${n.median}/${n.p90} (${n.drawn}) | ${m.median}/${m.p90} (${m.drawn})`);
}
const mem = process.memoryUsage();
console.log(`heapUsed ${(mem.heapUsed / 1e6).toFixed(0)} MB · arrayBuffers ${(mem.arrayBuffers / 1e6).toFixed(0)} MB`);
