// ASME Section VIII Division 1 calculation engine.
// Covers: UG-16 min thickness, UG-27 shell (hoop & longitudinal), UG-28 external
// pressure (approximated chart factors), UG-32 heads & cones, UG-37/UG-40 nozzle
// reinforcement, UG-45 nozzle neck minimum, UG-47 anchor bolts, UG-99 hydrotest,
// UCS-56 PWHT triggers.
// DISCLAIMER: preliminary engineering aid. Final stamped designs require
// verification against the licensed current code edition by a qualified engineer.

import type {
  Equipment,
  EquipmentCalc,
  HeadCalc,
  HeadType,
  NozzleCalc,
  SectionCalc,
  SectionSpec,
  Warning,
} from './types';
import { allowableAt, getMat } from './materials';
import { flangeGroupForMat, verifyFlange } from './flange';
import { flangeWeightKg, npsNumber, pipeMassKgPerM, studCount, wallForBore } from './pipes';
import { clamp, interp } from './units';
import { pwhtAdvice } from './pwht';

export const JOINT_EFFICIENCY: Record<'full' | 'spot' | 'none', number> = {
  full: 1.0, // UW-12(a) full radiography
  spot: 0.85, // UW-12(b) spot radiography (Type 1 joint)
  none: 0.7, // UW-12(c) no radiography (Type 1 joint)
};

const UG16_MIN = 1.5; // mm, UG-16(b) minimum exclusive of CA (non-corrosive)

/** Head geometry & forming data by type */
export function headGeometry(type: HeadType, D: number) {
  switch (type) {
    case 'ellip2':
      return { crownR: D, knuckleR: 0, depth: D / 4, blankFactor: 1.24, saFactor: 1.084, volFactor: Math.PI / 24 };
    case 'toriFD':
      return { crownR: D, knuckleR: 0.06 * D, depth: 0.1935 * D, blankFactor: 1.26, saFactor: 1.14, volFactor: 0.174 };
    case 'toriD':
      return { crownR: 1.0 * D, knuckleR: 0.17 * D, depth: 0.152 * D, blankFactor: 1.2, saFactor: 1.0, volFactor: 0.12 };
    case 'hemi':
      return { crownR: D / 2, knuckleR: 0, depth: D / 2, blankFactor: 1.35, saFactor: Math.PI / 2, volFactor: Math.PI / 12 };
    default:
      return { crownR: 0, knuckleR: 0, depth: 0, blankFactor: 0, saFactor: 0, volFactor: 0 };
  }
}

/** UG-32 required head thickness (mm), P in MPa, S in MPa */
export function headRequiredThickness(type: HeadType, D: number, P: number, S: number, E: number): number {
  const g = headGeometry(type, D);
  switch (type) {
    case 'ellip2':
      return (P * D) / Math.max(1e-6, 2 * S * E - 0.2 * P); // UG-32(e) 2:1
    case 'toriFD':
      return (0.885 * P * g.crownR) / Math.max(1e-6, S * E - 0.1 * P); // UG-32(d) L=D, r=0.06D
    case 'toriD':
      return (P * g.crownR) / Math.max(1e-6, S * E - 0.1 * P); // UG-32(d) L≠D
    case 'hemi':
      return (P * g.crownR) / Math.max(1e-6, 2 * S * E - 0.2 * P); // UG-32(e)
    default:
      return 0;
  }
}

/** Head MAWP (bar) for actual corroded thickness t (mm) */
export function headMawp(type: HeadType, D: number, t: number, S: number, E: number): number {
  const g = headGeometry(type, D);
  // each branch returns MPa; ×10 converts to bar
  switch (type) {
    case 'ellip2':
      return ((2 * S * E * t) / (D + 0.2 * t)) * 10; // UG-32(e)
    case 'toriFD':
      return ((S * E * t) / (0.885 * g.crownR + 0.1 * t)) * 10;
    case 'toriD':
      return ((S * E * t) / (g.crownR + 0.1 * t)) * 10;
    case 'hemi':
      return ((2 * S * E * t) / (g.crownR + 0.2 * t)) * 10;
    default:
      return Infinity;
  }
}

/** UG-27 shell thickness (mm) for P in MPa */
export function shellRequiredThickness(R: number, P: number, S: number, E: number) {
  const tHoop = (P * R) / Math.max(1e-6, S * E - 0.6 * P); // (c)(1)
  const tLong = (P * R) / Math.max(1e-6, 2 * S * E + 0.4 * P); // (c)(2)
  return { tHoop, tLong };
}

export function shellMawp(t: number, R: number, S: number, E: number): { hoop: number; long: number } {
  return {
    hoop: ((S * E * t) / (R + 0.6 * t)) * 10,
    long: ((2 * S * E * t) / (R - 0.4 * t)) * 10,
  };
}

// ---------------------------------------------------------------------------
// UG-28 external pressure (approximated factor charts)
// ---------------------------------------------------------------------------
const CS_BMAX: [number, number][] = [
  [20, 2600], [370, 2600], [425, 2500], [480, 2350], [540, 2000], [600, 1550], [700, 1100], [815, 700],
];
const SS_BMAX: [number, number][] = [
  [20, 1800], [370, 1700], [480, 1550], [540, 1450], [600, 1300], [700, 1050], [815, 800],
];

