import { type BlockIndex, lowerBound, rangeExtent, upperBound } from './index';

/** Step value at the left edge of bucket c (c in 0..buckets). Shared with tests so both bin identically. */
export function bucketEdge(x0: number, x1: number, buckets: number, c: number): number {
  return c >= buckets ? x1 : x0 + ((x1 - x0) * c) / buckets;
}

/**
 * M4 downsampling of one drawable segment [s, e) to `buckets` pixel columns over the step window [x0, x1].
 *
 * Per column we keep first, min, max and last point (by index, in order). The min/max points
 * guarantee that the vertical extent drawn in every pixel column equals the extent of the full-resolution
 * line in that column — so a single-sample spike survives at any zoom. One point outside each edge of the
 * window is included so the line runs to the plot edge instead of stopping short.
 *
 * Returns indices into the series (strictly increasing).
 */
export function m4Indices(
  step: Float64Array,
  v: Float64Array,
  ix: BlockIndex,
  s: number,
  e: number,
  x0: number,
  x1: number,
  buckets: number,
  naive = false,
): Int32Array {
  const i = Math.max(s, lowerBound(step, x0, s, e) - 1);
  const j = Math.min(e, upperBound(step, x1, s, e) + 1);
  if (j <= i) return new Int32Array(0);
  const out: number[] = [];
  let cur = i;
  if (step[cur] < x0) out.push(cur++);
  let end = j;
  let tail = -1;
  if (end > cur && step[end - 1] > x1) {
    tail = end - 1;
    end--;
  }
  if (naive || end - cur <= buckets * 4) {
    for (let t = cur; t < end; t++) out.push(t);
  } else {
    for (let c = 0; c < buckets && cur < end; c++) {
      const bEnd = c === buckets - 1 ? end : lowerBound(step, bucketEdge(x0, x1, buckets, c + 1), cur, end);
      if (bEnd > cur) {
        const ext = rangeExtent(v, ix, cur, bEnd);
        const a = cur, d = bEnd - 1;
        const lo = Math.min(ext.argmin, ext.argmax), hi = Math.max(ext.argmin, ext.argmax);
        out.push(a);
        if (lo > a) out.push(lo);
        if (hi > lo && hi > a) out.push(hi);
        if (d > hi && d > a) out.push(d);
      }
      cur = bEnd;
    }
  }
  if (tail >= 0) out.push(tail);
  return Int32Array.from(out);
}

/**
 * Debiased EMA (TensorBoard-style), computed independently inside each segment: it restarts after
 * NaN/Inf and after logging gaps, so it never invents values across missing data. Outside segments -> NaN.
 */
export function emaSmooth(v: Float64Array, segs: Int32Array, w: number): Float64Array {
  const out = new Float64Array(v.length).fill(NaN);
  for (let k = 0; k < segs.length; k += 2) {
    let last = 0, deb = 0;
    for (let i = segs[k]; i < segs[k + 1]; i++) {
      last = last * w + (1 - w) * v[i];
      deb = deb * w + (1 - w);
      out[i] = last / deb;
    }
  }
  return out;
}
