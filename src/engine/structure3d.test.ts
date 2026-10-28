// Access & support steelwork descriptors. The viewer used to draw a spiral
// stair on tanks and nothing at all on vessels or air coolers; these tests pin
// the parts it now draws to the usual access practice and to the engine results.

import { describe, it, expect } from 'vitest';
import { demoProject, newEquipment } from '../defaults';
import { computeEquipment } from './compute';
import { finFanModel } from './model3d';
import { accessModel, ACCESS, supportHeightMm } from './structure3d';

const tag = (type: 'vessel' | 'column' | 'hx' | 'finfan' | 'tank') => demoProject().find((e) => e.equipType === type)!;

describe('tank access (API 650 §5.10)', () => {
  it('builds a spiral stair to the roof with a landing, perimeter rail and walkway', () => {
    const eq = tag('tank');
    const calc = computeEquipment(eq);
    const m = accessModel(eq, calc);

    expect(m.stairs).toHaveLength(1);
    const stair = m.stairs[0];
    expect(stair.kind).toBe('spiral');
    expect(stair.y0).toBeGreaterThan(0); // starts on the bottom plate, not at 0
    expect(stair.y1 - stair.y0).toBeCloseTo(14000, 6);
    expect(stair.steps).toBe(Math.ceil(14000 / 220));
    expect(stair.radiusMm).toBeGreaterThan(6000); // clears the shell

    // no ladder is needed when a stair is built
    expect(m.ladders).toHaveLength(0);

    expect(m.platforms.map((p) => p.label)).toEqual(
      expect.arrayContaining(['Roof access landing', 'Roof centre deck'])
    );
    const landing = m.platforms.find((p) => p.label === 'Roof access landing')!;
    expect(landing.kind).toBe('ring');
    expect(landing.r0).toBeGreaterThan(6000);
    expect(landing.r1 - landing.r0).toBeCloseTo(ACCESS.walkWidthMm, 6);
    expect(landing.rails).toContain('outer');

    const guard = m.guards.find((g) => g.label.includes('perimeter'))!;
    expect(guard.sweepDeg).toBe(360);
    expect(guard.y).toBeGreaterThan(14000);

    const walkway = m.walkways.find((w) => w.label === 'Roof walkway')!;
    expect(walkway.rails).toBe(true);
    expect(walkway.y1).toBeGreaterThan(walkway.y0); // follows the roof slope
    expect(walkway.widthMm).toBe(ACCESS.walkWidthMm);

    expect(m.weightKg).toBeGreaterThan(0);
    expect(m.rows.map((r) => r.label)).toEqual(expect.arrayContaining(['Stairs', 'Platforms & landings', 'Guard rails']));
    expect(m.basis).toContain('API 650');
  });

  it('falls back to a caged ladder with guide rails on a low tank', () => {
    const eq = tag('tank');
    eq.sections[0].ttLength = 3000;
    eq.tank!.maxDesignLiquidLevel = 3000;
    const m = accessModel(eq, computeEquipment(eq));
    expect(m.stairs).toHaveLength(0);
    expect(m.ladders).toHaveLength(1);
    const l = m.ladders[0];
    expect(l.cageFromY).toBeCloseTo(ACCESS.cageFromMm, 6);
    expect(l.guideRails).toBe(true);
    expect(l.widthMm).toBe(ACCESS.ladderWidthMm);
    expect(l.rungPitchMm).toBe(ACCESS.rungPitchMm);
    expect(l.y1).toBeGreaterThan(l.y0);
  });

  it('leaves the roof rail off an open-top tank and adds the rolling ladder instead', () => {
    const eq = tag('tank');
    eq.tank!.roofType = 'externalFloating';
    eq.tank!.maxDesignLiquidLevel = 9000;
    const m = accessModel(eq, computeEquipment(eq));
    expect(m.guards).toHaveLength(0);
    expect(m.walkways).toHaveLength(0);
    expect(m.platforms.some((p) => p.label.includes('Roof'))).toBe(false);
    const rolling = m.ladders.find((l) => l.label.startsWith('Rolling ladder'))!;
    expect(rolling).toBeTruthy();
    expect(rolling.cageFromY).toBe(0); // hands slide on the guide, no cage
    expect(rolling.y0).toBeLessThan(rolling.y1);
  });
});