export function externalPressureCheck(
  Do: number,
  t: number,
  L: number,
  tC: number,
  group: 'CS' | 'LTCS' | 'CrMo' | 'SS' | 'Duplex'
): { A: number; B: number; pAllowBar: number; ok: (p: number) => boolean; note: string } {
  const ratio = Math.max(1.01, Do / Math.max(0.1, t));
  // ASME II-D geometric chart (Fig. G) approximation: A = 1.1/(Do/t)^1.5, capped at the
  // chart's left end (A ≤ 0.1). The previous 1.5/(Do/t) branch above Do/t = 120 jumped
  // A up ~15× at the breakpoint, badly overstating the external-pressure allowable.
  const A = Math.min(0.1, 1.1 / Math.pow(ratio, 1.5));
  const ssLike = group === 'SS';
  const er = ssLike ? 0.62 : group === 'Duplex' ? 1.25 : 1.0;
  const k = 1.9e6 * er;
  const bmax = interp(ssLike ? SS_BMAX : CS_BMAX, tC); // psi
  const B = (bmax * (k * A)) / (bmax + k * A); // psi, approximated Fig G / CS-2 curve
  const pAllowPsi = (4 * B) / (3 * ratio); // UG-28 step (5)
  return {
    A,
    B,
    pAllowBar: pAllowPsi * 0.0689476,
    ok: (p: number) => p <= pAllowPsi * 0.0689476,
    note: 'UG-28 with approximated geometric chart (A = 1.1/(Do/t)^1.5) and Fig. G / CS curves — verify against ASME II-D charts',
  };
}

/** Invert UG-28: minimum corroded thickness whose external-pressure allowable ≥ PExt (bar).
 *  Uses L = Do (no intermediate stiffener) as a conservative line-of-support assumption. */
