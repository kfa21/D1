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
import { externalPressureCheck, externalRequiredThickness, zickHornStress, zickK3, zickK2, zickSaddle } from './asme';
import { studCount } from './pipes';
import { computeTank } from './api650';
import { computeEquipment } from './compute';
import { demoProject } from '../defaults';
import { checkWarningCodes } from './warnings';
import type { Equipment } from './types';

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

describe('ASME UG-37 nozzle reinforcement (corrected A2, UG-40 limits)', () => {
  it('A2 uses the UG-37.1 form 2·(h_out+h_in)·(t_n − F·t_r) on the demo vessel', () => {
    const v = demoProject().find((e) => e.tag === 'V-101')!;
    const c = computeEquipment(v);
    const n2 = c.nozzles.find((nz) => nz.spec.tag === 'N2')!;
    expect(n2).toBeTruthy();
    // re-derive A2 from the calc's own quantities using the corrected form + UG-40 limits
    const ta = c.sections[0].tCorroded;
    const hOut = Math.min(n2.spec.projOutside + n2.spec.padThk, 2.5 * ta + n2.spec.padThk);
    const hIn = Math.min(50, ta, 2.5 * n2.wallCorroded);
    const expected = 2 * (hOut + hIn) * Math.max(0, n2.wallCorroded - c.sections[0].tReq); // F = 1
    expect(n2.A2).toBeCloseTo(expected, 6);
    expect(n2.reinforceOK).toBe(true); // pad still covers the requirement
    expect(n2.Aprov).toBeGreaterThanOrEqual(n2.Areq);
    expect(n2.neckOK).toBe(true); // sch40 neck − 12.5 % ≥ UG-45 minimum
  });

  it('thick-neck nozzle: A2 > 0 and no longer double-deducts t_rn (discriminating)', () => {
    // thin shell (low pressure) + heavy DN300 sch40 neck → the neck wall contributes
    // real reinforcement, so the A2 formula shape is actually exercised (demo N2 has A2 = 0).
    const base = demoProject().find((e) => e.tag === 'V-101')!;
    const eq: Equipment = {
      ...base,
      designPressure: 4,
      corrosionAllowance: 0,
      rtCategory: 'full',
      externalPressure: 0,
      sections: [{ ...base.sections[0], dia: 2000, ttLength: 4000, headTop: 'none', headBottom: 'none', shellThk: 0, coneAngleDeg: 0 }],
      nozzles: [
        { id: 'nz1', tag: 'NZ', service: 'Inlet', dn: 300, schKey: '40', sectionId: base.sections[0].id, elevation: 2000, azimuth: 0, kind: 'process', flangeClass: 150, flangeMatKey: 'SA-105', padDia: 0, padThk: 0, projOutside: 150 },
      ],
    };
    const c = computeEquipment(eq);
    const sec = c.sections[0];
    const nz = c.nozzles[0];
    const tn = nz.wallCorroded;
    const tr = sec.tReq;
    expect(tn).toBeGreaterThan(tr); // discriminating: neck contributes
    const hOut = Math.min(nz.spec.projOutside + nz.spec.padThk, 2.5 * sec.tCorroded + nz.spec.padThk);
    const hIn = Math.min(50, sec.tCorroded, 2.5 * tn);
    const inner = tn - tr; // F = 1 — corrected form deducts F·t_r only
    expect(nz.A2).toBeCloseTo(2 * (hOut + hIn) * inner, 6);
    expect(nz.A2).toBeGreaterThan(0);
    // the pre-fix form also subtracted t_rn, giving a strictly smaller A2
    const oldInner = tn - nz.trn - tr;
    expect(oldInner).toBeLessThan(inner);
    expect(Math.abs(nz.A2 - 2 * (hOut + hIn) * oldInner)).toBeGreaterThan(1);
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

describe('UG-45 external-pressure floor (inverted UG-28)', () => {
  it('externalRequiredThickness inverts the UG-28 allowable', () => {
    const t = externalRequiredThickness(1400, 1.0, 200, 'CS'); // ≈ 13.5 mm
    const at = externalPressureCheck(1400, t, 1400, 200, 'CS');
    expect(at.pAllowBar).toBeGreaterThanOrEqual(1.0);
    const thinner = externalPressureCheck(1400, t - 0.3, 1400, 200, 'CS');
    expect(thinner.pAllowBar).toBeLessThan(1.0);
    expect(t).toBeGreaterThan(5); // a Ø1400 shell under 1 bar vacuum needs real thickness
    expect(externalRequiredThickness(1400, 0, 200, 'CS')).toBe(0); // no external → no b2 floor
  });
});

describe('Zick saddle horn stress (verified formula + published K3)', () => {
  it('K3 anchors match Zick Table I and decrease monotonically 120°→150°', () => {
    expect(zickK3(120)).toBeCloseTo(0.528, 6);
    expect(zickK3(150)).toBeCloseTo(0.0316, 6);
    expect(zickK3(90)).toBeCloseTo(0.528, 6); // clamped below 120° (conservative)
    const a = zickK3(120), b = zickK3(130), c = zickK3(140), d = zickK3(150);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('horn stress matches hand calc for the L ≥ 8R and L < 8R branches', () => {
    // Q=100 kN, t=10 mm, R=700 mm, b0=200 mm, 120° (K3=0.528)
    const hi = zickHornStress(100000, 10, 700, 8000, 200, 120); // L=8000 ≥ 8R=5600
    expect(hi.b2).toBe(300); // b0 + 10t
    expect(hi.membrane).toBeCloseTo(100000 / (4 * 10 * 300), 6);
    expect(hi.bending).toBeCloseTo((3 * 0.528 * 100000) / (2 * 100), 6); // = 792
    expect(hi.S3).toBeCloseTo(hi.membrane + hi.bending, 6);
    const lo = zickHornStress(100000, 10, 700, 2600, 200, 120); // L < 8R
    expect(lo.bending).toBeCloseTo((12 * 0.528 * 100000 * 700) / (2600 * 100), 6);
    // the two branches are continuous at L = 8R
    const at = zickHornStress(100000, 10, 700, 5600, 200, 120);
    const justBelow = zickHornStress(100000, 10, 700, 5599, 200, 120);
    expect(Math.abs(at.bending - justBelow.bending)).toBeLessThan(1);
  });

  it('demo V-101 saddle reports a real Zick horn stress (old formula gave ~0.06 MPa)', () => {
    const v = demoProject().find((e) => e.tag === 'V-101')!;
    const c = computeEquipment(v);
    const s = c.saddle!;
    expect(s.k3).toBeCloseTo(0.528, 3); // 120° saddle
    expect(s.hornMembraneMPa + s.hornBendingMPa).toBeCloseTo(s.zickFc, 6);
    expect(s.zickFc).toBeGreaterThan(50); // real magnitude, not the old ~0.06 MPa
    expect(s.zickAllow).toBeCloseTo(1.25 * c.sAllow, 5);
    expect(s.reaction).toBeGreaterThan(0);
  });

  it('K2 shear anchors match Zick Table I and decrease 120°→150°', () => {
    expect(zickK2(120)).toBeCloseTo(1.171, 6);
    expect(zickK2(150)).toBeCloseTo(0.799, 6);
    expect(zickK2(90)).toBeCloseTo(1.171, 6); // clamped below 120° (conservative)
    expect(zickK2(120)).toBeGreaterThan(zickK2(135));
    expect(zickK2(135)).toBeGreaterThan(zickK2(150));
  });

  it('shear and longitudinal match hand calc (K2·Q/(R·t), beam moments, πR²t)', () => {
    // controlled case: W=200 kN, 2 saddles, R=700, t=10, L=8000 (≥8R), span=6000, 120°
    const z = zickSaddle({ WopN: 200000, nSaddle: 2, RMm: 700, tMm: 10, LttMm: 8000, spanMm: 6000, b0Mm: 200, angleDeg: 120, Pm: 1.0, S: 150 });
    expect(z.Q).toBe(100000);
    expect(z.k2).toBeCloseTo(1.171, 6);
    expect(z.shear).toBeCloseTo((1.171 * 100000) / (700 * 10), 6); // ≈ 16.73 MPa
    // longitudinal: overhang a = (L−span)/2 = 1000
    expect(z.a).toBe(1000);
    expect(z.Mhog).toBeCloseTo((200000 * 1000 * 1000) / (2 * 8000), 3); // W·a²/(2L) = 1.25e7
    expect(z.Msag).toBeCloseTo((200000 * 8000) / 8 - (200000 * 1000) / 2, 3); // = 1e8
    const Z = Math.PI * 700 * 700 * 10; // πR²t
    expect(z.longTens).toBeCloseTo((1.0 * 700) / 20 + 1e8 / Z, 5); // ≈ 41.50 MPa
    expect(z.longComp).toBeCloseTo(1.25e7 / Z - 35, 5);
  });

  it('demo V-101 completes all three Zick cases — horn governs, shear & long. pass', () => {
    const v = demoProject().find((e) => e.tag === 'V-101')!;
    const c = computeEquipment(v);
    const s = c.saddle!;
    expect(s.k2).toBeCloseTo(1.171, 3); // 120°
    expect(s.shearAllowMPa).toBeCloseTo(0.8 * c.sAllow, 5);
    expect(s.longAllowMPa).toBeCloseTo(c.sAllow, 5);
    // shear and longitudinal are comfortably under their allowables for this drum
    expect(s.shearMPa).toBeLessThan(s.shearAllowMPa);
    expect(s.longStressMPa).toBeGreaterThan(0);
    expect(s.longStressMPa).toBeLessThan(s.longAllowMPa);
    // the horn is the governing check and trips the wear-plate advisory
    expect(s.hornUtil).toBeGreaterThan(0.85);
    expect(s.ok).toBe(false);
  });
});

describe('Anchor bolts — wind & seismic overturning (real inputs)', () => {
  it('wind-only hand calc on demo column C-201 (q = 1.0 kPa)', () => {
    const col = demoProject().find((e) => e.tag === 'C-201')!;
    col.designLoads = { windPressureKpa: 1.0, sds: 0, seismicR: 3, seismicIe: 1 };
    const c = computeEquipment(col);
    const b = c.bolts!;
    const Hw = (18000 * 1.05) / 1000; // 18.9 m
    const Aproj = (1800 / 1000) * Hw; // 34.02 m²
    const Mwind = 1.0 * Aproj * (Hw / 2); // kN·m ≈ 321.49
    expect(b.governing).toBe('wind');
    expect(b.windMomentKNm).toBeCloseTo(Mwind, 3);
    expect(b.seismicMomentKNm).toBe(0);
    expect(b.overturnMomentKNm).toBeCloseTo(Mwind, 3);
    const Dbc = 1800 + 400;
    const reqArea = (Mwind * 1e6) / (90 * (Dbc / 2)); // ≈ 3247 mm²
    expect(b.reqArea).toBeCloseTo(reqArea, 3);
    expect(b.ok).toBe(b.totalArea >= b.reqArea);
    const Rbc = Dbc / 2;
    const Tbolt = (Mwind * 1e6 * Rbc) / ((b.count * Rbc * Rbc) / 2); // elastic bolt group
    expect(b.boltTensionKN).toBeCloseTo(Tbolt / 1000, 4);
  });

  it('seismic governs at high Sds, and wind/seismic are not combined', () => {
    const col = demoProject().find((e) => e.tag === 'C-201')!;
    col.designLoads = { windPressureKpa: 1.0, sds: 0.9, seismicR: 3, seismicIe: 1 };
    const c = computeEquipment(col);
    const b = c.bolts!;
    const Hw = (18000 * 1.05) / 1000;
    const Wop = (c.weightOperatingKg * 9.81) / 1000; // kN
    const Cs = (0.9 * 1) / 3; // 0.3
    const Mseis = Cs * Wop * (0.7 * Hw);
    expect(b.governing).toBe('seismic');
    expect(b.seismicMomentKNm).toBeCloseTo(Mseis, 3);
    expect(b.overturnMomentKNm).toBeCloseTo(Mseis, 3); // = max(wind, seismic), not the sum
    expect(b.overturnMomentKNm).toBeGreaterThan(b.windMomentKNm);
  });
});
