// Engineering checks for the access and structural steelwork.
//
// structure3d answers "what is there" (the descriptors the viewer draws); this
// module answers "is it adequate" — the questions a fabricator/engineer asks
// before the drawing is released: does every ladder land on a deck instead of
// passing through it, is the unbroken climb within the rest-platform limit, does
// the grating support its beam span under the design live load, is the stair
// pitch buildable, is a walkway wide enough to walk?
//
// All checks are PRELIMINARY and clearly indicative: live load 4.5 kN/m² plus a
// 1.5 kN concentrated load (usual industrial platform practice, OSHA 1910.28 /
// BS EN ISO 14122-2), steel allowable 165 MPa (S275 at ambient), E = 210 GPa,
// deflection limit L/200. They size nothing for a stamped design — they catch the
// errors that would otherwise reach the shop drawing.

import type { Equipment, EquipmentCalc, Warning } from './types';
import { accessModel, ACCESS, type AccessModel, type AccessPlatform } from './structure3d';

export const ACCESS_LOAD = {
  /** distributed live load on a platform / walkway deck (kN/m²) */
  liveKnM2: 4.5,
  /** concentrated load at any point of the deck (kN) */
  pointKn: 1.5,
  /** allowable bending stress for S275 plate/section at ambient (MPa) */
  steelAllowMPa: 165,
  /** elastic modulus (MPa) */
  steelEMPa: 210000,
  /** deflection limit, span / n */
  deflectionSpanDiv: 200,
  /** beam assumed under the deck edge: HEA 140 (S = 155 cm³, I = 1030 cm⁴) */
  beamSmm3: 155e3,
  beamImm4: 1030e4,
  beamKgM: 24.7,
  /** OSHA 1910.23: unbroken climb before a rest platform (mm) */
  maxUnbrokenClimbMm: 9000,
  /** clear walkway width (mm) */
  minWalkWidthMm: 600,
  /** buildable stair pitch (deg) */
  stairMinDeg: 30,
  stairMaxDeg: 38,
  /** standard stair rise per tread (mm) */
  treadRiseMm: 175,
  treadGoingMm: 250,
} as const;

export interface AccessCheckRow {
  label: string;
  value: string;
  note?: string;
  tone?: 'ok' | 'warn' | 'err';
}

export interface AccessCheckResult {
  warnings: Warning[];
  rows: AccessCheckRow[];
  /** indicative mass of the access steel (kg) */
  totalKg: number;
  platforms: number;
  ladders: number;
  stairs: number;
  /** longest single ladder run (mm) — the climb limit applies to this */
  maxRunMm: number;
  /** worst platform beam utilisation (required / available section modulus) */
  beamUtil: number;
  ok: boolean;
}

/**
 * Section check for one deck: the deck is carried on two edge beams, each taking
 * half the width of live load. Returns the required section modulus, the
 * deflection and the governing utilisation.
 */
export function deckBeam(spanMm: number, widthMm: number) {
  const L = Math.max(1, spanMm); // mm
  // half the deck width is carried by each edge beam; kN/m² × m of width = kN/m
  const wLine = (ACCESS_LOAD.liveKnM2 * Math.max(0, widthMm)) / 2 / 1000; // kN/m per beam
  const M = (wLine * (L / 1000) * (L / 1000)) / 8; // kN·m
  const Mpoint = (ACCESS_LOAD.pointKn * (L / 1000)) / 4; // kN·m, point load at mid-span
  const Mgov = Math.max(M, Mpoint);
  const sReq = (Mgov * 1e6) / ACCESS_LOAD.steelAllowMPa; // mm³
  const wNmm = wLine; // kN/m ≡ N/mm
  const defl = (5 * wNmm * Math.pow(L, 4)) / (384 * ACCESS_LOAD.steelEMPa * ACCESS_LOAD.beamImm4); // mm
  const deflAllow = L / ACCESS_LOAD.deflectionSpanDiv;
  return {
    spanMm: L,
    momentKNm: Mgov,
    sReqMm3: sReq,
    sAvailMm3: ACCESS_LOAD.beamSmm3,
    util: sReq / ACCESS_LOAD.beamSmm3,
    deflectionMm: defl,
    deflectionAllowMm: deflAllow,
    deflectionOK: defl <= deflAllow,
    // keep the intermediate value available for the panel
    lineLoadKNm: wLine,
  };
}

const round = (v: number) => Math.round(v);

