/**
 * All formatting takes an explicit locale / time zone. Data never round-trips through a formatted string:
 * parsing "1,234" is ambiguous between en-US (1234) and de-DE (1.234), so we simply never parse display strings.
 */

// Creating Intl.NumberFormat is slow, so formatters are cached by locale + options
const formatterCache = new Map<string, Intl.NumberFormat>();
function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatSpecial(value: number): string | null {
  if (value !== value) return 'NaN';
  if (value === Infinity) return '+∞';
  if (value === -Infinity) return '−∞';
  return null;
}

const needsScientific = (value: number) => value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e7);

/** Tick label. `step` is the tick spacing (null for log ticks); decimals are derived from it so labels are distinct and exact. */
export function formatTick(value: number, step: number | null, locale: string): string {
  const special = formatSpecial(value);
  if (special) return special;
  if (value === 0) return '0';
  if (needsScientific(value)) {
    // e.g. value 1.5e-4 with step 5e-5: exponents -4 and -5 -> 1 digit after the point -> "1.5E-4"
    const valueExponent = Math.floor(Math.log10(Math.abs(value)));
    const stepExponent = step ? Math.floor(Math.log10(step) + 1e-9) : valueExponent - 2;
    const fractionDigits = Math.max(0, Math.min(10, valueExponent - stepExponent));
    return numberFormatter(locale, { notation: 'scientific', maximumFractionDigits: fractionDigits }).format(value);
  }
  if (step === null) return numberFormatter(locale, { maximumSignificantDigits: 3 }).format(value);
  // step 0.05 -> 2 decimals, step 5 -> 0 decimals
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  return numberFormatter(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** A data value for tooltips/cards: 6 significant digits, explicit NaN/∞. */
export function formatValue(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  const special = formatSpecial(value);
  if (special) return special;
  if (needsScientific(value)) return numberFormatter(locale, { notation: 'scientific', maximumSignificantDigits: 4 }).format(value);
  return numberFormatter(locale, { maximumSignificantDigits: 6 }).format(value);
}

export function formatStep(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  return numberFormatter(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Always shows the zone name, so "08:00" is never ambiguous between UTC and local. */
export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'invalid date';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(date);
}

export function formatAgo(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
