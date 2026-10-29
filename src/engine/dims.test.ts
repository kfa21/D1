// Overall dimensions: the number the register, the viewer and the shipping/plot
// planning use. The T-T total alone is not the overall length — cones and dished
// ends add to it, and a multi-section vessel is where that difference bites.

import { describe, expect, it } from 'vitest';
import { equipmentDims } from './dims';
import { computeEquipment } from './compute';
import { demoProject } from '../defaults';
import { headDepthMm } from './layout3d';

const demo = demoProject();
const vessel = demo.find((e) => e.equipType === 'vessel')!;
const tank = demo.find((e) => e.equipType === 'tank')!;
const cooler = demo.find((e) => e.equipType === 'finfan')!;

describe('equipmentDims — vessels', () => {
  it('overall = T-T + both dished ends, and height adds the support', () => {
    const eq = { ...vessel, orientation: 'vertical' as const, support: { ...vessel.support, type: 'legs' as const, skirtH: 1000 } };
    const calc = computeEquipment(eq);
    const d = equipmentDims(eq, calc);
    const R = eq.sections[0].dia / 2;
    const bot = headDepthMm({ type: eq.sections[0].headBottom, tMinNominal: calc.sections[0]?.headBot?.tMinNominal }, R);
    const top = headDepthMm({ type: eq.sections[0].headTop, tMinNominal: calc.sections[0]?.headTop?.tMinNominal }, R);
    expect(d.ttMm).toBe(eq.sections.reduce((s, x) => s + x.ttLength, 0));
    expect(d.bottomHeadMm).toBeCloseTo(bot, 6);
    expect(d.topHeadMm).toBeCloseTo(top, 6);
    expect(d.overallMm).toBeCloseTo(d.ttMm + d.coneMm + bot + top, 6);
    expect(d.heightMm).toBeCloseTo(d.overallMm + 1000, 6);
    expect(d.coneMm).toBe(0);
  });

  it('adds the cone length between two sections of different diameter', () => {
    const [s0] = vessel.sections;
    const eq = {
      ...vessel,
      sections: [
        { ...s0, id: 's1', dia: 1600, ttLength: 2400, headBottom: 'ellip2' as const, headTop: 'none' as const, coneAngleDeg: 0 },
        { ...s0, id: 's2', dia: 1000, ttLength: 1800, headBottom: 'none' as const, headTop: 'ellip2' as const, coneAngleDeg: 60 },
      ],
    };
    const calc = computeEquipment(eq);
    const d = equipmentDims(eq, calc);
    expect(d.coneMm).toBeGreaterThan(0);
    // the cone belongs to the section above the step (index 1)
    expect(d.coneLengthsMm[0]).toBe(0);
    expect(d.coneLengthsMm[1]).toBeCloseTo(d.coneMm, 6);
    // 60° included → 30° half angle: h = (R1 - R2) / tan(30°)
    const expected = (800 - 500) / Math.tan((30 * Math.PI) / 180);
    expect(d.coneLengthsMm[1]).toBeCloseTo(expected, 3);
    // overall still = tt + cones + heads
    expect(d.overallMm).toBeCloseTo(d.ttMm + d.coneMm + d.bottomHeadMm + d.topHeadMm, 6);
    expect(d.overallMm).toBeGreaterThan(d.ttMm);
  });

  it('reports the plan diameter of the largest course', () => {
    const [s0] = vessel.sections;
    const eq = {
      ...vessel,
      sections: [
        { ...s0, id: 's1', dia: 1600, ttLength: 2000, headBottom: 'none' as const, headTop: 'none' as const, coneAngleDeg: 0 },
        { ...s0, id: 's2', dia: 1000, ttLength: 1200, headBottom: 'none' as const, headTop: 'none' as const, coneAngleDeg: 60 },
      ],
    };
    const d = equipmentDims(eq, computeEquipment(eq));
    expect(d.planMm).toBeCloseTo(1600, 6);
  });
});

describe('equipmentDims — tank and air cooler', () => {
  it('measures a tank floor to roof apex and reports its diameter', () => {
    const calc = computeEquipment(tank);
    const d = equipmentDims(tank, calc);
    expect(d.planMm).toBeGreaterThan(0);
    expect(d.overallMm).toBeGreaterThanOrEqual(d.ttMm); // roof rise is added
    expect(d.heightMm).toBeCloseTo(d.overallMm, 6);
    expect(d.note).toMatch(/roof apex/);
  });

  it('measures an air cooler by bundle length and height above grade', () => {
    const calc = computeEquipment(cooler);
    const d = equipmentDims(cooler, calc);
    expect(d.overallMm).toBe(cooler.finfan!.tubeLength);
    expect(d.heightMm).toBeGreaterThan(0);
    expect(d.planMm).toBeGreaterThan(0);
  });
});