describe('vessel access (OSHA 1910.23)', () => {
  it('puts a platform at the manway elevation and a caged ladder up from grade', () => {
    const eq = tag('vessel');
    // the demo drum is horizontal on saddles; stand it on legs for the ladder case
    eq.orientation = 'vertical';
    eq.support = { ...eq.support, type: 'legs', legCount: 4, skirtH: 1000 };
    const calc = computeEquipment(eq);
    const m = accessModel(eq, calc);
    const supH = supportHeightMm(eq);
    const manway = calc.nozzles.find((n) => n.spec.kind === 'manway')!;
    const level = manway.spec.elevation + supH;

    const deck = m.platforms.find((p) => Math.abs(p.y - level) < 1)!;
    expect(deck).toBeTruthy();
    expect(deck.kind).toBe('ring');
    expect(deck.sweepDeg).toBeGreaterThanOrEqual(120);
    expect(deck.detail).toContain(manway.spec.tag);

    expect(m.ladders).toHaveLength(1);
    const l = m.ladders[0];
    expect(l.y0).toBe(0);
    expect(l.y1).toBeGreaterThan(level);
    expect(l.cageFromY).toBeCloseTo(ACCESS.cageFromMm, 6);

    // legs are braced into a frame
    expect(m.bars.length).toBeGreaterThanOrEqual(3);
    expect(m.bars[0].b[1]).toBeGreaterThan(m.bars[0].a[1]);
    expect(m.weightKg).toBeGreaterThan(0);
    expect(m.rows.map((r) => r.label)).toEqual(expect.arrayContaining(['Ladders', 'Platforms & landings']));
  });

  it('switches to a stair tower when the climb exceeds 12 m', () => {
    const eq = newEquipment('column', 9);
    eq.sections[0].ttLength = 16000;
    eq.support = { ...eq.support, type: 'skirt', skirtH: 2500 };
    const calc = computeEquipment(eq);
    const m = accessModel(eq, calc);
    expect(m.stairs).toHaveLength(1);
    expect(m.stairs[0].kind).toBe('straight');
    expect(m.stairs[0].flights).toBeGreaterThanOrEqual(5);
    expect(m.stairs[0].headingDeg).toBe(0);
    expect(m.ladders).toHaveLength(0);
    // the top of the shell gets a landing
    expect(m.platforms.some((p) => p.label.includes('(top)'))).toBe(true);
  });

  it('runs a crown walkway and an end ladder on a horizontal exchanger', () => {
    const eq = tag('hx');
    expect(eq.orientation).toBe('horizontal');
    const calc = computeEquipment(eq);
    const m = accessModel(eq, calc);
    const R = calc.sections[0].spec.dia / 2;

    const crown = m.platforms.find((p) => p.label === 'Crown walkway')!;
    expect(crown).toBeTruthy();
    expect(crown.kind).toBe('rect');
    expect(crown.y).toBeGreaterThan(R * 1.9); // above the shell crown
    expect(crown.rails).toEqual(['east', 'west']);
    expect(crown.hz).toBeGreaterThan(crown.hx); // runs along the shell

    expect(m.ladders).toHaveLength(1);
    expect(m.ladders[0].y1).toBeGreaterThan(crown.y);
    expect(m.platforms.some((p) => p.label === 'Ladder landing')).toBe(true);
  });
});

describe('air-cooler access (API 661 §7)', () => {
  it('puts a handrailed platform at both header ends with a ladder on each corner', () => {
    const eq = tag('finfan');
    const calc = computeEquipment(eq);
    const fm = finFanModel(eq, calc)!;
    const m = accessModel(eq, calc);

    const headers = m.platforms.filter((p) => p.label.includes('Header platform'));
    expect(headers).toHaveLength(2);
    for (const p of headers) {
      expect(p.kind).toBe('rect');
      expect(p.y).toBeGreaterThan(1000);
      expect(p.y).toBeLessThan(fm.bundleTopY);
      expect(p.rails).toEqual(['north', 'south', 'east', 'west']);
    }
    // one platform per header end, and the ladders stand outside them
    expect(m.ladders).toHaveLength(4);
    for (const l of m.ladders) {
      expect(l.y0).toBe(0);
      expect(l.y1).toBeGreaterThan(headers[0].y);
    }

    expect(m.walkways.some((w) => w.label === 'Inter-bay walkway')).toBe(true);
    // forced draft → inlet screen guards, not fan-deck rails
    expect(m.guards.length).toBe(fm.bays);
    expect(m.guards[0].heightMm).toBeLessThanOrEqual(200);
  });

  it('puts a guard rail around the fans of an induced-draft cooler', () => {
    const eq = tag('finfan');
    eq.finfan!.arrangement = 'induced';
    const m = accessModel(eq, computeEquipment(eq));
    expect(m.guards).toHaveLength(2);
    for (const g of m.guards) {
      expect(g.sweepDeg).toBe(360);
      expect(g.heightMm).toBe(ACCESS.railHeightMm);
    }
    expect(m.walkways.some((w) => w.label === 'Fan deck handrail')).toBe(true);
  });
});

