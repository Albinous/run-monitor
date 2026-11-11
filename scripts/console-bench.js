// Paste into the DevTools console on /?perf=1#/run/r08 (tab must be VISIBLE).
// Fires 12 wheel-zooms and 30 hovers, waits for two animation frames after each, prints wall-clock latency.
// Use it together with a Performance recording (CPU throttling 4x) — the recording is the source of truth.
(async () => {
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const el = document.querySelector('.canvas-wrap');
  const b = el.getBoundingClientRect();
  const run = async (n, fire) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const t0 = performance.now();
      fire(k);
      await raf2();
      out.push(performance.now() - t0);
    }
    return out.sort((x, y) => x - y);
  };
  const zoom = await run(12, (k) =>
    el.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: k < 6 ? -100 : 100,
        clientX: b.left + b.width * 0.47,
        clientY: b.top + 50,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const hover = await run(30, (k) =>
    el.dispatchEvent(
      new PointerEvent('pointermove', { clientX: b.left + 70 + k * 25, clientY: b.top + 60, bubbles: true }),
    ),
  );
  const s = (a) => `median ${a[a.length >> 1].toFixed(1)} ms, max ${a[a.length - 1].toFixed(1)} ms`;
  console.table({
    zoom: s(zoom),
    hover: s(hover),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 'n/a',
  });
})();
