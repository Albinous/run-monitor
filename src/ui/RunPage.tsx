import { useEffect } from 'react';
import { RUN_IDS } from '../data/api';
import { RunBody } from './RunBody';
import { useRunData } from './useRunData';

/** Keys that switch runs quickly — the fastest way to provoke a request race. */
const PREVIOUS_RUN_KEY = '[';
const NEXT_RUN_KEY = ']';

const isTyping = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('input, select, textarea');

/** Run page: navigation between runs plus loading / error / ready states. The content itself is in RunBody. */
export function RunPage({ id }: { id: string }) {
  const { state, retry } = useRunData(id);
  const position = RUN_IDS.indexOf(id);

  const goToRun = (offset: number) => {
    // wraps around: "next" after the last run is the first one
    const nextId = RUN_IDS[(position + offset + RUN_IDS.length) % RUN_IDS.length];
    location.hash = `#/run/${nextId}`;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === PREVIOUS_RUN_KEY) goToRun(-1);
      if (event.key === NEXT_RUN_KEY) goToRun(1);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  });

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Run navigation">
        <a href="#/">← All runs</a>
        <span className="spacer" />
        <button onClick={() => goToRun(-1)} aria-label="Previous run">
          ‹ Prev
        </button>
        <span className="muted small">
          {position >= 0 ? `${position + 1} / ${RUN_IDS.length}` : ''} · keys {PREVIOUS_RUN_KEY} {NEXT_RUN_KEY}
        </span>
        <button onClick={() => goToRun(1)} aria-label="Next run">
          Next ›
        </button>
      </nav>

      {state.kind === 'loading' && (
        <div className="state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading run <code>{id}</code>…
          <div className="skeleton" aria-hidden="true" />
        </div>
      )}

      {state.kind === 'error' && (
        <div className="state error" role="alert">
          <h1>Run {id}</h1>
          <p>
            Could not load this run: <strong>{state.message}</strong>
          </p>
          <p className="small">Nothing is drawn rather than an empty or stale chart.</p>
          <button onClick={retry}>Retry</button>
        </div>
      )}

      {/* key = run id: a new run gets fresh zoom, cursor and smoothing */}
      {state.kind === 'ready' && <RunBody key={state.id} state={state} />}
    </section>
  );
}
