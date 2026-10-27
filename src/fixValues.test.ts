// Golden tests for the "correct value beside the field" suggestions: each case
// forces the warning to fire, then asserts the suggested number matches the
// live calculation (not a hard-coded guess).

import { describe, expect, it } from 'vitest';
import { suggestedValue } from './fixValues';
import { computeEquipment } from './engine/compute';
import { demoProject, newEquipment } from './defaults';

const vessel = () => demoProject().find((e) => e.tag === 'V-101')!;

describe('suggestedValue — correct values beside erroring fields', () => {
  it('returns undefined for codes with no single computable value', () => {
    expect(suggestedValue('GE-01', vessel(), computeEquipment(vessel()))).toBeUndefined();
    expect(suggestedValue('NO-SUCH-CODE', vessel(), computeEquipment(vessel()))).toBeUndefined();
  });

  it('SH-01 suggests the min nominal thickness incl. CA from the live calc', () => {
    const v = vessel();
    v.sections[0] = { ...v.sections[0], shellThk: 1 }; // force the shortfall
    const calc = computeEquipment(v);
    expect(calc.warnings.some((w) => w.code === 'SH-01')).toBe(true);
    const s = calc.sections[0];
    const sug = suggestedValue('SH-01', v, calc)!;
    const minNominal = Math.ceil(s.tMinNominal * 2) / 2; // rounded up to 0.5 mm
    expect(sug.value).toBe(`≥ ${minNominal} mm`);
    expect(sug.basis).toContain(`t req ${s.tReq.toFixed(2)}`);
    expect(minNominal).toBeGreaterThan(s.tMinNominal - 0.5);
  });

  it('MW-01 suggests the current MAWP as the pressure ceiling', () => {
    const v = vessel();
    v.designPressure = 500; // far above what a thin fixed shell can hold
    v.sections[0] = { ...v.sections[0], shellThk: 10 };
    const calc = computeEquipment(v);
    expect(calc.warnings.some((w) => w.code === 'MW-01')).toBe(true);
    const sug = suggestedValue('MW-01', v, calc)!;
    expect(sug.value).toBe(`≤ ${calc.mawpBar.toFixed(2)} bar g`);
    expect(calc.mawpBar).toBeLessThan(500);
  });

  it('FL-01 steps the flange class up to the smallest that rates the pressure', () => {
    const v = vessel();
    v.designPressure = 40; // Class 150 cannot rate this at design temperature
    v.nozzles[0] = { ...v.nozzles[0], flangeClass: 150 };
    const calc = computeEquipment(v);
    expect(calc.warnings.some((w) => w.code === 'FL-01')).toBe(true);
    const sug = suggestedValue('FL-01', v, calc)!;
    expect(sug.value).toMatch(/^Class (300|600|900|1500|2500)$/);
    expect(sug.value).not.toBe('Class 150');
    expect(sug.basis).toContain('B16.5');
  });

  it('T650-07 suggests the T-T shell height as the liquid-level ceiling', () => {
    const tk = newEquipment('tank', 31);
    tk.sections[0] = { ...tk.sections[0], dia: 12000, ttLength: 14000 };
    tk.tank!.maxDesignLiquidLevel = 16000;
    const calc = computeEquipment(tk);
    expect(calc.warnings.some((w) => w.code === 'T650-07')).toBe(true);
    const sug = suggestedValue('T650-07', tk, calc)!;
    expect(sug.value).toContain('14000');
  });

  it('T650-10 suggests the auto-sized bottom thickness (6 mm + CA)', () => {
    const tk = newEquipment('tank', 32);
    tk.sections[0] = { ...tk.sections[0], dia: 12000, ttLength: 14000 };
    tk.tank!.annularBottom = false;
    tk.corrosionAllowance = 3;
    tk.tank!.bottomThk = 0; // auto → 9 mm, entered 6 mm → warning
    const calc = computeEquipment(tk);
    expect(calc.warnings.some((w) => w.code === 'T650-10')).toBe(true);
    const sug = suggestedValue('T650-10', tk, calc)!;
    expect(sug.value).toBe(`≥ ${calc.tank!.bottomThk} mm`);
    expect(sug.value).toContain('9');
  });

  it('AF-05 suggests the auto fan diameter for 40% coverage', () => {
    const ff = demoProject().find((e) => e.equipType === 'finfan')!;
    ff.finfan!.fanDiaMm = 500; // force the coverage warning
    const calc = computeEquipment(ff);
    expect(calc.warnings.some((w) => w.code === 'AF-05')).toBe(true);
    const f = calc.finfan!;
    const auto = Math.sqrt((0.4 * f.faceAreaM2 * 4) / Math.PI) * 1000;
    const sug = suggestedValue('AF-05', ff, calc)!;
    expect(sug.value).toContain(auto.toFixed(0));
    expect(sug.value).toContain('0 = auto');
  });

  it('covers a broad set of field-targeted codes without throwing', () => {
    // every registry code that has a field must either produce a value or be
    // explicitly uncomputable — nothing may throw
    const v = vessel();
    const calc = computeEquipment(v);
    for (const code of ['SH-02', 'HD-01', 'CN-02', 'EX-01', 'MT-01', 'NZ-01', 'NZ-03', 'T650-12', 'HX-02', 'HX-17']) {
      const sug = suggestedValue(code, v, calc);
      if (code === 'HD-01' || code === 'EX-01') {
        expect(sug, `${code} expected on the demo vessel`).toBeDefined();
      }
      if (sug) {
        expect(sug.value.length, code).toBeGreaterThan(0);
        expect(sug.basis.length, code).toBeGreaterThan(0);
      }
    }
  });
});
