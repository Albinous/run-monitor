const q = new URLSearchParams(location.search);
/** ?render=naive draws every raw point (baseline used for the before/after perf comparison). */
export const RENDER_MODE: 'm4' | 'naive' = q.get('render') === 'naive' ? 'naive' : 'm4';
/** ?perf=1 shows timing HUD. */
export const PERF_HUD = q.has('perf');
/**
 * The UI text is English, so dates and numbers default to English too (not the browser language:
 * a Russian browser would otherwise mix "Nov" labels with "нояб." dates).
 * ?locale=de-DE / ?tz=Asia/Tokyo override, to check locale & time-zone handling by hand.
 */
const DEFAULT_LOCALE = 'en-US';
export const LOCALE = q.get('locale') || DEFAULT_LOCALE;
export const TIME_ZONE = q.get('tz') || undefined;
