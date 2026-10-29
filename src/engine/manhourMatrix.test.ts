// The man-hour matrix is the contract between Settings and the estimate: every
// activity type has its subtypes, and every subtype is either computed from the
// tag or explicitly zero. These tests pin that contract so a subtype cannot be
// added to Settings and silently dropped from the estimate.

import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, MANHOUR_BASIS, estimateEquipment, manhourGroup, manhourMatrix } from './estimate';
import { computeEquipment } from './compute';
import { demoProject } from '../defaults';
import { NPS_SIZES, npsLabelForBore } from './pipes';

describe('man-hour matrix (activity type → subtype)', () => {
  it('assigns every documented item to exactly one activity type', () => {
    for (const b of MANHOUR_BASIS) {
      const g = b.group ?? manhourGroup(b.key);
      expect(g, `no group for ${b.key}`).toBeTruthy();
      expect(b.basis.length, `thin basis for ${b.key}`).toBeGreaterThan(20);
    }
  });

  it('groups the welding subtypes the user asked for under Welding', () => {
    const weld = manhourMatrix().find((g) => g.group === 'Welding');
    expect(weld).toBeDefined();
    const keys = weld!.items.map((i) => i.key);
    expect(keys).toContain('weld.ls');
    expect(keys).toContain('weld.cs');
    expect(keys).toContain('weld.head');
    expect(keys).toContain('weld.nozzle');
    expect(keys).toContain('weld.ring');
    expect(keys).toContain('weld.intRing');
    expect(keys).toContain('weld.clip');
  });

  it('covers the other manufacturing types, not only welding', () => {
    const groups = manhourMatrix().map((g) => g.group);
    for (const g of [
      'Cutting & edge prep',
      'Forming & fitting',
      'Assembly & supports',
      'Non-destructive testing',
      'Heat treatment',
      'Testing',
      'Painting & insulation',
      'Handling & erection',
      'Engineering & QA',
    ]) {
      expect(groups).toContain(g);
    }
  });

  it('has no empty group and no duplicated key', () => {
    const m = manhourMatrix();
    for (const g of m) expect(g.items.length).toBeGreaterThan(0);
    const keys = MANHOUR_BASIS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('estimate books the added subtypes', () => {
  const vessel = demoProject().find((e) => e.equipType === 'vessel')!;

  it('counts stiffening-ring and clipping welding for a tag that needs them', () => {
    const withRing = { ...vessel, ring: { enabled: true, webDepthMm: 90, webThkMm: 10, count: 2 } };
    const calc = computeEquipment(withRing);
    const est = estimateEquipment(
      { equip: withRing, calc, bom: [], procurementCostUSD: 0 },
      DEFAULT_RATES
    );
    const hours = (key: string) => est.tag.manhours.find((m) => m.key === key)?.autoH ?? 0;
    expect(hours('weld.ring')).toBeGreaterThan(0);
    expect(hours('handle')).toBeGreaterThan(0);
    // keys exist even when the tag does not need them, so Settings can show the basis
    expect(est.tag.manhours.map((m) => m.key)).toContain('weld.intRing');
    expect(est.tag.manhours.map((m) => m.key)).toContain('weld.clip');
  });

  it('never counts ring welding when no ring is specified', () => {
    const plain = { ...vessel, ring: undefined };
    const calc = computeEquipment(plain);
    const est = estimateEquipment({ equip: plain, calc, bom: [], procurementCostUSD: 0 }, DEFAULT_RATES);
    expect(est.tag.manhours.find((m) => m.key === 'weld.ring')?.autoH).toBe(0);
  });
});

describe('nozzle bore sizes offered in inches (I6)', () => {
  it('lists the standard NPS sizes with their nominal bore in mm', () => {
    expect(NPS_SIZES.find((s) => s.nps === '2"')?.dnMm).toBe(50);
    expect(NPS_SIZES.find((s) => s.nps === '6"')?.dnMm).toBe(150);
    expect(NPS_SIZES.find((s) => s.nps === '24"')?.dnMm).toBe(600);
    // ascending bore order, so the picker reads naturally
    const bores = NPS_SIZES.map((s) => s.dnMm);
    expect([...bores].sort((a, b) => a - b)).toEqual(bores);
  });

  it('labels a stored bore back to its NPS size, and falls back for a custom bore', () => {
    expect(npsLabelForBore(150)).toBe('6"');
    expect(npsLabelForBore(50)).toBe('2"');
    expect(npsLabelForBore(137)).toBe('137 mm');
  });
});
