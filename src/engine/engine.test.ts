import { describe, expect, it } from 'vitest';
import {
  computeVessel,
  headRequiredThickness,
  shellRequiredThickness,
  shellMawp,
  ug45MinWall,
} from './asme';
import { flangeRatingBar, verifyFlange } from './flange';
import { stockThickness, choosePlate, nestParts, planPlate, DEFAULT_PLATE_STOCK } from './plates';
import { computeEquipment } from './compute';
import { estimateProject, DEFAULT_RATES, depositPerMeter, blankSeamLengthM, sawFillHoursPerMeter } from './estimate';
import { generateBOM, buildProcurement } from './bom';
import { computeTank, sealMassKg } from './api650';
import { computeSupports, recommendStructure } from './supports';
import { computeHX, lmtdCorrected, bundleOD, maxTubes } from './tema';
import { computeFinFan } from './api661';
import type { Equipment, SectionSpec } from './types';
import { allowableAt, getMat } from './materials';
import { suggestNdtMethod } from './ndt';

function section(p: Partial<SectionSpec> = {}): SectionSpec {
  return {
    id: 's1',
    dia: 1200,
    ttLength: 3000,
    headTop: 'ellip2',
    headBottom: 'toriFD',
    shellThk: 0,
    headThkTop: 0,
    headThkBot: 0,
    coneAngleDeg: 0,
    coneThk: 0,
    ...p,
  };
}

function vessel(p: Partial<Equipment> = {}): Equipment {
  return {
    id: 'e1',
    srNo: 1,
    tag: 'V-101',
    name: 'KO Drum',
    equipType: 'vessel',
    orientation: 'horizontal',
    sections: [section()],
    nozzles: [
      {
        id: 'n1',
        tag: 'N1',
        service: 'Inlet',
        dn: 100,
        schKey: '40',
        sectionId: 's1',
        elevation: 1500,
        azimuth: 45,
        kind: 'process',
        flangeClass: 300,
        flangeMatKey: 'SA-105',
        // reinforcement pad per UG-37 — a bare Ø100 opening in a 6 mm shell is under-reinforced
        padDia: 200,
        padThk: 16,
        projOutside: 180,
      },
    ],
    internals: [],
    support: { type: 'saddle', legCount: 4, saddleSpan: 3600, saddleAngle: 120, skirtH: 0, legPlateThk: 12 },
    materialKey: 'SA-516-70',
    corrosionAllowance: 1.5,
    designPressure: 10,
    designTemp: 100,
    mdmt: -10,
    externalPressure: 0.1,
    rtCategory: 'full',
    inspectionLevel: '3.1',
    pwhtOverride: null,
    mwps: 0,
    testPressureFactor: 1.3,
    notes: '',
    ...p,
  };
}

describe('ASME VIII-1 core formulas', () => {
  it('UG-27 hoop and longitudinal thickness match hand calc', () => {
    // P = 1 MPa, R = 600 mm, S = 138 MPa, E = 1
    const { tHoop, tLong } = shellRequiredThickness(600, 1, 138, 1);
    expect(tHoop).toBeCloseTo((1 * 600) / (138 - 0.6), 4);
    expect(tLong).toBeCloseTo((1 * 600) / (2 * 138 + 0.4), 4);
    expect(tHoop).toBeCloseTo(4.3668, 2);
  });

  it('UG-32 heads match hand calc', () => {
    const ellip = headRequiredThickness('ellip2', 1200, 1, 138, 1);
    expect(ellip).toBeCloseTo((1 * 1200) / (2 * 138 - 0.2), 3); // 4.351
    const fd = headRequiredThickness('toriFD', 1200, 1, 138, 1);
    expect(fd).toBeCloseTo((0.885 * 1 * 1200) / (138 - 0.1), 3); // 7.70
    const hemi = headRequiredThickness('hemi', 1200, 1, 138, 1);
    expect(hemi).toBeCloseTo((1 * 600) / (2 * 138 - 0.2), 3);
  });

  it('MAWP recovers design pressure when thickness is exact', () => {
    const t = (1 * 600) / (138 - 0.6); // exact required at P=10 bar
    const m = shellMawp(t, 600, 138, 1);
    expect(m.hoop).toBeCloseTo(10, 3);
  });

  it('UG-45 minimum wall table is sane', () => {
    expect(ug45MinWall(2)).toBeCloseTo(1.8, 1);
    expect(ug45MinWall(8)).toBeCloseTo(3.1, 1);
    expect(ug45MinWall(24)).toBeGreaterThanOrEqual(4.1);
  });

  it('allowable stress interpolates between table points', () => {
    expect(allowableAt('SA-516-70', 25)).toBe(138);
    expect(allowableAt('SA-516-70', 176.5)).toBeCloseTo(134.5, 1); // between 149(136) and 204(133)
    expect(allowableAt('SA-240-316L', 300)).toBeCloseTo(104.6, 1);
  });
});

