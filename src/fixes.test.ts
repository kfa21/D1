import { describe, expect, it } from 'vitest';
import { WARNING_CATALOG } from './engine/warnings';
import { WARNING_FIX, fixFor, fieldId } from './fixes';

const TABS = ['general', 'sections', 'nozzles', 'internals', 'type'];

describe('warning → clickable fix registry', () => {
  it('covers every engine warning code with a concrete correction hint', () => {
    for (const code of Object.keys(WARNING_CATALOG)) {
      const fx = fixFor(code);
      expect(fx, `missing fix entry for ${code}`).toBeDefined();
      expect(fx!.suggest.trim().length, `thin suggestion for ${code}`).toBeGreaterThan(20);
      if (fx!.field) expect(TABS, `bad tab for ${code}`).toContain(fx!.tab);
      else expect(fx!.tab, `tab without a field for ${code}`).toBe('');
    }
  });

  it('has no registry entries for codes the engine cannot emit', () => {
    for (const code of Object.keys(WARNING_FIX)) {
      expect(WARNING_CATALOG[code], `orphan fix entry ${code}`).toBeDefined();
    }
  });

  it('omits the field exactly for codes with no single editable input', () => {
    // basis/advisory codes and engine exceptions: nothing to type into
    const NO_FIELD = [
      'AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-08',
      'AF-04', 'DBA-02', 'DBA-03', 'HX-04', 'HX-05', 'HX-09', 'HX-11',
      'NL-01', 'NL-03', 'RG-01', 'RG-02', 'RG-03', 'SYS',
      'T650-01', 'T650-02', 'T650-03', 'T650-05', 'T650-11', 'T650-14', 'T650-15',
      'T650-16', 'T650-17',
    ].sort();
    const actual = Object.entries(WARNING_FIX)
      .filter(([, fx]) => !fx.field)
      .map(([c]) => c)
      .sort();
    expect(actual).toEqual(NO_FIELD);
  });

  it('field ids follow the row conventions the Register renders', () => {
    for (const [code, fx] of Object.entries(WARNING_FIX)) {
      if (fx.field.startsWith('sec')) {
        expect(fx.field, code).toMatch(/^sec\d+-(dia|ttLength|headTop|shellThk|coneAngleDeg|coneThk)$/);
      }
      if (fx.field.startsWith('nz')) {
        expect(fx.field, code).toMatch(/^nz\d+-(dn|attach|style|neckThk|flangeClass|padDia|elevation)$/);
      }
      if (fx.field.startsWith('shellFlow-')) {
        expect(fx.field, code).toMatch(/^shellFlow-[A-Za-z]+$/);
      }
    }
    expect(fieldId('eq1', 'designPressure')).toBe('f-eq1-designPressure');
  });
});
