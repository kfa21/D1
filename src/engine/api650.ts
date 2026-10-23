// API 650 storage tank engine — one-foot method shell thickness, minimums,
// cone roof, wind girder/anchor advisories, hydrostatic condition.
// SI form of API 650 §5.6: t_d = 4.9·D·(H−0.3)·G/S_d + CA ; t_t = 4.9·D·(H−0.3)/S_t
// (D, H in m; S in MPa; t in mm). Verify against the governing edition.

import type { Equipment, EquipmentCalc, TankCalc, Warning } from './types';
import { allowableAt, getMat } from './materials';
import { computeVessel } from './asme';

export interface Api650Stress {
  Sd: number; // MPa design
  St: number; // MPa hydro (water)
}

/** API 650 Table 5.2 indicative stresses (editable in settings via override) */
export const API650_STRESSES: Record<string, Api650Stress> = {
  'SA-285-C': { Sd: 137, St: 154 },
  'SA-516-70': { Sd: 173, St: 195 },
  'SA-516-60': { Sd: 148, St: 167 },
  'default': { Sd: 137, St: 154 },
};

/** Floating-roof seal assembly masses (kg per metre of seal run) — API 650 §5.8.3 seal types. */
export const SEAL_PRIMARY_KG_PER_M: Record<string, number> = { none: 0, shoe: 14, fabric: 8, liquidMounted: 11, doubleContact: 18 };
export const SEAL_SECONDARY_KG_PER_M: Record<string, number> = { none: 0, metal: 12, fabric: 6, panCover: 15 };

export function sealMassKg(Dm: number, tank: { roofType: string; primarySeal?: string; secondarySeal?: string }): { primary: number; secondary: number } {
  const runM = Math.PI * Dm;
  const primarySeal = tank.primarySeal ?? 'shoe';
  const secondarySeal = tank.secondarySeal ?? 'metal';
  if (tank.roofType === 'externalFloating') {
    return {
      primary: runM * (SEAL_PRIMARY_KG_PER_M[primarySeal] ?? 0),
      secondary: runM * (SEAL_SECONDARY_KG_PER_M[secondarySeal] ?? 0),
    };
  }
  if (tank.roofType === 'internalFloating') {
    return { primary: runM * (SEAL_PRIMARY_KG_PER_M[primarySeal] ?? 0), secondary: 0 };
  }
  return { primary: 0, secondary: 0 };
}

export function shellMinByDiameter(dM: number): number {
  if (dM < 15) return 5;
  if (dM < 36) return 6;
  if (dM <= 60) return 8;
  return 10;
}

