// Shell-side rating & tube-vibration screening for shell-and-tube exchangers.
//
// Basis and honesty notes (read before changing numbers):
//  * Ideal-tube-bank heat transfer: ESDU 73031 correlation (Nu = a·Re^m·Pr^0.34·F1·F2)
//    — an explicitly published correlation whose constants and row-correction table
//    are transcribed here (row factors from ESDU 73031 as reproduced in the
//    MIT-licensed `ht` library). The ORIGINAL Bell–Delaware ideal-bank j/f charts
//    are NOT reproduced, so this is "ESDU ideal bank + Bell correction structure",
//    not the full Delaware method. Say so in the UI, the README and warnings.
//  * Bell correction factors use published closed-form (HEDH) fits:
//      Jc = 0.55 + 0.72·Fc                              (window/crossflow ligament)
//      JL = 0.44(1−rs) + [1−0.44(1−rs)]·exp(−2.2·rlm)  (baffle leakage)
//      JB = exp[−1.25·Fbp]                              (bundle bypass, no seal strips)
//      JR = 1 outside 20 < Re < 100 (laminar band), interpolated inside
//      Js = 1 (uniform baffle spacing assumed)
//  * Pressure drop: Kern's equivalent-diameter method with the Kern friction chart
//    as digitised in `ht` (MIT, Caleb Bell). The Delaware ΔP correction charts are
//    NOT reproduced. Assumptions are listed at each use and surfaced to the user.
//  * Vibration screening follows the classical published relations (beam natural
//    frequency, Connors critical velocity, Strouhal shedding, half-wave acoustics).
//    Constants are explicit, documented and conservative; this is a screen, not a
//    response analysis (HTRI-style) or a code-mandated pass/fail.
//
// Nothing here is a substitute for a licensed code edition or a vendor rating.

import type { HXSpec, ShellSideFlow, ShellSideCalc, TubeVibCalc } from './types';

/** Assumed shell-to-baffle diametral clearance (mm) — typical TEMA practice. */
const SHELL_BAFFLE_CLEAR_MM = 0.8;
/** Assumed tube-to-baffle hole diametral clearance (mm) — drilled-hole practice. */
const TUBE_HOLE_CLEAR_MM = 0.1;
/** Seal strips: none credited (conservative — bypassing stream is unblocked). */
const SEAL_STRIP_RSS = 0;

/** ESDU 73031 tube-row correction F2 (rows 3..9; ≤2 uses the row-3 value, ≥10 = 1). */
const F2_INLINE = [0.8479, 0.8957, 0.9306, 0.9551, 0.9724, 0.9839, 0.9902];
const F2_STAGGERED = [0.8593, 0.8984, 0.9268, 0.9482, 0.965, 0.9777, 0.9868];

function tubeRowCorrection(rows: number, staggered: boolean): number {
  const tbl = staggered ? F2_STAGGERED : F2_INLINE;
  if (rows <= 2) return tbl[0];
  if (rows >= 10) return 1;
  return tbl[rows - 3];
}

/** ESDU 73031 constants a, m by Reynolds band and layout. */
function esduConstants(re: number, staggered: boolean): { a: number; m: number } {
  if (staggered) {
    if (re <= 300) return { a: 1.309, m: 0.36 };
    if (re <= 2e5) return { a: 0.273, m: 0.635 };
    return { a: 0.124, m: 0.7 };
  }
  if (re <= 300) return { a: 0.742, m: 0.431 };
  if (re <= 2e5) return { a: 0.211, m: 0.651 };
  return { a: 0.116, m: 0.7 };
}

/**
 * Kern friction chart, digitised as a cubic B-spline by the MIT-licensed `ht`
 * library (Kern, Process Heat Transfer, via Peters/Timmerhaus). Reproduces ht's
 * published worked example to ~2.9 % (see the golden test) — the chart itself is
 * read to roughly ±10 %, so this is a screening-grade f, not a rating-grade one.
 */
const KERN_T = [
  9.9524, 9.9524, 9.9524, 9.9524, 17.9105, 27.7862, 47.2083, 83.9573, 281.996, 1122.76, 42999.9,
  1012440.0, 1012440.0, 1012440.0, 1012440.0, 2756750.0, 2756750.0, 2756750.0, 2756750.0,
];
const KERN_C = [
  6.040435949178239, 4.64973456285782, 2.95274850806163, 1.9569061885042, 1.1663069946420412,
  0.6830549536215098, 0.4588680265447762, 0.22387792331971723, 0.12721190975530583,
  0.1395456548881242, 0.12888895743468684, 0.0, 0.0, 0.0, 0.0,
];
const KERN_K = 3;

