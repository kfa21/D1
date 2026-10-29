// Layout maths for the 3D viewer and the CAD exports — pure functions, no
// three.js, so every placement rule below is unit-testable.
//
// Local coordinates used by both views:
//   y = 0            bottom head tip (flat bottom: the shell bottom itself)
//   y = bottomDepth  vessel datum — nozzle elevations are measured from here
//                    (bottom tangent line, matching NozzleSpec.elevation)
//   +Y               vessel axis; the renderer lays a horizontal vessel down
//                    with a 90° rotation about X, after which local +Z points
//                    to the ground and local −Z points to the sky.

import type { HeadType, SectionCalc } from './types';

/** Geometry of a conical head — the outside profile depth (mm).
 *  Values mirror asme.ts headGeom(): torispherical D = 0.152·D, F&D = 0.1935·D,
 *  2:1 ellipsoidal = 0.25·D, hemispherical = 0.5·D (D = 2R = inside diameter).
 *  F&D additionally carries the head nominal wall, because the solid model is
 *  drawn from the outside surface. */
export function headDepthMm(h: { type: HeadType; tMinNominal?: number }, R: number): number {
  const t = 'tMinNominal' in h ? h.tMinNominal ?? 0 : 0;
  switch (h.type) {
    case 'hemi':
      return R;
    case 'ellip2':
      return R / 2;
    case 'toriD':
      return 0.152 * (2 * R);
    case 'toriFD':
      return 0.1935 * (2 * R) + t;
    default:
      return 0;
  }
}

/** One continuous surface of the pressure boundary (shell course or cone). */
export interface BodySegment {
  kind: 'shell' | 'cone';
  /** local Y bounds */
  y0: number;
  y1: number;
  /** surface radius at y0 / y1 (mm) */
  r0: number;
  r1: number;
  /** section this surface belongs to (the UPPER section for a cone) */
  sectionIndex: number;
  /** cone drawn although the engine produced no cone spec (diameter step) */
  assumed?: boolean;
}

export interface BodyLayout {
  segments: BodySegment[];
  /** bottom head depth; the shell datum sits here (0 for a flat bottom) */
  bottomDepth: number;
  /** local Y of the top of the last shell/cone segment */
  stackTop: number;
  /** local Y of the top head tip — overall model length */
  totalLen: number;
  /** top head geometry, for callers that need its depth */
  topHeadDepth: number;
}

/** Build the connected boundary of a (possibly multi-diameter) vessel.
 *  The cone joins an upper section to the one below it (SectionSpec.coneAngleDeg),
 *  so it is taken from the NEXT section while walking the stack — the same
 *  association the length accounting uses, which is what keeps supports,
 *  nozzles and the camera framing on the real geometry. */
export function buildBodyLayout(sections: SectionCalc[]): BodyLayout {
  const segments: BodySegment[] = [];
  const first = sections[0];
  const bottomDepth =
    first?.headBot && first.headBot.type !== 'none' ? headDepthMm(first.headBot, first.spec.dia / 2) : 0;

  let y = bottomDepth;
  sections.forEach((sc, i) => {
    const R = sc.spec.dia / 2;
    const L = Math.max(0, sc.spec.ttLength);
    segments.push({ kind: 'shell', y0: y, y1: y + L, r0: R, r1: R, sectionIndex: i });
    y += L;

    const next = sections[i + 1];
    if (!next) return;
    const Rn = next.spec.dia / 2;
    const dR = R - Rn;
    if (Math.abs(dR) < 0.5) return; // same diameter → continuous shell
    const cone = next.cone;
    const halfDeg = cone && cone.theta > 0 ? Math.max(3, cone.theta / 2) : 15;
    const hC = Math.max(120, Math.abs(dR) / Math.tan((halfDeg * Math.PI) / 180));
    // r0 = lower course radius, r1 = upper course radius — the cone must follow
    // the actual diameters, not always widen upwards.
    segments.push({ kind: 'cone', y0: y, y1: y + hC, r0: R, r1: Rn, sectionIndex: i + 1, assumed: !cone });
    y += hC;
  });

  const stackTop = y;
  const last = sections[sections.length - 1];
  const topHeadDepth =
    last?.headTop && last.headTop.type !== 'none' ? headDepthMm(last.headTop, last.spec.dia / 2) : 0;

  return { segments, bottomDepth, stackTop, totalLen: stackTop + topHeadDepth, topHeadDepth };
}

/** Radius of the drawn surface at a local Y (clamped to the stack). */
export function radiusAtY(layout: BodyLayout, y: number): number {
  const seg = segmentAtY(layout, y);
  return seg ? radiusIn(seg, y) : 0;
}

/** Linear radius of a segment at local Y. */
export function radiusIn(seg: BodySegment, y: number): number {
  const span = seg.y1 - seg.y0;
  if (span <= 0 || seg.r0 === seg.r1) return seg.r0;
  const t = Math.min(1, Math.max(0, (y - seg.y0) / span));
  return seg.r0 + (seg.r1 - seg.r0) * t;
}

