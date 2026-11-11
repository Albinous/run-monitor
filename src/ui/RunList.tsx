import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatStep, formatValue } from '../core/format';
import { createLatest } from '../core/latest';
import {
  compareRuns,
  matchesFilter,
  type Sort,
  type SortDirection,
  type SortKey,
  type StatusFilter,
} from '../core/sortRuns';
import type { RunMeta } from '../core/types';
import { isAbort, listRuns } from '../data/api';
import { LOCALE, TIME_ZONE } from './env';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; runs: RunMeta[]; fetchedAt: number };

/** Filter and sort live outside the component, so they survive opening a run and coming back. */
const remembered = { query: '', status: 'all' as StatusFilter, sort: { key: 'startedAt', direction: -1 } as Sort };

const errorMessage = (error: unknown) => String((error as Error)?.message ?? error);

export function RunList() {
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [query, setQuery] = useState(remembered.query);
  const [status, setStatus] = useState<StatusFilter>(remembered.status);
  const [sort, setSort] = useState<Sort>(remembered.sort);
  const [loader] = useState(() => createLatest<Awaited<ReturnType<typeof listRuns>>>());

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    loader.run(listRuns, (result) => {
      if (result.ok) setState({ kind: 'ready', runs: result.value.runs, fetchedAt: result.value.fetchedAt });
      else if (!isAbort(result.error)) setState({ kind: 'error', message: errorMessage(result.error) });
    });
  }, [loader]);

  // load once when the list opens (load and loader never change); cancel the request when leaving it
  useEffect(() => {
    load();
    return () => loader.cancel();
  }, [load, loader]);

  useEffect(() => {
    Object.assign(remembered, { query, status, sort });
  }, [query, status, sort]);

  const visibleRuns = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const normalizedQuery = query.trim().toLowerCase();
    return state.runs
      .filter((run) => matchesFilter(run, normalizedQuery, status))
      .toSorted((a, b) => compareRuns(a, b, sort));
  }, [state, query, status, sort]);

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
  };

  /** Column header with a sort button. Clicking the active column flips the direction. */
  const sortableHeader = (key: SortKey, label: string, className = '') => {
    const isActive = sort.key === key;
    const ariaSort = isActive ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none';
    const arrow = isActive ? (sort.direction === 1 ? '▲' : '▼') : '↕';
    const onClick = () => setSort({ key, direction: isActive ? (-sort.direction as SortDirection) : 1 });
    return (
      <th className={className} aria-sort={ariaSort} scope="col">
        <button className="th-btn" onClick={onClick}>
          {label} <span aria-hidden="true">{arrow}</span>
        </button>
      </th>
    );
  };

  return (
    <section className="page">
      <h1>Training runs</h1>
      <div className="filters" role="search">
        <label>
          <span>Filter</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name, id or defect (nan, gaps…)"
          />
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="finished">Finished</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <button onClick={load}>Refresh</button>
      </div>

      {state.kind === 'loading' && (
        <div className="state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading runs…
        </div>
      )}

      {state.kind === 'error' && (
        <div className="state error" role="alert">
          Could not load runs: {state.message} <button onClick={load}>Retry</button>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <p className="muted small" aria-live="polite">
            {visibleRuns.length} of {state.runs.length} runs · list fetched{' '}
            {formatDateTime(new Date(state.fetchedAt).toISOString(), LOCALE, TIME_ZONE)} (values for running runs may be
            newer on the run page)
          </p>

          {visibleRuns.length === 0 ? (
            <div className="state">
              No runs match these filters. <button onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="runs">
                <thead>
                  <tr>
                    {sortableHeader('name', 'Run')}
                    {sortableHeader('status', 'Status')}
                    {sortableHeader('startedAt', 'Started', 'hide-sm')}
                    {sortableHeader('points', 'Points', 'num hide-sm')}
                    {sortableHeader('lastLoss', 'Last loss', 'num')}
                    {sortableHeader('minLoss', 'Min loss', 'num hide-sm')}
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RunRow({ run }: { run: RunMeta }) {
  return (
    <tr>
      <td>
        <a href={`#/run/${run.id}`}>{run.name}</a>
        <div className="tags">
          {run.defects.map((defect) => (
            <span key={defect} className="tag">
              {defect}
            </span>
          ))}
        </div>
      </td>
      <td>
        <span className={`badge ${run.status}`}>{run.status}</span>
      </td>
      <td className="hide-sm">{formatDateTime(run.startedAt, LOCALE, TIME_ZONE)}</td>
      <td className="num hide-sm">{formatStep(run.points, LOCALE)}</td>
      <td className="num">{formatValue(run.lastLoss, LOCALE)}</td>
      <td className="num hide-sm">{formatValue(run.minLoss, LOCALE)}</td>
    </tr>
  );
}
