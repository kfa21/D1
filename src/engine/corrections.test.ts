// Golden-value regression tests for the P0/P1 correction batch.
// Each case pins a corrected formula to a hand/chart-calculated value so a future
// refactor cannot silently reintroduce the previous wrong numbers:
//  - LMTD F: garbled Bowman expression (always collapsed to 0.75/0.6 fallbacks)
//  - tubesheets: bar→psi converter fed MPa (10× understress → ~3× overthick)
//  - HX heads: plate thickness taken from the head DEPTH
//  - HX shell: UG-27 thickness multiplied by 10 instead of divided
//  - UG-28 A: discontinuous 1.5/(Do/t) branch above Do/t = 120
//  - UG-37 A2: missing −F·t_r deduction; UG-45 without −12.5 % mill tolerance
//  - API 650 wind girder: Pa compared to MPa; πD² instead of πR²
//  - anchor bolts: dimensionally wrong required-area formulas (both engines)
//  - B16.5 stud counts below NPS 6

import { describe, expect, it } from 'vitest';
import {
  lmtdCorrected,
  fixedTubeSheetThickness,
  removableTubeSheetThickness,
} from './tema';
import { externalPressureCheck } from './asme';
import { studCount } from './pipes';
import { computeTank } from './api650';
import { computeEquipment } from './compute';
import { demoProject } from '../defaults';
import { checkWarningCodes } from './warnings';

describe('LMTD correction factor F — Bowman 1-2 (corrected)', () => {
  it('R=2, P=0.3 → F ≈ 0.883 (Bowman chart ≈ 0.88)', () => {
    // hot 150→78, cold 30→66
    const { F } = lmtdCorrected(150, 78, 30, 66, 2);
    expect(F).toBeCloseTo(0.883, 2);
  });

  it('R=1, P=0.5 → F ≈ 0.80 via the L’Hôpital limit (Bowman chart ≈ 0.80)', () => {
    // hot 100→60, cold 20→60
    const { F } = lmtdCorrected(100, 60, 20, 60, 2);
    expect(F).toBeCloseTo(0.802, 2);
  });

  it('R→1 branch is continuous across R = 1', () => {
    const at = lmtdCorrected(100, 60, 20, 60, 2).F; // R = 1 exactly
    const above = lmtdCorrected(100, 60, 20, 59.999, 2).F; // R slightly < 1
    const below = lmtdCorrected(100, 60.004, 20, 60, 2).F; // R slightly > 1
    expect(Math.abs(above - at)).toBeLessThan(0.005);
    expect(Math.abs(below - at)).toBeLessThan(0.005);
  });

  it('F → 1 as P → 0, and F decreases monotonically with P at fixed R', () => {
    expect(lmtdCorrected(100, 98, 0, 1, 2).F).toBeGreaterThan(0.99); // P = 0.01, R = 2
    const f1 = lmtdCorrected(100, 80, 0, 10, 2).F; // P = 0.1
    const f2 = lmtdCorrected(100, 80, 0, 20, 2).F; // P = 0.2
    const f3 = lmtdCorrected(100, 80, 0, 30, 2).F; // P = 0.3
    expect(f1).toBeGreaterThan(f2);
    expect(f2).toBeGreaterThan(f3);
  });

  it('reports a temperature cross as F = 0 instead of a fallback factor', () => {
    expect(lmtdCorrected(100, 60, 30, 100, 2).F).toBe(0); // P = 1
    expect(lmtdCorrected(100, 20, 30, 80, 2).F).toBe(0); // R·P = 1.14 > 1
  });

  it('R=4, P=0.21 lands in the low-F region (≈ 0.715 → HX-03 territory)', () => {
    // hot 100→16, cold 0→21
    const { F } = lmtdCorrected(100, 16, 0, 21, 2);
    expect(F).toBeCloseTo(0.715, 2);
    expect(F).toBeLessThan(0.75);
  });
});

describe('TEMA tubesheet thickness — MPa→psi conversion (corrected)', () => {
  it('RCB-7.131 fixed tubesheet: G=1000, b=16, P=16 bar, S=138 MPa → ≈ 7.3 mm', () => {
    // hand calc: G=39.37 in, G1=38.74 in, P=232.06 psi, S=20,015 psi
    // t = √(1×232.06×39.37² / (16×20015×38.74)) + 0.118 in = 0.288 in = 7.32 mm
    const t = fixedTubeSheetThickness(1000, 16, 16, 138, 1.0, 3);
    expect(t).toBeCloseTo(7.32, 1);
    // the old bar→psi-on-MPa bug produced ≈ 16.7 mm here
    expect(t).toBeLessThan(10);
  });

  it('RCB-7.132 removable tubesheet: G=1000, P=16 bar, S=138 MPa (capped) → ≈ 42.8 mm', () => {
    // S = min(20,015 psi, 12,900 psi cap) = 12,900 psi
    // t = 0.319 × 39.37 × √(232.06/12900) = 1.685 in = 42.8 mm
    const t = removableTubeSheetThickness(1000, 16, 138);
    expect(t).toBeCloseTo(42.8, 0);
  });
});

describe('ASME UG-28 geometric chart factor A (corrected)', () => {
  it('is monotone and continuous across the old Do/t = 120 breakpoint', () => {
    const lo = externalPressureCheck(200, 2, 1000, 20, 'CS'); // Do/t = 100
    const mid = externalPressureCheck(240, 2, 1000, 20, 'CS'); // Do/t = 120
    const hi = externalPressureCheck(242, 2, 1000, 20, 'CS'); // Do/t = 121
    expect(lo.A).toBeGreaterThan(mid.A);
    expect(mid.A).toBeGreaterThan(hi.A); // old code jumped ~15× UP here
    expect(mid.A / hi.A).toBeLessThan(1.05); // continuous at the breakpoint
  });

  it('A at Do/t = 100 matches 1.1/(Do/t)^1.5', () => {
    const lo = externalPressureCheck(200, 2, 1000, 20, 'CS');
    expect(lo.A).toBeCloseTo(1.1 / Math.pow(100, 1.5), 8);
  });
});

