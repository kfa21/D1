// API 650 storage tank engine — shell thickness (one-foot §5.6.3 or variable
// design point §5.6.4 for D > 61 m), minimums, annular bottom plates
// (Table 5-1a), cone roof, wind girder/anchor advisories, hydrostatic condition.
// SI form: t_d = 4.9·D·(H−0.3)·G/S_d + CA ; t_t = 4.9·D·(H−0.3)/S_t
// (D, H in m; S in MPa; t in mm). Verify against the governing edition.

import type { Equipment, EquipmentCalc, TankCalc, TankSpec, Warning } from './types';
import { allowableAt, getMat } from './materials';
import { computeVessel, sizeAnchorBolts } from './asme';

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

// ---------------------------------------------------------------------------
// API 650 §5.6.4 variable design point method (SI units)
// ---------------------------------------------------------------------------

/** First (bottom) course of a variable-design-point design — API 650 §5.6.4
 *  first-course equation (SI):
 *    t1d = [1.06 − 0.0696·(D/H)·√(H·G/Sd)]·4.9·H·D·G/Sd + CA
 *    t1t = [1.06 − 0.0696·(D/H)·√(H/St)]·4.9·H·D/St        (no CA)
 *  with D, H in m, S in MPa, t in mm. Validated against a published worked
 *  calculation (D = 11.5 m, H = 10.5 m, G = 1, Sd = 156.667, CA = 6 → 9.929 mm). */
export function vdpFirstCourseThickness(
  Dm: number,
  Hm: number,
  G: number,
  Sd: number,
  St: number,
  ca: number
): { td: number; tt: number } {
  if (!(Hm > 0) || !(Dm > 0)) return { td: Math.max(0, ca), tt: 0 };
  const base = 4.9 * Hm * Dm;
  const kD = 1.06 - 0.0696 * (Dm / Hm) * Math.sqrt((Hm * G) / Math.max(1e-6, Sd));
  const kT = 1.06 - 0.0696 * (Dm / Hm) * Math.sqrt(Hm / Math.max(1e-6, St));
  return {
    td: kD * ((base * G) / Math.max(1e-6, Sd)) + ca,
    tt: kT * (base / Math.max(1e-6, St)),
  };
}

/** Upper-course design point and required thicknesses — API 650 §5.6.4 (SI):
 *    K  = tL/tu,  C = K(K−1)/(1 + K^1.5)
 *    x1 = 0.61·√(R·tu) + 320·C·H,  x2 = 1000·C·H,  x3 = 1.22·√(R·tu)
 *    x  = min(x1, x2, x3) (mm, clamped ≥ 0) above the course bottom
 *    td = 4.9·D·(H − x/1000)·G/Sd + CA,  tt = 4.9·D·(H − x/1000)/St
 *  R = tank radius (mm), tu = corroded trial thickness of this course (mm),
 *  tL = thickness of the course below (mm), H = liquid head above this
 *  course's bottom (m). The x3 (√R·t) candidate does not involve H; x2 does. */
export function vdpUpperCourseThickness(p: {
  Dm: number;
  headM: number;
  G: number;
  Sd: number;
  St: number;
  ca: number;
  RmMm: number;
  tuMm: number;
  tLMm: number;
}): { K: number; C: number; x1: number; x2: number; x3: number; x: number; td: number; tt: number } {
  const tu = Math.max(1e-3, p.tuMm);
  const tL = Math.max(1e-3, p.tLMm);
  const K = tL / tu;
  const C = (K * (K - 1)) / (1 + Math.pow(K, 1.5));
  const root = Math.sqrt(Math.max(0, p.RmMm * tu));
  const H = Math.max(0, p.headM);
  const x1 = 0.61 * root + 320 * C * H;
  const x2 = 1000 * C * H;
  const x3 = 1.22 * root;
  const x = Math.max(0, Math.min(x1, x2, x3));
  const head = Math.max(0, H - x / 1000);
  return {
    K,
    C,
    x1,
    x2,
    x3,
    x,
    td: (4.9 * p.Dm * head * p.G) / Math.max(1e-6, p.Sd) + p.ca,
    tt: (4.9 * p.Dm * head) / Math.max(1e-6, p.St),
  };
}

