import { useEffect, useState } from 'react';
import type { Palette } from '../core/draw';
import { METRICS, type Metric } from '../core/types';

/** CSS variable with the line colour of each metric (defined in styles.css for light and dark theme). */
const LINE_COLOR_VARIABLE: Record<Metric, string> = { loss: '--c-loss', lr: '--c-lr', grad_norm: '--c-grad' };

function readPalettes(): Record<Metric, Palette> {
  const styles = getComputedStyle(document.documentElement);
  const cssVariable = (name: string) => styles.getPropertyValue(name).trim();
  const shared = {
    bg: cssVariable('--surface'),
    grid: cssVariable('--grid'),
    axis: cssVariable('--axis'),
    text: cssVariable('--muted'),
    smooth: cssVariable('--c-smooth'),
    nan: cssVariable('--c-nan'),
    inf: cssVariable('--c-nan'),
  };
  const entries = METRICS.map((metric) => [metric, { ...shared, line: cssVariable(LINE_COLOR_VARIABLE[metric]) }]);
  return Object.fromEntries(entries) as Record<Metric, Palette>;
}

/**
 * Canvas can't use CSS variables directly, so the colours are read from CSS once
 * and read again when the system switches between light and dark theme.
 */
export function usePalettes(): Record<Metric, Palette> {
  const [palettes, setPalettes] = useState(readPalettes);
  useEffect(() => {
    const darkTheme = matchMedia('(prefers-color-scheme: dark)');
    const onThemeChange = () => setPalettes(readPalettes());
    darkTheme.addEventListener('change', onThemeChange);
    return () => darkTheme.removeEventListener('change', onThemeChange);
  }, []);
  return palettes;
}

/** Current time that updates every `intervalMs`, for texts like "5s ago". */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
