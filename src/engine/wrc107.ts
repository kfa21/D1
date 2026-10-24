// Nozzle local-load screening — WRC 107 structure + Kellogg equivalent pressure.
//
// What is implemented (all from accessible published sources):
//  * Shell shear at a ROUND attachment, exact WRC 107 (2002 update) equations:
//        tau = V / (pi * r0 * T)          (transverse shear, both directions summed)
//        tau = Mt / (2 * pi * r0^2 * T)   (torsion)
//    with r0 = attachment outside radius (pad radius when padded — the usual
//    "rigid plug at the pad edge" screening assumption), T = corroded shell wall.
//  * Nominal nozzle-neck stresses from thin-wall section properties
//    (A ~ 2*pi*r*tn, Z ~ pi*r^2*tn, J ~ 2*pi*r^3*tn).
//  * Kellogg equivalent pressure  Pe = 4F/(pi*G^2) + 16M/(pi*G^3)  from the
//    resultant external loads, added to the design pressure for the B16.5
//    flange-rating check (the classic equivalent-pressure use).
//  * WRC geometry parameters gamma = Rm/T and beta = 0.875*r0/Rm, with a
//    chart-range advisory above beta ~ 0.126.
//
// What is deliberately NOT implemented: the curve-based WRC 107/537 shell
// membrane/bending response (the figures/precision equations are copyrighted
// WRC bulletin data, not reproducible here). Those full local stresses need
// the licensed WRC 107/537 publication (or WRC 297 for the nozzle side) —
// every screened nozzle carries the NL-01 caveat. Screening acceptance uses a
// typical primary+secondary local-load criterion of 1.5 x S — verify against
// the governing code edition / project specification.

import type { NozzleLoadCalc, NozzleLoads, Warning } from './types';

/** Convert the user-entered loads (kN / kN·m, nozzle local axes) to N / N·mm. */
export function toSI(l: NozzleLoads): {
  P: number; V1: number; V2: number; Mt: number; Mo1: number; Mo2: number;
} {
  return {
    P: l.fx * 1000,
    V1: l.fy * 1000,
    V2: l.fz * 1000,
    Mt: l.mx * 1e6,
    Mo1: l.my * 1e6,
    Mo2: l.mz * 1e6,
  };
}

export function hasLoad(l?: NozzleLoads): boolean {
  if (!l) return false;
  return [l.fx, l.fy, l.fz, l.mx, l.my, l.mz].some((v) => Math.abs(v) > 1e-9);
}

/**
 * Nominal thin-wall nozzle-neck stresses (MPa) — verified textbook forms for
 * r mean radius, tn wall, loads in N / N·mm.
 * Reference example (published comparison of simplified forms): r = 50 mm,
 * tn = 10 mm, P = 10 kN, V = 5 kN, M = 1 kN·m, Mt = 0.5 kN·m gives
 * 3.18 / 12.73 / 1.59 / 3.18 MPa — pinned by a golden test.
 */
export function neckStresses(P: number, V: number, M: number, Mt: number, r: number, tn: number): {
  axial: number; bend: number; torsion: number; shear: number; vonMises: number;
} {
  const rr = Math.max(1e-6, r);
  const tt = Math.max(1e-6, tn);
  const axial = P / (2 * Math.PI * rr * tt);
  const bend = Math.abs(M) / (Math.PI * rr * rr * tt);
  const torsion = Math.abs(Mt) / (2 * Math.PI * rr * rr * tt);
  const shear = Math.abs(V) / (2 * Math.PI * rr * tt);
  const sigma = axial + bend; // axial + bending fibre stress
  const tau = torsion + shear; // conservative direct sum
  return { axial, bend, torsion, shear, vonMises: Math.sqrt(sigma * sigma + 3 * tau * tau) };
}

/** Kellogg equivalent pressure (bar) from resultant force F (N), moment M (N·mm)
 *  over the attachment/gasket reaction diameter G (mm). */
export function kelloggEquivPressureBar(F: number, M: number, G: number): number {
  if (G <= 0) return 0;
  const peMPa = (4 * F) / (Math.PI * G * G) + (16 * M) / (Math.PI * G * G * G);
  return peMPa * 10; // MPa → bar
}

/** Exact WRC 107 shell shear at a round attachment (MPa), conservative direct
 *  sum of the two transverse shears and torsion. */
export function wrcShellShear(V1: number, V2: number, Mt: number, r0: number, T: number): number {
  if (r0 <= 0 || T <= 0) return 0;
  const tauV = (Math.abs(V1) + Math.abs(V2)) / (Math.PI * r0 * T);
  const tauT = Math.abs(Mt) / (2 * Math.PI * r0 * r0 * T);
  return tauV + tauT;
}

/**
 * Full local-load screening for one nozzle. Returns null when the nozzle has
 * no loads or the geometry degenerates (zero wall) — the caller then skips
 * cleanly, so existing nozzles without loads are unaffected.
 */
