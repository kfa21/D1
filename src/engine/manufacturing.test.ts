// Manufacturing-scope tests: derived RF pad thickness, two-layer weld overlay,
// manual vs machine man-hours, the extended support family, lifting gear,
// transportation saddles and support-ring-only internals.

import { describe, expect, it } from 'vitest';
import { computeEquipment } from './compute';
import { demoProject, newEquipment } from '../defaults';
import { DEFAULT_RATES, MANHOUR_BASIS, estimateEquipment } from './estimate';
import { generateBOM } from './bom';
import { suggestedValue } from '../fixValues';
import type { Equipment, NozzleSpec } from './types';

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

describe('RF pad thickness is derived from the nozzle and shell thickness', () => {
  it('sizes the pad so the ring itself closes the UG-37 shortfall', () => {
    const eq = withNozzle(vessel(), { padDia: 300, padThk: 0 });
    const n = computeEquipment(eq).nozzles[0];
    expect(n.padDiaUsed).toBe(300);
    expect(n.padThkAuto).toBeGreaterThan(0);
    // the entered pad thickness is 0 → the engine uses the derived one
    expect(n.padThkUsed).toBeCloseTo(Math.ceil(n.padThkAuto * 2) / 2, 6);
    expect(n.reinforceOK).toBe(true);
    expect(n.shortfall).toBeLessThanOrEqual(1e-6); // the derived pad closes the requirement
  });

  it('a thicker shell needs a thinner pad, a larger pad OD needs a thinner pad', () => {
    const thin = computeEquipment(
      withNozzle(
        { ...vessel(), sections: [{ ...vessel().sections[0], shellThk: 8 }] },
        { padDia: 300, padThk: 0 }
      )
    ).nozzles[0];
    const thick = computeEquipment(
      withNozzle(
        { ...vessel(), sections: [{ ...vessel().sections[0], shellThk: 20 }] },
        { padDia: 300, padThk: 0 }
      )
    ).nozzles[0];
    expect(thick.padThkAuto).toBeLessThan(thin.padThkAuto);

    const wide = computeEquipment(withNozzle(vessel(), { padDia: 400, padThk: 0 })).nozzles[0];
    expect(wide.padThkAuto).toBeLessThan(thin.padThkAuto);
  });

  it('ignores a legacy entered pad thickness — thickness always follows the derivation', () => {
    const eq = withNozzle(vessel(), { padDia: 300, padThk: 25 });
    const n = computeEquipment(eq).nozzles[0];
    expect(n.padThkUsed).toBeCloseTo(Math.ceil(n.padThkAuto * 2) / 2, 6);
    expect(n.padThkUsed).toBeLessThan(25);
  });

  it('offers a pad OD and a derived pad thickness as the correction value', () => {
    const eq = withNozzle(vessel(), { dn: 300, padDia: 0, padThk: 0 });
    const calc = computeEquipment(eq);
    expect(calc.warnings.some((w) => w.code === 'NZ-02')).toBe(true);
    const sug = suggestedValue('NZ-02', eq, calc)!;
    expect(sug.value).toMatch(/Pad Ø \d+ mm/);
  });
});

