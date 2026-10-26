import { describe, expect, it } from 'vitest';
import { estimateProject, DEFAULT_RATES, MANHOUR_BASIS } from './estimate';
import { computeEquipment } from './compute';
import { newEquipment } from '../defaults';
import { DEFAULT_PLATE_STOCK } from './plates';
import type { Equipment } from './types';

const ctx = { stockPlates: DEFAULT_PLATE_STOCK, prices: DEFAULT_RATES.prices };
const entries = (eq: Equipment) => [{ equip: eq, calc: computeEquipment(eq) }];
const usage = (res: ReturnType<typeof estimateProject>, key: string) =>
  res.manhours.find((m) => m.key === key) ?? { key, autoH: 0, appliedH: 0 };

describe('man-hour basis registry', () => {
  it('has unique keys, real trades and a derivation for every item', () => {
    const keys = MANHOUR_BASIS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of MANHOUR_BASIS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.basis.length).toBeGreaterThan(0);
      if (b.trade !== 'outsourced') expect(DEFAULT_RATES.labor).toHaveProperty(b.trade);
    }
    // the table covers every project-level roll-up too
    expect(keys).toContain('eng');
    expect(keys).toContain('qa');
    expect(keys).toContain('forming');
  });

  it('estimate reports auto == applied when no manual input is given', () => {
    const res = estimateProject(entries(newEquipment('vessel', 1)), DEFAULT_RATES, ctx);
    for (const m of res.manhours) expect(m.appliedH).toBeCloseTo(m.autoH, 9);
    expect(res.manhours).toHaveLength(MANHOUR_BASIS.length);
    expect(res.manhours.some((m) => m.autoH > 0)).toBe(true);
  });
});

describe('manual man-hour input (Settings)', () => {
  it('replaces the auto hours and books the difference as an adjustment line', () => {
    const eq = newEquipment('vessel', 1);
    const auto = estimateProject(entries(eq), DEFAULT_RATES, ctx);
    const fitAuto = usage(auto, 'fitup').autoH;
    expect(fitAuto).toBeGreaterThan(0);

    const over = estimateProject(entries(eq), DEFAULT_RATES, ctx, { fitup: 30 });
    expect(usage(over, 'fitup').appliedH).toBe(30);
    // hours: only the fit-up difference moves
    expect(over.totals.shopHours).toBeCloseTo(auto.totals.shopHours - fitAuto + 30, 6);
    // cost: the same difference at the fitter rate
    expect(over.totals.laborUSD).toBeCloseTo(
      auto.totals.laborUSD - fitAuto * DEFAULT_RATES.labor.fitter + 30 * DEFAULT_RATES.labor.fitter,
      6
    );
    // material is untouched
    expect(over.totals.materialUSD).toBe(auto.totals.materialUSD);
    // the adjustment line is explicit in the detail
    const adj = over.lines.filter((l) => l.key === 'fitup' && l.activity.includes('Manual manhour adjustment'));
    expect(adj).toHaveLength(1);
    expect(adj[0].qty).toBeCloseTo(30 - fitAuto, 6);
    expect(adj[0].trade).toBe('fitter');
  });

  it('can add hours for an item the engine booked at zero', () => {
    const eq = newEquipment('vessel', 1);
    eq.pwhtOverride = false; // guarantee no PWHT by code
    const auto = estimateProject(entries(eq), DEFAULT_RATES, ctx);
    expect(usage(auto, 'pwht').autoH).toBe(0);

    const over = estimateProject(entries(eq), DEFAULT_RATES, ctx, { pwht: 10 });
    expect(usage(over, 'pwht').appliedH).toBe(10);
    expect(over.totals.shopHours).toBeCloseTo(auto.totals.shopHours + 10, 6);
    expect(over.totals.laborUSD).toBeCloseTo(auto.totals.laborUSD + 10 * DEFAULT_RATES.labor.pwht, 6);
  });

  it('overrides the project-level engineering and QA percentages', () => {
    const eq = newEquipment('vessel', 1);
    const auto = estimateProject(entries(eq), DEFAULT_RATES, ctx);
    expect(usage(auto, 'eng').autoH).toBeCloseTo(auto.totals.shopHours * 0.06, 6);
    expect(usage(auto, 'qa').autoH).toBeCloseTo(auto.totals.shopHours * 0.02, 6);

    const over = estimateProject(entries(eq), DEFAULT_RATES, ctx, { eng: 5, qa: 0 });
    expect(usage(over, 'eng').appliedH).toBe(5);
    expect(usage(over, 'qa').appliedH).toBe(0);
    expect(over.lines.find((l) => l.key === 'eng')!.qty).toBe(5);
    expect(over.lines.find((l) => l.key === 'qa')).toBeUndefined(); // zero hours → no line
  });

  it('forms heads from the settings override, but a per-tag override still wins', () => {
    const eq = newEquipment('vessel', 1);
    const auto = estimateProject(entries(eq), DEFAULT_RATES, ctx);
    const autoForm = usage(auto, 'forming').autoH;
    expect(autoForm).toBeGreaterThan(0);

    const settings = estimateProject(entries(eq), DEFAULT_RATES, ctx, { forming: 12 });
    expect(usage(settings, 'forming').appliedH).toBe(12);
    expect(settings.lines.find((l) => l.group === 'Outside services')!.qty).toBe(12);

    const tagged = newEquipment('vessel', 1);
    tagged.formingHoursOverride = 7;
    const perTag = estimateProject(entries(tagged), DEFAULT_RATES, ctx, { forming: 12 });
    expect(usage(perTag, 'forming').appliedH).toBe(7);
    expect(perTag.lines.find((l) => l.group === 'Outside services')!.qty).toBe(7);
  });
});