export function screenNozzleLoad(args: {
  loads: NozzleLoads;
  /** nozzle outside diameter, new (mm) */
  odMm: number;
  /** effective pad outside diameter (mm), 0 = unpadded */
  padDiaMm: number;
  /** corroded bore (mm) */
  boreCorrMm: number;
  /** corroded neck wall (mm) */
  wallCorrMm: number;
  /** corroded shell wall at the junction (mm) */
  tShellMm: number;
  /** shell inside diameter (mm) */
  shellDiaMm: number;
  /** design pressure at the junction (MPa) — combined with the load shear on
   *  the shell side (pressure membrane is already covered by UG-27 alone;
   *  the interaction adds the WRC shear contribution) */
  PdesignMPa: number;
  /** material allowable at design temperature (MPa) */
  S: number;
}): NozzleLoadCalc | null {
  const { loads, tShellMm, S } = args;
  if (!hasLoad(loads)) return null;
  const T = tShellMm;
  const tn = args.wallCorrMm;
  if (T <= 0 || tn <= 0 || args.odMm <= 0) return null;

  const l = toSI(loads);
  const r0 = args.padDiaMm > 0 ? args.padDiaMm / 2 : args.odMm / 2;
  const Rm = args.shellDiaMm / 2 + T / 2;

  // WRC 107 shell shear (exact bulletin equations)
  const shellShear = wrcShellShear(l.V1, l.V2, l.Mt, r0, T);

  // Nominal nozzle-neck stresses
  const rn = args.boreCorrMm / 2 + tn / 2; // mean radius
  const Mres = Math.hypot(l.Mo1, l.Mo2);
  const Fres = Math.hypot(l.P, l.V1, l.V2);
  const Mtres = Math.abs(l.Mt);
  const neck = neckStresses(Math.abs(l.P), Math.hypot(l.V1, l.V2), Mres, Mtres, rn, tn);

  // Kellogg equivalent pressure over the attachment diameter (flange check)
  const G = 2 * r0;
  const peBar = kelloggEquivPressureBar(Fres, Math.hypot(l.Mt, l.Mo1, l.Mo2), G);

  // Screening: on the SHELL side combine the biaxial pressure membrane
  // (σ_h = P·D/2T, σ_l = σ_h/2) with the WRC shear via von Mises — the pressure
  // alone is already checked by UG-27, so this is the P + local-load
  // interaction. The NECK side stays load-only (neck pressure is covered by
  // UG-45/UG-27 trn). Both vs a typical local-load allowable of 1.5·S.
  const allow = 1.5 * S;
  const sigmaH = (Math.max(0, args.PdesignMPa) * args.shellDiaMm) / (2 * T);
  const sigmaL = sigmaH / 2;
  const shellVm = Math.sqrt(
    Math.max(0, sigmaH * sigmaH - sigmaH * sigmaL + sigmaL * sigmaL + 3 * shellShear * shellShear)
  );
  const util = Math.max(shellVm, neck.vonMises) / Math.max(1e-6, allow);

  return {
    P: l.P, V1: l.V1, V2: l.V2, Mt: l.Mt, Mo1: l.Mo1, Mo2: l.Mo2,
    r0Mm: r0, RmMm: Rm, tShellMm: T,
    gamma: Rm / Math.max(1e-6, T),
    beta: (0.875 * r0) / Rm,
    shellShearMPa: shellShear,
    shellPressureMPa: sigmaH,
    shellVmMPa: shellVm,
    neckAxialMPa: neck.axial,
    neckBendMPa: neck.bend,
    neckTorsionMPa: neck.torsion,
    neckShearMPa: neck.shear,
    neckVonMisesMPa: neck.vonMises,
    equivPressureBar: peBar,
    util,
    allowMPa: allow,
    ok: util <= 1,
  };
}

/** Emit the screening caveat + result warnings for a screened nozzle. */
export function loadWarnings(tag: string, lc: NozzleLoadCalc, warnings: Warning[]): void {
  warnings.push({
    level: 'info',
    code: 'NL-01',
    msg: `Nozzle ${tag}: local-load screening — shell ${lc.shellVmMPa.toFixed(1)} MPa (P ${lc.shellPressureMPa.toFixed(1)} + shear ${lc.shellShearMPa.toFixed(1)}), neck ${lc.neckVonMisesMPa.toFixed(1)} MPa vs ${(lc.allowMPa).toFixed(0)} MPa (1.5·S), Pe = ${lc.equivPressureBar.toFixed(1)} bar · full curve-based WRC 107/537 shell stresses require the licensed bulletin`,
  });
  if (!lc.ok) {
    warnings.push({
      level: 'warning',
      code: 'NL-02',
      msg: `Nozzle ${tag}: local-load screening utilisation ${(lc.util * 100).toFixed(0)}% > 100% — reduce piping loads or add a reinforcing pad / set-on pad (WRC 107 screening)`,
    });
  }
  if (lc.beta > 0.126) {
    warnings.push({
      level: 'info',
      code: 'NL-03',
      msg: `Nozzle ${tag}: attachment ratio β = ${lc.beta.toFixed(3)} > 0.126 — beyond the common WRC 107 chart range; a full WRC/FEA check is advised`,
    });
  }
}