describe('API 650 tank — wind girder & anchors (corrected units)', () => {
  it('demo TK-501 shell wind stress is in a physical MPa range and anchors are sane', () => {
    const tk = demoProject().find((e) => e.equipType === 'tank')!;
    const c = computeEquipment(tk);
    expect(c.tank).toBeTruthy();
    // 12 m Ø × 14 m tank: M_wind ≈ 1411 kN·m, Z = πR²t ≈ 0.80 m³ → ≈ 1.8 MPa.
    // (Pre-fix the value was ≈ 1.8e6 — Pa labelled as MPa — with πD² instead of πR².)
    expect(c.tank!.windGirderStressMPa).toBeGreaterThan(0.2);
    expect(c.tank!.windGirderStressMPa).toBeLessThan(5);
    // UG-47 basis: A = M/(f·D_b/2) ≈ 1411.2e6/(90×6300) ≈ 2490 mm²
    expect(c.tank!.anchorBoltAreaMm2).toBeGreaterThan(500);
    expect(c.tank!.anchorBoltAreaMm2).toBeLessThan(15000);
  });
});

describe('ASME UG-47 anchor bolts (corrected formula)', () => {
  it('demo column C-201 gets a dimensionally sane bolt group', () => {
    const col = demoProject().find((e) => e.tag === 'C-201')!;
    const c = computeEquipment(col);
    expect(c.bolts).toBeTruthy();
    expect(c.bolts!.reqArea).toBeGreaterThan(100);
    expect(c.bolts!.reqArea).toBeLessThan(20000);
    expect(c.bolts!.ok).toBe(c.bolts!.totalArea >= c.bolts!.reqArea);
  });
});

describe('ASME UG-37 nozzle reinforcement (corrected A2, UG-45 mill tolerance)', () => {
  it('A2 deducts F·t_r per UG-37 and the demo vessel still passes', () => {
    const v = demoProject().find((e) => e.tag === 'V-101')!;
    const c = computeEquipment(v);
    const n2 = c.nozzles.find((nz) => nz.spec.tag === 'N2')!;
    expect(n2).toBeTruthy();
    // re-derive the corrected A2 from the calc's own quantities
    const hOut = Math.min(n2.spec.projOutside + n2.spec.padThk, n2.wall + n2.spec.padThk);
    const hIn = Math.min(50, c.sections[0].tCorroded);
    const expected = 2 * (hOut + hIn) * Math.max(0, n2.wallCorroded - n2.trn - c.sections[0].tReq);
    expect(n2.A2).toBeCloseTo(expected, 6);
    expect(n2.reinforceOK).toBe(true); // pad still covers the requirement
    expect(n2.Aprov).toBeGreaterThanOrEqual(n2.Areq);
    expect(n2.neckOK).toBe(true); // 6 mm sch40 neck − 12.5 % ≥ UG-45 minimum
  });
});

describe('HX engine — head weight & demo sanity (corrected)', () => {
  it('demo E-301 operating weight is physical (head depth is no longer used as thickness)', () => {
    const hx = demoProject().find((e) => e.equipType === 'hx')!;
    const c = computeEquipment(hx);
    expect(c.hx).toBeTruthy();
    // pre-fix: heads alone ≈ 18.9 t and shell wall 10× overstated → ≈ 58 t total
    expect(c.weightOperatingKg).toBeGreaterThan(5000);
    expect(c.weightOperatingKg).toBeLessThan(30000);
    expect(Number.isFinite(c.hx!.tubeSheetThk)).toBe(true);
  });

  it('raises HX-11 and fails the area check on a temperature cross', () => {
    const hx = demoProject().find((e) => e.equipType === 'hx')!;
    hx.hx!.passesTube = 2;
    hx.hx!.tShellIn = 100;
    hx.hx!.tShellOut = 60;
    hx.hx!.tTubeIn = 30;
    hx.hx!.tTubeOut = 100; // P = 1 → cross
    const c = computeEquipment(hx);
    expect(c.warnings.some((w) => w.code === 'HX-11')).toBe(true);
    expect(c.hx!.areaOK).toBe(false);
  });
});

describe('warning catalog sync', () => {
  it('every warning emitted for the demo project is registered at the right level', () => {
    for (const e of demoProject()) {
      const res = checkWarningCodes(computeEquipment(e).warnings);
      expect(res.problems, `${e.tag}: ${res.problems.join('; ')}`).toEqual([]);
    }
  });

  it('external floating roof path (T650-04/05) is catalog-clean', () => {
    const tk = demoProject().find((e) => e.equipType === 'tank')!;
    tk.tank!.roofType = 'externalFloating';
    const res = checkWarningCodes(computeEquipment(tk).warnings);
    expect(res.problems).toEqual([]);
  });
});

describe('B16.5 stud counts', () => {
  it('matches Table 9 for Class 150/300 flanges', () => {
    expect(studCount(2)).toBe(4);
    expect(studCount(4)).toBe(8);
    expect(studCount(6)).toBe(12); // old table wrongly gave 8
    expect(studCount(8)).toBe(16); // old table wrongly gave 8
    expect(studCount(12)).toBe(20); // old table wrongly gave 12
    expect(studCount(24)).toBe(24);
  });
});