describe('Flange ratings (ASME B16.5)', () => {
  it('Class 150 group 1.1 at B16.5 reference temp 38°C (100°F) = 285 psig = 19.64 bar', () => {
    expect(flangeRatingBar('1.1', 150, 38)).toBeCloseTo(19.64, 1);
    expect(flangeRatingBar('1.1', 150, 50)).toBeCloseTo(19.27, 1); // interpolated down from 285→260 psig
  });
  it('Class 300 group 1.1 at 54°C (130°F) interpolates between 740 and 680 psig', () => {
    const v = flangeRatingBar('1.1', 300, 54.4);
    expect(v).toBeCloseTo(49.64, 0); // 700 psig → 48.26... check band
  });
  it('verifies and fails correctly', () => {
    expect(verifyFlange('1.1', 150, 38, 15).ok).toBe(true);
    expect(verifyFlange('1.1', 150, 38, 25).ok).toBe(false);
  });
  it('stainless groups follow their own tables', () => {
    expect(flangeRatingBar('2.3', 150, 38)).toBeCloseTo(15.85, 1); // 230 psig at 100 °F
    expect(flangeRatingBar('2.1', 300, 148.9)).toBeCloseTo(37.23, 1); // group 2.1 Class 300 @300 °F
  });
});

describe('Plate stock & nesting', () => {
  it('maps required thickness to next stock size', () => {
    const c = stockThickness(17.6);
    expect(c.chosen).toBe(18);
    expect(c.isStandard).toBe(false);
    expect(c.addedMm).toBeCloseTo(0.4, 1);
    expect(stockThickness(16).isStandard).toBe(true);
  });
  it('picks the smallest fitting plate (rotation allowed)', () => {
    const c = choosePlate(1500, 6000)!;
    expect(c.plate.w * c.plate.l).toBe(1500 * 6000);
    const c2 = choosePlate(2000, 7500)!;
    expect(c2.plate.w).toBeGreaterThanOrEqual(2000);
    expect(c2.plate.l).toBeGreaterThanOrEqual(7500);
    expect(choosePlate(3100, 13000)).toBeNull();
  });
  it('nests and reports wastage', () => {
    const n = nestParts(1500, 6000, 3, { w: 3000, l: 12000 });
    expect(n.partsPerPlate).toBe(4);
    expect(n.platesNeeded).toBe(1);
    // 3 parts × 9 m² = 27 m² used on a single 36 m² plate → 25 % offcut
    expect(n.wastagePct).toBeCloseTo(25, 1);
  });
  it('procurement line computes mass and cost', () => {
    const l = planPlate({ material: 'SA-516-70', thk: 17.6, w: 1900, l: 5800, count: 2 }, DEFAULT_PLATE_STOCK, 1.1, 'x');
    expect(l.thkStock).toBe(18);
    expect(l.platesNeeded).toBeGreaterThanOrEqual(1);
    expect(l.massKg).toBeGreaterThan(0);
    expect(l.estimatedCostUSD).toBeGreaterThan(0);
  });
});

