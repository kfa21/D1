// Per-type scope, SRN nozzles and exchanger tube-to-tubesheet welding.
//
// Three contracts are pinned here:
//  1. each equipment type only offers the inputs its own code reads (scope.ts),
//  2. a self-reinforced (SRN) nozzle is sized from its neck, with no pad, and the
//     engine reports the neck wall that would close UG-37,
//  3. a shell-and-tube tag books the tube-bundle work — drilling, rolling and the
//     tube-to-tubesheet weld that matches the selected joint method.

import { describe, expect, it } from 'vitest';
import { computeEquipment } from './compute';
import { newEquipment, demoProject } from '../defaults';
import { DEFAULT_RATES, MANHOUR_BASIS, estimateEquipment, manhourMatrix } from './estimate';
import { generateBOM } from './bom';
import { manhourGroup } from './estimate';
import { scopeFor, TYPE_SCOPE } from './scope';
import type { Equipment, EquipType, NozzleSpec } from './types';

const vessel = () => demoProject().find((e) => e.tag === 'V-101')!;

const withNozzle = (base: Equipment, patch: Partial<NozzleSpec>): Equipment => ({
  ...base,
  nozzles: [
    {
      id: 'nz-test',
      tag: 'N1',
      service: '',
      dn: 150,
      schKey: '40',
      sectionId: base.sections[0].id,
      elevation: 800,
      azimuth: 0,
      kind: 'process',
      flangeClass: 300,
      flangeMatKey: 'SA-105',
      padDia: 0,
      padThk: 0,
      projOutside: 150,
      ...patch,
    },
  ],
});

const estimateOf = (equip: Equipment) => {
  const calc = computeEquipment(equip);
  return estimateEquipment({ equip, calc, bom: [], procurementCostUSD: 0 }, DEFAULT_RATES);
};
const lineQty = (est: ReturnType<typeof estimateOf>, key: string) =>
  est.lines.filter((l) => l.key === key).reduce((s, l) => s + l.qty, 0);

describe('per-type field scope', () => {
  const types: EquipType[] = ['vessel', 'column', 'hx', 'tank', 'finfan'];

  it('offers a complete scope for every equipment type, with the type tab last', () => {
    for (const t of types) {
      const s = scopeFor(t);
      expect(s.tabs[0]).toBe('general');
      expect(s.tabs[s.tabs.length - 1]).toBe('type');
      expect(s.typeTabLabel.length).toBeGreaterThan(0);
      // a field the type needs must be reachable from a rendered tab
      if (s.internals) expect(s.tabs).toContain('internals');
      if (s.sections) expect(s.tabs).toContain('sections');
      expect(s.tabs).toContain('nozzles');
    }
    expect(Object.keys(TYPE_SCOPE).sort()).toEqual([...types].sort());
  });

  it('drops the ASME VIII-only inputs from an API 650 tank', () => {
    const tank = scopeFor('tank');
    expect(tank.general.pwht).toBe(false); // no UCS-56 heat treatment
    expect(tank.general.rtCategory).toBe(false); // no UW-11 category
    expect(tank.general.inspectionLevel).toBe(false); // no VIII App. 3 level
    expect(tank.general.externalPressure).toBe(false);
    expect(tank.general.designPressure).toBe(true);
    expect(tank.internals).toBe(false);
    expect(tank.cladding).toBe(false);
    expect(tank.localLoads).toBe(false); // WRC 107 is a vessel bulletin
  });

  it('treats an air cooler as a bundle and a fan, not a shell', () => {
    const ff = scopeFor('finfan');
    expect(ff.sections).toBe(false);
    expect(ff.internals).toBe(false);
    expect(ff.cladding).toBe(false);
    expect(ff.pad).toBe(false);
    expect(ff.general.corrosionAllowance).toBe(false);
    expect(ff.general.designPressure).toBe(true);
  });

  it('keeps the tubesheet overlay (not vessel cladding) and no internals for an exchanger', () => {
    const hx = scopeFor('hx');
    expect(hx.internals).toBe(false);
    expect(hx.cladding).toBe(false);
    expect(hx.localLoads).toBe(true);
    expect(hx.general.pwht).toBe(true);
  });

  it('keeps the full VIII-1 input set for vessels and columns', () => {
    for (const t of ['vessel', 'column'] as const) {
      const s = scopeFor(t);
      for (const v of Object.values(s.general)) expect(v).toBe(true);
      expect(s.cladding).toBe(true);
      expect(s.internals).toBe(true);
    }
  });

  it('stops a fin-fan buying plate for a section it does not have', () => {
    const ff: Equipment = { ...newEquipment('finfan', 1), tag: 'AC-1' };
    const { items } = generateBOM(ff, computeEquipment(ff));
    expect(items.some((i) => i.item.startsWith('Shell strip'))).toBe(false);
    expect(items.some((i) => i.item.startsWith('Header'))).toBe(true);
  });
});

