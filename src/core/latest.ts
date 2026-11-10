export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * "Latest request wins". Each run() aborts the previous request AND tags its own with a sequence number,
 * so even a backend that ignores AbortSignal cannot deliver a stale response (run A arriving after run B).
 */
export function createLatest<T>() {
  let seq = 0;
  let ctrl: AbortController | null = null;
  return {
    run(fn: (signal: AbortSignal) => Promise<T>, onResult: (r: Result<T>) => void) {
      ctrl?.abort();
      const my = ++seq;
      const c = new AbortController();
      ctrl = c;
      fn(c.signal).then(
        (value) => { if (my === seq && !c.signal.aborted) onResult({ ok: true, value }); },
        (error) => { if (my === seq && !c.signal.aborted) onResult({ ok: false, error }); },
      );
    },
    cancel() {
      ctrl?.abort();
      seq++;
    },
  };
}
