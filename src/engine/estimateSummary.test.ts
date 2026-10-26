import { describe, expect, it } from 'vitest';
import { summarizeEstimate } from './estimateSummary';
import { estimateProject, DEFAULT_RATES, type EstimateLine, type EstimateResult } from './estimate';
import { computeEquipment } from './compute';
import { newEquipment } from '../defaults';
import { DEFAULT_PLATE_STOCK } from './plates';
import type { Equipment } from './types';

const ctx = { stockPlates: DEFAULT_PLATE_STOCK, prices: DEFAULT_RATES.prices };
const entries = (eq: Equipment) => [{ equip: eq, calc: computeEquipment(eq) }];

const line = (group: EstimateLine['group'], amountUSD: number, qty = 0, unit = 'lot'): EstimateLine => ({
  equipId: 'e1',
  tag: 'T-1',
  group,
  activity: 'activity',
  qty,
  unit,
  rateUSD: amountUSD,
  amountUSD,
});

const synthetic = (): EstimateResult => ({
  lines: [
    line('Material', 600),
    line('Welding', 150, 10, 'h'),
    line('Shop labor', 50, 5, 'h'),
    line('NDT', 40, 4, 'h'),
    line('Outside services', 60),
  ],
  perTag: [{ equipId: 'e1', tag: 'T-1', name: 'Drum' }] as EstimateResult['perTag'],
  totals: {
    materialUSD: 600,
    laborUSD: 200,
    consumableUSD: 0,
    serviceUSD: 100,
    shopHours: 15,
    subtotalUSD: 900,
    overheadUSD: 198,
    profitUSD: 109.8,
    contingencyUSD: 60.39,
    grandUSD: 1268.19,
  },
  manhours: [],
});

describe('summarizeEstimate', () => {
  it('aggregates cost groups largest-first with shares that close on the direct cost', () => {
    const s = summarizeEstimate(synthetic(), { dryKg: 0, weldM: 0 }, { markups: { overheadPct: 22, profitPct: 10, contingencyPct: 5 } });
    expect(s.groups.map((g) => g.group)).toEqual(['Material', 'Welding', 'Outside services', 'Shop labor', 'NDT']);
    const sum = s.groups.reduce((a, g) => a + g.amountUSD, 0);
    expect(sum).toBeCloseTo(900, 6);
    expect(s.groups.reduce((a, g) => a + g.pct, 0)).toBeCloseTo(100, 6);
    // hours only accrue on hour-denominated lines
    expect(s.groups.find((g) => g.group === 'Welding')!.hours).toBeCloseTo(10, 9);
    expect(s.groups.find((g) => g.group === 'Material')!.hours).toBe(0);
    expect(s.groups.find((g) => g.group === 'Welding')!.lines).toBe(1);
  });

  it('splits the four headline buckets and keeps the markup ladder additive', () => {
    const s = summarizeEstimate(synthetic(), { dryKg: 0, weldM: 0 }, { markups: { overheadPct: 22, profitPct: 10, contingencyPct: 5 } });
    expect(s.split.reduce((a, x) => a + x.amountUSD, 0)).toBeCloseTo(900, 6);
    expect(s.split.find((x) => x.key === 'material')!.pct).toBeCloseTo((600 / 900) * 100, 6);
    const direct = s.ladder[0].amountUSD;
    const added = s.ladder.slice(1, 4).reduce((a, x) => a + x.amountUSD, 0);
    expect(direct + added).toBeCloseTo(1268.19, 6);
    expect(s.ladder[4].label).toBe('Grand total');
    expect(s.ladder[4].pctOfGrand).toBe(100);
    expect(s.ladder[1].ratePct).toBe(22);
  });

  it('returns the largest lines as top drivers', () => {
    const s = summarizeEstimate(synthetic(), { dryKg: 0, weldM: 0 }, { topN: 3 });
    expect(s.topDrivers).toHaveLength(3);
    expect(s.topDrivers[0].amountUSD).toBe(600);
    expect(s.topDrivers.map((l) => l.amountUSD)).toEqual([600, 150, 60]);
    expect(s.metrics.lineCount).toBe(5);
    expect(s.metrics.tags).toBe(1);
  });

  it('never divides by zero when the project has no weight or weld length', () => {
    const s = summarizeEstimate(synthetic(), { dryKg: 0, weldM: 0 });
    expect(s.metrics.costPerKgUSD).toBe(0);
    expect(s.metrics.costPerWeldMUSD).toBe(0);
    expect(s.metrics.hoursPerWeldM).toBe(0);
    expect(s.groups.every((g) => Number.isFinite(g.pct))).toBe(true);
  });

  it('closes on the real estimate: groups sum to the direct subtotal', () => {
    const eq = newEquipment('vessel', 1);
    const calc = computeEquipment(eq);
    const res = estimateProject(entries(eq), DEFAULT_RATES, ctx);
    const s = summarizeEstimate(res, { dryKg: calc.weightDryKg, weldM: calc.weldLengthM }, { markups: DEFAULT_RATES });
    expect(s.groups.reduce((a, g) => a + g.amountUSD, 0)).toBeCloseTo(res.totals.subtotalUSD, 4);
    expect(s.groups.reduce((a, g) => a + g.pct, 0)).toBeCloseTo(100, 4);
    expect(s.split.reduce((a, x) => a + x.amountUSD, 0)).toBeCloseTo(
      res.totals.materialUSD + res.totals.laborUSD + res.totals.consumableUSD + res.totals.serviceUSD,
      6
    );
    // subtotal + the three markup steps must equal the grand total
    expect(s.ladder.slice(0, 4).reduce((a, x) => a + x.amountUSD, 0)).toBeCloseTo(res.totals.grandUSD, 6);
    expect(s.metrics.costPerKgUSD).toBeGreaterThan(0);
    expect(s.metrics.hoursPerWeldM).toBeGreaterThan(0);
    expect(s.topDrivers.length).toBeGreaterThan(0);
  });
});