describe('SRN (self-reinforced) nozzles', () => {
  it('needs no pad and reports the neck wall that closes UG-37', () => {
    const eq = withNozzle(vessel(), { style: 'srn', padDia: 0 });
    const n = computeEquipment(eq).nozzles[0];
    expect(n.style).toBe('srn');
    expect(n.padDiaUsed).toBe(0); // no ring is bought for an SRN neck
    expect(n.srnNeckThkRequired).toBeGreaterThan(0);
    expect(n.reinforceOK).toBe(false);
    const warn = computeEquipment(eq).warnings.find((w) => w.code === 'NZ-06')!;
    expect(warn.msg).toContain('self-reinforced');
    expect(warn.msg).toContain(n.srnNeckThkRequired.toFixed(1));
  });

  it('passes once the neck is thickened to the reported value', () => {
    const probe = computeEquipment(withNozzle(vessel(), { style: 'srn' })).nozzles[0];
    const eq = withNozzle(vessel(), { style: 'srn', neckThkMm: probe.srnNeckThkRequired });
    const n = computeEquipment(eq).nozzles[0];
    expect(n.wall).toBe(probe.srnNeckThkRequired);
    expect(n.reinforceOK).toBe(true);
    expect(n.srnNeckThkRequired).toBe(0);
    expect(n.Aprov).toBeGreaterThanOrEqual(n.Areq - 1e-6);
  });

  it('ignores a pad left on the spec and says so', () => {
    const eq = withNozzle(vessel(), { style: 'srn', padDia: 300 });
    const calc = computeEquipment(eq);
    expect(calc.nozzles[0].padDiaUsed).toBe(0);
    expect(calc.warnings.some((w) => w.code === 'NZ-05')).toBe(true);
    // …and no RF pad ring reaches the BOM
    const { items } = generateBOM(eq, calc);
    expect(items.some((i) => i.item.startsWith('RF pad'))).toBe(false);
  });

  it('buys a plate ring for a padded nozzle, and it is procured as plate', () => {
    const eq = withNozzle(vessel(), { padDia: 300 });
    const calc = computeEquipment(eq);
    const { items, plateReqs } = generateBOM(eq, calc);
    const pad = items.find((i) => i.item.startsWith('RF pad'))!;
    expect(pad).toBeTruthy();
    expect(pad.massKg).toBeGreaterThan(0);
    expect(plateReqs.some((r) => r.partName.startsWith('RF pad'))).toBe(true);
  });
});