/** de Boor evaluation of the Kern chart spline at Reynolds number `x`. */
export function kernFriction(re: number): number {
  const n = KERN_C.length;
  if (re >= KERN_T[n]) return KERN_C[n - 1];
  if (re <= KERN_T[KERN_K]) return KERN_C[0];
  let lo = KERN_K;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (re < KERN_T[mid]) hi = mid;
    else lo = mid;
  }
  const span = lo;
  const d: number[] = [];
  for (let j = 0; j <= KERN_K; j++) d[j] = KERN_C[span - KERN_K + j];
  for (let r = 1; r <= KERN_K; r++) {
    for (let j = KERN_K; j >= r; j--) {
      const i = span - KERN_K + j;
      const den = KERN_T[i + KERN_K - r + 1] - KERN_T[i];
      const alpha = den === 0 ? 0 : (re - KERN_T[i]) / den;
      d[j] = (1 - alpha) * d[j - 1] + alpha * d[j];
    }
  }
  return d[KERN_K];
}

/** Fraction of a circle of radius R lying above the chord y = c (same units). */
function segmentFraction(r: number, c: number): number {
  if (c >= r) return 0;
  if (c <= -r) return 1;
  const area = r * r * Math.acos(c / r) - c * Math.sqrt(r * r - c * c);
  return area / (Math.PI * r * r);
}

/**
 * ESDU 73031 ideal-bank Nusselt number: Nu = a·Re^m·Pr^0.34·F1·F2.
 * Exported so it can be pinned to a published worked value (ht docstring:
 * Re = 1.32e4, Pr = 0.71, 8 rows, 0.09/0.05 m pitches → Nu = 98.2563319140594).
 */
export function esduNusselt(re: number, pr: number, rows: number, staggered: boolean, prWall?: number): number {
  const { a, m } = esduConstants(re, staggered);
  const f2 = tubeRowCorrection(rows, staggered);
  const f1 = prWall && prWall > 0 ? Math.pow(pr / prWall, 0.26) : 1;
  return a * Math.pow(re, m) * Math.pow(pr, 0.34) * f1 * f2;
}

/** Bell/HEDH window ligament correction, Jc = 0.55 + 0.72·Fc (crossflow tube fraction). */
export function bellJC(fc: number): number {
  return 0.55 + 0.72 * Math.min(1, Math.max(0, fc));
}

/** Bell/HEDH baffle-leakage correction (rs = shell gap share, rlm = leakage/crossflow ratio). */
export function bellJL(rS: number, rLm: number): number {
  const base = 0.44 * (1 - rS);
  return base + (1 - base) * Math.exp(-2.2 * rLm);
}

/**
 * Bell/HEDH bundle-bypass correction JB = exp[−1.25·Fbp·(1 − 2·rss^⅓)],
 * capped at 1 (a fully sealed gap removes the bypass penalty). This
 * implementation credits no seal strips (rss = 0), which is conservative.
 */
export function bellJB(bypassFraction: number, rSs = 0): number {
  return Math.min(1, Math.exp(-1.25 * bypassFraction * (1 - 2 * Math.pow(rSs, 1 / 3))));
}

export interface ShellSideInput {
  hx: HXSpec;
  flow: ShellSideFlow;
  /** Shell inside diameter (mm) */
  shellID: number;
  /** Tube bundle outside diameter (mm) */
  bundleOD: number;
  /** Baffle spacing (mm) — also the unsupported tube span */
  baffleSpacing: number;
  /** Baffle count */
  baffleCount: number;
  /** Actual tube count */
  tubeCount: number;
  /** Tube material density (kg/m³) for the vibrating mass */
  tubeDensityKgM3: number;
}

export interface ShellSideFlags {
  /** Design U above the computed shell-side film coefficient */
  uOverFilm: boolean;
  /** Pitch ratio outside the ESDU validity band */
  pitchOutOfRange: boolean;
  /** Bundle bypass fraction above the seal-strip advisory threshold */
  bypassHigh: boolean;
  /** Fluid-elastic instability ratio above 0.8 (HTRI guidance) */
  feiHigh: boolean;
  /** Vortex shedding within 10 % of the tube natural frequency */
  shedResonant: boolean;
  /** Acoustic mode within 20 % of the shedding frequency */
  acousticResonant: boolean;
}

export type ShellSideResult = (ShellSideCalc & { flags: ShellSideFlags }) | null;

/**
 * ESDU ideal bank × Bell corrections + Kern ΔP + vibration screening.
 * Returns null when the flow block is missing or physically incomplete, so the
 * caller can fall back to the existing guidance-only pressure drops.
 */
