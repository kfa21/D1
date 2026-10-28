// Geometry descriptors for the 3D viewer: tanks and air coolers used to be
// drawn from the pressure-boundary sections, so a tank had no roof and an air
// cooler came out as a 1.2 m shell. These tests pin the parts the viewer draws
// to the numbers the engines calculated.

import { describe, it, expect } from 'vitest';
import { demoProject, newEquipment } from '../defaults';
import { computeEquipment } from './compute';
import { finFanModel, tankModel, viewerSummary } from './model3d';

const tankTag = () => {
  const eq = demoProject().find((e) => e.equipType === 'tank')!;
  return { equip: eq, calc: computeEquipment(eq) };
};

const coolerTag = () => {
  const eq = demoProject().find((e) => e.equipType === 'finfan')!;
  return { equip: eq, calc: computeEquipment(eq) };
};

describe('tankModel (API 650)', () => {
  it('stacks every calculated shell course above the bottom plate', () => {
    const { equip, calc } = tankTag();
    const m = tankModel(equip, calc)!;
    expect(m).toBeTruthy();
    expect(m.courses).toHaveLength(calc.tank!.shellCourses.length);

    // 14 m of shell at the 2 m plate width → 7 courses, each 2 m
    expect(m.courses).toHaveLength(7);
    expect(m.bottomPlateThkMm).toBeCloseTo(calc.tank!.bottomThk, 9);
    expect(m.shellBaseY).toBeCloseTo(m.bottomPlateThkMm, 9);

    // continuous stack: each course starts where the previous one ended
    for (let i = 0; i < m.courses.length; i++) {
      const c = m.courses[i];
      expect(c.heightMm).toBeCloseTo(2000, 6);
      expect(c.y1 - c.y0).toBeCloseTo(c.heightMm, 9);
      if (i > 0) expect(c.y0).toBeCloseTo(m.courses[i - 1].y1, 9);
      // thickness and grade on the model are the sized ones
      expect(c.thicknessMm).toBeCloseTo(calc.tank!.shellCourses[i].tNominal, 9);
      expect(c.material).toBe(calc.tank!.shellCourses[i].material);
      expect(c.utilization).toBeGreaterThan(0);
      expect(c.utilization).toBeLessThanOrEqual(1);
    }
    expect(m.shellTopY).toBeCloseTo(m.shellBaseY + 14000, 6);
    expect(m.diameterMm).toBe(12000);
    expect(m.radiusMm).toBe(6000);
  });

  it('draws the cone roof at the entered 1:N slope and the annular ring width', () => {
    const { equip, calc } = tankTag();
    const m = tankModel(equip, calc)!;
    // default slope 1:16 → rise = R / 16
    expect(m.roof.kind).toBe('cone');
    expect(m.roof.riseMm).toBeCloseTo(6000 / 16, 6);
    expect(m.roof.rimY).toBeCloseTo(m.shellTopY, 9);
    expect(m.roof.apexY).toBeCloseTo(m.shellTopY + m.roof.riseMm, 9);
    expect(m.overallHeightMm).toBeCloseTo(m.roof.apexY, 9);
    expect(m.annularRingMm).toBe(600);
  });

  it('caps the liquid level at the shell and fills from the shell bottom', () => {
    const { equip, calc } = tankTag();
    const m = tankModel(equip, calc)!;
    expect(m.levelMm).toBe(14000); // defaults to the shell height
    expect(m.liquidY).toBeCloseTo(m.shellBaseY + 14000, 6);
    expect(m.floatingDeckY).toBeNull(); // cone roof, no floating deck

    equip.tank!.maxDesignLiquidLevel = 9000;
    const capped = tankModel(equip, computeEquipment({ ...equip }))!;
    expect(capped.levelMm).toBe(9000);
    expect(capped.liquidY).toBeCloseTo(capped.shellBaseY + 9000, 6);
  });

  it('opens the top for an external floating roof and adds a floating deck', () => {
    const { equip } = tankTag();
    equip.tank!.roofType = 'externalFloating';
    equip.tank!.maxDesignLiquidLevel = 10000;
    const m = tankModel(equip, computeEquipment({ ...equip }))!;
    expect(m.roof.kind).toBe('none');
    expect(m.roof.riseMm).toBe(0);
    expect(m.floatingDeckY).toBeCloseTo(m.shellBaseY + 10000, 6);
    expect(m.windGirdersY.length).toBeGreaterThan(0); // mandatory at the top course
  });

  it('keeps a fixed roof over an internal floating roof', () => {
    const { equip } = tankTag();
    equip.tank!.roofType = 'internalFloating';
    const m = tankModel(equip, computeEquipment({ ...equip }))!;
    expect(m.roof.kind).toBe('cone');
    expect(m.floatingDeckY).not.toBeNull();
  });

  it('adds a spiral stair only for a tank you can walk up', () => {
    const { equip } = tankTag();
    const tall = tankModel(equip, computeEquipment({ ...equip }))!;
    expect(tall.stair).toBeTruthy();
    expect(tall.stair!.steps).toBe(Math.ceil(14000 / 220));
    expect(tall.stair!.topY).toBeCloseTo(tall.shellTopY, 6);
    // the stair radius clears the shell
    expect(tall.stair!.radiusMm).toBeGreaterThan(tall.radiusMm);

    equip.sections[0].ttLength = 2500;
    equip.tank!.maxDesignLiquidLevel = 2500;
    const short = tankModel(equip, computeEquipment({ ...equip }))!;
    expect(short.stair).toBeNull();
  });

  it('returns null when the tag has no tank results', () => {
    const eq = newEquipment('vessel', 1);
    expect(tankModel(eq, computeEquipment(eq))).toBeNull();
  });
});