describe('Vessel computation', () => {
  it('computes a compliant vessel with zero errors', () => {
    const eq = vessel();
    const calc = computeVessel(eq);
    expect(calc.sections).toHaveLength(1);
    const s = calc.sections[0];
    // required ≈ 4.37 + 1.5 CA → nominal auto ≥ 5.87
    expect(s.tMinNominal).toBeGreaterThan(5.8);
    expect(s.tNominal).toBeGreaterThanOrEqual(s.tMinNominal);
    expect(calc.mawpBar).toBeGreaterThanOrEqual(eq.designPressure);
    expect(calc.hydroTestBar).toBeCloseTo(1.3 * calc.mawpBar, 1);
    expect(calc.nozzles[0].reinforceOK).toBe(true);
    expect(calc.nozzles[0].flangeClassOK).toBe(true);
    expect(calc.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
    expect(calc.weightDryKg).toBeGreaterThan(500);
    expect(calc.internalVolumeM3).toBeGreaterThan(3);
  });

  it('flags insufficient selected thickness as error', () => {
    const eq = vessel({ sections: [section({ shellThk: 3 })] });
    const calc = computeVessel(eq);
    expect(calc.warnings.some((w) => w.code === 'SH-01')).toBe(true);
  });

  it('flags undersized flange class', () => {
    // Class 150 group 1.1 is rated ~13.95 bar at 200 °C, so it must fail at 15 bar;
    // Class 300 (~43.6 bar) is adequate for the same duty.
    const eq = vessel({ designPressure: 15, designTemp: 200, testPressureFactor: 1.3 });
    eq.nozzles[0].flangeClass = 150;
    const calc = computeVessel(eq);
    expect(calc.warnings.some((w) => w.code === 'FL-01')).toBe(true);
    expect(calc.nozzles[0].flangeClassOK).toBe(false);
  });

  it('multi-dia vessel requires cone transition', () => {
    const eq = vessel({
      sections: [section({ id: 's1', dia: 2000 }), section({ id: 's2', dia: 1400, coneAngleDeg: 0 })],
    });
    const calc = computeVessel(eq);
    expect(calc.warnings.some((w) => w.code === 'MD-01')).toBe(true);
    eq.sections[1].coneAngleDeg = 20;
    const calc2 = computeVessel(eq);
    expect(calc2.warnings.some((w) => w.code === 'MD-01')).toBe(false);
    expect(calc2.sections[1].cone).toBeTruthy();
  });

  it('external pressure check rejects impossible vacuum when thin', () => {
    const eq = vessel({ externalPressure: 1.0, sections: [section({ shellThk: 4, ttLength: 4000 })] });
    const calc = computeVessel(eq);
    expect(calc.sections[0].external).toBeTruthy();
    expect(typeof calc.sections[0].external!.pAllowBar).toBe('number');
  });

  it('PWHT triggers above threshold', () => {
    const eq = vessel({ sections: [section({ shellThk: 45 })] });
    const calc = computeVessel(eq);
    expect(calc.pwht.required).toBe(true);
    expect(calc.pwht.procedure).toContain('PWHT');
  });
});

describe('API 650 tank', () => {
  it('one-foot method thickness and min shell', () => {
    const eq = vessel({
      equipType: 'tank',
      orientation: 'vertical',
      designPressure: 0.05,
      corrosionAllowance: 0,
      sections: [section({ dia: 18000, ttLength: 14000, headTop: 'none', headBottom: 'none' })],
      tank: {
        fluidName: 'Crude',
        specificGravity: 0.9,
        roofType: 'cone',
        annularBottom: true,
        bottomThk: 6,
        roofThk: 5,
        windPressure: 1.2,
        seismic: false,
        shellAllowableOverride: 0,
        stiffenerRings: true,
        maxDesignLiquidLevel: 14000,
      },
      support: { type: 'none', legCount: 0, saddleSpan: 0, saddleAngle: 120, skirtH: 0, legPlateThk: 0 },
    });
    const calc = computeTank(eq);
    expect(calc.tank).toBeTruthy();
    const t = calc.tank!.shellCourses.reduce((a, b) => (b.tDesign > a.tDesign ? b : a)); // governing (bottom) course
    // 4.9 * 18 * (14-0.3) * 0.9 / 173 = 6.38 mm (Sd A516-70 = 173)
    expect(t.tDesign).toBeGreaterThan(5);
    expect(t.tNominal).toBeGreaterThanOrEqual(6); // min shell for D=18 m
    expect(calc.tank!.volumeM3).toBeGreaterThan(3500);
    expect(calc.tank!.bottomThk).toBe(6);
  });
});

describe('TEMA exchanger', () => {
  it('bundle layout math', () => {
    const n = maxTubes(600, 25, 30);
    expect(n).toBeGreaterThan(200);
    const od = bundleOD(200, 25, 30);
    expect(od).toBeGreaterThan(200);
  });

  it('LMTD: pure counter-current equal-end differences', () => {
    const { lmtd, F } = lmtdCorrected(150, 90, 40, 100, 1);
    expect(F).toBe(1);
    expect(lmtd).toBeGreaterThan(0);
  });

  it('computes exchanger with area and tubesheet', () => {
    const eq = vessel({
      equipType: 'hx',
      orientation: 'horizontal',
      designPressure: 10,
      sections: [section({ dia: 600, ttLength: 3000, headTop: 'ellip2', headBottom: 'ellip2' })],
      nozzles: [
        {
          id: 'n1', tag: 'N1', service: 'Shell inlet', dn: 150, schKey: '40', sectionId: 's1',
          elevation: 1500, azimuth: 0, kind: 'process', flangeClass: 300, flangeMatKey: 'SA-105',
          padDia: 0, padThk: 0, projOutside: 200,
        },
      ],
      hx: {
        temaType: 'BEM', shellFluid: 'Hot oil', tubeFluid: 'Cooling water',
        shellDiaOD: 0, tubeOD: 19.05, tubeWall: 1.65, tubeLength: 3000, tubeCount: 0,
        pitch: 25.4, layoutAngle: 30, baffleType: 'segmental', baffleCut: 25,
        baffleSpacing: 0, passesTube: 1, shellMatKey: 'SA-516-70', tubeMatKey: 'SA-240-316L',
        baffleMatKey: 'SA-240-304', headMatKey: 'SA-516-70', tsMatKey: 'SA-516-70',
        designPShell: 10, designTShell: 150, designPTube: 6, designTTube: 80,
        dutyKW: 2000, tShellIn: 120, tShellOut: 70, tTubeIn: 32, tTubeOut: 42,
        uOverall: 0, tubeSideDP: 0, baffleCount: 0,
      },
    });
    const calc = computeHX(eq);
    expect(calc.hx).toBeTruthy();
    expect(calc.hx!.tubeCountActual).toBeGreaterThan(50);
    expect(calc.hx!.providedArea).toBeGreaterThan(0);
    expect(calc.hx!.tubeSheetThk).toBeGreaterThan(20);
    expect(calc.hx!.lmtd).toBeGreaterThan(0);
  });
});

describe('API 661 fin fan', () => {
  it('sizes a two-bay air cooler', () => {
    const eq = vessel({
      equipType: 'finfan',
      orientation: 'horizontal',
      designPressure: 10,
      sections: [section({ dia: 400, ttLength: 400, headTop: 'none', headBottom: 'none' })],
      nozzles: [],
      finfan: {
        arrangement: 'induced', bays: 2, rows: 6, tubeLength: 9144, tubeOD: 25.4, tubeWall: 2.11,
        finOD: 50.8, finPitch: 10, finThk: 0.4, dutyKW: 5000, processInC: 95, processOutC: 55,
        airInC: 35, uAir: 0, airRiseC: 15, fanEfficiency: 0.65, plenumLossH2O: 0.5,
        tubeMatKey: 'SA-240-316L', finMatKey: 'ALU', headerThk: 10, tubeCount: 0,
      },
      support: { type: 'legs', legCount: 4, saddleSpan: 0, saddleAngle: 120, skirtH: 800, legPlateThk: 12 },
    });
    const calc = computeFinFan(eq);
    expect(calc.finfan).toBeTruthy();
    expect(calc.finfan!.tubeCountActual).toBeGreaterThan(500);
    expect(calc.finfan!.finnedAreaM2).toBeGreaterThan(1000);
    expect(calc.finfan!.airFlowCMH).toBeGreaterThan(10000);
    expect(calc.finfan!.fanKW).toBeGreaterThan(1);
    expect(calc.finfan!.thermalOK).toBe(true);
  });
});

describe('BOM / estimate integration', () => {
  it('produces BOM, procurement and an estimate in BHD (base currency)', () => {
    const eq = vessel();
    const calc = computeEquipment(eq);
    const { items, plateReqs } = generateBOM(eq, calc);
    expect(items.length).toBeGreaterThan(6);
    expect(plateReqs.length).toBeGreaterThanOrEqual(3); // shell strips + 2 heads
    const proc = buildProcurement(plateReqs, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(proc.lines.length).toBeGreaterThan(0);
    const est = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(est.totals.grandUSD).toBeGreaterThan(3700); // BHD base (≈ former 10k USD)
    expect(est.totals.shopHours).toBeGreaterThan(50);
    expect(est.perTag[0].materialUSD).toBeGreaterThan(0);
    expect(est.lines.some((l) => l.group === 'Consumables')).toBe(true);
    expect(est.lines.some((l) => l.activity.includes('Longitudinal'))).toBe(true);
  });

  it('deposit per metre scales with thickness', () => {
    expect(depositPerMeter(10)).toBeLessThan(depositPerMeter(30));
    expect(depositPerMeter(20)).toBeGreaterThan(1.5);
  });
});

describe('Cladding / lining', () => {
  it('full-length clad adds weight and uses lining grade density', () => {
    const eq = vessel({
      clad: { mode: 'full', kind: 'explosionBonded', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 0, note: '' },
    });
    const bare = computeVessel(vessel());
    const cladCalc = computeVessel(eq);
    expect(cladCalc.clad).toBeTruthy();
    // 2:1 ellip heads + shell, 3 mm 316L @ 8000 kg/m³ → hundreds of kg
    expect(cladCalc.clad!.weightKg).toBeGreaterThan(100);
    expect(cladCalc.clad!.areaM2).toBeGreaterThan(10);
    expect(cladCalc.weightDryKg).toBeCloseTo(bare.weightDryKg + cladCalc.clad!.weightKg, 0);
  });

  it('partial clad scales covered length and flags zero coverage', () => {
    const eq = vessel({
      clad: { mode: 'partial', kind: 'weldOverlay', materialKey: 'SB-443-N06625', thicknessMm: 3, partialLengthMm: 1500, note: '' },
    });
    const c = computeVessel(eq);
    expect(c.clad!.coverageLengthMm).toBe(1500);
    expect(c.clad!.areaM2).toBeGreaterThan(0);
    const zero = vessel({
      clad: { mode: 'partial', kind: 'weldOverlay', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 0, note: '' },
    });
    expect(computeVessel(zero).warnings.some((w) => w.code === 'CL-02')).toBe(true);
  });

  it('PWHT + austenitic overlay raises CL-01 sequencing warning', () => {
    const eq = vessel({
      sections: [section({ shellThk: 45 })],
      clad: { mode: 'full', kind: 'weldOverlay', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 0, note: '' },
    });
    const c = computeVessel(eq);
    expect(c.warnings.some((w) => w.code === 'CL-01')).toBe(true);
  });
});

describe('HX tubesheet clad & tube-to-tubesheet joints', () => {
  it('tubesheet overlay weight and joint BOM consumables', () => {
    const eq = vessel({
      equipType: 'hx',
      orientation: 'horizontal',
      designPressure: 10,
      sections: [section({ dia: 600, ttLength: 3000, headTop: 'ellip2', headBottom: 'ellip2' })],
      nozzles: [],
      hx: {
        temaType: 'BEM', tubeJointType: 'strengthWelded',
        tubeSheetClad: { enabled: true, materialKey: 'SA-240-316L', thicknessMm: 3 },
        shellFluid: 'Hot oil', tubeFluid: 'Cooling water',
        shellDiaOD: 0, tubeOD: 19.05, tubeWall: 1.65, tubeLength: 3000, tubeCount: 0,
        pitch: 25.4, layoutAngle: 30, baffleType: 'segmental', baffleCut: 25,
        baffleSpacing: 0, passesTube: 1, shellMatKey: 'SA-516-70', tubeMatKey: 'SA-240-316L',
        baffleMatKey: 'SA-240-304', headMatKey: 'SA-516-70', tsMatKey: 'SA-516-70',
        designPShell: 10, designTShell: 150, designPTube: 6, designTTube: 80,
        dutyKW: 2000, tShellIn: 120, tShellOut: 70, tTubeIn: 32, tTubeOut: 42,
        uOverall: 0, tubeSideDP: 0, baffleCount: 0,
      },
    });
    const calc = computeHX(eq);
    expect(calc.hx!.tubeSheetCladKg).toBeGreaterThan(0);
    expect(calc.warnings.some((w) => w.code === 'HX-09')).toBe(true); // joint plan advisory
    const { items } = generateBOM(eq, calc);
    expect(items.some((i) => i.id.includes('hx-tsclad'))).toBe(true);
    expect(items.some((i) => i.id.includes('hx-joint'))).toBe(true);
  });
});

describe('Weld breakdown & NDT plan in estimates', () => {
  it('produces weld segments with joint configuration and electrodes', () => {
    const eq = vessel();
    const calc = computeEquipment(eq);
    const est = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    const tag = est.perTag[0];
    expect(tag.welds.length).toBeGreaterThan(2);
    expect(tag.welds.every((w) => w.hours > 0)).toBe(true);
    expect(tag.welds.every((w) => w.joint.includes('Butt'))).toBe(true);
    expect(tag.welds.some((w) => w.area.includes('Head-to-shell'))).toBe(true);
    expect(tag.welds.every((w) => w.electrode.length > 0)).toBe(true);
    expect(tag.welds.reduce((s, w) => s + w.depositKg, 0)).toBeGreaterThan(0);
  });

  it('NDT plan drives per-method lines incl. PaUT/TOFD day rate', () => {
    const eq = vessel();
    eq.ndtPlan = [
      { method: 'mt', enabled: true, timing: 'final', extent: 'spot', note: '' },
      { method: 'rt', enabled: false, timing: 'afterPwht', extent: 'spot', note: '' },
      { method: 'putTofd', enabled: true, timing: 'afterPwht', extent: 'full', note: 'client spec' },
    ];
    const calc = computeEquipment(eq);
    const est = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(est.lines.some((l) => l.activity.includes('PaUT/TOFD scanner'))).toBe(true);
    expect(est.lines.some((l) => l.activity.includes('MT/DP'))).toBe(true);
    expect(est.lines.some((l) => l.activity.includes('Conventional RT'))).toBe(false); // disabled
  });

  it('suggests PaUT/TOFD for heavy shell, RT for thin', () => {
    expect(suggestNdtMethod(60, 'vertical', false).preferred).toBe('putTofd');
    expect(suggestNdtMethod(12, 'horizontal', false).preferred).toBe('rt');
  });
});

describe('Head blank seams & outsourced forming', () => {
  it('blank seam length is in metres and grows with strip count', () => {
    expect(blankSeamLengthM(1200)).toBe(0); // fits one 2440 mm plate
    expect(blankSeamLengthM(3000)).toBeCloseTo(3.0, 2); // single centre chord
    const big = blankSeamLengthM(6000);
    expect(big).toBeGreaterThan(10); // 2 chord seams ≈ 11.3 m — not 11 300 (mm bug)
    expect(big).toBeLessThan(15);
  });

  it('SAW fill model is faster per metre than the manual SMAW norm', () => {
    for (const t of [12, 25, 50]) {
      expect(sawFillHoursPerMeter(t)).toBeGreaterThan(0);
      expect(sawFillHoursPerMeter(t) + 1.1).toBeLessThan(7.8); // fill + root < heavy manual norm
    }
  });

  it('forms dish ends as an outside service, with manual hours/rate overrides', () => {
    const eq = vessel();
    const calc = computeEquipment(eq);
    const est = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(est.lines.some((l) => l.group === 'Outside services' && l.activity.includes('Head forming'))).toBe(true);

    eq.formingHoursOverride = 25;
    eq.formingRateOverride = 40;
    const est2 = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    const forming = est2.lines.find((l) => l.group === 'Outside services' && l.activity.includes('Head forming'))!;
    expect(forming.qty).toBe(25);
    expect(forming.rateUSD).toBe(40);
    expect(forming.amountUSD).toBe(1000);
  });
});

describe('Support calculations (per kind) & structure recommendation', () => {
  it('computes each support kind separately with weight, welds and hours', () => {
    const eq = vessel({
      orientation: 'vertical',
      support: { type: 'legs', legCount: 4, saddleSpan: 0, saddleAngle: 120, skirtH: 900, legPlateThk: 16, baseRing: true, padeyes: true, guyLines: false },
    });
    const calc = computeEquipment(eq);
    const sup = calc.supports!;
    const kinds = sup.items.map((i) => i.kind);
    expect(kinds).toContain('legs');
    expect(kinds).toContain('baseRing');
    expect(kinds).toContain('padeyes');
    expect(sup.totalWeightKg).toBeGreaterThan(0);
    expect(sup.totalHours).toBeGreaterThan(0);
    expect(sup.anchorBolts).not.toBeNull();
  });

  it('support hours & electrodes flow into the estimate', () => {
    const eq = vessel({
      orientation: 'vertical',
      support: { type: 'skirt', legCount: 0, saddleSpan: 0, saddleAngle: 120, skirtH: 1500, legPlateThk: 16, padeyes: true, guyLines: false },
    });
    const calc = computeEquipment(eq);
    const est = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(est.lines.some((l) => l.activity.includes('Skirt support'))).toBe(true);
    expect(est.lines.some((l) => l.activity.includes('fillet electrodes'))).toBe(true);
  });

  it('saddle supports for horizontal vessels appear as their own calcs', () => {
    const eq = vessel(); // horizontal, saddle support
    const calc = computeEquipment(eq);
    expect(calc.supports!.items.some((i) => i.kind === 'saddle')).toBe(true);
  });

  it('structure recommendation exists for every tag and is costed only when selected', () => {
    const eq = vessel({ orientation: 'horizontal' });
    const calc = computeEquipment(eq);
    const rec = recommendStructure(eq, calc);
    expect(rec.kind).toBe('skid');
    expect(rec.members.length).toBeGreaterThan(0);
    expect(rec.weightKg).toBeGreaterThan(0);
    expect(rec.enabled).toBe(false);

    const off = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(off.lines.some((l) => l.activity.includes('Structural steelwork'))).toBe(false);

    eq.structure = { enabled: true, kind: 'skid' };
    const on = estimateProject([{ equip: eq, calc }], DEFAULT_RATES, { stockPlates: DEFAULT_PLATE_STOCK, prices: {} });
    expect(on.lines.some((l) => l.activity.includes('Structural steelwork fabrication'))).toBe(true);
    const items = generateBOM(eq, calc).items;
    expect(items.some((i) => i.item.includes('Structural steelwork'))).toBe(true);
  });
});

describe('HX tube material data', () => {
  it('SA-179 and other tube grades resolve with tube data (not plate fallback)', () => {
    expect(getMat('SA-179').key).toBe('SA-179');
    expect(getMat('SA-179').form).toBe('pipe');
    expect(allowableAt('SA-179', 100)).toBeCloseTo(95.2, 1);
    expect(getMat('SB-163-C70600').density).toBeCloseTo(8940, 0);
    expect(getMat('SA-213-T316L').group).toBe('SS316');
  });
});

describe('Storage tank floating roofs & seals (API 650)', () => {
  function tank(roof: 'cone' | 'externalFloating'): Equipment {
    const t: Equipment = {
      ...vessel({ equipType: 'tank', orientation: 'vertical', support: { type: 'none', legCount: 0, saddleSpan: 0, saddleAngle: 120, skirtH: 0, legPlateThk: 0 } }),
      sections: [{ ...section({ dia: 12000, ttLength: 14000, headTop: 'none', headBottom: 'none' }) }],
    };
    t.tank = {
      fluidName: 'Crude', specificGravity: 0.85, roofType: roof, annularBottom: true,
      bottomThk: 0, roofThk: 6, windPressure: 1.2, seismic: false, shellAllowableOverride: 0,
      stiffenerRings: false, maxDesignLiquidLevel: 0, primarySeal: 'shoe', secondarySeal: 'metal',
    };
    return t;
  }

  it('external floating roof adds primary + secondary seal mass', () => {
    const fixed = computeEquipment(tank('cone'));
    const efr = computeEquipment(tank('externalFloating'));
    expect(fixed.tank!.sealWeightKg).toBe(0);
    expect(efr.tank!.sealWeightKg).toBeGreaterThan(0);
    expect(efr.warnings.some((w) => w.code === 'T650-04')).toBe(true);
    // seal masses match the per-metre spec
    const manual = sealMassKg(12, tank('externalFloating').tank!);
    expect(manual.primary).toBeGreaterThan(0);
    expect(manual.secondary).toBeGreaterThan(0);
  });

  it('BOM carries the seal assemblies as purchased items', () => {
    const t = tank('externalFloating');
    const calc = computeEquipment(t);
    const items = generateBOM(t, calc).items;
    expect(items.some((i) => i.item.includes('Primary seal assembly'))).toBe(true);
    expect(items.some((i) => i.item.includes('Secondary seal assembly'))).toBe(true);
  });
});

describe('SR (safety relief) nozzles', () => {
  it('accepts the safetyRelief nozzle kind and prices it like any other nozzle', () => {
    const eq = vessel();
    eq.nozzles = [
      { id: 'nz-sr', tag: 'SR-1', service: 'SRV backup', dn: 80, schKey: '40', sectionId: 's1', elevation: 2000, azimuth: 120, kind: 'safetyRelief', flangeClass: 300, flangeMatKey: 'SA-105', padDia: 200, padThk: 16, projOutside: 150 },
    ];
    const calc = computeEquipment(eq);
    expect(calc.nozzles.length).toBe(1);
    expect(calc.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
    const items = generateBOM(eq, calc).items;
    expect(items.some((i) => i.item.includes('SR-1'))).toBe(true);
  });
});