/** Span of a deck between its supports, and the loaded width carried per beam. */
function deckSpan(p: AccessPlatform): { spanMm: number; widthMm: number; label: string } {
  if (p.kind === 'ring') {
    const width = Math.abs(p.r1 - p.r0);
    const arc = (Math.abs(p.sweepDeg) * Math.PI * p.r1) / 180;
    return { spanMm: Math.max(width, arc / 2), widthMm: width, label: `ring deck Ø${round(p.r0 * 2)}–${round(p.r1 * 2)}` };
  }
  const span = Math.max(p.hx, p.hz) * 2;
  const width = Math.min(p.hx, p.hz) * 2;
  return { spanMm: span, widthMm: width, label: `rect deck ${round(p.hx * 2)} × ${round(p.hz * 2)}` };
}

/**
 * Run every access check over a tag's access model.
 */
export function accessCheck(equip: Equipment, calc: EquipmentCalc): AccessCheckResult {
  return checkAccessModel(accessModel(equip, calc));
}

/** The checks themselves — pure over the descriptor model, so they can be tested. */
export function checkAccessModel(model: AccessModel): AccessCheckResult {
  const warnings: Warning[] = [];
  const rows: AccessCheckRow[] = [];

  // ---- decks must be entered from the ladder, not crossed by it -------------
  const levelYs = new Set(model.platforms.map((p) => Math.round(p.y)));
  for (const l of model.ladders) {
    for (const y of levelYs) {
      if (y > l.y0 + 100 && y < l.y1 - 100) {
        warnings.push({
          level: 'warning',
          code: 'AC-01',
          msg: `Ladder "${l.label}" runs from ${round(l.y0)} to ${round(l.y1)} mm and passes through the platform at ${y} mm — break it into one run per platform level with a rail opening`,
        });
        break;
      }
    }
  }

  // ---- unbroken climb --------------------------------------------------------
  const maxRun = model.ladders.reduce((m, l) => Math.max(m, l.y1 - l.y0), 0);
  for (const l of model.ladders) {
    const run = l.y1 - l.y0;
    if (run > ACCESS_LOAD.maxUnbrokenClimbMm) {
      warnings.push({
        level: 'warning',
        code: 'AC-02',
        msg: `Ladder "${l.label}" is an unbroken ${round(run)} mm climb — OSHA 1910.23 caps this at ${ACCESS_LOAD.maxUnbrokenClimbMm} mm; add an intermediate platform or a stair`,
      });
    }
    if (l.widthMm < 400) {
      warnings.push({ level: 'warning', code: 'AC-04', msg: `Ladder "${l.label}" is ${round(l.widthMm)} mm wide — below the 400 mm minimum clear width` });
    }
    if (l.rungPitchMm < 250 || l.rungPitchMm > 300) {
      warnings.push({
        level: 'warning',
        code: 'AC-04',
        msg: `Ladder "${l.label}" rung pitch ${round(l.rungPitchMm)} mm — outside the usual 250–300 mm spacing`,
      });
    }
    if (run > ACCESS.cageFromMm && l.cageFromY <= 0) {
      warnings.push({
        level: 'warning',
        code: 'AC-05',
        msg: `Ladder "${l.label}" climbs ${round(run)} mm with no cage and no guide rails — a fall-arrest measure is required above ${ACCESS.cageFromMm} mm`,
      });
    }
  }

  // ---- platform deck: beam + deflection under live load ----------------------
  let beamUtil = 0;
  let worst: { label: string; span: number; util: number } | null = null;
  for (const p of model.platforms) {
    const { spanMm, widthMm, label } = deckSpan(p);
    const b = deckBeam(spanMm, widthMm);
    if (b.util > beamUtil) {
      beamUtil = b.util;
      worst = { label, span: spanMm, util: b.util };
    }
    if (b.util > 1) {
      warnings.push({
        level: 'warning',
        code: 'AC-03',
        msg: `Platform at ${round(p.y)} mm (${label}): ${round(spanMm)} mm beam span needs S = ${(b.sReqMm3 / 1000).toFixed(0)} cm³ under ${ACCESS_LOAD.liveKnM2} kN/m² + ${ACCESS_LOAD.pointKn} kN, but the assumed HEA 140 gives ${(ACCESS_LOAD.beamSmm3 / 1000).toFixed(0)} cm³ (${(b.util * 100).toFixed(0)} %) — add a bracket or stanchion, or shorten the span`,
      });
    }
    if (!b.deflectionOK) {
      warnings.push({
        level: 'warning',
        code: 'AC-03',
        msg: `Platform at ${round(p.y)} mm: deck deflection ${b.deflectionMm.toFixed(1)} mm exceeds L/${ACCESS_LOAD.deflectionSpanDiv} (${b.deflectionAllowMm.toFixed(1)} mm) — stiffen the deck`,
      });
    }
  }

  // ---- decks must not occupy the same place ---------------------------------
  const rects = model.platforms.filter((p) => p.kind === 'rect');
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (Math.abs(a.y - b.y) > 50) continue;
      const dx = Math.abs(a.cx - b.cx);
      const dz = Math.abs(a.cz - b.cz);
      if (dx < a.hx + b.hx - 50 && dz < a.hz + b.hz - 50) {
        warnings.push({
          level: 'warning',
          code: 'AC-07',
          msg: `Two decks at ${round(a.y)} mm overlap in plan ("${a.label}" and "${b.label}") — separate the landing from the walkway`,
        });
      }
    }
  }

  // ---- walkways --------------------------------------------------------------
  for (const w of model.walkways) {
    if (w.widthMm > 0 && w.widthMm < ACCESS_LOAD.minWalkWidthMm) {
      warnings.push({
        level: 'warning',
        code: 'AC-06',
        msg: `Walkway "${w.label}" is ${round(w.widthMm)} mm wide — below the ${ACCESS_LOAD.minWalkWidthMm} mm clear width`,
      });
    }
  }

  // ---- stairs ---------------------------------------------------------------
  for (const st of model.stairs) {
    if (st.kind === 'spiral') {
      if (st.riseMm > 250) {
        warnings.push({ level: 'warning', code: 'AC-08', msg: `Spiral stair rise ${round(st.riseMm)} mm per step is above the usual 220–250 mm` });
      }
      continue;
    }
    const flights = Math.max(1, st.flights);
    const climb = st.y1 - st.y0;
    // a landing is needed about every 3 m of climb, so one flight cannot be endless
    const flightsNeeded = Math.max(1, Math.ceil(climb / 3000));
    if (flights < flightsNeeded) {
      warnings.push({
        level: 'warning',
        code: 'AC-08',
        msg: `Stair "${st.label}" climbs ${round(climb)} mm in ${flights} flight(s) — provide a landing about every 3 m (${flightsNeeded} flights)`,
      });
      continue;
    }
    const rise = climb / flights;
    const steps = Math.max(1, Math.round(rise / ACCESS_LOAD.treadRiseMm));
    const going = steps * ACCESS_LOAD.treadGoingMm;
    const angle = (Math.atan2(rise, going) * 180) / Math.PI;
    if (angle < ACCESS_LOAD.stairMinDeg || angle > ACCESS_LOAD.stairMaxDeg) {
      warnings.push({
        level: 'warning',
        code: 'AC-08',
        msg: `Stair "${st.label}" pitch ${angle.toFixed(1)}° is outside the buildable ${ACCESS_LOAD.stairMinDeg}–${ACCESS_LOAD.stairMaxDeg}° range — adjust the landing positions`,
      });
    }
  }

  // ---- equipment not covered by any platform ---------------------------------
  // (a tall shell with no deck gets an unbroken climb; that is caught by AC-02)

  const totalKg = model.weightKg;
  const ok = !warnings.some((w) => w.level === 'error') && beamUtil <= 1;

  rows.push({
    label: 'Access steel (indicative)',
    value: `${totalKg >= 1000 ? `${(totalKg / 1000).toFixed(1)} t` : `${round(totalKg)} kg`}`,
    note: `${model.platforms.length} deck(s), ${model.ladders.length} ladder run(s), ${model.stairs.length} stair(s) — section weights only, not a priced BOM line yet`,
  });
  rows.push({
    label: 'Longest unbroken climb',
    value: `${round(maxRun)} mm`,
    note: `limit ${ACCESS_LOAD.maxUnbrokenClimbMm} mm (OSHA 1910.23)`,
    tone: maxRun > ACCESS_LOAD.maxUnbrokenClimbMm ? 'warn' : 'ok',
  });
  if (worst) {
    rows.push({
      label: 'Governing platform beam',
      value: `${(beamUtil * 100).toFixed(0)} %`,
      note: `${worst.label} · ${round(worst.span)} mm span under ${ACCESS_LOAD.liveKnM2} kN/m² + ${ACCESS_LOAD.pointKn} kN, HEA 140 assumed`,
      tone: beamUtil > 1 ? 'warn' : beamUtil > 0.85 ? 'warn' : 'ok',
    });
  }
  rows.push({
    label: 'Rail standard',
    value: `${ACCESS.railHeightMm} / ${ACCESS.midRailMm} / ${ACCESS.toeBoardMm} mm`,
    note: 'top rail / mid rail / toe board — OSHA 1910.29',
    tone: 'ok',
  });

  return {
    warnings,
    rows,
    totalKg,
    platforms: model.platforms.length,
    ladders: model.ladders.length,
    stairs: model.stairs.length,
    maxRunMm: maxRun,
    beamUtil,
    ok,
  };
}