/** Segment containing local Y; null for an empty stack. Y outside the stack is
 *  clamped to the nearest end so a stale elevation never jumps to the bottom. */
export function segmentAtY(layout: BodyLayout, y: number): BodySegment | null {
  const segs = layout.segments;
  if (!segs.length) return null;
  const yC = Math.min(Math.max(y, segs[0].y0), segs[segs.length - 1].y1);
  return segs.find((s) => yC >= s.y0 && yC <= s.y1) ?? segs[segs.length - 1];
}

export interface NozzlePlacement {
  /** local Y of the nozzle centreline */
  y: number;
  /** surface radius at that Y (mm) */
  r: number;
  segment: BodySegment;
  /** elevation was outside the shell — clamped to the nearest end */
  clamped: boolean;
}

/** Place a nozzle from its elevation (mm above the bottom tangent).
 *  Returns null when the equipment has no drawable shell. */
export function locateNozzle(layout: BodyLayout, elevation: number): NozzlePlacement | null {
  const segs = layout.segments;
  if (!segs.length) return null;
  const e = Number.isFinite(elevation) ? elevation : 0;
  const target = layout.bottomDepth + e;
  const lo = segs[0].y0;
  const hi = segs[segs.length - 1].y1;
  const clamped = target < lo || target > hi;
  const y = Math.min(Math.max(target, lo), hi);
  const segment = segs.find((s) => y >= s.y0 && y <= s.y1) ?? segs[segs.length - 1];
  return { y, r: radiusIn(segment, y), segment, clamped };
}

export interface SaddleStation {
  y: number;
  r: number;
}

/** Saddle stations for a horizontal vessel: symmetric about the SHELL centre
 *  (previously they were centred on y = 0, which hung one saddle off the end of
 *  the vessel), each kept clear of the very ends and measured against the local
 *  radius so a multi-diameter drum is supported on the course it sits over. */
export function saddleStations(layout: BodyLayout, spanMm: number): { stations: SaddleStation[]; span: number } {
  const segs = layout.segments;
  const y0 = segs[0]?.y0 ?? 0;
  const y1 = segs[segs.length - 1]?.y1 ?? y0;
  const shell = Math.max(0, y1 - y0);
  const edge = Math.min(300, shell * 0.1);
  const lo = y0 + edge;
  const hi = Math.max(lo, y1 - edge);
  const span = spanMm > 0 ? spanMm : shell * 0.6;
  const c = (y0 + y1) / 2;
  const clamp = (v: number) => Math.min(Math.max(v, lo), hi);
  const ys = [clamp(c - span / 2), clamp(c + span / 2)];
  return {
    span,
    stations: ys.map((y) => ({ y, r: radiusAtY(layout, y) })),
  };
}

/** A revolved head profile, sampled from the rim to the apex.
 *  `points[0]` is the tangent point (r = R, y = 0); the last point is the apex
 *  (r = 0, y = depth). Ready for a lathe/revolve in the viewer or a DXF. */
export interface HeadProfile {
  points: [number, number][];
  /** apex height above the tangent line that the profile is drawn at (mm) */
  depth: number;
  /** crown (dish) radius used by the profile */
  crownR: number;
  /** knuckle radius used by the profile (0 for a plain sphere / ellipse) */
  knuckleR: number;
  /** depth the exact crown+knuckle geometry gives before depth normalisation */
  exactDepth: number;
}

/**
 * Revolve profile of a dished head. Torispherical heads are built as the real
 * crown + knuckle pair (two tangent arcs), not a scaled sphere cap: the knuckle
 * is centred at (R − r, 0) so the surface leaves the shell vertically, then the
 * crown sphere (radius L) is placed on the axis at the internal-tangency centre
 * |C − K| = L − r. The resulting height is normalised to the head depth the
 * engine uses (`headDepthMm`), so the drawn head still lands exactly on the
 * shell datum the T-T length and every nozzle elevation are measured from.
 */
