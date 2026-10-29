// Concrete "correct value" suggestions for the click-to-fix notes.
//
// For every warning code whose registry entry targets an editable field, this
// computes the value the field SHOULD carry from the live calculation — so the
// FixNote below an erroring input shows a number to enter, not just prose.
// Pure (equip + calc in → string out); unit-tested in fixValues.test.ts.

import type { Equipment, EquipmentCalc } from './engine/types';
import { MATERIALS, getMat } from './engine/materials';
import { flangeGroupForMat, minFlangeClass } from './engine/flange';

export interface CorrectValue {
  /** the value to type, e.g. "≥ 16.5 mm" or "Class 300" */
  value: string;
  /** where the number comes from */
  basis: string;
}

/** round UP to the next 0.5 mm — plate is ordered in sensible increments */
const halfUp = (v: number) => Math.ceil(v * 2) / 2;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Correct value for a warning code, derived from the live calculation.
 * Returns undefined for codes with no single computable value.
 */
export function suggestedValue(
  code: string,
  equip: Equipment,
  calc: EquipmentCalc
): CorrectValue | undefined {
  const sec0 = calc.sections[0];
  switch (code) {
    // ---- ASME VIII-1 shell / heads / cone ----
    case 'SH-01': {
      if (!sec0) return;
      return {
        value: `≥ ${halfUp(sec0.tMinNominal)} mm`,
        basis: `min nominal ${r2(sec0.tMinNominal)} mm = t req ${r2(sec0.tReq)} + CA ${equip.corrosionAllowance}`,
      };
    }
    case 'SH-02': {
      if (!sec0) return;
      const maxCa = Math.max(0, sec0.tNominal - sec0.tReq);
      return {
        value: `CA ≤ ${r1(maxCa)} mm`,
        basis: `corroded wall must stay ≥ t req ${r2(sec0.tReq)} mm at Spec t ${sec0.tNominal} mm`,
      };
    }
    case 'HD-01': {
      const h = sec0?.headTop;
      if (!h) return;
      return {
        value: `≥ ${halfUp(h.tMinNominal)} mm`,
        basis: `head min nominal ${r2(h.tMinNominal)} mm = t req ${r2(h.tReq)} + CA ${equip.corrosionAllowance}`,
      };
    }
    case 'CN-01': {
      const c = sec0?.cone;
      if (!c) return;
      return {
        value: `≥ ${halfUp(c.tMinNominal)} mm`,
        basis: `cone min nominal ${r2(c.tMinNominal)} mm (UG-32(g) incl. transition moment)`,
      };
    }
    case 'CN-02':
      return { value: '≤ 30°', basis: 'UG-32(g): a knuckle/multi-cone transition is needed above 30°' };

    // ---- design conditions ----
    case 'MW-01':
      return {
        value: `≤ ${calc.mawpBar.toFixed(2)} bar g`,
        basis: `current MAWP of this tag is ${calc.mawpBar.toFixed(2)} bar g`,
      };
    case 'EX-01': {
      const p = sec0?.external?.pAllowBar;
      if (p === undefined) return;
      return { value: `≤ ${r2(p)} bar`, basis: `UG-28 allowable at this D/t is ${r2(p)} bar` };
    }
    case 'MT-01': {
      const cur = getMat(equip.materialKey);
      const alt =
        MATERIALS.find((m) => m.key !== cur.key && m.form === cur.form && m.group === cur.group && m.maxTemp >= equip.designTemp) ??
        MATERIALS.find((m) => m.key !== cur.key && m.maxTemp >= equip.designTemp);
      return {
        value: `≤ ${cur.maxTemp} °C${alt ? ` (or ${alt.key}, ≥ ${alt.maxTemp} °C)` : ''}`,
        basis: `design ${equip.designTemp} °C vs grade limit of ${cur.name}`,
      };
    }

    // ---- nozzles / flanges ----
    case 'NZ-01': {
      const n = calc.nozzles[0];
      if (!n) return;
      const wallReq = Math.max(n.trn, n.ug45min);
      return {
        value: `≥ ${halfUp(wallReq)} mm wall`,
        basis: `heavier neck schedule — pressure ${r2(n.trn)} vs UG-45 ${r2(n.ug45min)} mm`,
      };
    }
    case 'NZ-02': {
      const n = calc.nozzles[0];
      if (!n) return;
      // pad thickness is derived by the engine; the only input left to change is the OD
      if (n.padDiaUsed <= 0) {
        return {
          value: `Pad Ø ${n.padDiaSuggested} mm`,
          basis: `${r1(n.shortfall)} mm² short with no pad — the ${n.padDiaSuggested} mm ring closes it with an auto pad thickness`,
        };
      }
      return {
        value: `Pad t ≥ ${halfUp(n.padThkAuto)} mm`,
        basis: `at Ø${n.padDiaUsed} the pad needs ${r1(n.padThkAuto)} mm (currently ${r1(n.padThkUsed)} mm); ${r1(n.shortfall)} mm² short`,
      };
    }
    case 'CL-05': {
      const ov = calc.clad?.overlay;
      if (!ov) return;
      return {
        value: 'Furnace heating: 1 cycle',
        basis: `${ov.totalThkMm} mm build-up (${ov.baseThkMm} mm 309L base + ${ov.finishThkMm} mm finish) — ${ov.basis}`,
      };
    }
    case 'CL-02':
      return {
        value: `covered length ≥ 1 mm (e.g. ${Math.round((equip.sections[0]?.ttLength ?? 0) / 2)} mm)`,
        basis: 'partial coverage needs a length measured up from the bottom tangent',
      };
    case 'CL-04': {
      const ov = calc.clad?.overlay;
      return {
        value: '≥ 2 mm total',
        basis: ov ? `base ${ov.baseThkMm} + finish ${ov.finishThkMm} mm` : 'typical clad barrier minimum',
      };
    }
    case 'NZ-03': {
      const tt = equip.sections[0]?.ttLength ?? 0;
      return { value: `0 – ${tt} mm`, basis: 'elevation measured above the bottom tangent, inside the shell' };
    }
    case 'FL-01': {
      const n = calc.nozzles[0];
      if (!n) return;
      const group = flangeGroupForMat(n.spec.flangeMatKey);
      const need = equip.designPressure + (n.load?.equivPressureBar ?? 0);
      const cls = minFlangeClass(group, equip.designTemp, need);
      return cls
        ? { value: `Class ${cls}`, basis: `B16.5 group ${group} rates ≥ ${r2(need)} bar at ${equip.designTemp} °C` }
        : { value: 'no class suffices', basis: `group ${group} tops out below ${r2(need)} bar at ${equip.designTemp} °C` };
    }
    case 'FL-02': {
      const n = calc.nozzles[0];
      if (!n) return;
      const group = flangeGroupForMat(n.spec.flangeMatKey);
      const need = equip.designPressure + (n.load?.equivPressureBar ?? 0);
      const suggested = minFlangeClass(group, equip.designTemp, need);
      return suggested && suggested < n.spec.flangeClass
        ? { value: `Class ${suggested}`, basis: `still rates ${r2(need)} bar at ${equip.designTemp} °C — one class down` }
        : { value: `Class ${n.spec.flangeClass} (keep)`, basis: 'no lower class covers the design pressure' };
    }

    // ---- tank ----
    case 'T650-07':
      return {
        value: `≤ ${equip.sections[0]?.ttLength ?? 0} mm (0 = TT)`,
        basis: 'courses and volume are sized on the liquid height',
      };
    case 'T650-08':
      return calc.tank
        ? { value: `≥ ${r1(calc.tank.annularThk)} mm`, basis: `Table 5-1a ring ${r1(calc.tank.annularThk)} mm incl. CA` }
        : undefined;
    case 'T650-10':
      return calc.tank
        ? { value: `≥ ${r1(calc.tank.bottomThk)} mm`, basis: `6 mm corroded + ${equip.corrosionAllowance} mm CA (§5.5.1)` }
        : undefined;
    case 'T650-12':
      return { value: '≥ 600 mm', basis: 'API 650 §5.5.3 minimum annular ring width from the shell' };

    // ---- supports ----
    case 'AB-01': {
      const b = calc.bolts;
      if (!b || b.areaEach <= 0) return;
      const need = Math.ceil(b.reqArea / b.areaEach);
      return {
        value: `≥ ${b.reqArea.toFixed(0)} mm² total (≈ ${need} × ${b.areaEach.toFixed(0)} mm²)`,
        basis: `currently ${b.totalArea.toFixed(0)} mm² over ${b.count} bolts`,
      };
    }

    // ---- TEMA exchanger ----
    case 'HX-02': {
      const h = calc.hx;
      if (!h || h.providedArea <= 0) return;
      const need = Math.ceil((h.tubeCountActual * h.requiredArea) / h.providedArea);
      return {
        value: `≥ ${need} tubes`,
        basis: `required ${r1(h.requiredArea)} m² vs provided ${r1(h.providedArea)} m² — scale the count`,
      };
    }
    case 'HX-08': {
      const h = calc.hx;
      if (!h) return;
      return {
        value: `≥ ${r1(h.tubeSheetThk / 2)} mm`,
        basis: `tubesheet cladding ≥ 50% of ${r1(h.tubeSheetThk)} mm (TEMA/UF-4)`,
      };
    }
    case 'HX-17': {
      const h = calc.hx;
      const od = equip.hx?.tubeOD ?? 0;
      if (!h || od <= 0) return;
      return {
        value: `${r1(1.25 * od)} – ${r1(1.5 * od)} mm`,
        basis: `pitch/OD inside the ESDU 73031 band (1.25–1.5 × Ø${od})`,
      };
    }

    // ---- fin-fan ----
    case 'AF-02':
      return { value: '6 – 9 rows', basis: 'common API 661 practice per bank' };
    case 'AF-05': {
      const f = calc.finfan;
      if (!f) return;
      const auto = Math.sqrt((0.4 * f.faceAreaM2 * 4) / Math.PI) * 1000; // ≥ 40% coverage
      return {
        value: `≥ ${auto.toFixed(0)} mm (or 0 = auto)`,
        basis: `fan plan area must cover 40% of the ${r1(f.faceAreaM2)} m² bay face`,
      };
    }

    default:
      return undefined;
  }
}
