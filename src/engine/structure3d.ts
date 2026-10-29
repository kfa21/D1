// Access and support steelwork descriptors for the 3D viewer.
//
// Every equipment family needs the same site furniture: a way up (caged ladder,
// guided ladder or stair), somewhere to stand (platforms, landings, walkways)
// and something to stop you falling (top rail, mid rail, toe board, fan guards).
// The previous viewer drew a spiral stair on tanks and nothing at all on vessels
// or air coolers, so the picture never showed how the equipment is accessed.
//
// Everything here is expressed in ONE upright "erection" frame:
//   x, z  plan position (mm),  y  height ABOVE GRADE (mm, 0 = grade)
// so a ladder is vertical, a platform is a horizontal XZ deck and a walkway is a
// run between two plan points. The viewer rotates that frame per family:
//   • vertical vessel  → shift down by the support height
//   • horizontal vessel → lay the frame on its side (axial = descriptor z)
//   • tank / air cooler → used as-is (grade is already y = 0)
//
// Sizes follow the usual access practice (OSHA 1910.23 / 29 CFR 1910.28, API 650
// §5.10, API 661 §7): 460 mm ladder width, 300 mm rung pitch, cage from 2.2 m,
// 1070 mm top rail, 550 mm mid rail, 100 mm toe board, 175 mm stair rise.
// The masses are INDICATIVE section weights so the panel can show what the
// access steel weighs; they are not a substitute for the Structure calculation.

import type { Equipment, EquipmentCalc, SectionCalc } from './types';
import { buildBodyLayout, radiusAtY, type BodyLayout } from './layout3d';
import { finFanModel, tankModel } from './model3d';

// ---------------------------------------------------------------------------
// Access dimensions and section weights
// ---------------------------------------------------------------------------

export const ACCESS = {
  /** top rail height above the deck (OSHA 42 in) */
  railHeightMm: 1070,
  /** mid rail height above the deck */
  midRailMm: 550,
  /** toe board height */
  toeBoardMm: 100,
  /** clear walkway width of a platform / walkway */
  walkWidthMm: 900,
  /** ladder stringer spacing */
  ladderWidthMm: 460,
  /** rung vertical pitch (OSHA 12 in) */
  rungPitchMm: 300,
  /** a cage is required above this height */
  cageFromMm: 2200,
  /** ladder guide rails once a ladder is long enough to need standoff bracing */
  guideRailsFromMm: 6000,
  /** maximum climb between rests (OSHA 9.1 m) — longer climbs get a stair tower */
  stairAboveMm: 12000,
  /** handrail post spacing */
  postPitchMm: 1500,
  /** sign convention for azimuths, matching the nozzle/azimuth helpers: 0 = +Z, clockwise */
} as const;

/** Indicative mass of the steel sections used above (kg/m, kg/m² or kg each). */
export const ACCESS_STEEL = {
  gratingKgM2: 28, // 25 × 5 serrated grating with trim
  framingKgM: 21.5, // HEA 140 platform beams
  railKgM: 3.4, // Ø42.4 × 3.2 handrail pipe
  toeKgM: 2.2, // 100 × 5 toe board
  ladderStringerKgM: 7.2, // C 100 × 50 ladder stringer
  rungKgM: 3.1, // Ø20 rung bar
  cageHoopKg: 2.6, // bent 20 × 5 flat hoop
  cageStrapKgM: 2.2, // 50 × 6 cage strap
  stairStringerKgM: 14, // C 200 stair stringer
  treadKg: 6.2, // 250 × 800 grating tread + nosing
  braceKgM: 12, // L 70 × 7 bracing
  skidBeamKgM: 44, // HEB 220 skid beam
  columnKgM: 52, // HEB 200 column
} as const;

// ---------------------------------------------------------------------------
// Descriptor types
// ---------------------------------------------------------------------------

export interface AccessLadder {
  label: string;
  detail: string;
  /** plan position of the ladder centreline */
  x: number;
  z: number;
  /** climb from / to, heights above grade */
  y0: number;
  y1: number;
  widthMm: number;
  /** outward face direction (deg, 0 = +Z, clockwise) */
  facingDeg: number;
  rungPitchMm: number;
  /** cage starts at this height above grade (0 = no cage) */
  cageFromY: number;
  /** standoff guide rails for a tall unbraced ladder */
  guideRails: boolean;
  kg: number;
}

export interface AccessStair {
  label: string;
  detail: string;
  kind: 'straight' | 'spiral';
  x: number;
  z: number;
  y0: number;
  y1: number;
  widthMm: number;
  /** straight: number of flights, each ending on a landing */
  flights: number;
  headingDeg: number;
  /** spiral */
  radiusMm: number;
  riseMm: number;
  steps: number;
  startDeg: number;
  stepAngleDeg: number;
  kg: number;
}

export interface AccessPlatform {
  label: string;
  detail: string;
  kind: 'ring' | 'rect';
  y: number;
  /** ring deck: radii and the swept sector, centred on azimuthDeg */
  r0: number;
  r1: number;
  azimuthDeg: number;
  sweepDeg: number;
  /** rect deck: plan centre and half extents */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  railHeightMm: number;
  /** edges that carry handrail + toe board */
  rails: ('north' | 'south' | 'east' | 'west' | 'outer' | 'inner')[];
  /** ring decks: the outer rail is interrupted for the ladder, centred here */
  gapAzimuthDeg?: number;
  /** ring decks: angular width of that ladder opening (deg) */
  gapDeg?: number;
  kg: number;
}

export interface AccessWalkway {
  label: string;
  detail: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** deck height at each end (a roof walkway follows the roof slope) */
  y0: number;
  y1: number;
  widthMm: number;
  rails: boolean;
  kg: number;
}