export function headProfile(
  h: { type: HeadType; tMinNominal?: number },
  R: number,
  depthMm?: number
): HeadProfile {
  const target = depthMm && depthMm > 0 ? depthMm : headDepthMm(h, R);
  const N = 20;
  const pts: [number, number][] = [];
  const push = (r: number, y: number) => {
    if (Number.isFinite(r) && Number.isFinite(y)) pts.push([Math.max(0, r), Math.max(0, y)]);
  };

  if (h.type === 'hemi' || h.type === 'ellip2') {
    const rise = h.type === 'hemi' ? R : R / 2;
    for (let i = 0; i <= N * 2; i++) {
      const a = (i / (N * 2)) * (Math.PI / 2);
      push(R * Math.cos(a), rise * Math.sin(a));
    }
    return { points: pts, depth: rise, crownR: R, knuckleR: 0, exactDepth: rise };
  }

  if (h.type !== 'toriFD' && h.type !== 'toriD') {
    return { points: [[R, 0]], depth: 0, crownR: 0, knuckleR: 0, exactDepth: 0 };
  }

  // Torispherical: L = crown radius = D (as in asme.ts headGeometry),
  // r = knuckle radius (6 % D for F&D, 17 % D for the D-type).
  const D = 2 * R;
  const L = D;
  const r = Math.min(R * 0.49, (h.type === 'toriFD' ? 0.06 : 0.17) * D);
  const kx = R - r; // knuckle centre, radially
  const dKC = Math.max(1e-6, L - r); // |C − K| at internal tangency
  const under = dKC * dKC - kx * kx;

  if (!(r > 0) || kx <= 0 || under <= 0) {
    // degenerate proportions — fall back to an elliptical cap of the right depth
    for (let i = 0; i <= N * 2; i++) {
      const a = (i / (N * 2)) * (Math.PI / 2);
      push(R * Math.cos(a), target * Math.sin(a));
    }
    return { points: pts, depth: target, crownR: L, knuckleR: r, exactDepth: target };
  }

  const yc = -Math.sqrt(under); // crown centre on the axis (below the tangent)
  // knuckle: centre K = (kx, 0), leaving the shell vertically at (R, 0)
  const ux = kx / dKC; // unit vector K → tangency point (away from the crown centre)
  const uy = -yc / dKC;
  const alphaT = Math.atan2(uy, ux); // knuckle sweep angle
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * alphaT;
    push(kx + r * Math.cos(a), r * Math.sin(a));
  }
  // crown: from the tangency point up to the axis apex
  const beta0 = Math.atan2(-yc, kx); // angle of (P − C), both components share (dKC + r)/dKC
  for (let i = 1; i <= N; i++) {
    const b = beta0 + (i / N) * (Math.PI / 2 - beta0);
    push(L * Math.cos(b), yc + L * Math.sin(b));
  }

  const exactDepth = yc + L;
  const scale = exactDepth > 1e-6 ? target / exactDepth : 1;
  const scaled: [number, number][] = pts.map(([x, y]) => [x, y * scale]);
  return { points: scaled, depth: target, crownR: L, knuckleR: r, exactDepth };
}

/** Radius of a head profile at a height above its tangent line (clamped). */
export function headRadiusAt(profile: HeadProfile, riseMm: number): number {
  const pts = profile.points;
  if (!pts.length) return 0;
  const h = Math.min(Math.max(0, riseMm), profile.depth);
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1];
    const [r1, y1] = pts[i];
    if (h >= y0 && h <= y1) {
      const t = y1 - y0 <= 1e-9 ? 0 : (h - y0) / (y1 - y0);
      return r0 + t * (r1 - r0);
    }
  }
  return pts[pts.length - 1][0];
}

/**
 * Place a nozzle that penetrates a DISHED END. The elevation is measured along
 * the axis from the tangent line the head leaves (0 = tangent, + up/down into the
 * head), so a top-head nozzle shares the same datum as every shell nozzle.
 * `outside` reports an elevation that runs past the head depth (crown).
 */
export function locateHeadNozzle(
  layout: BodyLayout,
  elevation: number,
  attach: 'topHead' | 'bottomHead',
  sectionFor: (index: number) => SectionCalc | undefined,
  lastIndex: number
): { y: number; r: number; outside: boolean } | null {
  const e = Number.isFinite(elevation) ? Math.max(0, elevation) : 0;
  const firstSec = sectionFor(0);
  const lastSec = sectionFor(lastIndex);
  const head =
    attach === 'topHead'
      ? lastSec?.headTop
      : firstSec?.headBot;
  const R = (attach === 'topHead' ? lastSec?.spec.dia : firstSec?.spec.dia) ?? 0;
  if (!head || !(R > 0)) return null;
  const profile = headProfile(head, R / 2);
  const outside = e > profile.depth + 1e-6;
  const rise = Math.min(e, profile.depth);
  const y = attach === 'topHead' ? layout.stackTop + rise : layout.bottomDepth - rise;
  return { y, r: headRadiusAt(profile, rise), outside };
}

/** Radial direction of a nozzle at the given azimuth.
 *  Vertical vessel: 0° = north (+Z), turning clockwise viewed from above.
 *  Horizontal vessel: the axis lies down, so 0° = top of the shell (12 o'clock),
 *  90° = +X side, 180° = bottom — gas outlets at 0° and drains at 180°, which is
 *  how the demo tags are tagged. */
export function radialDirection(azimuthDeg: number, vertical: boolean): [number, number, number] {
  const a = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(a), 0, vertical ? Math.cos(a) : -Math.cos(a)];
}