describe('structure frame', () => {
  it('draws only the structure selected in the register', () => {
    const eq = tag('vessel');
    eq.structure = { enabled: false, kind: 'skid' };
    expect(accessModel(eq, computeEquipment(eq)).frame).toBeNull();

    eq.structure = { enabled: true, kind: 'portal' };
    const m = accessModel(eq, computeEquipment(eq));
    expect(m.frame?.kind).toBe('portal');
    expect(m.frame!.heightMm).toBeGreaterThan(1000);
    expect(m.frame!.hx).toBeGreaterThan(0);
    expect(m.rows.map((r) => r.label)).toContain('Portal frame');
    expect(m.weightKg).toBeGreaterThan(m.frame!.kg);
    expect(m.weightKg).toBeCloseTo(
      [...m.ladders, ...m.stairs, ...m.platforms, ...m.walkways, ...m.guards, ...m.bars].reduce((n, p) => n + p.kg, 0) + m.frame!.kg,
      6
    );
  });
});

describe('access descriptors — invariants for every demo tag', () => {
  it('produces finite, non-negative geometry for all five equipment families', () => {
    const tags = demoProject();
    expect(tags.length).toBeGreaterThanOrEqual(5);
    for (const eq of tags) {
      const m = accessModel(eq, computeEquipment(eq));
      expect(Number.isFinite(m.weightKg), eq.tag).toBe(true);
      expect(m.weightKg, eq.tag).toBeGreaterThan(0);
      expect(m.rows.length, eq.tag).toBeGreaterThan(0);

      for (const l of m.ladders) {
        expect(l.y1, `${eq.tag} ladder`).toBeGreaterThan(l.y0);
        expect(l.y0).toBeGreaterThanOrEqual(0);
        for (const v of [l.x, l.z, l.y0, l.y1, l.kg]) expect(Number.isFinite(v)).toBe(true);
      }
      for (const s of m.stairs) {
        expect(s.y1, `${eq.tag} stair`).toBeGreaterThan(s.y0);
        expect(Number.isFinite(s.kg)).toBe(true);
        if (s.kind === 'spiral') {
          expect(s.steps).toBeGreaterThan(0);
          expect(s.radiusMm).toBeGreaterThan(0);
        } else {
          expect(s.flights).toBeGreaterThan(0);
        }
      }
      for (const p of m.platforms) {
        if (p.kind === 'ring') {
          expect(p.r1).toBeGreaterThan(p.r0);
          expect(p.sweepDeg).toBeGreaterThan(0);
        } else {
          expect(p.hx).toBeGreaterThan(0);
          expect(p.hz).toBeGreaterThan(0);
        }
        expect(p.y).toBeGreaterThanOrEqual(0);
      }
      for (const w of m.walkways) expect(Number.isFinite(w.y0) && Number.isFinite(w.y1)).toBe(true);
      for (const g of m.guards) {
        expect(g.radiusMm).toBeGreaterThan(0);
        expect(g.y).toBeGreaterThan(0);
      }
    }
  });

  it('returns an empty model for a tag with no results yet', () => {
    const empty = newEquipment('vessel', 12);
    empty.sections = [];
    const m = accessModel(empty, computeEquipment(empty));
    expect(m.ladders).toHaveLength(0);
    expect(m.stairs).toHaveLength(0);
    expect(m.platforms).toHaveLength(0);
    expect(m.weightKg).toBe(0);
    expect(m.rows).toHaveLength(0);
  });
});