describe('weld overlay — 309L base run + finish layer', () => {
  const overlayVessel = (furnaceHeating: boolean, shellThk = 12): Equipment => ({
    ...vessel(),
    sections: [{ ...vessel().sections[0], shellThk }],
    clad: {
      mode: 'full',
      kind: 'weldOverlay',
      materialKey: 'SA-240-316L',
      thicknessMm: 3,
      partialLengthMm: 0,
      note: '',
      overlay: { baseMatKey: 'SA-240-309L', baseThkMm: 1.5, finishThkMm: 2, furnaceHeating },
    },
  });

  it('reports each layer separately and sums to the total overlay weight', () => {
    const c = computeEquipment(overlayVessel(false));
    const ov = c.clad!.overlay!;
    expect(ov.baseMatKey).toBe('SA-240-309L');
    expect(ov.baseThkMm).toBe(1.5);
    expect(ov.finishThkMm).toBe(2);
    expect(ov.totalThkMm).toBeCloseTo(3.5, 6);
    expect(ov.baseWeightKg + ov.finishWeightKg).toBeCloseTo(c.clad!.weightKg, 6);
  });

  it('enforces the 1.5 mm minimum on each layer', () => {
    const eq = overlayVessel(false);
    eq.clad!.overlay!.baseThkMm = 0.4;
    eq.clad!.overlay!.finishThkMm = 0.5;
    const ov = computeEquipment(eq).clad!.overlay!;
    expect(ov.baseThkMm).toBe(1.5);
    expect(ov.finishThkMm).toBe(1.5);
  });

  it('suggests furnace heating for a thick build-up and stops warning once selected', () => {
    const eq = overlayVessel(false, 40);
    eq.clad!.overlay!.baseThkMm = 3;
    eq.clad!.overlay!.finishThkMm = 3;
    const c = computeEquipment(eq);
    expect(c.clad!.overlay!.furnaceSuggested).toBe(true);
    expect(c.warnings.some((w) => w.code === 'CL-05')).toBe(true);

    // computeEquipment memoises on object identity — re-compute from a new object
    const furnaceEq: Equipment = { ...eq, clad: { ...eq.clad!, overlay: { ...eq.clad!.overlay!, furnaceHeating: true } } };
    const withFurnace = computeEquipment(furnaceEq);
    expect(withFurnace.warnings.some((w) => w.code === 'CL-05')).toBe(false);

    // the furnace cycle and its attendance hours are costed
    const est = estimateOf(furnaceEq);
    expect(est.lines.some((l) => l.group === 'Outside services' && /Furnace heating cycle/.test(l.activity))).toBe(true);
    expect(est.tag.manhours.find((m) => m.key === 'overlay.furnace')!.autoH).toBeGreaterThan(0);
  });

  it('books an hour item per layer', () => {
    const est = estimateOf(overlayVessel(true));
    const keys = est.tag.manhours.map((m) => m.key);
    expect(keys).toContain('weld.overlay.base');
    expect(keys).toContain('weld.overlay.finish');
    expect(est.tag.manhours.find((m) => m.key === 'weld.overlay.base')!.autoH).toBeGreaterThan(0);
    expect(est.lines.some((l) => /Weld overlay wire/.test(l.activity))).toBe(true);
  });
});

describe('manual man-hours vs machine hours', () => {
  it('books SAW fill as machine time and the GTAW root as manual welding', () => {
    const eq = { ...vessel(), sections: [{ ...vessel().sections[0], shellThk: 16 }] };
    const est = estimateOf(eq);
    const machine = est.lines.filter((l) => l.group === 'Machine');
    expect(machine.length).toBeGreaterThan(0);
    expect(machine.some((l) => l.key === 'cut')).toBe(true); // plasma table
    expect(machine.some((l) => l.key === 'edge')).toBe(true); // bevelling machine
    expect(machine.some((l) => l.key === 'weld.ls')).toBe(true); // SAW fill
    expect(est.lines.some((l) => l.key === 'weld.ls' && /GTAW root/.test(l.activity))).toBe(true);
    expect(est.tag.machineHours).toBeGreaterThan(0);
    // a machine line is never charged at a labor rate
    for (const l of machine) expect(l.rateUSD).toBeGreaterThan(0);
  });

  it('has a machine rate for every machine man-hour item', () => {
    for (const b of MANHOUR_BASIS.filter((x) => x.resource === 'machine')) {
      expect(b.machine, b.key).toBeTruthy();
      expect(DEFAULT_RATES.machine[b.machine!], b.key).toBeGreaterThan(0);
    }
  });

  it('prices machine hours into the labor total and the shop hours', () => {
    const est = estimateOf(vessel());
    const machineUSD = est.lines.filter((l) => l.group === 'Machine').reduce((s, l) => s + l.amountUSD, 0);
    expect(est.tag.laborUSD).toBeGreaterThan(machineUSD);
    expect(est.tag.shopHours).toBeGreaterThan(
      est.tag.hoursByActivity.reduce((s, h) => s + h.hours, 0)
    );
  });
});