/** Loose linear member: leg bracing, standoff brackets, cage straps… */
export interface AccessBar {
  label: string;
  detail: string;
  a: [number, number, number];
  b: [number, number, number];
  diaMm: number;
  kg: number;
}

/** Rail ring around an opening (roof edge, fan intake) — no deck. */
export interface AccessGuard {
  label: string;
  detail: string;
  y: number;
  radiusMm: number;
  azimuthDeg: number;
  sweepDeg: number;
  heightMm: number;
  kg: number;
}

/** Structural frame around the tag (only when a structure is selected). */
export interface AccessFrame {
  kind: 'skid' | 'portal' | 'pedestal' | 'platform';
  label: string;
  detail: string;
  /** plan half extents and height above grade */
  hx: number;
  hz: number;
  heightMm: number;
  rails: boolean;
  kg: number;
}

export interface AccessRow {
  label: string;
  value: string;
  note?: string;
  tone?: 'ok' | 'warn' | 'err';
}

export interface AccessModel {
  ladders: AccessLadder[];
  stairs: AccessStair[];
  platforms: AccessPlatform[];
  walkways: AccessWalkway[];
  guards: AccessGuard[];
  bars: AccessBar[];
  frame: AccessFrame | null;
  /** indicative mass of everything above (kg) */
  weightKg: number;
  /** the reference the design was built to, shown in the panel */
  basis: string;
  rows: AccessRow[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Plan direction of an azimuth (0 = +Z, turning clockwise) as a unit vector. */
export function planDirection(azimuthDeg: number): [number, number] {
  const a = azimuthDeg * DEG;
  return [Math.sin(a), Math.cos(a)];
}

const num = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Centre-height of the primary support above grade — the same rule the viewer
 *  uses to stand the vessel on its legs/skirt, so access lands on the real shell. */
export function supportHeightMm(equip: Equipment): number {
  if (equip.orientation === 'horizontal') return 0;
  const s = equip.support;
  if (!s) return 0;
  if (s.type === 'legs' || s.type === 'legsAngle' || s.type === 'legsBeam') return s.skirtH > 0 ? s.skirtH : 800;
  if (s.type === 'skirt' || s.type === 'skirtCone') return s.skirtH > 0 ? s.skirtH : 1500;
  if (s.type === 'angleSkirt' || s.type === 'bodyAngleSkirt') return s.skirtH > 0 ? s.skirtH : s.type === 'bodyAngleSkirt' ? 400 : 600;
  return 0;
}

/** Engine sections, with a stand-in for a tag that has no results yet. */
export function sectionsFor(equip: Equipment, calc: EquipmentCalc): SectionCalc[] {
  if (calc.sections.length) return calc.sections;
  return equip.sections.map((spec) => ({ spec, utilization: 0, tNominal: 0 }) as SectionCalc);
}

const railKg = (runMm: number) => (runMm / 1000) * (ACCESS_STEEL.railKgM + ACCESS_STEEL.toeKgM);

function ringDeckKg(r0: number, r1: number, sweepDeg: number, rails: string[], gapDeg = 0): number {
  const sweep = Math.abs(clamp(sweepDeg, 1, 360)) * DEG;
  const area = (Math.PI * (r1 * r1 - r0 * r0) * sweep) / (2 * Math.PI) / 1e6; // m²
  const width = Math.abs(r1 - r0);
  const arc = ((r0 + r1) / 2) * sweep; // mid-line length of the sector
  const railArc = arc * (1 - Math.min(0.9, Math.max(0, gapDeg) / Math.max(1, Math.abs(sweepDeg))));
  let kg = area * ACCESS_STEEL.gratingKgM2;
  kg += (arc / 1000) * ACCESS_STEEL.framingKgM * 2; // two curved beams under the deck
  if (rails.includes('outer')) kg += railKg(railArc); // outer edge rail, less the ladder opening
  if (rails.includes('inner')) kg += railKg(arc);
  // radial end rails close the sector
  const closed = rails.includes('outer') || rails.includes('inner');
  if (closed) kg += railKg(width) * 2;
  return kg;
}

function rectDeckKg(hx: number, hz: number, rails: string[]): number {
  const w = hx * 2;
  const d = hz * 2;
  let kg = ((w * d) / 1e6) * ACCESS_STEEL.gratingKgM2;
  kg += ((w + d) * 2 / 1000) * ACCESS_STEEL.framingKgM;
  const edge = (side: string) => (side === 'north' || side === 'south' ? w : d);
  for (const side of rails) kg += railKg(edge(side));
  return kg;
}

function ladderKg(y0: number, y1: number, widthMm: number, rungPitchMm: number, cageFromY: number, guideRails: boolean): number {
  const h = Math.max(0, y1 - y0);
  if (h <= 0) return 0;
  let kg = (h / 1000) * ACCESS_STEEL.ladderStringerKgM * 2;
  const rungs = Math.max(1, Math.floor(h / Math.max(150, rungPitchMm)));
  kg += (rungs * widthMm) / 1000 * ACCESS_STEEL.rungKgM;
  if (cageFromY > 0 && y1 > cageFromY) {
    const cageH = y1 - cageFromY;
    const hoops = Math.max(1, Math.floor(cageH / 900));
    kg += hoops * ACCESS_STEEL.cageHoopKg;
    kg += (cageH / 1000) * ACCESS_STEEL.cageStrapKgM * 4;
  }
  if (guideRails) kg += (h / 1000) * (ACCESS_STEEL.braceKgM * 1.4);
  return kg;
}

function stairKg(y0: number, y1: number, widthMm: number, flights = 1): number {
  const h = Math.max(0, y1 - y0);
  const steps = Math.max(1, Math.round(h / 175));
  const run = steps * 250;
  let kg = steps * ACCESS_STEEL.treadKg;
  kg += (Math.hypot(h, run) / 1000) * ACCESS_STEEL.stairStringerKgM * 2;
  kg += (run / 1000) * ACCESS_STEEL.railKgM * 2;
  // one landing per flight, 1000 × 1000 mm, handrailed on two sides
  kg += Math.max(1, flights) * rectDeckKg(500, 500, ['north', 'south']);
  return kg * (widthMm > 800 ? 1.1 : 1);
}

// ---------------------------------------------------------------------------
// Platforms / rails builders
// ---------------------------------------------------------------------------

function ringPlatform(params: {
  label: string;
  detail: string;
  y: number;
  r0: number;
  r1: number;
  azimuthDeg: number;
  sweepDeg: number;
  rails?: ('outer' | 'inner')[];
  /** outer-rail opening for the ladder arriving at this deck */
  gapAzimuthDeg?: number;
  gapDeg?: number;
}): AccessPlatform {
  const rails = params.rails ?? ['outer'];
  const gapDeg = params.gapDeg && params.gapDeg > 0 ? params.gapDeg : 0;
  return {
    label: params.label,
    detail: params.detail,
    kind: 'ring',
    y: params.y,
    r0: params.r0,
    r1: params.r1,
    azimuthDeg: params.azimuthDeg,
    sweepDeg: params.sweepDeg,
    cx: 0,
    cz: 0,
    hx: 0,
    hz: 0,
    railHeightMm: ACCESS.railHeightMm,
    rails,
    gapAzimuthDeg: gapDeg > 0 ? params.gapAzimuthDeg ?? params.azimuthDeg : undefined,
    gapDeg: gapDeg > 0 ? gapDeg : undefined,
    kg: ringDeckKg(params.r0, params.r1, params.sweepDeg, rails, gapDeg),
  };
}

function rectPlatform(params: {
  label: string;
  detail: string;
  y: number;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rails: ('north' | 'south' | 'east' | 'west')[];
}): AccessPlatform {
  return {
    label: params.label,
    detail: params.detail,
    kind: 'rect',
    y: params.y,
    r0: 0,
    r1: 0,
    azimuthDeg: 0,
    sweepDeg: 0,
    cx: params.cx,
    cz: params.cz,
    hx: params.hx,
    hz: params.hz,
    railHeightMm: ACCESS.railHeightMm,
    rails: params.rails,
    kg: rectDeckKg(params.hx, params.hz, params.rails),
  };
}

function ladder(params: {
  label: string;
  detail: string;
  x: number;
  z: number;
  y0: number;
  y1: number;
  facingDeg: number;
  widthMm?: number;
  cage?: boolean;
  guideRails?: boolean;
}): AccessLadder {
  const widthMm = params.widthMm ?? ACCESS.ladderWidthMm;
  const y0 = Math.max(0, params.y0);
  const y1 = Math.max(y0 + 300, params.y1);
  const change = y1 - y0;
  const cageFromY = params.cage === false || change <= ACCESS.cageFromMm ? 0 : y0 + ACCESS.cageFromMm;
  const guideRails = params.guideRails ?? y1 > ACCESS.guideRailsFromMm;
  return {
    label: params.label,
    detail: params.detail,
    x: params.x,
    z: params.z,
    y0,
    y1,
    widthMm,
    facingDeg: params.facingDeg,
    rungPitchMm: ACCESS.rungPitchMm,
    cageFromY,
    guideRails,
    kg: ladderKg(y0, y1, widthMm, ACCESS.rungPitchMm, cageFromY, guideRails),
  };
}

function straightStair(params: {
  label: string;
  detail: string;
  x: number;
  z: number;
  y0: number;
  y1: number;
  flights: number;
  headingDeg: number;
  widthMm?: number;
}): AccessStair {
  const widthMm = params.widthMm ?? ACCESS.walkWidthMm;
  return {
    label: params.label,
    detail: params.detail,
    kind: 'straight',
    x: params.x,
    z: params.z,
    y0: Math.max(0, params.y0),
    y1: params.y1,
    widthMm,
    flights: Math.max(1, params.flights),
    headingDeg: params.headingDeg,
    radiusMm: 0,
    riseMm: 0,
    steps: 0,
    startDeg: 0,
    stepAngleDeg: 0,
    kg: stairKg(params.y0, params.y1, widthMm, params.flights),
  };
}

// ---------------------------------------------------------------------------
// Structural frame (drawn only when the tag has a structure selected)
// ---------------------------------------------------------------------------

function frameFor(equip: Equipment, env: { radiusMm: number; lengthMm: number }): AccessFrame | null {
  const spec = equip.structure;
  if (!spec?.enabled) return null;
  const R = Math.max(300, env.radiusMm);
  switch (spec.kind) {
    case 'skid': {
      const hx = Math.max(1200, R + 500);
      const hz = Math.max(1200, env.lengthMm / 2 + 400);
      const kg = ((hx * 2 + hz * 2) / 1000) * ACCESS_STEEL.skidBeamKgM * 2 + 180;
      return {
        kind: 'skid',
        label: 'Skid',
        detail: `HEB 220 runners ${Math.round(hx * 2)} × ${Math.round(hz * 2)} mm · transport skid at grade`,
        hx,
        hz,
        heightMm: 300,
        rails: false,
        kg,
      };
    }
    case 'portal': {
      const hx = Math.max(1500, R + 800);
      const hz = Math.max(1000, R + 400);
      const heightMm = Math.max(3000, env.lengthMm + 1200);
      const kg = 4 * (heightMm / 1000) * ACCESS_STEEL.columnKgM + ((hx * 2) / 1000) * ACCESS_STEEL.skidBeamKgM * 2;
      return {
        kind: 'portal',
        label: 'Portal frame',
        detail: `HEB 200 columns ${Math.round(heightMm)} mm high · HEB 220 head beam · base plates`,
        hx,
        hz,
        heightMm,
        rails: false,
        kg,
      };
    }
    case 'pedestal': {
      const hx = Math.max(900, R * 0.75);
      const hz = hx;
      const heightMm = 600;
      const kg = 420;
      return {
        kind: 'pedestal',
        label: 'Pedestal',
        detail: `Concrete/steel pedestal ${Math.round(hx * 2)} × ${Math.round(hz * 2)} × ${heightMm} mm`,
        hx,
        hz,
        heightMm,
        rails: false,
        kg,
      };
    }
    default: {
      const hx = Math.max(1400, R + 700);
      const hz = Math.max(1400, (env.lengthMm / 2) + 700);
      const heightMm = 1500;
      const kg = rectDeckKg(hx, hz, ['north', 'south', 'east', 'west']) + 6 * 1.5 * ACCESS_STEEL.columnKgM;
      return {
        kind: 'platform',
        label: 'Access platform steelwork',
        detail: `Free-standing platform ${Math.round(hx * 2)} × ${Math.round(hz * 2)} mm at ${heightMm} mm, 4 HEB 200 columns`,
        hx,
        hz,
        heightMm,
        rails: true,
        kg,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Vessels, columns and exchangers
// ---------------------------------------------------------------------------

/** Ladder / stair + platform access for an ASME body, in the erection frame. */
export function vesselAccess(equip: Equipment, calc: EquipmentCalc, layout: BodyLayout): Partial<AccessModel> {
  const out: Partial<AccessModel> = { ladders: [], stairs: [], platforms: [], walkways: [], guards: [], bars: [] };
  const ladders = out.ladders!;
  const stairs = out.stairs!;
  const platforms = out.platforms!;
  const bars = out.bars!;

  // a tag with no sections has nothing to stand on yet
  if (!layout.segments.length) return out;

  const supH = supportHeightMm(equip);
  const R0 = Math.max(100, layout.segments[0]?.r0 ?? (equip.sections[0]?.dia ?? 1000) / 2);
  const shellTopH = layout.stackTop - layout.bottomDepth + supH; // top of the last shell above grade
  const totalH = layout.totalLen - layout.bottomDepth + supH;
  const horizontal = equip.orientation === 'horizontal';

  if (horizontal) {
    return horizontalAccess(equip, calc, layout, out as AccessModel);
  }

  // ---- where to stand: every manway, plus tray levels on a column, plus the top
  const wants: { y: number; azimuthDeg: number; reason: string }[] = [];
  for (const n of calc.nozzles) {
    if (n.spec.kind !== 'manway') continue;
    const y = num(n.spec.elevation) + supH;
    if (y < 2000 || y > shellTopH + 50) continue;
    wants.push({ y, azimuthDeg: num(n.spec.azimuth), reason: `manway ${n.spec.tag}` });
  }

  const traySpec = equip.internals.find(
    (i) => i.kind === 'sieveTray' || i.kind === 'valveTray' || i.kind === 'bubbleCapTray' || i.kind === 'chimneyTray'
  );
  if (traySpec && traySpec.count > 0) {
    const spacing = traySpec.spacing > 0 ? traySpec.spacing : 500;
    // one platform per 6 m of tray stack, on the manway side
    const levels = Math.min(6, Math.max(1, Math.floor((traySpec.count * spacing) / 6000)));
    for (let i = 1; i <= levels; i++) {
      const y = traySpec.bottomElevation + supH + i * 6000;
      if (y > 2000 && y < shellTopH) wants.push({ y, azimuthDeg: 0, reason: `tray level ${i}` });
    }
  }

  // one platform per distinct elevation (within 500 mm), manways win
  wants.sort((a, b) => a.y - b.y);
  const levels: typeof wants = [];
  for (const w of wants) {
    if (levels.some((l) => Math.abs(l.y - w.y) < 500)) continue;
    levels.push(w);
  }

  const topLevel = levels.length ? levels[levels.length - 1].y : 0;
  const addTopLanding = !horizontal && (shellTopH > 8000 || (traySpec?.count ?? 0) > 0) && shellTopH - topLevel > 1200;
  if (addTopLanding) levels.push({ y: shellTopH, azimuthDeg: levels[0]?.azimuthDeg ?? 0, reason: 'top of shell' });

  // One access column: every platform is centred on the same azimuth, so the
  // ladder runs straight up the front of the vessel and each deck can be entered
  // through an opening in its outer rail. Previously each deck was centred on
  // its own manway, which left the ladder arriving through the deck itself.
  const columnAz = levels[0]?.azimuthDeg ?? 0;
  const [colX, colZ] = planDirection(columnAz);

  for (const lvl of levels) {
    // local Y for the radius lookup, then the ring deck clears the shell
    const localY = lvl.y - supH + layout.bottomDepth;
    const r = Math.max(R0, radiusAtY(layout, localY));
    const r0 = r + 80;
    const r1 = r0 + ACCESS.walkWidthMm;
    const isTop = Math.abs(lvl.y - shellTopH) < 1;
    const sweep = isTop ? 180 : 130;
    // the ladder arrives at the outer edge: cut a clear opening for it
    const openingMm = Math.round(ACCESS.ladderWidthMm + 240);
    const gapDeg = openingMm / r1 / DEG;
    platforms.push(
      ringPlatform({
        label: `Access platform · ${Math.round(lvl.y)} mm${isTop ? ' (top)' : ''}`,
        detail: `${lvl.reason} · deck Ø${Math.round(r0 * 2)}–${Math.round(r1 * 2)} mm · ${sweep}° sweep · ${openingMm} mm ladder opening in the outer rail · inner edge closed by the shell · Ø42.4 handrail + 100 mm toe board`,
        y: lvl.y,
        r0,
        r1,
        azimuthDeg: columnAz,
        sweepDeg: sweep,
        rails: ['outer'],
        gapAzimuthDeg: columnAz,
        gapDeg,
      })
    );
  }

  // ---- how to get up: stair tower above 12 m, otherwise a caged ladder
  const climbTo = levels.length ? levels[levels.length - 1].y : shellTopH;
  const baseR = R0;
  const firstAz = levels[0]?.azimuthDeg ?? 0;
  const [px, pz] = planDirection(firstAz);

  if (climbTo > 2200) {
    if (climbTo > ACCESS.stairAboveMm) {
      const flights = Math.ceil(climbTo / 3000);
      stairs.push(
        straightStair({
          label: 'Access stair tower',
          detail: `${flights} flights of ~3 m rise · 175 mm rise / 250 mm going · 900 mm wide with landings, handrails and toe boards`,
          x: px * (baseR + 1100),
          z: pz * (baseR + 1100),
          y0: 0,
          y1: climbTo,
          flights,
          headingDeg: firstAz,
        })
      );
      // the flight landings are drawn (and weighed) by the renderer where each
      // flight actually ends — a fixed (x,z) list here would not follow a
      // switchback stair, so nothing is emitted for them in the descriptors.
    } else {
      // One run per platform: climb to a deck, step through the rail opening,
      // take the next run from that deck upward. A single run from grade to the
      // top would pass through every platform above the first.
      const stops = [0, ...levels.map((l) => l.y)];
      let runNo = 0;
      for (let i = 1; i < stops.length; i++) {
        const y0 = stops[i - 1];
        const y1 = stops[i];
        if (y1 - y0 < 300) continue;
        runNo += 1;
        // the run stands at the outer edge of the deck it serves
        const localY = y1 - supH + layout.bottomDepth;
        const rEdge =
          Math.max(R0, radiusAtY(layout, localY)) + 80 + ACCESS.walkWidthMm - ACCESS.ladderWidthMm / 2;
        const isLast = i === stops.length - 1;
        ladders.push(
          ladder({
            label: isLast
              ? `Caged ladder run ${runNo}/${stops.length - 1} — to the top platform`
              : `Caged ladder run ${runNo}/${stops.length - 1}`,
            detail:
              `${runNo === 1 ? 'From grade' : `From the ${Math.round(y0)} mm deck`} to ${Math.round(y1)} mm · ` +
              `${ACCESS.ladderWidthMm} mm wide · ${ACCESS.rungPitchMm} mm rungs · cage from ${ACCESS.cageFromMm} mm` +
              `${y1 - y0 > ACCESS.guideRailsFromMm ? ' · standoff guide rails + brackets every 1.5 m' : ''}`,
            x: colX * rEdge,
            z: colZ * rEdge,
            y0,
            // stiles carry past the top landing only, so intermediate runs stop flush
            y1: isLast ? y1 + 1100 : y1,
            facingDeg: columnAz,
            guideRails: y1 - y0 > ACCESS.guideRailsFromMm,
          })
        );
      }
      // no unbroken run may exceed the rest-platform limit
      for (const l of ladders) {
        if (l.y1 - l.y0 > ACCESS.stairAboveMm) {
          // caller sees this in the rows/checks; keep the descriptor honest
          l.detail += ' · exceeds the 9 m unbroken-climb limit — add an intermediate platform';
        }
      }
    }
  }

  // ---- support steelwork: bracing between legs
  const s = equip.support;
  if ((s.type === 'legs' || s.type === 'legsAngle' || s.type === 'legsBeam') && (s.legCount || 4) >= 3) {
    const n = Math.max(3, s.legCount || 4);
    const legR = R0 + Math.max(8, s.legPlateThk || 16) / 2;
    const h = Math.max(400, supH);
    for (let i = 0; i < n; i++) {
      const [ax, az] = planDirection((i / n) * 360 + 180 / n);
      const [bx, bz] = planDirection(((i + 1) / n) * 360 + 180 / n);
      const a: [number, number, number] = [ax * legR, 0, az * legR];
      const b: [number, number, number] = [bx * legR, h, bz * legR];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      bars.push({
        label: `Leg bracing ${i + 1}`,
        detail: `Diagonal L 70×7 between legs · ${Math.round(len)} mm long`,
        a,
        b,
        diaMm: 70,
        kg: (len / 1000) * ACCESS_STEEL.braceKgM,
      });
    }
  }

  // a structure frame is sized on the PLAN footprint, not the vessel height
  const maxR = Math.max(...layout.segments.map((sg) => Math.max(sg.r0, sg.r1)), R0);
  out.frame = frameFor(equip, { radiusMm: maxR, lengthMm: maxR * 2 });
  return out;
}

/** Horizontal vessel: a walkway along the top at the manways and a ladder on one end. */
function horizontalAccess(equip: Equipment, calc: EquipmentCalc, layout: BodyLayout, out: AccessModel): AccessModel {
  const R0 = Math.max(100, layout.segments[0]?.r0 ?? 500);
  const hAxis = R0 * 1.01 + 40; // axis height above grade in the erected frame
  const shellTop = hAxis + R0;
  const deckY = shellTop + 550;
  const s0 = layout.bottomDepth;
  const s1 = layout.stackTop;
  const len = Math.max(500, s1 - s0);

  const manways = calc.nozzles.filter((n) => n.spec.kind === 'manway');
  const topManway = [...manways].sort((a, b) => b.spec.elevation - a.spec.elevation)[0];

  // walkway along the crown, over the manways
  out.platforms!.push(
    rectPlatform({
      label: 'Crown walkway',
      detail: `${Math.round(len + 600)} mm long × 900 mm wide at ${Math.round(deckY)} mm above grade · both sides handrailed`,
      y: deckY,
      cx: 0,
      cz: (s0 + s1) / 2,
      hx: 450,
      hz: len / 2 + 300,
      rails: ['east', 'west'],
    })
  );

  // ladder at the end away from the main nozzles, plus a small landing. The
  // landing sits clear of the walkway end (it used to overlap it by ~450 mm).
  const azEnd = 0;
  const landingCz = s1 + 300 + 450;
  out.ladders!.push(
    ladder({
      label: 'Access ladder',
      detail: `At the end of the shell · climbs ${Math.round(deckY)} mm · caged above 2.2 m`,
      x: 0,
      z: landingCz,
      y0: 0,
      y1: deckY + 1100,
      facingDeg: azEnd,
    })
  );
  out.platforms!.push(
    rectPlatform({
      label: 'Ladder landing',
      detail: 'Top landing at the crown walkway',
      y: deckY,
      cx: 0,
      cz: landingCz,
      hx: 450,
      hz: 450,
      rails: ['north', 'south', 'east', 'west'],
    })
  );

  if (topManway) {
    out.bars!.push({
      label: `Manway approach ${topManway.spec.tag}`,
      detail: 'Two-step access platform to the manway cover',
      a: [R0 * 0.6, deckY, s0 + topManway.spec.elevation],
      b: [R0 * 0.6, deckY, s0 + topManway.spec.elevation + 600],
      diaMm: 60,
      kg: 22,
    });
  }

  out.frame = frameFor(equip, { radiusMm: R0, lengthMm: len });
  return out;
}

// ---------------------------------------------------------------------------
// API 650 storage tank
// ---------------------------------------------------------------------------

function tankAccess(equip: Equipment, calc: EquipmentCalc): Partial<AccessModel> {
  const out: Partial<AccessModel> = { ladders: [], stairs: [], platforms: [], walkways: [], guards: [], bars: [] };
  const tm = tankModel(equip, calc);
  if (!tm) return out;
  const ladders = out.ladders!;
  const stairs = out.stairs!;
  const platforms = out.platforms!;
  const walkways = out.walkways!;
  const guards = out.guards!;

  const R = tm.radiusMm;
  const shellH = tm.shellTopY - tm.shellBaseY;
  const roof = tm.roof;
  const fixedRoof = roof.kind !== 'none';

  // ---- top landing at the roof edge (where the stair or ladder arrives)
  const landingY = tm.shellTopY;
  if (fixedRoof) {
    platforms.push(
      ringPlatform({
        label: 'Roof access landing',
        detail: `Ring platform at the roof rim · ${Math.round(R + 60)}–${Math.round(R + ACCESS.walkWidthMm)} mm · handrail and toe board`,
        y: landingY,
        r0: R + 60,
        r1: R + 60 + ACCESS.walkWidthMm,
        azimuthDeg: 0,
        sweepDeg: 150,
        rails: ['outer', 'inner'],
      })
    );
  }

  // ---- stair or ladder depending on the shell height (API 650 §5.10)
  if (shellH >= 4000) {
    const radius = R + Math.max(700, R * 0.09);
    const rise = 220;
    const stepAngle = 10;
    const steps = Math.max(1, Math.ceil(shellH / rise));
    stairs.push({
      label: 'Spiral stair',
      detail: `${steps} treads · ${rise} mm rise · 10° per tread on a ${Math.round(radius)} mm radius · stringers, handrails both sides and a top landing`,
      kind: 'spiral',
      x: 0,
      z: 0,
      y0: tm.shellBaseY,
      y1: tm.shellTopY,
      widthMm: Math.min(900, R * 0.12 + 550),
      flights: 1,
      headingDeg: -90,
      radiusMm: radius,
      riseMm: rise,
      steps,
      startDeg: -90,
      stepAngleDeg: stepAngle,
      kg: steps * ACCESS_STEEL.treadKg + ((steps * rise) / 1000) * ACCESS_STEEL.stairStringerKgM * 2 + ((steps * stepAngle * DEG * radius) / 1000) * ACCESS_STEEL.railKgM * 2,
    });
  } else if (shellH > 1200) {
    ladders.push(
      ladder({
        label: 'Caged shell ladder',
        detail: `Grade to the roof rim · ${Math.round(shellH)} mm · cage above 2.2 m · guide rails`,
        x: R + 300,
        z: 0,
        y0: 0,
        y1: tm.shellTopY + 1100,
        facingDeg: 90,
        guideRails: shellH > 2500,
      })
    );
  }

  // ---- roof access: perimeter handrail, a walkway to the centre and a small deck
  if (fixedRoof) {
    const slopeRun = tm.roof.riseMm > 0 ? roof.riseMm : 0;
    guards.push({
      label: 'Roof perimeter handrail',
      detail: `Ø42.4 handrail + mid rail + toe board around the roof edge · ${Math.round(roof.rimY)} mm elevation`,
      y: roof.rimY + ACCESS.railHeightMm,
      radiusMm: R - 80,
      azimuthDeg: 0,
      sweepDeg: 360,
      heightMm: ACCESS.railHeightMm,
      kg: ((2 * Math.PI * (R - 80)) / 1000) * (ACCESS_STEEL.railKgM + ACCESS_STEEL.toeKgM) * 1.2,
    });
    if (slopeRun > 250) {
      walkways.push({
        label: 'Roof walkway',
        detail: `From the roof edge to the centre · 900 mm wide · follows the 1:${Math.round(R / Math.max(1, slopeRun))} slope with handrails both sides`,
        x0: 0,
        z0: R - 200,
        x1: 0,
        z1: 150,
        y0: roof.rimY + Math.min(300, slopeRun * 0.4),
        y1: roof.apexY,
        widthMm: ACCESS.walkWidthMm,
        rails: true,
        kg: (R / 1000) * (ACCESS_STEEL.gratingKgM2 * ACCESS.walkWidthMm) / 1000 + (R / 1000) * ACCESS_STEEL.railKgM * 2,
      });
      platforms.push(
        rectPlatform({
          label: 'Roof centre deck',
          detail: 'Gauge hatch / vent access at the roof apex · handrailed on three sides',
          y: roof.apexY,
          cx: 0,
          cz: 0,
          hx: 800,
          hz: 800,
          rails: ['east', 'west', 'south'],
        })
      );
    }
  } else {
    // open top (external floating roof): a rolling ladder down to the deck
    if (tm.floatingDeckY !== null) {
      const deckY = tm.floatingDeckY;
      ladders.push(
        ladder({
          label: 'Rolling ladder to the floating roof',
          detail: `Stainless rolling ladder from the roof rim down to the deck at ${Math.round(deckY)} mm · with track and guide`,
          x: R - 350,
          z: 0,
          y0: deckY,
          y1: tm.shellTopY + 1100,
          facingDeg: 90,
          cage: false,
          guideRails: false,
        })
      );
    }
  }

  out.frame = frameFor(equip, { radiusMm: R, lengthMm: R * 2 });
  return out;
}

// ---------------------------------------------------------------------------
// API 661 air cooler
// ---------------------------------------------------------------------------

function finFanAccess(equip: Equipment, calc: EquipmentCalc): Partial<AccessModel> {
  const out: Partial<AccessModel> = { ladders: [], stairs: [], platforms: [], walkways: [], guards: [], bars: [] };
  const fm = finFanModel(equip, calc);
  if (!fm) return out;
  const ladders = out.ladders!;
  const platforms = out.platforms!;
  const walkways = out.walkways!;
  const guards = out.guards!;

  const halfL = fm.tubeLengthMm / 2;
  const halfD = fm.totalDepthMm / 2;
  // header platforms sit at the bundle's lower edge, one at each end of the tubes
  const deckY = Math.max(1200, fm.bundleBottomY - 250);
  const headX = halfL + fm.headerDiaMm / 2 + 700;

  for (const sx of [-1, 1]) {
    platforms.push(
      rectPlatform({
        label: sx < 0 ? 'Header platform (inlet end)' : 'Header platform (outlet end)',
        detail: `${Math.round(fm.totalDepthMm + 600)} mm long × 900 mm wide at ${Math.round(deckY)} mm · header, plug and cover access`,
        y: deckY,
        cx: sx * headX,
        cz: 0,
        hx: 450,
        hz: halfD + 300,
        rails: ['north', 'south', 'east', 'west'],
      })
    );
    // a caged ladder at each end of each platform
    for (const sz of [-1, 1]) {
      ladders.push(
        ladder({
          label: `Access ladder ${sx < 0 ? 'inlet' : 'outlet'} ${sz < 0 ? 'north' : 'south'}`,
          detail: `Grade to the header platform · ${Math.round(deckY)} mm climb · caged, guide rails above 6 m`,
          x: sx * headX,
          z: sz * (halfD + 300),
          y0: 0,
          y1: deckY + 1100,
          facingDeg: sz < 0 ? 180 : 0,
          guideRails: deckY > 4000,
        })
      );
    }
  }

  // walkway between the bays, along the centre line of the cooler
  if (fm.bays > 1) {
    walkways.push({
      label: 'Inter-bay walkway',
      detail: `Grating walkway across the ${fm.bays} bays at the fan deck · handrails both sides`,
      x0: -headX * 2,
      z0: 0,
      x1: headX * 2,
      z1: 0,
      y0: deckY,
      y1: deckY,
      widthMm: ACCESS.walkWidthMm,
      rails: true,
      kg: ((headX * 4) / 1000) * (ACCESS_STEEL.gratingKgM2 * ACCESS.walkWidthMm) / 1000,
    });
  }

  // fan guards: a rail ring around each fan when the fans sit at the top (induced)
  if (fm.arrangement !== 'forced' && fm.arrangement !== 'vapor') {
    for (const z of fm.bayCentersZ) {
      guards.push({
        label: 'Fan guard rail',
        detail: `Ø${Math.round(fm.fanDiaMm + 400)} mm rail ring around the fan · top and mid rail with posts`,
        y: fm.fanY + fm.fanDiaMm * 0.16 + 300,
        radiusMm: fm.fanDiaMm / 2 + 200,
        azimuthDeg: 0,
        sweepDeg: 360,
        heightMm: ACCESS.railHeightMm,
        kg: ((2 * Math.PI * (fm.fanDiaMm / 2 + 200)) / 1000) * ACCESS_STEEL.railKgM * 1.6,
      });
    }
  } else {
    // fans at low level: an inlet screen ring instead of a rail
    for (const z of fm.bayCentersZ) {
      guards.push({
        label: 'Fan inlet guard',
        detail: `Mesh guard across the Ø${Math.round(fm.fanDiaMm)} mm fan intake`,
        y: fm.fanY - 120,
        radiusMm: fm.fanDiaMm / 2,
        azimuthDeg: 0,
        sweepDeg: 360,
        heightMm: 120,
        kg: 26,
      });
    }
  }

  // fan deck handrail along the fan sides so the motors can be serviced
  if (fm.arrangement !== 'forced') {
    walkways.push({
      label: 'Fan deck handrail',
      detail: 'Handrail along both fan-deck edges, 1070 mm high with mid rail',
      x0: -halfL - 300,
      z0: -halfD,
      x1: halfL + 300,
      z1: -halfD,
      y0: fm.fanY + 700,
      y1: fm.fanY + 700,
      widthMm: 0,
      rails: true,
      kg: (((halfL * 2) + 600) / 1000) * ACCESS_STEEL.railKgM * 2,
    });
  }

  out.frame = frameFor(equip, {
    radiusMm: Math.max(fm.tubeLengthMm / 2, fm.totalDepthMm / 2),
    lengthMm: Math.max(fm.tubeLengthMm, fm.totalDepthMm),
  });
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function rowsFor(m: {
  ladders: AccessLadder[];
  stairs: AccessStair[];
  platforms: AccessPlatform[];
  walkways: AccessWalkway[];
  guards: AccessGuard[];
  bars: AccessBar[];
  frame: AccessFrame | null;
}): AccessRow[] {
  const rows: AccessRow[] = [];
  if (m.stairs.length) {
    const kg = m.stairs.reduce((n, s) => n + s.kg, 0);
    rows.push({
      label: 'Stairs',
      value: m.stairs.map((s) => `${s.kind} · ${s.flights > 1 ? `${s.flights} flights` : `${s.steps} treads`}`).join(' · '),
      note: `${Math.round(kg)} kg · rise 175 mm / going 250 mm · handrails both sides`,
    });
  }
  if (m.ladders.length) {
    const kg = m.ladders.reduce((n, l) => n + l.kg, 0);
    const caged = m.ladders.filter((l) => l.cageFromY > 0).length;
    rows.push({
      label: 'Ladders',
      value: `${m.ladders.length} ladder${m.ladders.length === 1 ? '' : 's'}${caged ? ` · ${caged} caged` : ''}`,
      note: `${Math.round(kg)} kg · 460 mm wide, 300 mm rungs${m.ladders.some((l) => l.guideRails) ? ' · guide rails with standoff brackets' : ''}`,
    });
  }
  if (m.platforms.length) {
    const kg = m.platforms.reduce((n, p) => n + p.kg, 0);
    rows.push({
      label: 'Platforms & landings',
      value: `${m.platforms.length} deck${m.platforms.length === 1 ? '' : 's'} · ${Math.round(
        Math.max(...m.platforms.map((p) => (p.kind === 'ring' ? p.r1 - p.r0 : p.hx * 2)))
      )} mm widest`,
      note: `${Math.round(kg)} kg · 25×5 grating with 1070 mm handrail, 550 mm mid rail and 100 mm toe board`,
    });
  }
  if (m.walkways.length) {
    const kg = m.walkways.reduce((n, w) => n + w.kg, 0);
    rows.push({
      label: 'Walkways',
      value: `${m.walkways.length} · ${m.walkways.map((w) => w.label).join(' · ')}`,
      note: `${Math.round(kg)} kg · 900 mm clear width${m.walkways.some((w) => w.rails) ? ' · handrailed both sides' : ''}`,
    });
  }
  if (m.guards.length) {
    const kg = m.guards.reduce((n, g) => n + g.kg, 0);
    rows.push({
      label: 'Guard rails',
      value: `${m.guards.length} · ${m.guards.map((g) => g.label).join(' · ')}`,
      note: `${Math.round(kg)} kg · top rail ${ACCESS.railHeightMm} mm + mid rail`,
    });
  }
  if (m.bars.length) {
    const kg = m.bars.reduce((n, b) => n + b.kg, 0);
    rows.push({
      label: 'Bracing & brackets',
      value: `${m.bars.length} member${m.bars.length === 1 ? '' : 's'}`,
      note: `${Math.round(kg)} kg · ${m.bars[0].label.toLowerCase()}…`,
    });
  }
  if (m.frame) {
    rows.push({
      label: m.frame.label,
      value: m.frame.detail,
      note: `${Math.round(m.frame.kg)} kg · selected in the register (costed in the estimate)`,
    });
  }
  return rows;
}

/**
 * Access and support steelwork for any tag, in the erection frame
 * (y = height above grade). Draw nothing when the tag has no results yet.
 */
export function accessModel(equip: Equipment, calc: EquipmentCalc): AccessModel {
  const sections = sectionsFor(equip, calc);
  let partial: Partial<AccessModel>;
  if (equip.equipType === 'tank') {
    partial = tankAccess(equip, calc);
  } else if (equip.equipType === 'finfan') {
    partial = finFanAccess(equip, calc);
  } else {
    partial = vesselAccess(equip, calc, buildBodyLayout(sections));
  }

  const ladders = partial.ladders ?? [];
  const stairs = partial.stairs ?? [];
  const platforms = partial.platforms ?? [];
  const walkways = partial.walkways ?? [];
  const guards = partial.guards ?? [];
  const bars = partial.bars ?? [];
  const frame = partial.frame ?? null;

  const weightKg =
    ladders.reduce((n, l) => n + l.kg, 0) +
    stairs.reduce((n, s) => n + s.kg, 0) +
    platforms.reduce((n, p) => n + p.kg, 0) +
    walkways.reduce((n, w) => n + w.kg, 0) +
    guards.reduce((n, g) => n + g.kg, 0) +
    bars.reduce((n, b) => n + b.kg, 0) +
    (frame?.kg ?? 0);

  const basis =
    equip.equipType === 'tank'
      ? 'API 650 §5.10 / OSHA 1910.23: spiral stair above 4 m of shell, otherwise a caged ladder; roof perimeter rail and walkway to the centre.'
      : equip.equipType === 'finfan'
        ? 'API 661 §7 / OSHA 1910.23: header platforms at each end, inter-bay walkway, caged ladders and fan guards.'
        : 'OSHA 1910.23 / 1910.28: platforms at every manway, caged ladder to 12 m, stair tower above, 1070 mm top rail and 100 mm toe board.';

  return {
    ladders,
    stairs,
    platforms,
    walkways,
    guards,
    bars,
    frame,
    weightKg,
    basis,
    rows: rowsFor({ ladders, stairs, platforms, walkways, guards, bars, frame }),
  };
}
