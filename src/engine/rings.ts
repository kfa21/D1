// External-pressure (vacuum) stiffening-ring inertia check.
//
// Basis — deliberately the PUBLIC code text, because the ASME VIII-1 UG-29
// procedure (its Y-factor figure, Fig. UG-29.2) is licensed data that this
// project does not reproduce, and the Zick saddle-stiffener-ring sizing
// equations live in the paywalled 1951/1971 Welding Journal paper and the
// Moss/Bednar handbooks. What is implemented here is the complete, publicly
// readable rule of 49 CFR 179.400-9 (US federal regulation, tank-car tanks):
//
//   effective shell width on each side of the ring   W = 0.78·√(R·t)
//   required inertia of the ring alone               I  = 0.035·D³·L·Pc/E
//   required inertia of ring + effective shell      I' = 0.046·D³·L·Pc/E
//
// with D = outside diameter, L = line-of-support to line-of-support distance,
// Pc = critical collapsing pressure, E = ring-material modulus. The same
// 0.78·√(Rt) effective-width form is the classical shell-participation width
// used in external-pressure ring work, and the section arithmetic (centroid,
// parallel-axis theorem, c, Z) is generic mechanics.
//
// Units are the internal convention: mm, MPa → I in mm⁴, Z in mm³. The
// 0.035/0.046/0.78 constants are dimensionless in the sense required, so the
// metric result equals the imperial one exactly (pinned in a golden test).
//
// Scope limits, stated in the code and in the UI:
//  * L is taken as the UG-28 unsupported length, divided into `count`+1 equal
//    bays when rings are specified (even spacing assumed).
//  * Pc is the vessel's design external pressure. The regulation itself sets a
//    37.5 psi (2.59 bar) minimum for its own rail-tank-car service; that
//    minimum is reported in the basis text, not applied as a design load.
//  * A single flat-bar ring is modelled. Angles and channels need their own
//    section arithmetic — not implemented.
//  * This is a ring-inertia check. It does not size the saddle-stiffener ring
//    for saddle horn loads (Zick) — that method is not publicly available.

/** Flat-bar stiffening ring, welded radially to the shell. */
export interface RingInput {
  /** Ring web depth measured radially (mm) */
  webDepthMm: number;
  /** Ring web thickness (mm) */
  webThkMm: number;
  /** Effective shell width participating with the ring, total (mm) */
  shellWidthMm: number;
  /** Shell thickness (mm) */
  shellThkMm: number;
}

export interface RingSection {
  /** Ring area (mm²) */
  ringAreaMm2: number;
  /** Combined centroid measured from the shell mid-surface (mm) */
  centroidMm: number;
  /** Combined moment of inertia about the neutral axis (mm⁴) */
  inertiaMm4: number;
  /** Distance from the neutral axis to the extreme fibre (mm) */
  cMm: number;
  /** Combined section modulus I/c (mm³) */
  sectionModulusMm3: number;
  /** Ring alone, about its own centroidal axis (mm⁴) */
  ringInertiaMm4: number;
}

/**
 * Effective shell width that participates with the ring, on ONE side:
 * W = 0.78·√(R·t) — 49 CFR 179.400-9(b).
 */
export function effectiveShellWidth(rMm: number, tMm: number): number {
  if (!(rMm > 0) || !(tMm > 0)) return 0;
  return 0.78 * Math.sqrt(rMm * tMm);
}

/**
 * Required ring inertia: I = 0.035·D³·L·Pc/E (ring alone) and
 * I' = 0.046·D³·L·Pc/E (ring + effective shell) — 49 CFR 179.400-9(d).
 * D and L in mm, Pc and E in MPa → result in mm⁴.
 */
export function requiredRingInertia(
  dOutsideMm: number,
  lengthMm: number,
  collapseMpa: number,
  youngMpa: number
): { ringAlone: number; combined: number } {
  if (!(dOutsideMm > 0) || !(lengthMm > 0) || !(collapseMpa > 0) || !(youngMpa > 0)) {
    return { ringAlone: 0, combined: 0 };
  }
  const common = (dOutsideMm ** 3 * lengthMm * collapseMpa) / youngMpa;
  return { ringAlone: 0.035 * common, combined: 0.046 * common };
}

