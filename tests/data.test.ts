import { describe, expect, it } from 'vitest';
import { cleanRun } from '../src/core/clean';
import { RUN_SPECS } from '../src/data/generate';

describe('generated dataset contains every defect the task asks for', () => {
  const by = (id: string) => cleanRun(RUN_SPECS.find((s) => s.id === id)!.build());

  it('20 runs', () => expect(RUN_SPECS.length).toBe(20));
  it('NaN in loss', () => expect(by('r03').report.nonFinite.loss.nan).toBe(5));
  it('Infinity in loss', () => {
    expect(by('r04').report.nonFinite.loss.posInf).toBeGreaterThan(0);
    expect(by('r09').report.nonFinite.loss).toEqual({ nan: 1, posInf: 1, negInf: 1 });
  });
  it('duplicate steps', () => expect(by('r05').report.duplicatesDropped).toBe(1000));
  it('unsorted steps', () => expect(by('r06').report.wasUnsorted).toBe(true));
  it('gaps', () => expect(by('r07').report.gaps.length).toBe(2));
  it('one run with 1,000,000 points', () => expect(by('r08').n).toBe(1_000_000));
  it('empty run', () => expect(by('r10').n).toBe(0));
  it('generation is deterministic', () => {
    const a = RUN_SPECS[0].build(), b = RUN_SPECS[0].build();
    expect(Array.from(a.loss.slice(0, 100))).toEqual(Array.from(b.loss.slice(0, 100)));
  });
});
