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

/** Radial direction of a nozzle at the given azimuth.
 *  Vertical vessel: 0° = north (+Z), turning clockwise viewed from above.
 *  Horizontal vessel: the axis lies down, so 0° = top of the shell (12 o'clock),
 *  90° = +X side, 180° = bottom — gas outlets at 0° and drains at 180°, which is
 *  how the demo tags are tagged. */
export function radialDirection(azimuthDeg: number, vertical: boolean): [number, number, number] {
  const a = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(a), 0, vertical ? Math.cos(a) : -Math.cos(a)];
}