export function externalRequiredThickness(
  Do: number,
  PExtBar: number,
  tC: number,
  group: 'CS' | 'LTCS' | 'CrMo' | 'SS' | 'Duplex'
): number {
  if (PExtBar <= 0) return 0;
  let lo = 0.5;
  let hi = Math.max(20, Do / 2);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const chk = externalPressureCheck(Do, mid, Do, tC, group);
    if (chk.pAllowBar >= PExtBar) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ---------------------------------------------------------------------------
// Zick saddle horn stress (circumferential compression at the horn)
// S3 = Q/(4·t·b2) + 3·K3·Q/(2·t²) for L ≥ 8R  (P3 Engineering / Zick 1951 form)
// S3 = Q/(4·t·b2) + 12·K3·Q·R/(L·t²) for L < 8R
// where b2 = b0 + 10·t (effective supporting length). K3 from Zick Table I
// (unstiffened shell): 0.528 @ 120°, 0.0316 @ 150° — intermediate angles are
// log-interpolated between the two published anchors (labelled indicative).
// ---------------------------------------------------------------------------
// Published Zick Table I anchors for the unstiffened-shell horn coefficient K3.
// Only the 120° and 150° entries are verified against the original paper; values
// between them are interpolated and below 120° clamps to the 120° (conservative)
// end — the codes normally limit saddle contact to ≥ 120°.
const ZICK_K3: [number, number][] = [
  [120, 0.528],
  [150, 0.0316],
];

/** Zick horn coefficient K3 by saddle contact angle (deg). < 120° clamps to 0.528. */
export function zickK3(saddleAngleDeg: number): number {
  if (saddleAngleDeg <= 120) return ZICK_K3[0][1]; // conservative (max horn moment)
  if (saddleAngleDeg >= 150) return ZICK_K3[1][1];
  // log-interpolate between the two published anchors (K3 spans ~17×)
  const [a0, k0] = ZICK_K3[0];
  const [a1, k1] = ZICK_K3[1];
  const f = (saddleAngleDeg - a0) / (a1 - a0);
  return Math.exp(Math.log(k0) + f * (Math.log(k1) - Math.log(k0)));
}

/** Zick circumferential stress at the saddle horn (MPa). Q in N, lengths in mm. */
export function zickHornStress(Q: number, tMm: number, RMm: number, spanMm: number, b0Mm: number, saddleAngleDeg: number) {
  const t = Math.max(0.5, tMm);
  const b2 = b0Mm + 10 * t; // effective supporting length
  const k3 = zickK3(saddleAngleDeg);
  const membrane = Q / (4 * t * b2); // direct/membrane term
  const bending = spanMm >= 8 * RMm ? (3 * k3 * Q) / (2 * t * t) : (12 * k3 * Q * RMm) / (spanMm * t * t);
  return { S3: membrane + bending, membrane, bending, b2, k3 };
}

// ---------------------------------------------------------------------------
// UG-45 nozzle neck minimum thickness (b3 table, indicative)
// ---------------------------------------------------------------------------
const UG45_B3: [number, number][] = [
  [1, 1.5], [2, 1.8], [3, 2.3], [4, 2.5], [6, 2.8], [8, 3.1], [10, 3.3], [12, 3.6], [16, 3.8], [24, 4.1],
];

export function ug45MinWall(npsNum: number): number {
  return interp(UG45_B3, npsNum);
}

// ---------------------------------------------------------------------------
// Section calculation
// ---------------------------------------------------------------------------
function calcHead(
  type: HeadType,
  D: number,
  tSel: number,
  P: number,
  S: number,
  E: number,
  ca: number,
  warnings: Warning[],
  label: string
): HeadCalc | undefined {
  if (type === 'none') return undefined;
  const g = headGeometry(type, D);
  const tReq = headRequiredThickness(type, D, P, S, E);
  const tMinNominal = tReq + ca;
  const tActual = tSel > 0 ? tSel : tMinNominal;
  const tCorr = tActual - ca;
  if (tCorr < tReq - 1e-6) {
    warnings.push({
      level: 'error',
      code: 'HD-01',
      msg: `${label}: selected head thickness ${tActual.toFixed(1)} mm < required ${tMinNominal.toFixed(1)} mm (incl. CA ${ca} mm)`,
    });
  }
  // UG-32(d)/(e) geometry checks
  if (type === 'toriFD' && g.knuckleR < 0.06 * D - 0.01) {
    warnings.push({ level: 'error', code: 'HD-02', msg: `${label}: knuckle radius < 6% of inside diameter (UG-32(d))` });
  }
  if (type === 'toriD' && g.knuckleR < 0.06 * D - 0.01) {
    warnings.push({ level: 'error', code: 'HD-03', msg: `${label}: knuckle radius < 6% of inside diameter (UG-32(d))` });
  }
  const mawp = tCorr > 0 ? headMawp(type, D, tCorr, S, E) : 0;
  const dMm = D / 1000;
  return {
    type,
    crownR: g.crownR,
    knuckleR: g.knuckleR,
    depth: g.depth,
    tReq,
    tMinNominal,
    mawp,
    utilization: tReq > 0 ? tReq / Math.max(1e-9, tCorr) : 0,
    blankDia: g.blankFactor * D,
    surfaceArea: g.saFactor * dMm * dMm,
  };
}

function calcSection(
  spec: SectionSpec,
  P: number,
  PExt: number,
  matKey: string,
  S: number,
  E: number,
  ca: number,
  warnings: Warning[]
): SectionCalc {
  const D = spec.dia;
  const R = D / 2;
  const Rc = Math.max(1, R - ca); // corroded inside radius
  const { tHoop, tLong } = shellRequiredThickness(Rc, P, S, E); // corroded basis (UG-27 with CA in R)
  const mat = getMat(matKey);
  const tReqG = Math.max(tHoop, tLong);
  const tMinNominal = Math.max(UG16_MIN, tReqG) + ca;
  const tNominal = spec.shellThk > 0 ? spec.shellThk : tMinNominal;
  const tCorr = tNominal - ca;
  if (spec.shellThk > 0 && tCorr < tReqG - 1e-6) {
    warnings.push({
      level: 'error',
      code: 'SH-01',
      msg: `Section Ø${D}: shell thickness ${tNominal.toFixed(1)} mm < required ${tMinNominal.toFixed(1)} mm (UG-27, incl. CA)`,
    });
  }
  if (tCorr <= 0) {
    warnings.push({ level: 'error', code: 'SH-02', msg: `Section Ø${D}: non-positive corroded thickness` });
  }
  const mawp = tCorr > 0 ? shellMawp(tCorr, Rc, S, E) : { hoop: 0, long: 0 };
  let governing = 'Hoop (UG-27(c)(1))';
  let utilization = tHoop / Math.max(1e-9, tCorr);
  if (tLong > tHoop) {
    governing = 'Longitudinal (UG-27(c)(2))';
    utilization = tLong / Math.max(1e-9, tCorr);
  }
  const weightShellKg = (Math.PI * ((D + tNominal) / 1000) * (tNominal / 1000) * (spec.ttLength / 1000)) * mat.density;

  const calc: SectionCalc = {
    spec,
    Rc,
    tReqHoop: tHoop,
    tReqLong: tLong,
    tReqExternal: 0,
    tReq: tReqG,
    tMinNominal: tMinNominal,
    tNominal,
    tCorroded: tCorr,
    mawpHoop: mawp.hoop,
    mawpLong: mawp.long,
    utilization,
    governing,
    weightShellKg,
  };

  calc.headTop = calcHead(spec.headTop, D, spec.headThkTop, P, S, E, ca, warnings, `Ø${D} top head`);
  calc.headBot = calcHead(spec.headBottom, D, spec.headThkBot, P, S, E, ca, warnings, `Ø${D} bottom head`);

  if (spec.coneAngleDeg > 0 && spec.coneAngleDeg <= 90) {
    const half = spec.coneAngleDeg / 2;
    const Dlarge = D; // assumed: this section is the large end of the cone above the previous section
    const tCone = (P * Dlarge) / Math.max(1e-6, 2 * Math.cos((half * Math.PI) / 180) * (S * E - 0.1 * P));
    const tMinCone = tCone + ca;
    const tConeSel = spec.coneThk > 0 ? spec.coneThk : tMinCone;
    if (spec.coneThk > 0 && spec.coneThk - ca < tCone - 1e-6) {
      warnings.push({
        level: 'error',
        code: 'CN-01',
        msg: `Section Ø${D}: cone thickness ${spec.coneThk.toFixed(1)} mm < required ${tMinCone.toFixed(1)} mm (UG-32(g))`,
      });
    }
    if (spec.coneAngleDeg > 30) {
      warnings.push({
        level: 'warning',
        code: 'CN-02',
        msg: `Section Ø${D}: cone included angle ${spec.coneAngleDeg}° > 30° — transition should preferably use knuckle radii / multiple cones`,
      });
    }
    calc.cone = {
      tReq: tCone,
      tMinNominal: tMinCone,
      tNominal: tConeSel,
      theta: spec.coneAngleDeg,
      mawp: tConeSel - ca > 0 ? ((S * E * (tConeSel - ca)) / ((Dlarge / 2) / Math.cos((half * Math.PI) / 180) + 0.1 * (tConeSel - ca))) * 10 : 0,
      D1: Dlarge,
      D2: Dlarge,
    };
  }

  return calc;
}

// ---------------------------------------------------------------------------
// Nozzle calculation (UG-37 / UG-40 / UG-45 + B16.5)
// ---------------------------------------------------------------------------
function calcNozzle(
  nozzle: Equipment['nozzles'][number],
  section: SectionCalc,
  P: number,
  S: number,
  E: number,
  ca: number,
  matKey: string,
  tC: number,
  PExt: number,
  warnings: Warning[]
): NozzleCalc {
  const pipeInfo = wallForBore(nozzle.dn, nozzle.schKey);
  const pipe = pipeInfo?.pipe;
  const wall = pipeInfo?.wall ?? 0;
  const od = pipe?.od ?? nozzle.dn + 2 * wall;
  const boreCorr = nozzle.dn + 2 * ca; // corroded finished opening
  const wallCorr = Math.max(0, wall - ca);
  const Snozzle = S;
  const trn = (P * boreCorr) / Math.max(1e-6, 2 * (S * E - 0.6 * P)); // nozzle pressure thickness (t_a)
  const npsNum = npsNumber(pipe?.nps ?? '2"');
  const nmat = getMat(matKey);
  const matGroup: 'CS' | 'LTCS' | 'CrMo' | 'SS' | 'Duplex' =
    nmat.group === 'SS304' || nmat.group === 'SS316' || nmat.group === 'SS stab'
      ? 'SS'
      : nmat.group === 'Duplex' || nmat.group === 'SuperDuplex'
      ? 'Duplex'
      : (nmat.group as 'CS' | 'LTCS' | 'CrMo');
  const RshellNew = section.spec.dia / 2;
  const tb3 = ug45MinWall(npsNum); // b3: Table UG-45 minimum wall
  // b1: shell required thickness for internal pressure at the opening, E = 1.0 (UG-45)
  const tb1 = (P * RshellNew) / Math.max(1e-6, S - 0.6 * P);
  // b2: shell required thickness under external (vacuum) pressure at the opening
  const tb2 = PExt > 0 ? externalRequiredThickness(section.spec.dia + 2 * section.tNominal, PExt, tC, matGroup) : 0;
  // t_b = min(b3, max(b1, b2)); UG-45 neck requirement t = max(t_a, t_b)
  const tb = Math.min(tb3, Math.max(tb1, tb2));
  const tNeckReq = Math.max(trn, tb);
  // UG-45/UG-22: the nozzle neck pressure thickness is verified against its NOMINAL
  // wall less the −12.5 % pipe mill tolerance (ASTM A53/A106 minimum wall). The vessel
  // shell CA governs the shell opening, not the neck wall itself.
  const neckOK = wall * 0.875 >= tNeckReq - 1e-6;

  const d = boreCorr; // finished opening (corroded)
  const tr = section.tReq;
  const ta = Math.max(0, section.tCorroded);
  const fr1 = Math.min(1, S / Math.max(1e-6, Snozzle));
  const F = 1; // no misalignment assumed
  const tn = wallCorr;
  const Areq = d * tr * F + 2 * tr * (1 - fr1) * Math.min(tn, d) * F;

  const A1 = Math.max(0, d * (E * ta - tr));
  // UG-40 limits of reinforcement: shell side 2.5·t (+pad), nozzle side 2.5·t_n.
  const hOut = Math.min(nozzle.projOutside + nozzle.padThk, 2.5 * ta + nozzle.padThk);
  const hIn = Math.min(50, ta, 2.5 * tn); // inside projection (set-through assumption), UG-40 nozzle cap
  // A2 = 2·(h_out + h_in)·(t_n − F·t_r) per UG-37.1 — only the F·t_r term (pressure
  // thickness the shell needs at the opening) is deducted from the nozzle wall; the
  // previous form also subtracted t_rn a second time, under-providing A2.
  const A2 = 2 * (hOut + hIn) * Math.max(0, tn - F * tr);
  const padDia = nozzle.padDia > nozzle.dn + 2 * wall ? nozzle.padDia : 0;
  const A3 = padDia > 0 ? Math.max(0, (padDia - d - 2 * wall) * nozzle.padThk) : 0;
  const w = 6; // assumed fillet leg mm
  const Aweld = w * w;
  const Aprov = A1 + A2 + A3 + Aweld;
  const shortfall = Areq - Aprov;
  const reinforceOK = shortfall <= 1e-6;

  if (!neckOK) {
    warnings.push({
      level: 'error',
      code: 'NZ-01',
      msg: `Nozzle ${nozzle.tag}: guaranteed min. neck wall ${(wall * 0.875).toFixed(2)} mm (${wall} mm − 12.5 % mill tol.) < required ${tNeckReq.toFixed(2)} mm (UG-45/pressure)`,
    });
  }
  if (!reinforceOK) {
    warnings.push({
      level: 'error',
      code: 'NZ-02',
      msg: `Nozzle ${nozzle.tag}: reinforcement shortfall ${shortfall.toFixed(0)} mm² — increase pad or wall (UG-37)`,
    });
  }

  const group = flangeGroupForMat(nozzle.flangeMatKey);
  // P here is MPa (thickness formulas above); B16.5 ratings are bar — convert so the
  // comparison is like-for-like (10 bar = 1 MPa).
  const fl = verifyFlange(group, nozzle.flangeClass, tC, P * 10);
  if (!fl.ok) {
    warnings.push({
      level: 'error',
      code: 'FL-01',
      msg: `Nozzle ${nozzle.tag}: Class ${nozzle.flangeClass} ${group} rated ${fl.ratingBar.toFixed(1)} bar @ ${tC} °C < design ${P.toFixed(1)} bar (B16.5)`,
    });
  } else if (fl.margin > 0.5) {
    warnings.push({
      level: 'info',
      code: 'FL-02',
      msg: `Nozzle ${nozzle.tag}: flange Class ${nozzle.flangeClass} has ${(fl.margin * 100).toFixed(0)}% margin — consider lower class`,
    });
  }

  const neckLenM = (nozzle.projOutside + wall + 150) / 1000;
  const pipeKg = pipe ? pipeMassKgPerM(od, wall, getMat(matKey).density) * neckLenM : 0;
  const flangeKg = flangeWeightKg(npsNum, nozzle.flangeClass);

  return {
    spec: nozzle,
    dn: d,
    wall,
    wallCorroded: wallCorr,
    trn,
    ug45min: tb3,
    neckOK,
    Areq,
    A1,
    A2,
    A3,
    Aweld,
    Aprov,
    shortfall,
    reinforceOK,
    flangeRating: fl.ratingBar,
    flangeClassOK: fl.ok,
    pipeLenM: neckLenM,
    pipeKg,
    flangeKg,
  };
}

// ---------------------------------------------------------------------------
// Main vessel / column computation
// ---------------------------------------------------------------------------
export function computeVessel(equip: Equipment): EquipmentCalc {
  const warnings: Warning[] = [];
  const mat = getMat(equip.materialKey);
  const P = Math.max(0.01, equip.designPressure); // bar g
  const Pm = P / 10; // MPa
  const T = equip.designTemp;
  const S = allowableAt(equip.materialKey, T);
  const E = JOINT_EFFICIENCY[equip.rtCategory];
  const ca = Math.max(0, equip.corrosionAllowance);
  const PExt = Math.max(0, equip.externalPressure ?? 0);

  if (T > mat.maxTemp) {
    warnings.push({
      level: 'error',
      code: 'MT-01',
      msg: `Design temperature ${T} °C exceeds recommended max ${mat.maxTemp} °C for ${mat.name}`,
    });
  }
  if (equip.mdmt < mat.minTemp) {
    warnings.push({
      level: 'warning',
      code: 'MT-02',
      msg: `MDMT ${equip.mdmt} °C below typical limit ${mat.minTemp} °C for ${mat.name} — impact testing per UG-84 required`,
    });
  }

  // External pressure line of support
  const totalTT = equip.sections.reduce((s, x) => s + x.ttLength, 0);
  const overall = equip.orientation === 'vertical' ? totalTT * 1.05 : totalTT * 0.85;

  const sections = equip.sections.map((spec) => {
    const c = calcSection(spec, Pm, PExt, mat.key, S, E, ca, warnings);
    // attach UG-28 result with realistic L
    const L = equip.orientation === 'vertical' ? overall : equip.support.saddleSpan || overall;
    const ext = externalPressureCheck(
      spec.dia + 2 * c.tNominal,
      Math.max(0.5, c.tCorroded),
      L,
      T,
      mat.group === 'SS304' || mat.group === 'SS316' || mat.group === 'SS stab'
        ? 'SS'
        : mat.group === 'Duplex' || mat.group === 'SuperDuplex'
        ? 'Duplex'
        : (mat.group as 'CS' | 'LTCS' | 'CrMo')
    );
    c.external = { ...ext, L, Do: spec.dia + 2 * c.tNominal, t: c.tCorroded, DoOverT: (spec.dia + 2 * c.tNominal) / Math.max(0.5, c.tCorroded), ok: ext.ok(PExt) } as any;
    if (PExt > 0 && !ext.ok(PExt)) {
      warnings.push({
        level: 'error',
        code: 'EX-01',
        msg: `Section Ø${spec.dia}: external pressure ${PExt} bar exceeds allowable ${ext.pAllowBar.toFixed(2)} bar (UG-28)`,
      });
    }
    return c;
  });

  // Cone transitions: D2 (small end) = diameter of the section below
  for (let i = 0; i < sections.length; i++) {
    const cone = sections[i].cone;
    if (cone) cone.D2 = i > 0 ? sections[i - 1].spec.dia : cone.D1;
  }

  // Nozzles
  const nozzleCalcs = equip.nozzles.map((n) => {
    const sec =
      sections.find((s) => s.spec.id === n.sectionId) ??
      sections.reduce((best, s) =>
        Math.abs(s.spec.dia) < Math.abs(best.spec.dia) ? s : best
      );
    return calcNozzle(n, sec, Pm, S, E, ca, mat.key, T, PExt, warnings);
  });

  // Weights / volumes / areas
  let weightDry = 0;
  let volume = 0;
  let paint = 0;
  for (const c of sections) {
    weightDry += c.weightShellKg;
    const Dm = c.spec.dia / 1000;
    volume += (Math.PI / 4) * Dm * Dm * (c.spec.ttLength / 1000);
    paint += Math.PI * Dm * (c.spec.ttLength / 1000);
    for (const hc of [c.headTop, c.headBot]) {
      if (!hc) continue;
      const g = headGeometry(hc.type, c.spec.dia);
      const tNom = hc.type === c.spec.headTop ? c.spec.headThkTop : c.spec.headThkBot;
      const tUse = tNom > 0 ? tNom : hc.tMinNominal;
      const d = c.spec.dia / 1000;
      weightDry += g.saFactor * d * d * (tUse / 1000) * mat.density * 1.05; // +5% forming
      volume += g.volFactor * d * d * d;
      paint += g.saFactor * d * d;
    }
  }
  for (const nc of nozzleCalcs) {
    weightDry += nc.pipeKg + nc.flangeKg;
    paint += Math.PI * (nc.spec.dn / 1000) * 0.25;
  }
  // internal/external attachments
  weightDry += equip.support.legCount * 90 + (equip.support.type === 'skirt' ? 600 : 0);

  // Internal mass (column internals etc.)
  let internalsMass = 0;
  for (const it of equip.internals) {
    const area = (Math.PI / 4) * Math.pow((sections[0].spec.dia - 100) / 1000, 2);
    internalsMass += it.count * it.kgPerM2 * area;
  }
  weightDry += internalsMass;

  // ---- Cladding / lining (vessels & columns) ----
  let clad: EquipmentCalc['clad'];
  let cladAusteniticOrDuplex = false;
  const cladSpec = equip.clad;
  if (cladSpec && cladSpec.mode !== 'none' && cladSpec.thicknessMm > 0) {
    let cladArea = 0;
    for (const c of sections) {
      const Dm = c.spec.dia / 1000;
      cladArea += Math.PI * Dm * (c.spec.ttLength / 1000);
      for (const hc of [c.headTop, c.headBot]) {
        if (!hc) continue;
        const g = headGeometry(hc.type, c.spec.dia);
        cladArea += g.saFactor * Dm * Dm;
      }
    }
    let coverageLengthMm = totalTT;
    if (cladSpec.mode === 'partial') {
      const covered = Math.max(0, Math.min(cladSpec.partialLengthMm, totalTT));
      coverageLengthMm = covered;
      cladArea *= totalTT > 0 ? covered / totalTT : 0;
    }
    const cladMat = getMat(cladSpec.materialKey);
    cladAusteniticOrDuplex = ['SS304', 'SS316', 'SS stab', 'Duplex', 'SuperDuplex', 'Nickel'].includes(cladMat.group);
    const cladWeightKg = cladArea * (cladSpec.thicknessMm / 1000) * cladMat.density;
    weightDry += cladWeightKg;
    clad = {
      weightKg: cladWeightKg,
      areaM2: cladArea,
      materialKey: cladSpec.materialKey,
      materialName: cladMat.name,
      coverageLengthMm,
    };
    if (cladSpec.kind === 'mechanicalLiner') {
      warnings.push({
        level: 'info',
        code: 'CL-03',
        msg: 'Mechanical liner is non-pressure-retaining — thickness excluded from UG-27 design; verify liner collapse/roll-in per client spec',
      });
    }
    if (cladSpec.mode === 'partial' && cladSpec.partialLengthMm <= 0) {
      warnings.push({ level: 'error', code: 'CL-02', msg: 'Partial cladding selected but coverage length is 0 — set covered length from bottom datum' });
    }
    if (cladSpec.thicknessMm > 0 && cladSpec.thicknessMm < 2 && cladSpec.kind !== 'mechanicalLiner') {
      warnings.push({
        level: 'warning',
        code: 'CL-04',
        msg: `Cladding ${cladSpec.thicknessMm} mm < 2 mm min. finished thickness for corrosion barrier (typical mill min. 2–3 mm) — confirm with clad supplier`,
      });
    }
  }

  const hydroWater = volume * 997;
  const weightHydro = weightDry + hydroWater + internalsMass * 0.2;
  const weightOperating = weightDry + internalsMass * 0.6 + volume * 997 * 0.1;

  // Governing MAWP (corroded, minimum of parts; exclude user MWPS override)
  const mawps: number[] = [];
  for (const c of sections) {
    mawps.push(Math.min(c.mawpHoop, c.mawpLong));
    if (c.headTop) mawps.push(c.headTop.mawp);
    if (c.headBot) mawps.push(c.headBot.mawp);
    if (c.cone) mawps.push(c.cone.mawp);
  }
  const calcMawp = mawps.length ? Math.min(...mawps) : 0;
  const mawpBar = equip.mwps > 0 ? Math.min(equip.mwps, calcMawp) : calcMawp;
  if (equip.designPressure > calcMawp + 1e-6) {
    warnings.push({
      level: 'error',
      code: 'MW-01',
      msg: `MAWP ${calcMawp.toFixed(2)} bar < design pressure ${P.toFixed(2)} bar — increase thickness`,
    });
  }

  // Hydrotest UG-99
  const STest = allowableAt(equip.materialKey, 25);
  const ratioCap = (0.9 * mat.sy) / Math.max(1e-6, S);
  const ratio = Math.min(STest / Math.max(1e-6, S), ratioCap);
  const ptFactor = equip.testPressureFactor > 0 ? equip.testPressureFactor : 1.3;
  const hydroTestBar = ptFactor * mawpBar * ratio;
  const rho = volume > 0 ? 997 : 0;
  const staticHeadBar = (equip.orientation === 'vertical' ? (totalTT / 1000) * 997 * 9.81 : 0) / 1e5;
  const hydroTestBottomBar = hydroTestBar + staticHeadBar;

  // Weld length estimate (m)
  let weldLen = 0;
  for (const c of sections) {
    weldLen += (Math.PI * c.spec.dia) / 1000; // long seam
    weldLen += (2 * Math.PI * c.spec.dia) / 1000; // 2 circ seams
    if (c.headTop) weldLen += (Math.PI * c.spec.dia) / 1000;
    if (c.headBot) weldLen += (Math.PI * c.spec.dia) / 1000;
  }
  for (const nc of nozzleCalcs) weldLen += (2 * Math.PI * (nc.spec.dn / 1000)) * 1.2;

  const pw = pwhtAdvice(mat.key, Math.max(...sections.map((s) => s.tNominal)), equip.mdmt, equip.pwhtOverride);
  if (pw.required && equip.pwhtOverride === false) {
    warnings.push({ level: 'warning', code: 'PW-01', msg: `PWHT required by UCS-56 but overridden off` });
  }
  if (pw.required && cladAusteniticOrDuplex) {
    warnings.push({
      level: 'warning',
      code: 'CL-01',
      msg: `PWHT required on ${mat.name} base with corrosion-resistant overlay — sequence PWHT before overlay application or specify L-grade/low-carbon overlay to avoid sensitisation (UW-40 / NACE RP0472)`,
    });
  }

  // Simple checks
  for (const c of sections) {
    const ld = c.spec.ttLength / c.spec.dia;
    if (equip.orientation === 'vertical' && ld > 15) {
      warnings.push({
        level: 'warning',
        code: 'GE-01',
        msg: `Section Ø${c.spec.dia}: L/D ${ld.toFixed(1)} > 15 — review slender column wind/seismic analysis`,
      });
    }
    if (c.spec.dia / c.tNominal > 200) {
      warnings.push({
        level: 'warning',
        code: 'GE-02',
        msg: `Section Ø${c.spec.dia}: D/t = ${(c.spec.dia / c.tNominal).toFixed(0)} > 200 — buckling & handling checks advised`,
      });
    }
  }

  // Anchor bolts (vertical, legs or skirt) — force-couple sizing on the governing
  // overturning moment (wind or seismic, separate cases not combined). Design loads
  // from equip.designLoads (user) or indicative defaults. Preliminary aid — verify
  // against ASCE 7 / the governing jurisdiction edition and ASME II-D bolt allowables.
  let bolts: EquipmentCalc['bolts'];
  if (equip.orientation === 'vertical' && (equip.support.type === 'legs' || equip.support.type === 'skirt')) {
    const dl = equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 };
    const Dbc = sections[0].spec.dia + 400; // bolt circle, mm
    const Hw = (totalTT * 1.05) / 1000; // m, projected height incl. top head
    const Dow = sections[0].spec.dia / 1000; // m, projected width
    const Aproj = Dow * Hw; // m², projected wind area
    // Wind overturning: flat design pressure (kPa) × projected area × lever to centroid
    const qWindKpa = dl.windPressureKpa > 0 ? dl.windPressureKpa : 0.75; // kPa indicative
    const Fwind = qWindKpa * Aproj; // kN
    const Mwind = Fwind * (Hw / 2); // kN·m (centroid at mid-height)
    // Seismic overturning: V = Cs·W, Cs = Sds·Ie/R (ASCE 7 ELF, indicative), CG ≈ 0.7·H
    const Wop = (weightOperating * 9.81) / 1000; // kN operating weight
    const Cs = dl.sds > 0 ? Math.min(0.5, (dl.sds * dl.seismicIe) / Math.max(0.5, dl.seismicR)) : 0;
    const V = Cs * Wop; // kN base shear
    const Mseis = V * (0.7 * Hw); // kN·m
    const governing: 'wind' | 'seismic' = Mseis > Mwind ? 'seismic' : 'wind';
    const Mgov = Math.max(Mwind, Mseis); // kN·m — separate load cases, not combined
    const fT = 90; // MPa bolt allowable at temperature (B7, indicative — use ASME II-D)
    const reqArea = (Mgov * 1e6) / (fT * (Dbc / 2)); // mm² = (kN·m→N·mm)/(MPa·mm)
    const count = Math.max(8, Math.round(sections[0].spec.dia / 250) * 4);
    const areaEach = (Math.PI * 24 * 24) / 4; // M24 default
    // Elastic bolt-group max tension: T_max = M·R/Σy², Σy² = n·R²/2 for a full circle
    const Rbc = Dbc / 2; // mm
    const MgovNmm = Mgov * 1e6; // N·mm
    const sumY2 = (count * Rbc * Rbc) / 2; // mm²
    const Tbolt = (MgovNmm * Rbc) / sumY2; // N
    const boltStress = Tbolt / areaEach; // MPa
    // Good-practice circumferential spacing advisory (not a hard code limit)
    const spacing = (Math.PI * Dbc) / count;
    const spacingOK = spacing <= 600 && count >= 6;
    bolts = {
      count,
      boltCircle: Dbc,
      areaEach,
      totalArea: count * areaEach,
      reqArea,
      utilization: reqArea / Math.max(1, count * areaEach),
      ok: count * areaEach >= reqArea,
      governing,
      overturnMomentKNm: Mgov,
      windMomentKNm: Mwind,
      seismicMomentKNm: Mseis,
      boltTensionKN: Tbolt / 1000,
      boltStressMPa: boltStress,
      boltAllowMPa: fT,
      spacingMm: spacing,
      spacingOK,
      note: `Governing ${governing} overturning ${Mgov.toFixed(0)} kN·m (wind ${Mwind.toFixed(0)}, seismic ${Mseis.toFixed(0)}); force-couple A = M/(f_b·D_b/2), f_b = ${fT} MPa (indicative)`,
    };
    if (!bolts.ok) {
      warnings.push({ level: 'warning', code: 'AB-01', msg: `Anchor bolt area short — increase bolt size/count for ${governing} overturning ${Mgov.toFixed(0)} kN·m (UG-47 basis)` });
    }
    if (!spacingOK) {
      warnings.push({ level: 'info', code: 'AB-02', msg: `Anchor bolt spacing ${spacing.toFixed(0)} mm across ${count} bolts — review count/spacing for base-ring gasket seating (good practice ≤ 600 mm)` });
    }
  }

  // Saddle checks (horizontal) — Zick method: circumferential stress at the horn
  let saddle: EquipmentCalc['saddle'];
  if (equip.orientation === 'horizontal' && equip.support.type === 'saddle') {
    const nSad = Math.max(2, Math.min(4, equip.support.legCount || 2));
    const RMm = sections[0].spec.dia / 2; // inside radius
    // governing (min) corroded shell thickness — the shell carries the saddle load
    const tGov = Math.max(1, Math.min(...sections.map((s) => Math.max(0.5, s.tCorroded))));
    const WopN = weightOperating * 9.81; // operating weight, N
    const Q = WopN / nSad; // load per saddle, N
    const reaction = Q / 1000; // kN
    const b0 = Math.min(400, Math.max(150, 0.05 * (2 * RMm))); // assumed saddle contact width, mm
    const span = equip.support.saddleSpan || sections.reduce((s, x) => s + x.spec.ttLength, 0);
    const angle = Math.max(90, Math.min(150, equip.support.saddleAngle || 120));
    // Zick L is the cylinder tangent length (head-to-head), not the saddle spacing
    const { S3, membrane, bending, k3 } = zickHornStress(Q, tGov, RMm, totalTT, b0, angle);
    const hornAllow = 1.25 * S; // Zick recommendation: 1.25 × tension allowable
    // Longitudinal stress at mid-span (pressure + gross bending), indicative only:
    // shell as a simply-supported beam (UDL), section modulus ≈ πR²t. The governing
    // Zick longitudinal case (over the saddle, K1 factor, saddle position) needs a
    // full moment review — flagged in the note.
    const Mmid = (WopN * span) / 8; // N·mm, mid-span sagging moment
    const Zlong = Math.PI * RMm * RMm * tGov; // mm³
    const longStress = (Pm * RMm) / (2 * tGov) + Mmid / Zlong; // MPa
    const maxSpan = 20 * RMm;
    saddle = {
      reaction,
      zickFc: S3,
      zickAllow: hornAllow,
      hornMembraneMPa: membrane,
      hornBendingMPa: bending,
      saddleWidthMm: b0,
      k3,
      longStressMPa: longStress,
      maxSpan,
      ok: S3 <= hornAllow,
      note: `Zick horn check (K3 = ${k3.toFixed(3)} @ ${angle}°, b2 = ${(b0 + 10 * tGov).toFixed(0)} mm, L = ${(totalTT / 1000).toFixed(2)} m) — verify against licensed Zick/ASME VIII-2 Annex G`,
    };
    if (!saddle.ok) {
      warnings.push({ level: 'warning', code: 'SD-01', msg: `Saddle horn compression ${S3.toFixed(1)} MPa > ${hornAllow.toFixed(1)} MPa (Zick) — add saddle wear plate or increase saddle angle` });
    }
    if (angle < 120) {
      warnings.push({ level: 'info', code: 'SD-03', msg: `Saddle contact angle ${angle}° < 120° — below the usual Zick/code minimum; K3 clamped to the 120° (conservative) value` });
    }
    if (span > maxSpan * 1.2) {
      warnings.push({
        level: 'info',
        code: 'SD-02',
        msg: `Saddle spacing ${(span / 1000).toFixed(1)} m exceeds 20R guidance (${(maxSpan / 1000).toFixed(1)} m)`,
      });
    }
  }

  // Multi-dia consistency
  if (sections.length > 1) {
    for (let i = 1; i < sections.length; i++) {
      if (sections[i].spec.coneAngleDeg <= 0 && sections[i].spec.dia !== sections[i - 1].spec.dia) {
        warnings.push({
          level: 'error',
          code: 'MD-01',
          msg: `Ø${sections[i - 1].spec.dia} → Ø${sections[i].spec.dia}: cone transition missing between differing diameters`,
        });
      }
    }
  }

  const membraneUtil = Math.max(0, ...sections.map((s) => s.utilization));
  const mawpNote = `Governing MAWP (corroded) ${calcMawp.toFixed(2)} bar @ ${T} °C, E=${E}, S=${S.toFixed(0)} MPa`;

  return {
    equip,
    codeRef: 'ASME VIII-1: UG-16/UG-27/UG-28/UG-32/UG-37/UG-40/UG-45/UG-99, UCS-56, UW-12',
    mawpBar,
    mawpNote,
    sections,
    nozzles: nozzleCalcs,
    hydroTestBar,
    hydroTestBottomBar,
    weightDryKg: weightDry,
    weightHydroKg: weightHydro,
    weightOperatingKg: weightOperating,
    internalVolumeM3: volume,
    paintAreaM2: paint,
    weldLengthM: weldLen,
    membraneUtil,
    weldEfficiency: E,
    pwht: pw,
    warnings,
    bolts,
    saddle,
    materialName: mat.name,
    sAllow: S,
    clad,
  };
}

export function computeVesselOrColumn(equip: Equipment): EquipmentCalc {
  return computeVessel(equip);
}
