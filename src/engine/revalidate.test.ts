// Revalidation suite — cross-checks engine outputs against independent
// hand calculations and enforces the warning-code catalog:
// 1. Every warning code emitted by any engine must exist in WARNING_CATALOG
//    at the emitted level, with a non-empty message.
// 2. Key results (shell/head thickness, MAWP, API 650 courses, flange
//    ratings, weights, hydrotest) are recomputed here from code formulae
//    and compared with engine outputs.

import { describe, expect, it } from 'vitest';
import { computeEquipment } from './compute';
import { computeVessel, shellRequiredThickness, shellMawp, headRequiredThickness } from './asme';
import { computeTank, API650_STRESSES, shellMinByDiameter } from './api650';
import { computeHX } from './tema';
import { computeFinFan } from './api661';
import { flangeRatingBar } from './flange';
import { allowableAt } from './materials';
import { ASTM_PLATE_THICKNESS_MM } from './plates';
import { checkWarningCodes, WARNING_CATALOG } from './warnings';
import type { Equipment, EquipmentCalc } from './types';
import { demoProject, newEquipment } from '../defaults';

/** Collect warnings from a computed result and validate against catalog. */
function expectCatalogClean(calc: EquipmentCalc, label: string) {
  const res = checkWarningCodes(calc.warnings);
  expect(res.problems, `${label}: ${res.problems.join('; ')}`).toEqual([]);
}

function baseVessel(over: Partial<Equipment> = {}): Equipment {
  const eq = newEquipment('vessel', 1);
  eq.sections = [{ ...eq.sections[0], dia: 1600, ttLength: 4000 }];
  eq.designPressure = 12;
  eq.designTemp = 150;
  eq.nozzles = [];
  return { ...eq, ...over };
}

describe('warning-code catalog conformance', () => {
  it('every catalog entry has a note and valid level', () => {
    for (const [code, spec] of Object.entries(WARNING_CATALOG)) {
      const list = Array.isArray(spec) ? spec : [spec];
      expect(code, `code ${code}`).toMatch(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/);
      for (const s of list) {
        expect(s.note.length, `${code} note`).toBeGreaterThan(5);
        expect(['info', 'warning', 'error']).toContain(s.level);
      }
    }
  });

  it('demo project emissions all match the catalog', () => {
    for (const e of demoProject()) {
      const calc = computeEquipment(e);
      expectCatalogClean(calc, e.tag);
    }
  });

  it('default equipment of every type matches the catalog', () => {
    for (const t of ['vessel', 'column', 'hx', 'finfan', 'tank'] as const) {
      const eq = newEquipment(t, 1);
      expectCatalogClean(computeEquipment(eq), t);
    }
  });

  it('stressed scenarios emit only cataloged codes', () => {
    // deliberately extreme inputs to force engine warning paths
    const scenarios: Equipment[] = [
      baseVessel({ designPressure: 400 }),                       // SH-02 / GE-01 likely
      baseVessel({ designTemp: 900 }),                            // MT-02 likely
      baseVessel({ materialKey: 'NOPE-123' }),                    // MT-01
      baseVessel({ rtCategory: 'none' }),
      (() => { const e = baseVessel(); e.sections[0].coneAngleDeg = 55; return e; })(), // CN-01/02
      (() => { const e = baseVessel({ designPressure: 25 }); e.nozzles = [{ id: 'nz1', tag: 'N1', service: 'process', dn: 300, schKey: '40', sectionId: e.sections[0].id, elevation: 2000, azimuth: 0, kind: 'process', flangeClass: 150, flangeMatKey: 'SA-105', padDia: 0, padThk: 0, projOutside: 200 }]; return e; })(), // FL-01/FL-02
      (() => { const e = newEquipment('hx', 2); e.hx!.tubeWall = 0.5; e.hx!.designPShell = 25; return e; })(),  // HX-02 likely
      (() => { const e = newEquipment('finfan', 3); e.finfan!.tubeWall = 0.5; return e; })(),                  // AF-01 likely
      (() => { const e = newEquipment('tank', 4); e.sections[0].dia = 70000; return e; })(),                   // T650-01
      (() => { const e = newEquipment('tank', 5); e.tank!.specificGravity = 1.4; return e; })(),
    ];
    for (const eq of scenarios) {
      expectCatalogClean(computeEquipment(eq), eq.tag);
    }
  });
});

