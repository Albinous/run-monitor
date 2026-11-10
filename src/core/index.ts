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

const isFiniteNumber = (x: number) => x === x && x !== Infinity && x !== -Infinity;

export function buildBlockIndex(values: Float64Array): BlockIndex {
  const count = values.length;
  const blockCount = Math.ceil(count / BLOCK);
  const min = new Float64Array(blockCount);
  const max = new Float64Array(blockCount);
  const argmin = new Int32Array(blockCount);
  const argmax = new Int32Array(blockCount);
  const minPos = new Float64Array(blockCount);
  for (let block = 0; block < blockCount; block++) {
    let minValue = Infinity;
    let maxValue = -Infinity;
    let minIndex = -1;
    let maxIndex = -1;
    let minPositive = Infinity;
    const blockEnd = Math.min(count, (block + 1) * BLOCK);
    for (let i = block * BLOCK; i < blockEnd; i++) {
      const value = values[i];
      if (!isFiniteNumber(value)) continue;
      if (value < minValue) { minValue = value; minIndex = i; }
      if (value > maxValue) { maxValue = value; maxIndex = i; }
      if (value > 0 && value < minPositive) minPositive = value;
    }
    min[block] = minValue;
    max[block] = maxValue;
    argmin[block] = minIndex;
    argmax[block] = maxIndex;
    minPos[block] = minPositive;
  }
  return { min, max, argmin, argmax, minPos };
}

export interface Extent {
  min: number;
  max: number;
  argmin: number; // -1 if no finite value
  argmax: number;
}

/** Exact min/max (and their indices) over FINITE values in [from, to). */
export function rangeExtent(values: Float64Array, index: BlockIndex, from: number, to: number): Extent {
  let minValue = Infinity;
  let maxValue = -Infinity;
  let minIndex = -1;
  let maxIndex = -1;
  const scan = (scanFrom: number, scanTo: number) => {
    for (let i = scanFrom; i < scanTo; i++) {
      const value = values[i];
      if (!isFiniteNumber(value)) continue;
      if (value < minValue) { minValue = value; minIndex = i; }
      if (value > maxValue) { maxValue = value; maxIndex = i; }
    }
  };
  // whole blocks inside [from, to) are read from the index; the partial edges are scanned point by point
  const firstFullBlock = Math.ceil(from / BLOCK);
  const endFullBlock = Math.floor(to / BLOCK);
  if (firstFullBlock >= endFullBlock) {
    scan(from, to);
  } else {
    scan(from, firstFullBlock * BLOCK);
    for (let block = firstFullBlock; block < endFullBlock; block++) {
      if (index.argmin[block] >= 0 && index.min[block] < minValue) { minValue = index.min[block]; minIndex = index.argmin[block]; }
      if (index.argmax[block] >= 0 && index.max[block] > maxValue) { maxValue = index.max[block]; maxIndex = index.argmax[block]; }
    }
    scan(endFullBlock * BLOCK, to);
  }
  return { min: minValue, max: maxValue, argmin: minIndex, argmax: maxIndex };
}

/** Smallest finite value > 0 in [from, to), or Infinity. */
export function rangeMinPositive(values: Float64Array, index: BlockIndex, from: number, to: number): number {
  let minPositive = Infinity;
  const scan = (scanFrom: number, scanTo: number) => {
    for (let i = scanFrom; i < scanTo; i++) {
      const value = values[i];
      if (value > 0 && value < minPositive && value !== Infinity) minPositive = value;
    }
  };
  const firstFullBlock = Math.ceil(from / BLOCK);
  const endFullBlock = Math.floor(to / BLOCK);
  if (firstFullBlock >= endFullBlock) scan(from, to);
  else {
    scan(from, firstFullBlock * BLOCK);
    for (let block = firstFullBlock; block < endFullBlock; block++) {
      if (index.minPos[block] < minPositive) minPositive = index.minPos[block];
    }
    scan(endFullBlock * BLOCK, to);
  }
  return minPositive;
}

export type Validity = 'finite' | 'positive';

const isDrawable = (value: number, mode: Validity) => isFiniteNumber(value) && (mode === 'finite' || value > 0);

/** Flat [start0, end0, start1, end1, ...] of maximal drawable runs. */
export function computeSegments(step: Float64Array, values: Float64Array, gapThreshold: number, mode: Validity): Int32Array {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    if (isDrawable(values[i], mode)) {
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
  if (start >= 0) out.push(start, values.length);
  return Int32Array.from(out);
}

/** Indices of values that cannot be drawn on this scale. */
export function computeInvalid(values: Float64Array, mode: Validity): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) if (!isDrawable(values[i], mode)) out.push(i);
  return Int32Array.from(out);
}

/** First index in [left, right) with sorted[index] >= target. */
export function lowerBound(sorted: ArrayLike<number>, target: number, left = 0, right = sorted.length): number {
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (sorted[middle] < target) left = middle + 1;
    else right = middle;
  }
  return left;
}

/** First index in [left, right) with sorted[index] > target. */
export function upperBound(sorted: ArrayLike<number>, target: number, left = 0, right = sorted.length): number {
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (sorted[middle] <= target) left = middle + 1;
    else right = middle;
  }
  return left;
}

/** Index of the point whose step is nearest to `target` (ties -> earlier). -1 if empty. */
export function nearestIndex(step: Float64Array, target: number): number {
  const count = step.length;
  if (count === 0) return -1;
  const after = lowerBound(step, target);
  if (after === 0) return 0;
  if (after === count) return count - 1;
  const before = after - 1;
  return target - step[before] <= step[after] - target ? before : after;
}