/** Iterate one VDP upper course to convergence: the design point x depends on
 *  this course's own (trial) thickness, so sizing needs a fixed-point pass.
 *  Returns converged = false when maxIter is exhausted — the caller warns
 *  (T650-11) and keeps the last iterate. In practice the loop converges in
 *  2–3 passes because |d(next)/d(trial)| < 1 for normal geometry. */
export function iterateVdpCourse(
  p: {
    Dm: number;
    headM: number;
    G: number;
    Sd: number;
    St: number;
    ca: number;
    RmMm: number;
    /** one-foot trial thickness of this course (mm) */
    trial0: number;
    /** thickness of the course below (mm) */
    tLMm: number;
    /** code minimum shell thickness (mm) */
    minShell: number;
  },
  maxIter = 5,
  tol = 0.01
): { tDesign: number; tTest: number; x: number; converged: boolean } {
  let trial = Math.max(p.trial0, p.minShell);
  let tDesign = trial;
  let tTest = trial;
  let x = 0;
  let converged = false;
  for (let k = 0; k < maxIter; k++) {
    const r = vdpUpperCourseThickness({
      Dm: p.Dm,
      headM: p.headM,
      G: p.G,
      Sd: p.Sd,
      St: p.St,
      ca: p.ca,
      RmMm: p.RmMm,
      tuMm: Math.max(0.5, trial - p.ca),
      tLMm: p.tLMm,
    });
    tDesign = r.td;
    tTest = r.tt;
    x = r.x;
    const next = Math.max(p.minShell, r.td, r.tt);
    if (Math.abs(next - trial) < tol) {
      converged = true;
      break;
    }
    trial = next;
  }
  return { tDesign, tTest, x, converged };
}

/** §5.6.4 applicability of the variable design point method (D2).
 *  L = √(500·D·t) with D in METRES and t (bottom-course shell thickness) in
 *  MILLIMETRES → L in millimetres; API compares L in mm against H in metres
 *  against the threshold 1000/6 (USC form: L in inches / H in feet ≤ 2) —
 *  equivalently L_m/H_m ≤ 1/6. The unit convention is deliberate: do NOT mix
 *  conversions and treat 1000/6 as a plain dimensionless ratio. Above the
 *  limit the standard routes the shell to elastic analysis.
 *  Source: API 650 14th-edition preview §5.6.4 + a public worked calculation. */
export function vdpApplicabilityLH(
  Dm: number,
  tBottomMm: number,
  Hm: number
): { Lmm: number; ratio: number; ok: boolean } {
  const Lmm = Math.sqrt(Math.max(0, 500 * Dm * tBottomMm));
  const ratio = Hm > 0 ? Lmm / Hm : 0;
  return { Lmm, ratio, ok: !(Hm > 0) || ratio <= 1000 / 6 };
}

// ---------------------------------------------------------------------------
// API 650 Table 5-1a (SI) — annular bottom-plate thickness
// ---------------------------------------------------------------------------
/** Columns: stress in the first shell course (MPa). Rows: plate thickness of
 *  the FIRST shell course (mm) — corroded thickness for the product condition,
 *  nominal for the hydrostatic-test condition (table note a). The stress used
 *  is the greater of the product and hydrostatic-test stresses (note b). */
const ANNULAR_T5_1A_COLS = [190, 210, 220, 250];
const ANNULAR_T5_1A_ROW_UB = [19, 25, 32, 40, 45];
const ANNULAR_T5_1A: number[][] = [
  [6, 6, 7, 9],
  [6, 7, 10, 11],
  [6, 9, 12, 14],
  [8, 11, 14, 17],
  [9, 13, 16, 19],
];