describe('exchanger tube-to-tubesheet welding', () => {
  const hxWith = (patch: Partial<NonNullable<Equipment['hx']>>): Equipment => {
    const e = newEquipment('hx', 1);
    e.tag = 'E-101';
    e.hx = { ...e.hx!, tubeOD: 25, tubeWall: 2.5, tubeLength: 4000, tubeCount: 120, ...patch };
    return e;
  };
  const count = (eq: Equipment) => computeEquipment(eq).hx!.tubeCountActual;

  it('documents every tube-bundle item under its own activity group', () => {
    const keys = MANHOUR_BASIS.filter((b) => b.key.startsWith('hx.')).map((b) => b.key);
    expect(keys).toEqual(
      expect.arrayContaining(['hx.tsDrill', 'hx.tubeCut', 'hx.tubeExpand', 'hx.tubeWeld', 'hx.bundle', 'hx.tubeTest'])
    );
    for (const k of keys) expect(manhourGroup(k)).toBe('Tube bundle');
    expect(manhourMatrix().some((g) => g.group === 'Tube bundle')).toBe(true);
    // machine items carry a machine rate
    for (const b of MANHOUR_BASIS.filter((x) => x.key.startsWith('hx.') && x.resource === 'machine')) {
      expect(DEFAULT_RATES.machine[b.machine!]).toBeGreaterThan(0);
    }
  });

  it('books one weld per tube END for a strength-welded joint, plus rolling and drilling', () => {
    const eq = hxWith({ tubeJointType: 'strengthWelded' });
    const est = estimateOf(eq);
    const tubes = count(eq);
    const weldJoints = est.lines.find((l) => l.key === 'hx.tubeWeld')!.activity;
    expect(weldJoints).toContain(`${tubes * 2} joints`);
    expect(lineQty(est, 'hx.tubeWeld')).toBeCloseTo(tubes * 2 * 0.1, 6); // one GTAW pass each
    expect(lineQty(est, 'hx.tubeExpand')).toBeCloseTo(tubes * 2 * 0.05, 6);
    const drill = est.lines.find((l) => l.key === 'hx.tsDrill')!;
    expect(drill.group).toBe('Machine');
    expect(drill.rateUSD).toBe(DEFAULT_RATES.machine.drill);
    expect(lineQty(est, 'hx.bundle')).toBeGreaterThan(0);
    expect(lineQty(est, 'hx.tubeTest')).toBeGreaterThan(6); // PT of the welds + helium test
  });

  it('books no weld at all for a rolled joint, and expansion instead', () => {
    const eq = hxWith({ tubeJointType: 'expanded' });
    const est = estimateOf(eq);
    expect(lineQty(est, 'hx.tubeWeld')).toBe(0);
    expect(est.lines.some((l) => l.key === 'hx.tubeWeld')).toBe(false);
    expect(lineQty(est, 'hx.tubeExpand')).toBeGreaterThan(0);
  });

  it('books more weld hours for a fully welded joint and no expansion', () => {
    const tubes = count(hxWith({}));
    const strength = estimateOf(hxWith({ tubeJointType: 'strengthWelded' }));
    const seal = estimateOf(hxWith({ tubeJointType: 'sealWeldExpanded' }));
    const full = estimateOf(hxWith({ tubeJointType: 'fullyWelded' }));
    expect(lineQty(seal, 'hx.tubeWeld')).toBeCloseTo(tubes * 2 * 0.07, 6);
    expect(lineQty(full, 'hx.tubeWeld')).toBeCloseTo(tubes * 2 * 0.2, 6); // two GTAW passes per end
    expect(lineQty(full, 'hx.tubeWeld')).toBeGreaterThan(lineQty(strength, 'hx.tubeWeld'));
    expect(full.lines.some((l) => l.key === 'hx.tubeExpand')).toBe(false);
  });

  it('books nothing tube-related for a vessel', () => {
    const est = estimateOf(vessel());
    expect(est.lines.some((l) => l.key?.startsWith('hx.'))).toBe(false);
  });

  it('adds the tube weld filler to the consumables', () => {
    const est = estimateOf(hxWith({ tubeJointType: 'strengthWelded' }));
    expect(est.lines.some((l) => l.group === 'Consumables' && l.activity.includes('Tube-to-tubesheet'))).toBe(true);
  });

  it('scales with the tube count', () => {
    const one = estimateOf(hxWith({ tubeCount: 60 }));
    const two = estimateOf(hxWith({ tubeCount: 120 }));
    expect(lineQty(two, 'hx.tubeWeld')).toBeGreaterThan(lineQty(one, 'hx.tubeWeld') * 1.5);
  });
});
