import { useCallback, useEffect, useRef, useState } from 'react';
import { type CleanSeries, cleanRun } from '../core/clean';
import { createLatest } from '../core/latest';
import type { RunMeta } from '../core/types';
import { getRun, isAbort } from '../data/api';

export interface ReadyState {
  kind: 'ready';
  id: string;
  meta: RunMeta;
  series: CleanSeries;
  fetchedAt: number;
  /** Set when a background refresh failed: data on screen is from fetchedAt, not "now". */
  lastError: { at: number; message: string } | null;
}

export type RunState = { kind: 'loading'; id: string } | { kind: 'error'; id: string; message: string } | ReadyState;

/** Running runs are refreshed this often. */
export const POLL_MS = 3000;

type RunResponse = Awaited<ReturnType<typeof getRun>>;

const errorMessage = (error: unknown) => String((error as Error)?.message ?? error);

export function useRunData(id: string) {
  const [state, setState] = useState<RunState>({ kind: 'loading', id });
  const loader = useRef(createLatest<RunResponse>()).current;

  const load = useCallback(
    (isPoll: boolean) => {
      loader.run(
        (signal) => getRun(id, signal),
        (result) => {
          if (result.ok) {
            const cleanStart = performance.now();
            const series = cleanRun(result.value.data);
            performance.measure?.(`clean:${id}`, { start: cleanStart, end: performance.now() });
            // a response for a different run can never land here: createLatest drops it, and we tag by id
            setState({
              kind: 'ready',
              id,
              meta: result.value.meta,
              series,
              fetchedAt: result.value.fetchedAt,
              lastError: null,
            });
            return;
          }
          if (isAbort(result.error)) return; // we cancelled it ourselves
          const message = errorMessage(result.error);
          setState((previous) =>
            isPoll && previous.kind === 'ready' && previous.id === id
              ? { ...previous, lastError: { at: Date.now(), message } } // keep the data, but flag it as stale
              : { kind: 'error', id, message },
          );
        },
      );
    },
    [id, loader],
  );

  // load when the run id changes; cancel the request when leaving the run
  useEffect(() => {
    setState({ kind: 'loading', id });
    load(false);
    return () => loader.cancel();
  }, [id, load, loader]);

  // poll only while the run is running
  const isRunning = state.kind === 'ready' && state.meta.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [isRunning, load]);

  const retry = useCallback(() => {
    setState({ kind: 'loading', id });
    load(false);
  }, [id, load]);

  // Between an id change and the effect above, `state` still holds the previous run. Never render it under the new id.
  const visible: RunState = state.id === id ? state : { kind: 'loading', id };
  return { state: visible, retry };
}
