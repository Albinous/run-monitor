export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * "Latest request wins". Each run() aborts the previous request AND tags its own with a sequence number,
 * so even a backend that ignores AbortSignal cannot deliver a stale response (run A arriving after run B).
 */
export function createLatest<T>() {
  let latestRequest = 0;
  let controller: AbortController | null = null;
  return {
    run(request: (signal: AbortSignal) => Promise<T>, onResult: (result: Result<T>) => void) {
      controller?.abort();
      const thisRequest = ++latestRequest;
      const ownController = new AbortController();
      controller = ownController;
      // deliver only if no newer request was started and this one wasn't cancelled
      const isCurrent = () => thisRequest === latestRequest && !ownController.signal.aborted;
      request(ownController.signal).then(
        (value) => {
          if (isCurrent()) onResult({ ok: true, value });
        },
        (error) => {
          if (isCurrent()) onResult({ ok: false, error });
        },
      );
    },
    cancel() {
      controller?.abort();
      latestRequest++;
    },
  };
}
