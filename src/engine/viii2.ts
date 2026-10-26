// ASME VIII-2 Part 5 — limited "design by analysis" (design margin) screen.
//
// Scope and honesty notes (read before changing numbers):
//  * Only rules that are PLAINLY SOURCED from readable material are used:
//      - VIII-2 allowable basis    S = min(Su/2.4, Sy/1.5)   (2007+ basis,
//        publicly summarised in the Farr & Jawad guidebook and vendor summaries)
//      - primary acceptance limits Pm ≤ S, PL ≤ 1.5S, PL+Pb ≤ 1.5S (Becht,
//        O'Donnell Consulting — secondary but explicit, publicly readable)
//      - stress-category definitions Pm/PL/Pb/Q/F with through-thickness
//        linearisation (O'Donnell, NAFEMS)
//  * NOT implemented, because the exact edition text is licensed and the
//    public summaries disagree (paragraph numbers shift between editions, and
//    2023 revised the fatigue screening article/table):
//      - the full Table 5.3/5.4 acceptance table (S_PS, S_a, Su/3 rules)
//      - local-membrane classification distance rules (Pm vs PL by geometry)
//      - the current Part 5 fatigue screening criteria (pressure / mechanical
//        stress range / thermal gradient inequalities)
//    Those are reported as not performed (DBA-03), not guessed.
//  * Su is NOT stored in the materials database (ASME II-D Table 1A is
//    licensed). It is inferred from the VIII-1 basis, Su = 3.5·S(38 °C), which
//    is exact for VIII-1 materials governed by the Su/3.5 rule. Where the
//    yield term would be affected, the min() in the VIII-2 basis protects the
//    result: an under-estimated Su only matters if Su/2.4 governs, and the
//    comparison is stated in the basis text.
//  * Part 5 does not license re-using the VIII-1 design-by-rule thickness as
//    the analysis; this module checks a TRIAL geometry — it reports whether
//    the as-modelled corroded shell meets the Part 5 primary limits. It never
//    replaces the UG-27 check, which still governs the ordered thickness.

import type { Equipment, SectionCalc } from './types';
import { allowableAt, getMat } from './materials';
import type { Warning } from './types';

export interface SectionMargin {
  sectionId: string;
  /** inside radius at the corroded geometry, mm */
  rInsideMm: number;
  /** corroded thickness, mm */
  tMm: number;
  /** hoop membrane stress, MPa */
  hoopMPa: number;
  /** longitudinal membrane stress (closed end), MPa */
  longMPa: number;
  /** von Mises equivalent of the membrane stress — the Pm candidate */
  pmMPa: number;
  /** Pm / S */
  util: number;
  ok: boolean;
}

export interface DesignMarginCalc {
  /** VIII-1 allowable at design temperature (for the comparison note) */
  sViii1: number;
  /** VIII-2 allowable basis at design temperature */
  sViii2: number;
  /** 1.5 × S (the PL and PL+Pb limit) */
  plAllow: number;
  /** inferred tensile strength used, MPa */
  suUsed: number;
  sections: SectionMargin[];
  ok: boolean;
  basis: string;
}

/**
 * VIII-2 allowable basis: lower of Su/2.4 and 2/3·Sy.
 * `sViii1At38C` is the VIII-1 allowable at 38 °C (Su/3.5 for VIII-1 materials).
 */
export function viii2AllowableFromBasis(sViii1At38C: number, syMpa: number): { s: number; suUsed: number } {
  const su = 3.5 * sViii1At38C;
  const s = Math.min(su / 2.4, (2 / 3) * syMpa);
  return { s, suUsed: su };
}

/** VIII-2 allowable for a material at design temperature (indicative basis). */
export function viii2Allowable(key: string, tC: number): { s: number; suUsed: number } {
  const m = getMat(key);
  const sAt38 = allowableAt(key, 38);
  void tC;
  // Temperature derating follows the VIII-1 curve shape (the VIII-2 table is
  // licensed); the yield term is taken as the specified minimum yield.
  const base = viii2AllowableFromBasis(sAt38, m.sy);
  const v1 = allowableAt(key, tC);
  const s1 = allowableAt(key, 38);
  const derate = s1 > 0 ? v1 / s1 : 1;
  return { s: Math.min(base.s, base.s * derate), suUsed: base.suUsed };
}

