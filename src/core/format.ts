/**
 * All formatting takes an explicit locale / time zone. Data never round-trips through a formatted string:
 * parsing "1,234" is ambiguous between en-US (1234) and de-DE (1.234), so we simply never parse display strings.
 */

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    nfCache.set(key, f);
  }
  return f;
}

export function formatSpecial(v: number): string | null {
  if (v !== v) return 'NaN';
  if (v === Infinity) return '+∞';
  if (v === -Infinity) return '−∞';
  return null;
}

const useSci = (v: number) => v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e7);

/** Tick label. `step` is the tick spacing (null for log ticks); decimals are derived from it so labels are distinct and exact. */
export function formatTick(v: number, step: number | null, locale: string): string {
  const sp = formatSpecial(v);
  if (sp) return sp;
  if (v === 0) return '0';
  if (useSci(v)) {
    const ev = Math.floor(Math.log10(Math.abs(v)));
    const es = step ? Math.floor(Math.log10(step) + 1e-9) : ev - 2;
    const fd = Math.max(0, Math.min(10, ev - es));
    return nf(locale, { notation: 'scientific', maximumFractionDigits: fd }).format(v);
  }
  if (step === null) return nf(locale, { maximumSignificantDigits: 3 }).format(v);
  const d = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  return nf(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

/** A data value for tooltips/cards: 6 significant digits, explicit NaN/∞. */
export function formatValue(v: number | null | undefined, locale: string): string {
  if (v === null || v === undefined) return '—';
  const sp = formatSpecial(v);
  if (sp) return sp;
  if (useSci(v)) return nf(locale, { notation: 'scientific', maximumSignificantDigits: 4 }).format(v);
  return nf(locale, { maximumSignificantDigits: 6 }).format(v);
}

export function formatStep(v: number | null | undefined, locale: string): string {
  if (v === null || v === undefined) return '—';
  return nf(locale, { maximumFractionDigits: 0 }).format(v);
}

/** Always shows the zone name, so "08:00" is never ambiguous between UTC and local. */
export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'invalid date';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(d);
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