export function shellSideRating(input: ShellSideInput): ShellSideResult {
  const { hx, flow, shellID, bundleOD, baffleSpacing, baffleCount, tubeCount } = input;
  const m = flow.massFlowKgS;
  const rho = flow.densityKgM3;
  const mu = (flow.viscCp > 0 ? flow.viscCp : 1) / 1000; // cP → Pa·s
  const muW = flow.viscWallCp && flow.viscWallCp > 0 ? flow.viscWallCp / 1000 : mu;
  const cp = flow.cpKjKgK * 1000; // kJ/kg·K → J/kg·K
  const k = flow.condWmK;
  if (!(m > 0) || !(rho > 0) || !(mu > 0) || !(cp > 0) || !(k > 0)) return null;
  if (!(shellID > 0) || !(baffleSpacing > 0)) return null;

  const p = hx.pitch > 0 ? hx.pitch : hx.tubeOD * 1.25; // mm
  const doMm = hx.tubeOD;
  const doM = doMm / 1000;
  const diMm = doMm - 2 * hx.tubeWall;
  const angle = hx.layoutAngle;
  const staggered = angle !== 90;

  // Row/transverse pitches. Longitudinal row spacing = p·cos(θ) (p for 90° in-line);
  // transverse spacing = p for every layout. This is the same spacing the TEMA/
  // Delaware N_CT row count uses.
  const sL = angle === 90 ? p : p * Math.cos((angle * Math.PI) / 180);
  const sT = p;

  const bM = baffleSpacing / 1000;
  const shellM = shellID / 1000;
  const pitchM = p / 1000;

  // Kern crossflow area: S_S = D_s·(P_T − D_o)·L_B / P_T  (L_B = baffle spacing).
  const areaCT = (shellM * (pitchM - doM) * bM) / pitchM; // m²
  if (!(areaCT > 0)) return null;
  const gMass = m / areaCT; // kg/s·m²
  const vCross = gMass / rho; // m/s at bundle face
  const vMax = vCross * (pitchM / (pitchM - doM)); // m/s through the minimum gap

  const re = (rho * vMax * doM) / mu;
  const pr = (cp * mu) / k;
  const prW = pr * (mu / muW); // k assumed unchanged at the wall

  // --- ESDU 73031 ideal bank -------------------------------------------------
  const rowsInBundle = Math.max(1, Math.floor(bundleOD / sL));
  const nuIdeal = esduNusselt(re, pr, rowsInBundle, staggered, prW);
  const hIdeal = (nuIdeal * k) / doM;

  // --- Bell geometry ---------------------------------------------------------
  const cutMm = (hx.baffleCut / 100) * shellID;
  const rShell = shellID / 2;
  const rBundle = bundleOD / 2;
  const chord = rShell - cutMm; // window chord offset from the bundle centre
  const windowFrac = segmentFraction(rBundle, chord);
  const fc = Math.min(1, Math.max(0.05, 1 - 2 * windowFrac)); // tubes in crossflow
  const jC = bellJC(fc);

  // Leakage areas (cross-sections, m²): shell↔baffle annulus and tube holes.
  const aSb = (Math.PI / 4) * (shellID * shellID - (shellID - SHELL_BAFFLE_CLEAR_MM) ** 2) * 1e-6;
  const aTb =
    tubeCount *
    (Math.PI / 4) *
    ((doMm + TUBE_HOLE_CLEAR_MM) ** 2 - doMm * doMm) *
    1e-6;
  const leakTotal = aSb + aTb;
  const rS = aSb / Math.max(1e-12, leakTotal);
  const rLm = leakTotal / areaCT;
  const jL = bellJL(rS, rLm);

  // Bypass: shell-to-bundle gap over crossflow area; no seal strips credited.
  const aBp = (shellID - bundleOD) * baffleSpacing * 1e-6;
  const bypass = aBp / areaCT;
  const jB = bellJB(bypass, SEAL_STRIP_RSS);

  // Rows crossed between baffle tips and total row passes for the laminar term.
  const nCT = Math.max(1, Math.round((shellID - 2 * cutMm) / sL));
  const nRowPasses = nCT * (baffleCount + 1);
  let jR = 1;
  if (re > 20 && re < 100) {
    const jStar = Math.max(0.4, Math.pow(10 / Math.max(1, nRowPasses), 0.18));
    jR = jStar + ((re - 20) / 80) * (1 - jStar);
  }
  const jS = 1; // uniform baffle spacing assumed

  const hShell = hIdeal * jC * jL * jB * jR * jS;

  // --- Kern shell-side pressure drop ----------------------------------------
  const deM = (4 * (pitchM * pitchM - (Math.PI * doM * doM) / 4)) / (Math.PI * doM);
  const vKern = m / areaCT / rho;
  const reKern = (rho * deM * vKern) / mu;
  const f = kernFriction(reKern);
  const viscRatio = Math.pow(mu / muW, 0.14);
  const dP =
    (f * (vKern * rho) ** 2 * (shellID / 1000) * (baffleCount + 1)) /
    (2 * rho * deM * viscRatio);
  const dPBar = dP / 1e5;

  // --- Tube vibration screening ---------------------------------------------
  const vibration = tubeVibration({
    spanM: baffleSpacing / 1000,
    doM,
    diM: Math.max(1e-6, diMm / 1000),
    tubeDensityKgM3: input.tubeDensityKgM3,
    shellDensity: rho,
    velocityMs: vMax,
    // Acoustic path: 1-D half-wave across the shell diameter (documented
    // approximation — a real acoustic mode depends on the compartment shape).
    acousticPathM: shellM,
    flow,
  });

  const pitchRatio = p / doMm;
  const flags: ShellSideFlags = {
    uOverFilm: hx.uOverall > 0 && hx.uOverall > hShell,
    pitchOutOfRange: staggered ? pitchRatio < 1 || pitchRatio > 4 : pitchRatio < 1.2 || pitchRatio > 4,
    bypassHigh: bypass > 0.15,
    feiHigh: vibration ? vibration.feiRatio > 0.8 : false,
    shedResonant: vibration ? Math.abs(vibration.shedRatio - 1) <= 0.1 : false,
    acousticResonant: vibration && vibration.acousticHz !== null
      ? Math.abs(vibration.acousticHz - vibration.shedHz) / vibration.acousticHz <= 0.2
      : false,
  };

  return {
    reynolds: re,
    prandtl: pr,
    crossVelocityMs: vCross,
    maxVelocityMs: vMax,
    hIdeal,
    hShell,
    jC,
    jL,
    jB,
    jR,
    dPBar,
    bypassFraction: bypass,
    crossflowTubes: fc,
    vibration,
    flags,
  };
}