/**
 * Primary membrane stress in a cylindrical shell at the corroded geometry,
 * thin-wall form on the inside radius (the UG-27 geometry convention):
 *   σ_h = P·R/t,  σ_l = P·R/(2t),  von Mises = √(σh² + σl² − σh·σl)
 */
export function primaryStress(pMpa: number, rInsideMm: number, tMm: number): {
  hoopMPa: number;
  longMPa: number;
  pmMPa: number;
} {
  if (!(pMpa > 0) || !(rInsideMm > 0) || !(tMm > 0)) return { hoopMPa: 0, longMPa: 0, pmMPa: 0 };
  const hoop = (pMpa * rInsideMm) / tMm;
  const long = hoop / 2;
  const vm = Math.sqrt(hoop * hoop + long * long - hoop * long);
  return { hoopMPa: hoop, longMPa: long, pmMPa: vm };
}

const BASIS_TEXT =
  'ASME VIII-2 Part 5 (elastic stress analysis) preliminary screen: equivalent-stress Pm ≤ S with S = min(Su/2.4, Sy/1.5); PL ≤ 1.5·S and PL+Pb ≤ 1.5·S are stated as the framework limits. NOT performed here: the full Table 5.3/5.4 acceptance set (S_PS / S_a / Su/3 rules), local-membrane classification by distance, secondary (Q) and peak (F) stresses, and the Part 5 fatigue screening criteria — those need stress linearisation from FEA and the licensed edition text. Verify against the licensed VIII-2 edition before claiming design-by-analysis compliance.';

/** Build the design-margin block for a vessel under internal pressure. */
export function designMargin(equip: Equipment, sections: SectionCalc[]): DesignMarginCalc | null {
  if (!equip.designByAnalysis) return null;
  const pMpa = Math.max(0, equip.designPressure) / 10;
  if (!(pMpa > 0) || !sections.length) return null;

  const { s, suUsed } = viii2Allowable(equip.materialKey, equip.designTemp);
  const sViii1 = allowableAt(equip.materialKey, equip.designTemp);

  const margins: SectionMargin[] = sections
    .filter((sec) => !sec.cone)
    .map((sec) => {
      const r = sec.Rc;
      const t = Math.max(1e-6, sec.tCorroded);
      const { pmMPa } = primaryStress(pMpa, r, t);
      const util = s > 0 ? pmMPa / s : 0;
      return {
        sectionId: sec.spec.id,
        rInsideMm: r,
        tMm: t,
        hoopMPa: (pMpa * r) / t,
        longMPa: (pMpa * r) / (2 * t),
        pmMPa,
        util,
        ok: pmMPa <= s,
      };
    });

  if (!margins.length) return null;
  return {
    sViii1,
    sViii2: s,
    plAllow: 1.5 * s,
    suUsed,
    sections: margins,
    ok: margins.every((x) => x.ok),
    basis: BASIS_TEXT,
  };
}

/** Warnings raised by the design-by-analysis screen. */
export function designMarginWarnings(dm: DesignMarginCalc | null): Warning[] {
  if (!dm) return [];
  const w: Warning[] = [];
  const failed = dm.sections.filter((x) => !x.ok);
  if (failed.length) {
    w.push({
      level: 'error',
      code: 'DBA-01',
      msg: `Part 5 primary stress over allowable: Pm = ${Math.max(...failed.map((f) => f.pmMPa)).toFixed(1)} MPa > S = ${dm.sViii2.toFixed(1)} MPa (VIII-2 basis) — increase thickness or reduce pressure`,
    });
  }
  w.push({
    level: 'info',
    code: 'DBA-02',
    msg: `VIII-2 design-by-analysis screen active: S = ${dm.sViii2.toFixed(1)} MPa (min of Su/2.4 = ${(dm.suUsed / 2.4).toFixed(1)} and 2·Sy/3) vs VIII-1 S = ${dm.sViii1.toFixed(1)} MPa; PL/PL+Pb limit 1.5·S = ${dm.plAllow.toFixed(1)} MPa. Local, secondary and peak stresses and the fatigue screening are NOT evaluated here (FEA linearisation + licensed text required)`,
  });
  w.push({
    level: 'info',
    code: 'DBA-03',
    msg: 'Part 5 fatigue screening not performed — the current edition criteria (pressure cycles, mechanical stress range, thermal gradient) are licensed text; a cycle-count assessment is required before service with frequent cycles',
  });
  return w;
}