/** Required annular plate thickness tb (mm) from Table 5-1a. */
export function annularThicknessFromTable(firstCourseT: number, stressMPa: number): number {
  let row = ANNULAR_T5_1A_ROW_UB.findIndex((ub) => firstCourseT <= ub);
  if (row < 0) row = ANNULAR_T5_1A_ROW_UB.length - 1; // > 45 mm not tabulated — use last band
  let col = ANNULAR_T5_1A_COLS.findIndex((s) => stressMPa <= s);
  if (col < 0) col = ANNULAR_T5_1A_COLS.length - 1; // stress > 250 MPa — use max column
  return ANNULAR_T5_1A[row][col];
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
  // §5.6 sizes the shell on the LIQUID height, so a level above the shell
  // silently over-sizes every course and overstates the volume — data check.
  if (tank.maxDesignLiquidLevel > 0 && tank.maxDesignLiquidLevel > sec.ttLength + 1e-6) {
    warnings.push({
      level: 'warning',
      code: 'T650-07',
      msg: `Design liquid level ${Math.round(tank.maxDesignLiquidLevel)} mm exceeds the shell height ${Math.round(sec.ttLength)} mm — courses and volume are sized on the liquid height; set Max liquid level ≤ the tank T-T length`,
    });
  }
  const ca = Math.max(0, equip.corrosionAllowance);
  const st = API650_STRESSES[equip.materialKey] ?? API650_STRESSES.default;
  const Sd = tank.shellAllowableOverride > 0 ? tank.shellAllowableOverride : st.Sd;
  const St = st.St;
  const minShell = shellMinByDiameter(Dm);

  const useVdp = Dm > 61; // one-foot method limited to D ≤ 61 m (§5.6.3)
  if (useVdp) {
    warnings.push({
      level: 'info',
      code: 'T650-01',
      msg: `Tank Ø${Dm} m > 61 m — one-foot method not permitted; variable design point method applied (API 650 §5.6.4)`,
    });
  }

  // Courses (uniform width from plate catalogue, typically 1500–2000 mm).
  // Course i is counted from the BOTTOM; the design head is the liquid height
  // above that course's bottom (H_i = Hm − i·courseH). Both the one-foot
  // method (point 0.3 m above the course bottom) and the variable-design-point
  // method evaluate at/above that datum. The previous code used the course's
  // top ELEVATION as the head, inverting the courses (thinnest at the bottom).
  const plateW = 2000;
  const nCourses = Math.max(1, Math.ceil(Hmm / plateW));
  const courseH = Hmm / nCourses;
  const courses: TankCalc['shellCourses'] = [];
  let shellKg = 0;
  let tGov = 0;
  const nonConverged: number[] = [];
  // F4 — per-course plate grade: courseGrades[i] (0 = bottom course) overrides
  // the tag material for THAT course's allowable stresses. Unknown grades fall
  // back to the tag material and are reported (T650-15).
  const courseGrades = tank.courseGrades ?? [];
  const unknownGrades = new Set<string>();
  let SdBot = Sd; // bottom-course stresses feed Table 5-1a (annular ring)
  let StBot = St;
  for (let i = 0; i < nCourses; i++) {
    const requested = (courseGrades[i] ?? '').trim();
    const grade = requested || equip.materialKey;
    const gradeSt = API650_STRESSES[grade];
    if (requested && !gradeSt) unknownGrades.add(requested);
    // an unknown grade must not leak into BOM/estimate pricing — fall back to
    // the tag material for BOTH the stress and the reported course material
    const effGrade = gradeSt ? grade : equip.materialKey;
    const cst = gradeSt ?? st;
    const cSd = tank.shellAllowableOverride > 0 ? tank.shellAllowableOverride : cst.Sd;
    const cSt = cst.St;
    if (i === 0) {
      SdBot = cSd;
      StBot = cSt;
    }
    const designHeadM = Math.max(0, Hm - (i * courseH) / 1000);
    let tDesign: number;
    let tTest: number;
    /** where the stress is evaluated above the course bottom (mm):
     *  300 for the one-foot method, x for VDP upper courses, undefined for the
     *  VDP bottom course (its dedicated first-course equation has no point) */
    let designPointMm: number | undefined;
    if (useVdp) {
      if (i === 0) {
        // bottom course: dedicated §5.6.4 first-course equation (no x point)
        const f = vdpFirstCourseThickness(Dm, designHeadM, G, cSd, cSt, ca);
        tDesign = f.td;
        tTest = f.tt;
      } else {
        // upper courses: design point x = min(x1, x2, x3) above the course
        // bottom; iterate because x depends on this course's corroded thickness.
        const trial0 = Math.max(
          (4.9 * Dm * Math.max(0, designHeadM - 0.3) * G) / cSd + ca,
          (4.9 * Dm * Math.max(0, designHeadM - 0.3)) / cSt,
          minShell
        );
        const it = iterateVdpCourse({
          Dm,
          headM: designHeadM,
          G,
          Sd: cSd,
          St: cSt,
          ca,
          RmMm: Dmm / 2,
          trial0,
          tLMm: Math.max(0.5, courses[i - 1].tNominal - ca),
          minShell,
        });
        tDesign = it.tDesign;
        tTest = it.tTest;
        designPointMm = it.x;
        if (!it.converged) nonConverged.push(i);
      }
    } else {
      const hPoint = designHeadM - 0.3; // one-foot method: 0.3 m above course bottom
      tDesign = (4.9 * Dm * Math.max(0, hPoint) * G) / cSd + ca;
      tTest = (4.9 * Dm * Math.max(0, hPoint)) / cSt;
      designPointMm = 300;
    }
    const tMin = Math.max(minShell, tDesign, tTest);
    tGov = Math.max(tGov, tMin);
    courses.push({
      courseNo: nCourses - i, // top course = 1
      heightMm: courseH,
      designHeadM,
      designPointMm,
      tDesign,
      tTest,
      tMinCode: minShell,
      tNominal: tMin,
      material: effGrade,
    });
    shellKg += Math.PI * Dm * (courseH / 1000) * (tMin / 1000) * 7850;
  }
  if (unknownGrades.size > 0) {
    warnings.push({
      level: 'warning',
      code: 'T650-15',
      msg: `Shell course grade(s) ${[...unknownGrades].join(', ')} are not in the API 650 Table 5.2 stress table — those courses were sized with the tag material ${equip.materialKey}; pick one of the listed grades on the Tank data tab`,
    });
  }
  if (nonConverged.length > 0) {
    warnings.push({
      level: 'warning',
      code: 'T650-11',
      msg: `VDP design-point iteration did not converge in 5 passes for course(s) ${nonConverged
        .map((i) => nCourses - i)
        .join(', ')} (numbering from top) — thicknesses taken from the last iterate; verify`,
    });
  }
  // §5.6.4 applicability (D2): above L/H = 1000/6 the standard routes the shell
  // to elastic analysis, not the variable design point method.
  if (useVdp) {
    const lh = vdpApplicabilityLH(Dm, courses[0].tNominal, Hm);
    if (!lh.ok) {
      warnings.push({
        level: 'warning',
        code: 'T650-14',
        msg: `L/H = ${lh.ratio.toFixed(1)} exceeds the API 650 §5.6.4 applicability limit of 1000/6 (L = √(500·D·t) = ${lh.Lmm.toFixed(0)} mm from the ${courses[0].tNominal.toFixed(1)} mm bottom course, H = ${Hm} m) — beyond this ratio the shell must be designed by elastic analysis, not the VDP method`,
      });
    }
  }

  const bottomThkSel = Math.max(6, tank.bottomThk || 6);
  // §5.5.1 — ALL bottom plates need 6 mm CORRODED, i.e. 6 + CA nominal. The old
  // code floored the nominal thickness at 6 mm regardless of corrosion allowance.
  const bottomThkMin = 6 + ca;
  const bottomThk = Math.max(bottomThkSel, bottomThkMin);
  if (!tank.annularBottom && bottomThkSel < bottomThkMin - 1e-9) {
    warnings.push({
      level: 'warning',
      code: 'T650-10',
      msg: `Bottom plate ${bottomThkSel} mm < required ${bottomThkMin} mm (6 mm corroded + ${ca} mm CA, API 650 §5.5.1) — auto-sized to ${bottomThk} mm`,
    });
  }
  // Annular bottom plates — Table 5-1a (SI): keyed on the first-course plate
  // thickness and the maximum stress in that course (greater of product and
  // hydrostatic-test per table note b), floored at 6 mm and plus corrosion
  // allowance. 600 mm minimum annular width from the shell (§5.5.3) advised.
  let annularThk = bottomThk;
  // §5.5.3 — annular ring width measured from the shell (tank field, 600 mm minimum)
  const annularRingWidthMm = tank.annularRingWidthMm && tank.annularRingWidthMm > 0 ? tank.annularRingWidthMm : 600;
  const annularRingW = annularRingWidthMm / 1000; // m
  if (tank.annularBottom && courses.length > 0) {
    const c1 = courses[0]; // bottom course
    const t1Corr = Math.max(0.1, c1.tNominal - ca);
    const sProd = (Math.max(0, c1.tDesign - ca) / t1Corr) * SdBot;
    const sHyd = (c1.tTest / Math.max(0.1, c1.tNominal)) * StBot;
    const tbTable = Math.max(
      6,
      annularThicknessFromTable(t1Corr, sProd),
      annularThicknessFromTable(c1.tNominal, sHyd)
    );
    const tb = tbTable + ca;
    if (bottomThkSel < tb - 1e-9) {
      warnings.push({
        level: 'warning',
        code: 'T650-08',
        msg: `Annular plate ${bottomThkSel} mm < required ${tb.toFixed(1)} mm — Table 5-1a (t₁ corr. ${t1Corr.toFixed(1)} mm, σ = ${Math.max(sProd, sHyd).toFixed(0)} MPa → ${tbTable} mm) + ${ca} mm CA`,
      });
    }
    if (annularRingWidthMm < 600 - 1e-9) {
      warnings.push({
        level: 'warning',
        code: 'T650-12',
        msg: `Annular ring width ${annularRingWidthMm} mm < the 600 mm minimum from the shell (API 650 §5.5.3) — widen the ring or disable the annular bottom plate`,
      });
    } else {
      warnings.push({
        level: 'info',
        code: 'T650-09',
        msg: `Annular plate — keep the ${annularRingWidthMm} mm ring ≥ 600 mm clear of the shell before the first lap joint in the bottom (API 650 §5.5.3)`,
      });
    }
    annularThk = Math.max(bottomThk, tb);
  }
  const roofThk = Math.max(5, tank.roofThk || 5);
  const bottomArea = (Math.PI / 4) * Dm * Dm;
  // Bottom plates: field area at the (inner) bottom thickness, plus the annular
  // RING — its width is a tank field (default 600 mm, the §5.5.3 minimum) — at
  // its own Table 5-1a thickness. The old code charged the whole floor at
  // bottomThk with an unverified ×1.02 fudge.
  const ringArea = tank.annularBottom && Dm > 2 * annularRingW
    ? (Math.PI / 4) * (Dm * Dm - Math.pow(Dm - 2 * annularRingW, 2))
    : 0;
  const bottomWeight =
    bottomArea * (bottomThk / 1000) * 7850 +
    ringArea * (Math.max(0, annularThk - bottomThk) / 1000) * 7850;
  const roofSlope = coneRoofAreaFactor(roofSlopeRun(tank)); // slant × lap, from the entered 1:N slope
  const roofDeckArea = (Math.PI / 4) * Math.pow(Dm * 1.02, 2); // m²
  const primarySeal = tank.primarySeal ?? 'shoe';
  const secondarySeal = tank.secondarySeal ?? 'metal';
  const seals = sealMassKg(Dm, tank);
  const sealKg = seals.primary + seals.secondary;
  const roofWeight =
    tank.roofType === 'cone'
      ? roofDeckArea * roofSlope * (roofThk / 1000) * 7850
      : tank.roofType === 'dome'
      ? roofDeckArea * DOME_ROOF_DECK * (roofThk / 1000) * 7850
      : tank.roofType === 'externalFloating'
      ? // steel deck plates + pontoon buoyancy ring (≈12 % extra steel) + seal assembly mass
        roofDeckArea * (roofThk / 1000) * 7850 * EXTERNAL_ROOF_PONTOON + sealKg
      : // internal floating roof: pan/deck + supporting legs + primary seal
        roofDeckArea * (roofThk / 1000) * 7850 * INTERNAL_ROOF_DECK + sealKg;

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
  const windGirderRequired = windGirderStressMPa > shellAllowComp || Hm > 12 || tank.stiffenerRings === true;
  if (tank.stiffenerRings) {
    warnings.push({
      level: 'info',
      code: 'T650-13',
      msg: 'Stiffening rings / wind girders declared on the tag — the girder is treated as provided and carried in the structural scope (API 650 §5.8.7)',
    });
  }
  if (windGirderRequired && !tank.stiffenerRings) {
    warnings.push({
      level: 'info',
      code: 'T650-02',
      msg: `Top/intermediate wind girder recommended (shell compressive stress ${windGirderStressMPa.toFixed(1)} MPa vs allowable ${shellAllowComp.toFixed(1)} MPa, H = ${Hm.toFixed(1)} m)`,
    });
  }  const volume = (Math.PI / 4) * Dm * Dm * Hm;

  // F4 — hydrotest medium density is an editable tank field (default 997 kg/m³,
  // water at ~25 °C); it feeds the test-water mass, the hydrostatic test
  // pressure head and the operating weight.
  const rhoHydro = tank.hydroTestDensity && tank.hydroTestDensity > 0 ? tank.hydroTestDensity : 997;
  const hydroWater = volume * rhoHydro;
  const testPressureBar = (Hm * rhoHydro * 9.81) / 1e5;

  const weightDry = shellKg + bottomWeight + roofWeight + base.weightDryKg * 0.15; // + nozzles/attachments
  const weightOperatingKg = weightDry + volume * rhoHydro * 0.9;

  // Anchor bolts — the same elastic bolt-group engine as vessels/columns (wind OR
  // seismic, separate cases not combined), API 650 §5.11 basis, ≤ 600 mm spacing.
  // The previous block compared a raw required area against a magic constant and
  // ignored seismic entirely.
  const DbcMm = (Dm + 0.6) * 1000; // bolt circle, mm
  const tankBolts = sizeAnchorBolts(
    {
      boltCircleMm: DbcMm,
      windHeightM: Hm,
      windWidthM: Dm,
      windKpa: windP,
      weightOperatingKg,
      sds: equip.designLoads?.sds ?? 0,
      seismicR: equip.designLoads?.seismicR || 3,
      seismicIe: equip.designLoads?.seismicIe || 1,
      boltCount: Math.max(8, Math.ceil((Math.PI * DbcMm) / 600)), // ≤ 600 mm target spacing
      basis: 'API 650 §5.11',
    },
    warnings
  );
  const anchorBoltAreaMm2 = tankBolts.reqArea;
  if (anchorBoltAreaMm2 > 8 * ((Math.PI * 36 * 36) / 4)) {
    // required area beyond 8 × M36 — chair the group (§5.11)
    warnings.push({
      level: 'info',
      code: 'T650-03',
      msg: `Anchor bolt group requires ${anchorBoltAreaMm2.toFixed(0)} mm² (≥ 8 × M36) — consider chairs per API 650 §5.11`,
    });
  }

  const tankCalc: TankCalc = {
    shellCourses: courses,
    shellMethod: useVdp ? 'vdp' : 'oneFoot',
    bottomThk,
    annularThk,
    annularRingWidthMm,
    roofThk,
    roofSlopeRun: roofSlopeRun(tank),
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

  return {
    ...base,
    bolts: tankBolts,
    codeRef: `API 650 (12th/13th ed.): §5.6 ${useVdp ? 'variable design point (§5.6.4)' : 'one-foot'} shell method, §5.5.3 annular plates, §5.7 openings, §5.8 wind girder, §5.10 roofs, §5.11 anchors`,
    sections: base.sections,
    tank: tankCalc,
    weightDryKg: weightDry,
    weightHydroKg: weightDry + hydroWater,
    weightOperatingKg,
    internalVolumeM3: volume,
    paintAreaM2: Math.PI * Dm * Hm + (Math.PI / 4) * Dm * Dm * 1.02,
    hydroTestBar: testPressureBar,
    hydroTestBottomBar: testPressureBar,
    mawpBar: 0,
    mawpNote: `API 650 tank — fixed roof at ${equip.designPressure.toFixed(2)} bar g; shell designed by ${useVdp ? 'variable-design-point' : 'one-foot'} method, S_d = ${Sd} MPa`,
    membraneUtil: Math.min(
      1,
      courses.reduce((m, c) => Math.max(m, Math.max(c.tDesign, c.tTest) / Math.max(1e-6, c.tNominal)), 0)
    ),
    materialName: base.materialName,
    sAllow: Sd,
    warnings,
  };
}

/**
 * Cone-roof deck constants.
 * ROOF_DECK_LAP — empirical allowance for roof-plate laps, seams and cut-outs
 * (retained from the original model; documented per review point C2).
 * DOME_ROOF_DECK / EXTERNAL_ROOF_PONTOON / INTERNAL_ROOF_DECK — empirical
 * steel allowances for the other roof forms, also retained from the original
 * model and now named so they are visible instead of magic numbers.
 */
const ROOF_DECK_LAP = 1.05;
const DOME_ROOF_DECK = 0.6;
const EXTERNAL_ROOF_PONTOON = 1.12;
const INTERNAL_ROOF_DECK = 0.85;

/**
 * Run N of the cone-roof plate slope (rise 1 : N). API 650 uses 1:16 as the
 * standard slope; 1:20 is the shallow structurally-supported alternative, and
 * 'custom' lets any run be entered. Old projects without the field default to
 * 1:16 (the value closest to the previous fixed factor).
 */
export function roofSlopeRun(tank: TankSpec): number {
  const sel = tank.roofSlope ?? '1:16';
  if (sel === 'custom') return Math.max(4, tank.roofSlopeCustom && tank.roofSlopeCustom > 0 ? tank.roofSlopeCustom : 16);
  return sel === '1:20' ? 20 : 16;
}

/**
 * Deck area factor for a cone roof of slope 1:N: the slant (developed) length
 * over the plan radius, √(1 + (1/N)²), times the lap/seam allowance.
 * 1:16 → 1.0521, 1:20 → 1.0513 (the old fixed 1.055 matched neither).
 */
export function coneRoofAreaFactor(runN: number, lap = ROOF_DECK_LAP): number {
  const n = Math.max(4, runN);
  return Math.sqrt(1 + 1 / (n * n)) * lap;
}

/** Quick API 650 check against ASME allowable usage (materials page helper) */
export function api650StressFor(matKey: string): Api650Stress {
  return API650_STRESSES[matKey] ?? API650_STRESSES.default;
}

/** ASME comparison helper (materials page): show both S values for a temperature */
export function compareAllowables(matKey: string, tC: number): { asme: number; api650: number } {
  return { asme: allowableAt(matKey, tC), api650: api650StressFor(matKey).Sd };
}