/**
 * Combined flat-bar ring + effective shell strip, about the axis parallel to
 * the vessel axis. The two shell strips (one each side of the ring) are
 * coplanar with the shell, so they act as a single rectangle of width
 * `shellWidthMm` whose own centroid is at the shell mid-surface; the ring is
 * welded to a shell surface, so its centroid is at t/2 + h/2 from that datum.
 */
export function combinedRingSection(r: RingInput): RingSection {
  const h = Math.max(0, r.webDepthMm);
  const tr = Math.max(0, r.webThkMm);
  const w = Math.max(0, r.shellWidthMm);
  const t = Math.max(0, r.shellThkMm);
  const aRing = h * tr;
  const aShell = w * t;
  const total = aRing + aShell;
  if (!(total > 0)) {
    return { ringAreaMm2: 0, centroidMm: 0, inertiaMm4: 0, cMm: 0, sectionModulusMm3: 0, ringInertiaMm4: 0 };
  }
  // The ring is welded to a shell surface, so its centroid sits half a shell
  // thickness away from the mid-surface as well as at mid-depth of the web.
  const yRing = t / 2 + h / 2;
  const y = (aRing * yRing) / total;
  const iRing = (tr * h ** 3) / 12;
  const iShell = (w * t ** 3) / 12;
  const inertia = iShell + aShell * y * y + iRing + aRing * (yRing - y) ** 2;
  const cMm = Math.max(y + t / 2, yRing + h / 2 - y);
  return {
    ringAreaMm2: aRing,
    centroidMm: y,
    inertiaMm4: inertia,
    cMm,
    sectionModulusMm3: cMm > 0 ? inertia / cMm : 0,
    ringInertiaMm4: iRing,
  };
}

export interface StiffenerRingResult {
  /** Effective shell width on each side of the ring (mm) */
  effectiveWidthMm: number;
  /** Line-of-support to line-of-support length used (mm) */
  lengthMm: number;
  /** Number of rings assumed between the lines of support */
  rings: number;
  /** Required inertia, ring alone (mm⁴) */
  reqRingMm4: number;
  /** Required inertia, ring + effective shell (mm⁴) */
  reqCombinedMm4: number;
  /** Section properties of the supplied ring, when one is drawn */
  section: RingSection | null;
  /** Inertia check satisfied (ring alone or combined) */
  ok: boolean;
  basis: string;
}

/**
 * Full ring check. `webDepthMm`/`webThkMm` = 0 means no ring section has been
 * drawn yet — the requirement is still reported so it can be specified.
 */
export function stiffenerRingCheck(p: {
  dOutsideMm: number;
  shellThkMm: number;
  lengthMm: number;
  collapseBar: number;
  youngGPa?: number;
  webDepthMm?: number;
  webThkMm?: number;
  count?: number;
}): StiffenerRingResult {
  const e = (p.youngGPa && p.youngGPa > 0 ? p.youngGPa : 193) * 1e3; // MPa
  const rings = Math.max(0, Math.floor(p.count ?? 0));
  const lengthMm = p.lengthMm / (rings + 1); // equal bays between lines of support
  const w = effectiveShellWidth(p.dOutsideMm / 2, p.shellThkMm);
  const req = requiredRingInertia(p.dOutsideMm, lengthMm, p.collapseBar / 10, e);

  const hasSection = (p.webDepthMm ?? 0) > 0 && (p.webThkMm ?? 0) > 0;
  const section = hasSection
    ? combinedRingSection({
        webDepthMm: p.webDepthMm!,
        webThkMm: p.webThkMm!,
        shellWidthMm: 2 * w,
        shellThkMm: p.shellThkMm,
      })
    : null;

  const ok = section
    ? section.inertiaMm4 >= req.combined || section.ringInertiaMm4 >= req.ringAlone
    : false;

  return {
    effectiveWidthMm: w,
    lengthMm,
    rings,
    reqRingMm4: req.ringAlone,
    reqCombinedMm4: req.combined,
    section,
    ok,
    basis:
      'Ring inertia per 49 CFR 179.400-9(b),(d) (public code text): W = 0.78·√(R·t) effective shell each side, I = 0.035·D³·L·Pc/E (ring alone) or I′ = 0.046·D³·L·Pc/E (combined). The regulation sets a 37.5 psi (2.59 bar) minimum Pc for its own rail-tank-car service; here Pc is the vessel design external pressure. ASME VIII-1 UG-29 (Y-factor method) and Zick saddle-ring sizing are licensed/paywalled and are NOT reproduced.',
  };
}
