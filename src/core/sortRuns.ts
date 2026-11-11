import type { RunMeta, RunStatus } from './types';

export type SortKey = 'name' | 'status' | 'startedAt' | 'points' | 'lastLoss' | 'minLoss';
/** 1 = ascending, -1 = descending. */
export type SortDirection = 1 | -1;
export type StatusFilter = 'all' | RunStatus;

export interface Sort {
  key: SortKey;
  direction: SortDirection;
}

/** The value a run is sorted by. `null` = no value: such runs always go last. */
function sortValue(run: RunMeta, key: SortKey): number | string | null {
  switch (key) {
    case 'startedAt': {
      // timestamp, not a formatted string ("4 Nov" < "10 Nov" fails as text)
      return Date.parse(run.startedAt);
    }
    case 'name': {
      return run.name.toLowerCase();
    }
    default: {
      const value = run[key];
      // NaN compares false with everything and would scramble the order: sort it with the missing values (last)
      return value === null || Number.isNaN(value) ? null : value;
    }
  }
}

/** Comparator for Array.sort. Missing values and NaN always go last, in both directions. */
export function compareRuns(a: RunMeta, b: RunMeta, sort: Sort): number {
  const valueA = sortValue(a, sort.key);
  const valueB = sortValue(b, sort.key);
  if (valueA === null && valueB === null) return 0;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  if (valueA === valueB) return 0;
  return (valueA < valueB ? -1 : 1) * sort.direction;
}

/** `query` must already be trimmed and lower-case. Matches name, id or a defect tag. */
export function matchesFilter(run: RunMeta, query: string, status: StatusFilter): boolean {
  if (status !== 'all' && run.status !== status) return false;
  if (!query) return true;
  return (
    run.name.toLowerCase().includes(query) ||
    run.id.includes(query) ||
    run.defects.some((defect) => defect.toLowerCase().includes(query))
  );
}