describe('finFanModel (API 661)', () => {
  it('builds one bay per entered bay, with symmetric row centres', () => {
    const { equip, calc } = coolerTag();
    const m = finFanModel(equip, calc)!;
    expect(m.bays).toBe(2);
    expect(m.rows).toBe(4);
    expect(m.bayCentersZ).toHaveLength(2);
    expect(m.bayCentersZ[0] + m.bayCentersZ[1]).toBeCloseTo(0, 6);
    expect(m.totalDepthMm).toBeGreaterThan(m.bayDepthMm);
    expect(m.tubeLengthMm).toBe(9000);
    expect(m.tubeCount).toBe(calc.finfan!.tubeCountActual);
  });

  it('uses the fan the engine sized and keeps it below a forced-draft bundle', () => {
    const { equip, calc } = coolerTag();
    const m = finFanModel(equip, calc)!;
    expect(m.fanDiaMm).toBeCloseTo(calc.finfan!.fanDiaMm, 6);
    expect(m.arrangement).toBe('forced');
    expect(m.fanY).toBeLessThan(m.plenumBottomY);
    expect(m.plenumTopY).toBeCloseTo(m.plenumBottomY + m.plenumHeightMm, 6);
    expect(m.bundleBottomY).toBeCloseTo(m.plenumTopY, 6);
    expect(m.bundleTopY).toBeCloseTo(m.bundleBottomY + m.bundleHeightMm, 6);
    expect(m.overallHeightMm).toBeGreaterThan(m.bundleTopY);
  });

  it('moves the fans above the bundle for induced draft', () => {
    const { equip } = coolerTag();
    equip.finfan!.arrangement = 'induced';
    const m = finFanModel(equip, computeEquipment({ ...equip }))!;
    expect(m.arrangement).toBe('induced');
    expect(m.fanY).toBeGreaterThan(m.plenumTopY);
    expect(m.bundleBottomY).toBeCloseTo(m.legHeightMm, 6);
  });

  it('returns null when the tag has no air-cooler results', () => {
    const eq = newEquipment('vessel', 1);
    expect(finFanModel(eq, computeEquipment(eq))).toBeNull();
  });
});

describe('viewerSummary', () => {
  it('lists every tank course with its plate thickness and grade', () => {
    const { equip, calc } = tankTag();
    const s = viewerSummary(equip, calc);
    expect(s.title).toContain('API 650');
    const courseRows = s.rows.filter((r) => r.label.startsWith('Shell course'));
    expect(courseRows).toHaveLength(calc.tank!.shellCourses.length);
    expect(courseRows[0].label).toContain('(bottom)');
    expect(courseRows[0].value).toMatch(/t \d+\.\d mm/);
    expect(s.rows.some((r) => r.label === 'Roof')).toBe(true);
    expect(s.rows.some((r) => r.label === 'Design liquid level')).toBe(true);
  });

  it('describes an air cooler by bays, fans and air side', () => {
    const { equip, calc } = coolerTag();
    const s = viewerSummary(equip, calc);
    expect(s.subtitle).toContain('bay');
    expect(s.rows.map((r) => r.label)).toEqual(expect.arrayContaining(['Bundle', 'Fan', 'Air side', 'Thermal']));
    const fan = s.rows.find((r) => r.label === 'Fan')!;
    expect(fan.value).toContain('Ø');
    expect(fan.note).toContain('40%');
  });

  it('describes a vessel by courses, heads, supports and nozzles', () => {
    const eq = demoProject().find((e) => e.equipType === 'vessel')!;
    const calc = computeEquipment(eq);
    const s = viewerSummary(eq, calc);
    const labels = s.rows.map((r) => r.label);
    expect(labels).toContain('Shell course 1');
    expect(labels).toContain('Bottom head');
    expect(labels).toContain('Top head');
    expect(labels).toContain('Supports');
    expect(labels).toContain('Nozzles');
    expect(s.subtitle).toContain('MAWP');
  });
});