export function computeTank(equip: Equipment): EquipmentCalc {
  const base = computeVessel(equip); // reuse warnings, nozzle/flange checks
  const warnings: Warning[] = [...base.warnings];
  const tank = equip.tank!;
  const sec = equip.sections[0];
  const Dmm = sec.dia;
  const Dm = Dmm / 1000;
  const Hmm = tank.maxDesignLiquidLevel > 0 ? tank.maxDesignLiquidLevel : sec.ttLength;
  const Hm = Hmm / 1000;
  const G = Math.max(0.4, tank.specificGravity);
  const ca = Math.max(0, equip.corrosionAllowance);
  const st = API650_STRESSES[equip.materialKey] ?? API650_STRESSES.default;
  const Sd = tank.shellAllowableOverride > 0 ? tank.shellAllowableOverride : st.Sd;
  const St = st.St;
  const minShell = shellMinByDiameter(Dm);

  if (Dm > 61) {
    warnings.push({
      level: 'warning',
      code: 'T650-01',
      msg: 'API 650 one-foot method limited to D ≤ 61 m — use variable-design-point method',
    });
  }

  // Courses (uniform width from plate catalogue, typically 1500–2000 mm)
  const plateW = 2000;
  const nCourses = Math.max(1, Math.ceil(Hmm / plateW));
  const courseH = Hmm / nCourses;
  const courses: TankCalc['shellCourses'] = [];
  let shellKg = 0;
  let tGov = 0;
  for (let i = 0; i < nCourses; i++) {
    // course i counted from bottom; liquid head at top of course
    const hTopM = ((i + 1) * courseH) / 1000;
    const tDesign = (4.9 * Dm * Math.max(0, hTopM - 0.3) * G) / Sd + ca;
    const tTest = (4.9 * Dm * Math.max(0, hTopM - 0.3) * 1.0) / St;
    const tMin = Math.max(minShell, tDesign, tTest);
    tGov = Math.max(tGov, tMin);
    courses.push({
      courseNo: nCourses - i, // top course = 1
      heightMm: courseH,
      hTopM: hTopM,
      tDesign,
      tTest,
      tMinCode: minShell,
      tNominal: tMin,
      material: equip.materialKey,
    });
    shellKg += Math.PI * Dm * (courseH / 1000) * (tMin / 1000) * 7850;
  }

  const bottomThk = Math.max(6, tank.bottomThk || 6);
  const annularThk = tank.annularBottom ? Math.max(bottomThk, 10) : bottomThk;
  const roofThk = Math.max(5, tank.roofThk || 5);
  const bottomArea = (Math.PI / 4) * Dm * Dm;
  const bottomWeight = bottomArea * (bottomThk / 1000) * 7850 * (tank.annularBottom ? 1.02 : 1.0);
  const roofSlope = 1.055; // cone slope area factor for 1:20 (api) roofs ~2:1 pitch
  const roofDeckArea = (Math.PI / 4) * Math.pow(Dm * 1.02, 2); // m²
  const primarySeal = tank.primarySeal ?? 'shoe';
  const secondarySeal = tank.secondarySeal ?? 'metal';
  const seals = sealMassKg(Dm, tank);
  const sealKg = seals.primary + seals.secondary;
  const roofWeight =
    tank.roofType === 'cone'
      ? roofDeckArea * roofSlope * (roofThk / 1000) * 7850 * 1.05
      : tank.roofType === 'dome'
      ? roofDeckArea * 0.6 * (roofThk / 1000) * 7850
      : tank.roofType === 'externalFloating'
      ? // steel deck plates + pontoon buoyancy ring (≈12 % extra steel) + seal assembly mass
        roofDeckArea * (roofThk / 1000) * 7850 * 1.12 + sealKg
      : // internal floating roof: pan/deck + supporting legs + primary seal
        roofDeckArea * (roofThk / 1000) * 7850 * 0.85 + sealKg;

  if (tank.roofType === 'externalFloating') {
    warnings.push({
      level: 'info',
      code: 'T650-04',
      msg: `External floating roof — primary ${primarySeal === 'shoe' ? 'shoe-mounted' : primarySeal === 'fabric' ? 'fabric' : primarySeal === 'liquidMounted' ? 'liquid-mounted' : primarySeal === 'doubleContact' ? 'double-contacting shoe' : 'none'} seal + secondary ${secondarySeal === 'metal' ? 'metal' : secondarySeal === 'fabric' ? 'fabric' : secondarySeal === 'panCover' ? 'pan-cover' : 'none'} seal per API 650 §5.8.3; verify sinking, over-turning & windward stability and roof-drain design`,
    });
    warnings.push({
      level: 'info',
      code: 'T650-05',
      msg: 'Upper wind girder at shell top course is mandatory for external floating roofs (API 650 §5.8.7) — included in girder advisory below',
    });
  } else if (tank.roofType === 'internalFloating' && (tank.primarySeal ?? 'shoe') !== 'none') {
    warnings.push({
      level: 'info',
      code: 'T650-06',
      msg: `Internal floating roof with primary ${primarySeal} seal — check vapor-space venting (API 650 §5.8.2) and roof-guider arrangement`,
    });
  }

  // Wind girder / stiffener advisory — shell compressive stress from the overturning
  // wind moment about the base: Z = πR²t; M [kN·m] → σ [Pa] → MPa. (Previous code
  // compared Pa against an MPa allowable with πD² instead of πR² — always “required”.)
  const windP = tank.windPressure > 0 ? tank.windPressure : 1.2; // kPa
  const windMoment = windP * Dm * Hm * (Hm / 2); // kN·m
  const syTank = getMat(equip.materialKey).sy; // MPa
  const shellAllowComp = 0.125 * syTank; // MPa (indicative; girder I per §5.8.7.2)
  const Zshell = Math.PI * Math.pow(Dm / 2, 2) * (tGov / 1000); // m³
  const windGirderStressMPa = (windMoment * 1000) / Math.max(1e-6, Zshell) / 1e6; // MPa
  const windGirderRequired = windGirderStressMPa > shellAllowComp || Hm > 12;
  if (windGirderRequired) {
    warnings.push({
      level: 'info',
      code: 'T650-02',
      msg: `Top/intermediate wind girder recommended (shell compressive stress ${windGirderStressMPa.toFixed(1)} MPa vs allowable ${shellAllowComp.toFixed(1)} MPa, H = ${Hm.toFixed(1)} m)`,
    });
  }

  // Anchor bolts — UG-47 basis: total bolt area = M_overturning / (f_b × D_b/2)
  const DbcMm = (Dm + 0.6) * 1000; // bolt circle, mm
  const fT = 90; // MPa allowable bolt stress at temperature (indicative)
  const anchorBoltAreaMm2 = (windMoment * 1e6) / (fT * (DbcMm / 2)); // N·mm/(MPa·mm) → mm²
  if (anchorBoltAreaMm2 > 8 * Math.PI * 324) {
    warnings.push({ level: 'info', code: 'T650-03', msg: 'Anchor bolt group: consider chairs per API 650 §5.11' });
  }

  const volume = (Math.PI / 4) * Dm * Dm * Hm;
  const hydroWater = volume * 1000; // kg at G=1 test
  const testPressureBar = (Hm * 997 * 9.81) / 1e5;

  const tankCalc: TankCalc = {
    shellCourses: courses,
    bottomThk,
    annularThk,
    roofThk,
    sealWeightKg: sealKg,
    shellWeightKg: shellKg,
    bottomWeightKg: bottomWeight,
    roofWeightKg: roofWeight,
    windGirderRequired,
    windGirderStressMPa,
    anchorBoltAreaMm2,
    volumeM3: volume,
    hydroWaterKg: hydroWater,
    testPressureBar,
  };

  const weightDry = shellKg + bottomWeight + roofWeight + base.weightDryKg * 0.15; // + nozzles/attachments
  return {
    ...base,
    codeRef: 'API 650 (12th/13th ed.): §5.6 shell one-foot method, §5.7 openings, §5.8 wind girder, §5.10 roofs, §5.11 anchors',
    sections: base.sections,
    tank: tankCalc,
    weightDryKg: weightDry,
    weightHydroKg: weightDry + hydroWater,
    weightOperatingKg: weightDry + volume * 997 * 0.9,
    internalVolumeM3: volume,
    paintAreaM2: Math.PI * Dm * Hm + (Math.PI / 4) * Dm * Dm * 1.02,
    hydroTestBar: testPressureBar,
    hydroTestBottomBar: testPressureBar,
    mawpBar: 0,
    mawpNote: `API 650 tank — fixed roof at ${equip.designPressure.toFixed(2)} bar g; shell designed by one-foot method, S_d = ${Sd} MPa`,
    membraneUtil: Math.min(1, tGov / Math.max(1, courses[courses.length - 1].tDesign || tGov)),
    materialName: base.materialName,
    sAllow: Sd,
    warnings,
  };
}

/** Quick API 650 check against ASME allowable usage (materials page helper) */
export function api650StressFor(matKey: string): Api650Stress {
  return API650_STRESSES[matKey] ?? API650_STRESSES.default;
}

/** ASME comparison helper (materials page): show both S values for a temperature */
export function compareAllowables(matKey: string, tC: number): { asme: number; api650: number } {
  return { asme: allowableAt(matKey, tC), api650: api650StressFor(matKey).Sd };
}