describe('support family, lifting and transportation saddles', () => {
  const supportEq = (patch: Partial<Equipment['support']>): Equipment => ({
    ...vessel(),
    support: { ...vessel().support, ...patch },
  });

  it('calculates each new support type separately', () => {
    for (const type of ['legsAngle', 'legsBeam', 'skirtCone', 'angleSkirt', 'bodyAngleSkirt'] as const) {
      const sup = computeEquipment(supportEq({ type })).supports!;
      expect(sup.items[0].kind, type).toBe(type);
      expect(sup.items[0].weightKg, type).toBeGreaterThan(0);
      expect(sup.items[0].hours, type).toBeGreaterThan(0);
    }
  });

  it('does not give a body angle skirt an anchor-bolt group', () => {
    const sup = computeEquipment(supportEq({ type: 'bodyAngleSkirt' })).supports!;
    expect(sup.anchorBolts).toBeNull();
    const ring = computeEquipment(supportEq({ type: 'angleSkirt' })).supports!;
    expect(ring.anchorBolts).not.toBeNull();
  });

  it('sizes lifting lugs and trunnions from the lift weight', () => {
    const eq = supportEq({
      lifting: { enabled: true, kind: 'trunnionPair', count: 0, plateThkMm: 0, liftFactor: 1.5, trunnionBoreMm: 0 },
    });
    const sup = computeEquipment(eq).supports!;
    const lift = sup.items.find((i) => i.kind === 'lifting')!;
    expect(lift).toBeTruthy();
    expect(lift.count).toBe(2);
    expect(lift.label).toContain('trunnion');
    expect(lift.note).toContain('bearing');
    expect(lift.weightKg).toBeGreaterThan(0);
  });

  it('adds wooden transportation saddles for a light horizontal tag and metal above 8 t', () => {
    const light: Equipment = {
      ...newEquipment('hx', 1),
      orientation: 'horizontal',
      support: {
        type: 'saddle',
        legCount: 2,
        saddleSpan: 2400,
        saddleAngle: 120,
        skirtH: 0,
        legPlateThk: 16,
        transportSaddle: { enabled: true, kind: 'auto', count: 0, includeInPrice: true },
      },
    };
    light.hx = {
      ...newEquipment('hx', 2).hx!,
      tubeOD: 25,
      tubeWall: 2.5,
      tubeLength: 4000,
      tubeCount: 100,
      dutyKW: 100,
    };
    const lightItem = computeEquipment(light).supports!.items.find((i) => i.kind === 'transport')!;
    expect(lightItem.label).toContain('timber');

    const heavy: Equipment = {
      ...vessel(),
      orientation: 'horizontal',
      support: {
        ...vessel().support,
        transportSaddle: { enabled: true, kind: 'metal', count: 3, includeInPrice: true },
      },
    };
    const heavyItem = computeEquipment(heavy).supports!.items.find((i) => i.kind === 'transport')!;
    expect(heavyItem.count).toBe(3);
    expect(heavyItem.weightKg).toBeGreaterThan(0);
  });

  it('only prices transportation saddles when includeInPrice is ticked', () => {
    const eq = supportEq({
      type: 'saddle',
      transportSaddle: { enabled: true, kind: 'metal', count: 2, includeInPrice: false },
    });
    eq.orientation = 'horizontal';
    const priced = estimateOf(eq);
    expect(priced.lines.some((l) => /Transportation saddles/.test(l.activity) && l.group === 'Material')).toBe(false);

    const withPrice = { ...eq, support: { ...eq.support, transportSaddle: { ...eq.support.transportSaddle!, includeInPrice: true } } };
    expect(estimateOf(withPrice).lines.some((l) => /Transportation saddles/.test(l.activity) && l.group === 'Material')).toBe(true);
  });
});

describe('internals scope: support rings only, and clad TSR material', () => {
  const ringInternals = (supplied: boolean | undefined): Equipment => ({
    ...vessel(),
    internals: [
      { id: 'in-tsr', kind: 'supportRing', count: 4, spacing: 600, bottomElevation: 1000, materialKey: 'SA-516-70', kgPerM2: 40, note: '', supplied },
    ],
  });

  it('does not add internal mass for a support-ring-only item', () => {
    const supplied = computeEquipment(ringInternals(true)).weightDryKg;
    const ringOnly = computeEquipment(ringInternals(false)).weightDryKg;
    expect(ringOnly).toBeLessThan(supplied);
  });

  it('still books support-ring welding when no internals are supplied', () => {
    const est = estimateOf(ringInternals(false));
    expect(est.tag.manhours.find((m) => m.key === 'weld.intRing')!.autoH).toBeGreaterThan(0);
    expect(est.tag.manhours.find((m) => m.key === 'internals')!.autoH).toBe(0);
  });

  it('buys a clad-zone TSR in the clad finish-layer grade', () => {
    const eq: Equipment = {
      ...ringInternals(true),
      clad: {
        mode: 'full',
        kind: 'weldOverlay',
        materialKey: 'SA-240-316L',
        thicknessMm: 3,
        partialLengthMm: 0,
        note: '',
        overlay: { baseMatKey: 'SA-240-309L', baseThkMm: 1.5, finishThkMm: 1.5, furnaceHeating: false },
      },
    };
    const calc = computeEquipment(eq);
    const item = generateBOM(eq, calc).items.find((b) => b.category === 'Internals')!;
    expect(item.material).toBe('SA-240-316L');
  });
});
