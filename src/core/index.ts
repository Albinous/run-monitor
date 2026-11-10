/**
 * Range queries over a value array:
 *  - block min/max index (BLOCK=64) so a min/max over k points costs O(k/64 + 128),
 *  - segment splitting (a line never crosses NaN/Inf, a non-positive value on log axes, or a logging gap),
 *  - binary search on steps.
 */

export const BLOCK = 64;

export interface BlockIndex {
  min: Float64Array;
  max: Float64Array;
  argmin: Int32Array;
  argmax: Int32Array;
  minPos: Float64Array;
}

export function buildBlockIndex(v: Float64Array): BlockIndex {
  const n = v.length;
  const nb = Math.ceil(n / BLOCK);
  const min = new Float64Array(nb);
  const max = new Float64Array(nb);
  const argmin = new Int32Array(nb);
  const argmax = new Int32Array(nb);
  const minPos = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let lo = Infinity, hi = -Infinity, al = -1, ah = -1, mp = Infinity;
    const end = Math.min(n, (b + 1) * BLOCK);
    for (let i = b * BLOCK; i < end; i++) {
      const x = v[i];
      if (x !== x || x === Infinity || x === -Infinity) continue;
      if (x < lo) { lo = x; al = i; }
      if (x > hi) { hi = x; ah = i; }
      if (x > 0 && x < mp) mp = x;
    }
    min[b] = lo; max[b] = hi; argmin[b] = al; argmax[b] = ah; minPos[b] = mp;
  }
  return { min, max, argmin, argmax, minPos };
}

export interface Extent {
  min: number;
  max: number;
  argmin: number; // -1 if no finite value
  argmax: number;
}

/** Exact min/max (and their indices) over FINITE values in [i, j). */
export function rangeExtent(v: Float64Array, ix: BlockIndex, i: number, j: number): Extent {
  let lo = Infinity, hi = -Infinity, al = -1, ah = -1;
  const scan = (a: number, b: number) => {
    for (let t = a; t < b; t++) {
      const x = v[t];
      if (x !== x || x === Infinity || x === -Infinity) continue;
      if (x < lo) { lo = x; al = t; }
      if (x > hi) { hi = x; ah = t; }
    }
  };
  const bStart = Math.ceil(i / BLOCK);
  const bEnd = Math.floor(j / BLOCK);
  if (bStart >= bEnd) {
    scan(i, j);
  } else {
    scan(i, bStart * BLOCK);
    for (let b = bStart; b < bEnd; b++) {
      if (ix.argmin[b] >= 0 && ix.min[b] < lo) { lo = ix.min[b]; al = ix.argmin[b]; }
      if (ix.argmax[b] >= 0 && ix.max[b] > hi) { hi = ix.max[b]; ah = ix.argmax[b]; }
    }
    scan(bEnd * BLOCK, j);
  }
  return { min: lo, max: hi, argmin: al, argmax: ah };
}

/** Smallest finite value > 0 in [i, j), or Infinity. */
export function rangeMinPositive(v: Float64Array, ix: BlockIndex, i: number, j: number): number {
  let mp = Infinity;
  const scan = (a: number, b: number) => {
    for (let t = a; t < b; t++) {
      const x = v[t];
      if (x > 0 && x < mp && x !== Infinity) mp = x;
    }
  };
  const bStart = Math.ceil(i / BLOCK);
  const bEnd = Math.floor(j / BLOCK);
  if (bStart >= bEnd) scan(i, j);
  else {
    scan(i, bStart * BLOCK);
    for (let b = bStart; b < bEnd; b++) if (ix.minPos[b] < mp) mp = ix.minPos[b];
    scan(bEnd * BLOCK, j);
  }
  return mp;
}

export type Validity = 'finite' | 'positive';

const ok = (x: number, mode: Validity) =>
  x === x && x !== Infinity && x !== -Infinity && (mode === 'finite' || x > 0);

/** Flat [start0, end0, start1, end1, ...] of maximal drawable runs. */
export function computeSegments(step: Float64Array, v: Float64Array, gapThreshold: number, mode: Validity): Int32Array {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i < v.length; i++) {
    if (ok(v[i], mode)) {
      if (start < 0) start = i;
      else if (step[i] - step[i - 1] > gapThreshold) {
        out.push(start, i);
        start = i;
      }
    } else if (start >= 0) {
      out.push(start, i);
      start = -1;
    }
  }
  if (start >= 0) out.push(start, v.length);
  return Int32Array.from(out);
}

/** Indices of values that cannot be drawn on this scale. */
export function computeInvalid(v: Float64Array, mode: Validity): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) if (!ok(v[i], mode)) out.push(i);
  return Int32Array.from(out);
}

/** First index in [lo,hi) with a[idx] >= x. */
export function lowerBound(a: ArrayLike<number>, x: number, lo = 0, hi = a.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in [lo,hi) with a[idx] > x. */
export function upperBound(a: ArrayLike<number>, x: number, lo = 0, hi = a.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the point whose step is nearest to `x` (ties -> earlier). -1 if empty. */
export function nearestIndex(step: Float64Array, x: number): number {
  const n = step.length;
  if (n === 0) return -1;
  const i = lowerBound(step, x);
  if (i === 0) return 0;
  if (i === n) return n - 1;
  return x - step[i - 1] <= step[i] - x ? i - 1 : i;
}
