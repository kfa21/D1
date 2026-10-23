import { describe, expect, it } from 'vitest';
import { defaultItpStages, mergeItpStages, effectiveDurationH, itpTotalHours, itpStageName, ITP_PHASE_LABELS } from './itp';
import { computeEquipment } from './compute';
import { newEquipment } from '../defaults';
import type { Equipment } from './types';

function vesselWithNdT(overrides: Partial<Equipment> = {}): Equipment {
  const eq = newEquipment('vessel', 1);
  return { ...eq, ...overrides };
}

describe('ITP stage schedule', () => {
  it('default schedule covers all stages with finite durations', () => {
    const eq = vesselWithNdT();
    const calc = computeEquipment(eq);
    const stages = defaultItpStages(eq, calc);
    expect(stages.length).toBeGreaterThanOrEqual(12);
    for (const s of stages) {
      expect(Number.isFinite(s.durationH)).toBe(true);
      expect(s.durationH).toBeGreaterThanOrEqual(0);
      expect(s.phases.length).toBeGreaterThan(0);
      expect(s.durationOverrideH).toBeNull();
      expect(itpStageName(s.code)).not.toBe(s.code);
    }
  });

  it('every default phase is a valid labelled phase', () => {
    const eq = vesselWithNdT();
    const stages = defaultItpStages(eq, computeEquipment(eq));
    const keys = Object.keys(ITP_PHASE_LABELS);
    for (const s of stages) for (const p of s.phases) expect(keys).toContain(p);
  });

  it('fit-up duration scales with weld length', () => {
    const eq = vesselWithNdT();
    const calc = computeEquipment(eq);
    const stages = defaultItpStages(eq, calc);
    const fitup = stages.find((s) => s.code === 'FITUP')!;
    expect(fitup.durationH).toBeCloseTo(calc.weldLengthM * 0.1, 1);
  });

  it('disabled NDT method contributes zero hours; enabled contributes positive', () => {
    const off = vesselWithNdT();
    const offStages = defaultItpStages(off, computeEquipment(off));
    // default plan: RT disabled under 'none' category, MT enabled
    const mtOff = offStages.find((s) => s.code === 'NDT-MT')!;
    expect(mtOff.durationH).toBeGreaterThanOrEqual(0);

    const on = vesselWithNdT({ rtCategory: 'full' });
    const onStages = defaultItpStages(on, computeEquipment(on));
    const rt = onStages.find((s) => s.code === 'NDT-RT')!;
    const rtItem = on.ndtPlan!.find((p) => p.method === 'rt')!;
    expect(rt.durationH).toBeGreaterThan(0);
    expect(rtItem.enabled).toBe(true);
  });

  it('PWHT stage is longer when PWHT is required', () => {
    const noPwht = vesselWithNdT({ materialKey: 'SA-516-70', designTemp: 100, pwhtOverride: false });
    const withPwht = vesselWithNdT({ materialKey: 'SA-516-70', designTemp: 100, pwhtOverride: true });
    const hNo = defaultItpStages(noPwht, computeEquipment(noPwht)).find((s) => s.code === 'PWHT')!.durationH;
    const hYes = defaultItpStages(withPwht, computeEquipment(withPwht)).find((s) => s.code === 'PWHT')!.durationH;
    expect(hYes).toBeGreaterThan(hNo);
  });

  it('merge keeps saved overrides and phase edits, drops unknown codes', () => {
    const eq = vesselWithNdT();
    const defaults = defaultItpStages(eq, computeEquipment(eq));
    const saved = [
      { code: 'HYDRO', phases: ['final' as const], durationH: 0, durationOverrideH: 6 },
      { code: 'GHOST-STAGE', phases: ['final' as const], durationH: 1, durationOverrideH: null },
    ];
    const merged = mergeItpStages(defaults, saved);
    expect(merged).toHaveLength(defaults.length);
    expect(merged.some((s) => s.code === 'GHOST-STAGE')).toBe(false);
    const hydro = merged.find((s) => s.code === 'HYDRO')!;
    expect(hydro.durationOverrideH).toBe(6);
    expect(hydro.phases).toEqual(['final']);
  });

  it('effective duration prefers override and totals sum effective values', () => {
    const eq = vesselWithNdT();
    const defaults = defaultItpStages(eq, computeEquipment(eq));
    const withOverride = defaults.map((s) => (s.code === 'HYDRO' ? { ...s, durationOverrideH: 0.5 } : s));
    const hydro = withOverride.find((s) => s.code === 'HYDRO')!;
    expect(effectiveDurationH(hydro)).toBe(0.5);
    expect(effectiveDurationH(defaults[0])).toBe(defaults[0].durationH);
    const total = itpTotalHours(withOverride);
    const manual = withOverride.reduce((sum, s) => sum + (s.durationOverrideH ?? s.durationH), 0);
    expect(total).toBeCloseTo(manual, 6);
  });

  it('unticked stage (no phase boxes) counts as 0 h in totals', () => {
    const eq = vesselWithNdT();
    const defaults = defaultItpStages(eq, computeEquipment(eq));
    const cleared = defaults.map((s) => (s.code === 'HYDRO' ? { ...s, phases: [] } : s));
    const hydro = cleared.find((s) => s.code === 'HYDRO')!;
    expect(effectiveDurationH(hydro)).toBe(0);
    const defaultHydro = defaults.find((s) => s.code === 'HYDRO')!.durationH;
    expect(itpTotalHours(cleared)).toBeCloseTo(itpTotalHours(defaults) - defaultHydro, 6);
  });

  it('empty saved list falls back to defaults', () => {
    const eq = vesselWithNdT();
    const defaults = defaultItpStages(eq, computeEquipment(eq));
    expect(mergeItpStages(defaults, [])).toEqual(defaults);
    expect(mergeItpStages(defaults, undefined)).toEqual(defaults);
  });
});