interface VibInput {
  spanM: number;
  doM: number;
  diM: number;
  tubeDensityKgM3: number;
  shellDensity: number;
  velocityMs: number;
  /** Effective acoustic path length for the half-wave mode (m) */
  acousticPathM: number;
  flow: ShellSideFlow;
}

/**
 * Classical tube-vibration screening:
 *  · natural frequency of a pinned-pinned span with added fluid mass
 *  · Connors fluid-elastic instability, Vcr = K·fn·sqrt(μeff·δ/ρ)
 *  · Strouhal vortex shedding and half-wave acoustic mode of the shell
 * K = 3.3 (conservative lower-bound Connors constant), δ = 0.1 and St = 0.2
 * are defaults, not code limits — all three are overridable in the flow block.
 */
export function tubeVibration(v: VibInput): TubeVibCalc | null {
  const { spanM, doM, diM, flow } = v;
  if (!(spanM > 0) || !(v.shellDensity > 0) || !(v.velocityMs >= 0)) return null;

  const e = (flow.youngGPa && flow.youngGPa > 0 ? flow.youngGPa : 193) * 1e9; // Pa
  const i = (Math.PI / 64) * (Math.pow(doM, 4) - Math.pow(diM, 4)); // m⁴
  const muMetal = v.tubeDensityKgM3 * (Math.PI / 4) * (doM * doM - diM * diM); // kg/m
  const ca = flow.addedMassCoef && flow.addedMassCoef > 0 ? flow.addedMassCoef : 1;
  const muAdded = ca * v.shellDensity * (Math.PI / 4) * doM * doM;
  const muEff = muMetal + muAdded;

  // Pinned-pinned fundamental: fn = (π/2L²)·sqrt(EI/μ)
  const fn = (Math.PI / (2 * spanM * spanM)) * Math.sqrt((e * i) / muEff);

  const kc = flow.connorsK && flow.connorsK > 0 ? flow.connorsK : 3.3;
  const delta = flow.logDecrement && flow.logDecrement > 0 ? flow.logDecrement : 0.1;
  const vCr = kc * fn * Math.sqrt((muEff * delta) / v.shellDensity);
  const fei = vCr > 0 ? v.velocityMs / vCr : 0;

  const st = flow.strouhal && flow.strouhal > 0 ? flow.strouhal : 0.2;
  const shedHz = (st * v.velocityMs) / doM;
  const shedRatio = fn > 0 ? shedHz / fn : 0;

  const sound = flow.soundSpeedMs && flow.soundSpeedMs > 0 ? flow.soundSpeedMs : null;
  const acousticHz = sound ? sound / (2 * Math.max(1e-6, v.acousticPathM)) : null;

  return {
    spanM,
    naturalHz: fn,
    velocityMs: v.velocityMs,
    criticalMs: vCr,
    feiRatio: fei,
    shedHz,
    shedRatio,
    acousticHz,
    mach: sound ? v.velocityMs / sound : null,
  };
}
