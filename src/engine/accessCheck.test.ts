// Access steelwork checks: these are the rules that decide whether the access the
// viewer draws could actually be built and walked on, so they get the same
// treatment as the pressure-boundary rules — pure inputs, explicit numbers.

import { describe, expect, it } from 'vitest';
import { ACCESS_LOAD, checkAccessModel, deckBeam } from './accessCheck';
import { ACCESS, type AccessLadder, type AccessModel, type AccessPlatform } from './structure3d';

const empty = (): AccessModel => ({
  ladders: [],
  stairs: [],
  platforms: [],
  walkways: [],
  guards: [],
  bars: [],
  frame: null,
  weightKg: 0,
  basis: 'test',
  rows: [],
});

const platform = (p: Partial<AccessPlatform>): AccessPlatform => ({
  label: 'deck',
  detail: '',
  kind: 'ring',
  y: 6000,
  r0: 700,
  r1: 1600,
  azimuthDeg: 0,
  sweepDeg: 130,
  cx: 0,
  cz: 0,
  hx: 0,
  hz: 0,
  railHeightMm: ACCESS.railHeightMm,
  rails: ['outer'],
  kg: 100,
  ...p,
});

const ladder = (l: Partial<AccessLadder>): AccessLadder => ({
  label: 'ladder',
  detail: '',
  x: 0,
  z: 1500,
  y0: 0,
  y1: 6000,
  widthMm: ACCESS.ladderWidthMm,
  facingDeg: 0,
  rungPitchMm: ACCESS.rungPitchMm,
  cageFromY: ACCESS.cageFromMm,
  guideRails: false,
  kg: 80,
  ...l,
});

const codes = (m: AccessModel) => checkAccessModel(m).warnings.map((w) => w.code);

describe('deckBeam', () => {
  it('passes a normal 900 mm wide, ~1.8 m spanning deck on the assumed HEA 140', () => {
    const b = deckBeam(1800, 900);
    expect(b.util).toBeLessThan(1);
    expect(b.deflectionOK).toBe(true);
  });

  it('fails an unsupported long span under the same live load', () => {
    const b = deckBeam(10000, 1200);
    expect(b.util).toBeGreaterThan(1);
    // the point load governs a long span, the distributed load a short one
    expect(b.momentKNm).toBeGreaterThan(0);
  });

  it('counts the concentrated load, not only the distributed one', () => {
    const long = deckBeam(4000, 600);
    const expectedPoint = (ACCESS_LOAD.pointKn * 4) / 4; // kN·m at mid-span
    expect(long.momentKNm).toBeGreaterThanOrEqual(expectedPoint - 1e-9);
  });
});

describe('checkAccessModel', () => {
  it('accepts a sound arrangement: one run per deck, proper rails, short spans', () => {
    const m = empty();
    m.platforms = [platform({ y: 3000 }), platform({ y: 6000 })];
    m.ladders = [
      ladder({ y0: 0, y1: 3000, cageFromY: 2200 }),
      ladder({ y0: 3000, y1: 6000, cageFromY: 2200 }),
    ];
    const r = checkAccessModel(m);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.maxRunMm).toBe(3000);
  });

  it('flags a single ladder that runs through a platform (AC-01)', () => {
    const m = empty();
    m.platforms = [platform({ y: 3000 })];
    m.ladders = [ladder({ y0: 0, y1: 6000 })];
    expect(codes(m)).toContain('AC-01');
  });

  it('flags an unbroken climb over the rest-platform limit (AC-02)', () => {
    const m = empty();
    m.ladders = [ladder({ y0: 0, y1: ACCESS_LOAD.maxUnbrokenClimbMm + 1500 })];
    expect(codes(m)).toContain('AC-02');
  });

  it('flags a missing cage above the threshold (AC-05) and narrow ladders (AC-04)', () => {
    const m = empty();
    m.ladders = [ladder({ y0: 0, y1: 5000, cageFromY: 0, widthMm: 350, rungPitchMm: 340 })];
    const c = codes(m);
    expect(c).toContain('AC-05');
    expect(c.filter((x) => x === 'AC-04').length).toBe(2);
  });

  it('flags an over-spanned deck and reports the beam utilisation', () => {
    const m = empty();
    m.platforms = [platform({ r0: 700, r1: 4000, sweepDeg: 180 })];
    const r = checkAccessModel(m);
    expect(r.warnings.map((w) => w.code)).toContain('AC-03');
    expect(r.beamUtil).toBeGreaterThan(1);
    expect(r.ok).toBe(false);
  });

  it('flags overlapping decks at the same level (AC-07)', () => {
    const m = empty();
    m.platforms = [
      platform({ kind: 'rect', cx: 0, cz: 0, hx: 450, hz: 900, y: 5000 }),
      platform({ kind: 'rect', cx: 0, cz: 800, hx: 450, hz: 450, y: 5000 }),
    ];
    expect(codes(m)).toContain('AC-07');
  });

  it('flags a too-steep stair (AC-08)', () => {
    const m = empty();
    m.stairs = [
      {
        label: 'stair',
        detail: '',
        kind: 'straight',
        x: 0,
        z: 0,
        y0: 0,
        y1: 3000,
        widthMm: 900,
        flights: 1,
        headingDeg: 0,
        radiusMm: 0,
        riseMm: 0,
        steps: 0,
        startDeg: 0,
        stepAngleDeg: 0,
        kg: 200,
      },
    ];
    // 3 m rise over a single flight of 175 mm risers → 17 steps → 4.25 m going = 35°: fine
    expect(codes(m)).not.toContain('AC-08');
    // now make it climb 3 m in only half the going → too steep
    m.stairs[0].y1 = 6000;
    m.stairs[0].flights = 2;
    const steep = { ...m.stairs[0], flights: 1, y1: 6000 };
    m.stairs = [steep];
    expect(codes(m)).toContain('AC-08');
  });

  it('flags a too-narrow walkway (AC-06)', () => {
    const m = empty();
    m.walkways = [
      { label: 'walk', detail: '', x0: 0, z0: 0, x1: 0, z1: 1000, y0: 0, y1: 0, widthMm: 450, rails: true, kg: 20 },
    ];
    expect(codes(m)).toContain('AC-06');
  });

  it('reports the access steel mass and the rail standard as panel rows', () => {
    const m = empty();
    m.weightKg = 2450;
    m.platforms = [platform({})];
    const r = checkAccessModel(m);
    const labels = r.rows.map((x) => x.label);
    expect(labels).toContain('Access steel (indicative)');
    expect(labels).toContain('Rail standard');
    expect(r.totalKg).toBe(2450);
  });
});
