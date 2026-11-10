import { type BlockIndex, lowerBound, rangeExtent, upperBound } from './index';

/** M4 keeps at most 4 points per pixel column: first, min, max, last. */
export const POINTS_PER_COLUMN = 4;

/** Step value at the left edge of pixel column `column` (0..columns). Shared with tests so both bin identically. */
export function bucketEdge(viewStart: number, viewEnd: number, columns: number, column: number): number {
  return column >= columns ? viewEnd : viewStart + ((viewEnd - viewStart) * column) / columns;
}

/**
 * M4 downsampling of one drawable segment [segmentStart, segmentEnd) to `columns` pixel columns
 * over the step window [viewStart, viewEnd].
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
  values: Float64Array,
  index: BlockIndex,
  segmentStart: number,
  segmentEnd: number,
  viewStart: number,
  viewEnd: number,
  columns: number,
  naive = false,
): Int32Array {
  // visible part of the segment, plus one neighbour on each side
  const first = Math.max(segmentStart, lowerBound(step, viewStart, segmentStart, segmentEnd) - 1);
  const last = Math.min(segmentEnd, upperBound(step, viewEnd, segmentStart, segmentEnd) + 1);
  if (last <= first) return new Int32Array(0);

  const out: number[] = [];
  let columnStart = first;
  if (step[columnStart] < viewStart) out.push(columnStart++); // point left of the view

  let end = last;
  let pointRightOfView = -1;
  if (end > columnStart && step[end - 1] > viewEnd) {
    pointRightOfView = end - 1;
    end--;
  }

  if (naive || end - columnStart <= columns * POINTS_PER_COLUMN) {
    // few points: nothing to save, draw them all
    for (let i = columnStart; i < end; i++) out.push(i);
  } else {
    for (let column = 0; column < columns && columnStart < end; column++) {
      const columnEnd = column === columns - 1
        ? end
        : lowerBound(step, bucketEdge(viewStart, viewEnd, columns, column + 1), columnStart, end);
      if (columnEnd > columnStart) {
        const extent = rangeExtent(values, index, columnStart, columnEnd);
        const firstInColumn = columnStart;
        const lastInColumn = columnEnd - 1;
        // min and max ordered by time, so the line goes left to right:
        // if the max came before the min, the line must rise first and fall after
        const earlierExtreme = Math.min(extent.argmin, extent.argmax);
        const laterExtreme = Math.max(extent.argmin, extent.argmax);
        out.push(firstInColumn);
        if (earlierExtreme > firstInColumn) out.push(earlierExtreme);
        if (laterExtreme > earlierExtreme && laterExtreme > firstInColumn) out.push(laterExtreme);
        if (lastInColumn > laterExtreme && lastInColumn > firstInColumn) out.push(lastInColumn);
      }
      columnStart = columnEnd;
    }
  }
  if (pointRightOfView >= 0) out.push(pointRightOfView);
  return Int32Array.from(out);
}

/**
 * Debiased EMA (TensorBoard-style), computed independently inside each segment: it restarts after
 * NaN/Inf and after logging gaps, so it never invents values across missing data. Outside segments -> NaN.
 */
export function emaSmooth(values: Float64Array, segments: Int32Array, weight: number): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  for (let s = 0; s < segments.length; s += 2) {
    let average = 0;
    let debias = 0; // corrects the bias towards 0 at the start of every segment
    for (let i = segments[s]; i < segments[s + 1]; i++) {
      average = average * weight + (1 - weight) * values[i];
      debias = debias * weight + (1 - weight);
      out[i] = average / debias;
    }
  }
  return out;
}