describe('independent recalculation', () => {
  it('shell thickness and MAWP round-trip on a representative vessel', () => {
    const eq = baseVessel();
    const calc = computeVessel(eq);
    const sec = calc.sections[0];
    const S = allowableAt(eq.materialKey, eq.designTemp);
    const E = eq.rtCategory === 'full' ? 1 : eq.rtCategory === 'spot' ? 0.85 : 0.7;
    const R = eq.sections[0].dia / 2;
    const P = eq.designPressure / 10; // bar → MPa
    const { tHoop } = shellRequiredThickness(R, P, S, E);
    // required thickness + CA should not exceed chosen nominal
    expect(sec.tNominal).toBeGreaterThanOrEqual(Math.floor((tHoop + eq.corrosionAllowance) * 10) / 10 - 1e-9);
    // MAWP of the corroded wall must cover design pressure
    const m = shellMawp(sec.tCorroded, R, S, E);
    expect(m.hoop).toBeGreaterThanOrEqual(eq.designPressure - 0.05);
  });

  it('head required thickness matches UG-32 hand formula', () => {
    const D = 1600, P = 1.2, S = 138, E = 1;
    expect(headRequiredThickness('ellip2', D, P, S, E)).toBeCloseTo((P * D) / (2 * S * E - 0.2 * P), 3);
    expect(headRequiredThickness('hemi', D, P, S, E)).toBeCloseTo((P * (D / 2)) / (2 * S * E - 0.2 * P), 3);
  });

  it('API 650 course thickness matches the one-foot method', () => {
    const tank = newEquipment('tank', 1);
    tank.sections[0] = { ...tank.sections[0], dia: 12000, ttLength: 15000 };
    tank.tank!.maxDesignLiquidLevel = 14000;
    tank.tank!.specificGravity = 0.9;
    const calc = computeTank(tank);
    const st = API650_STRESSES[tank.materialKey] ?? API650_STRESSES.default;
    const Dm = 12, ca = tank.corrosionAllowance;
    const Hm = 14; // m design liquid height (maxDesignLiquidLevel = 14000 mm)
    const n = Math.ceil(14000 / 2000); // 7 courses of 2000 mm
    const courses = calc.tank!.shellCourses;
    expect(courses.length).toBe(n);
    courses.forEach((c, i) => {
      // index 0 = BOTTOM course: the design head is the liquid height above the
      // course's own bottom (Hm − i·courseH), and the one-foot point sits 0.3 m
      // above that bottom — not the course's top elevation.
      const headM = Hm - i * 2;
      expect(c.designHeadM, `course ${i} design head`).toBeCloseTo(headM, 6);
      const expected = Math.max(
        shellMinByDiameter(Dm),
        (4.9 * Dm * Math.max(0, headM - 0.3) * 0.9) / st.Sd + ca,
        (4.9 * Dm * Math.max(0, headM - 0.3) * 1.0) / st.St,
      );
      // tRequired is the code thickness; tNominal is the plate ordered — the
      // required value rounded UP to the ASTM A6/A20 rolled-plate series
      expect(c.tRequired ?? c.tNominal, `course ${i} required`).toBeCloseTo(expected, 4);
      expect(c.tNominal, `course ${i} plate`).toBeGreaterThanOrEqual(expected - 1e-9);
      expect(ASTM_PLATE_THICKNESS_MM, `course ${i} is a stock plate`).toContain(c.tNominal);
    });
    // design thickness must decrease going up — regression guard for the
    // inverted-head bug (previously the TOP course carried the full head)
    for (let i = 1; i < courses.length; i++) {
      expect(courses[i].tDesign, `course ${i} < course ${i - 1}`).toBeLessThan(courses[i - 1].tDesign);
    }
  });

  it('flange ratings follow the B16.5 group 1.1 table at ambient', () => {
    expect(flangeRatingBar('1.1', 150, 38)).toBeCloseTo(285 / 14.5038, 1);   // 285 psig
    expect(flangeRatingBar('1.1', 300, 38)).toBeCloseTo(740 / 14.5038, 1);   // 740 psig
    expect(flangeRatingBar('1.1', 600, 38)).toBeCloseTo(1480 / 14.5038, 1);  // 1480 psig
    // ratings must be monotonically non-increasing with temperature
    for (const cls of ['150', '300', '600'] as const) {
      let prev = Infinity;
      for (let tC = 38; tC <= 370; tC += 38) {
        const r = flangeRatingBar('1.1', +cls, tC);
        expect(r).toBeLessThanOrEqual(prev + 1e-9);
        prev = r;
      }
    }
  });

  it('all computed quantities are finite and weights positive for demo tags', () => {
    for (const e of demoProject()) {
      const c = computeEquipment(e);
      expect(c.weightDryKg, `${e.tag} dry weight`).toBeGreaterThan(0);
      expect(c.weightOperatingKg, `${e.tag} operating weight`).toBeGreaterThanOrEqual(c.weightDryKg);
      expect(Number.isFinite(c.hydroTestBar), `${e.tag} hydro`).toBe(true);
      expect(Number.isFinite(c.internalVolumeM3), `${e.tag} volume`).toBe(true);
      for (const s of c.sections) {
        expect(Number.isFinite(s.tNominal), `${e.tag} section t`).toBe(true);
        expect(s.tNominal).toBeGreaterThan(0);
        expect(s.utilization).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('hydrotest pressure is 1.3 × MAWP × S_test/S_design at minimum (UG-99)', () => {
    const eq = baseVessel();
    const calc = computeVessel(eq);
    // S ratio at test temp (ambient) is ≥ 1, so hydro ≥ 1.3 × MAWP
    expect(calc.hydroTestBar).toBeGreaterThanOrEqual(1.3 * calc.mawpBar - 0.05);
    // vertical vessel: bottom of shell adds the water static head, so ≥ top
    expect(calc.hydroTestBottomBar).toBeGreaterThanOrEqual(calc.hydroTestBar - 1e-9);
  });

  it('HX and fin-fan engines produce finite thermal results', () => {
    const hx = computeHX(newEquipment('hx', 1));
    expect(hx.hx!.tubeCountActual).toBeGreaterThan(0);
    expect(Number.isFinite(hx.hx!.providedArea)).toBe(true);
    expectCatalogClean(hx, 'hx-default');

    const ff = computeFinFan(newEquipment('finfan', 1));
    expect(ff.finfan!.tubeCountActual).toBeGreaterThan(0);
    expect(Number.isFinite(ff.finfan!.fanKW)).toBe(true);
    expectCatalogClean(ff, 'finfan-default');
  });
});
