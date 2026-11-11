const q = new URLSearchParams(location.search);
/** ?render=naive draws every raw point (baseline used for the before/after perf comparison). */
export const RENDER_MODE: 'm4' | 'naive' = q.get('render') === 'naive' ? 'naive' : 'm4';
/** ?perf=1 shows timing HUD. */
export const PERF_HUD = q.has('perf');
/** ?locale=de-DE / ?tz=Asia/Tokyo override, to check locale & time-zone handling by hand. */
export const LOCALE = q.get('locale') || navigator.language || 'en-US';
export const TIME_ZONE = q.get('tz') || undefined;
