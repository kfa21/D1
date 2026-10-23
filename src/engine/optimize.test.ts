import { describe, expect, it } from 'vitest';
import { optimizeProcurement, mergeRequests } from './optimize';
import { DEFAULT_PLATE_STOCK } from './plates';
import type { PlateRequestFull } from './bom';

const ctx: { stockPlates: typeof DEFAULT_PLATE_STOCK; prices: Record<string, number> } = {
  stockPlates: DEFAULT_PLATE_STOCK,
  prices: { 'SA-516-70': 1.1, 'SA-240-316L': 4.2, default: 1.2 },
};

function req(partial: Partial<PlateRequestFull> & { partName: string; count: number }): PlateRequestFull {
  return { equipId: 'e1', tag: 'V-101', material: 'SA-516-70', thk: 12, w: 1500, l: 2000, ...partial };
}

describe('mergeRequests', () => {
  it('pools identical parts across tags', () => {
    const reqs = [
      req({ partName: 'shell', count: 2, tag: 'V-101' }),
      req({ partName: 'shell', count: 3, tag: 'V-102' }),
      req({ partName: 'head blank', count: 1, w: 1300, l: 1300, tag: 'V-101' }),
    ];
    const groups = mergeRequests(reqs);
    expect(groups).toHaveLength(2);
    const shell = groups.find((g) => g.partW === 1500)!;
    expect(shell.partCount).toBe(5);
    expect(shell.tags).toEqual(['V-101', 'V-102']);
  });

  it('keeps different thicknesses as separate groups', () => {
    const reqs = [req({ partName: 'a', count: 1, thk: 12 }), req({ partName: 'a', count: 1, thk: 16 })];
    expect(mergeRequests(reqs)).toHaveLength(2);
  });
});

describe('optimizeProcurement', () => {
  it('reduces plate count vs per-tag planning when parts pool across tags', () => {
    // 4 identical parts per tag × 2 tags = 8 parts of 1000×2000:
    // per-tag: each tag needs ceil(4 / per) plates; pooled: fewer
    const reqs = [
      req({ partName: 'pad', count: 4, w: 1000, l: 2000, tag: 'V-101' }),
      req({ partName: 'pad', count: 4, w: 1000, l: 2000, tag: 'V-102' }),
    ];
    const plan = optimizeProcurement(reqs, ctx);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].mergedFromTags).toEqual(['V-101', 'V-102']);
    // pooled nesting must never need more plates than the naive split
    expect(plan.totals.plates).toBeLessThanOrEqual(plan.totals.baselinePlates);
    // and at least one suggestion should be present
    expect(plan.suggestions.length).toBeGreaterThan(0);
  });

  it('reports positive savings when pooling saves plates', () => {
    // 900×950 parts nest 12-up on a 2000×6000 plate: per-tag 5 parts → 1 plate
    // each (3 tags = 3 plates), pooled 15 parts → ceil(15/12) = 2 plates.
    const reqs = [
      req({ partName: 'pad', count: 5, w: 900, l: 950, tag: 'V-101' }),
      req({ partName: 'pad', count: 5, w: 900, l: 950, tag: 'V-102' }),
      req({ partName: 'pad', count: 5, w: 900, l: 950, tag: 'V-103' }),
    ];
    const plan = optimizeProcurement(reqs, ctx);
    expect(plan.totals.baselinePlates - plan.totals.plates).toBeGreaterThan(0);
    const mergeSug = plan.suggestions.find((s) => s.kind === 'plate-size');
    expect(mergeSug).toBeDefined();
    expect(mergeSug!.savingUSD).toBeGreaterThan(0);
    expect(plan.lines[0].platesSaved).toBeGreaterThan(0);
  });

  it('suggests thickness harmonization for adjacent stock steps in one material', () => {
    const reqs = [
      req({ partName: 'a', count: 20, thk: 8, w: 1000, l: 2000, tag: 'V-101' }),
      req({ partName: 'b', count: 20, thk: 10, w: 1000, l: 2000, tag: 'V-102' }),
    ];
    const plan = optimizeProcurement(reqs, ctx);
    const thk = plan.suggestions.find((s) => s.kind === 'thickness');
    expect(thk).toBeDefined();
    expect(thk!.title).toContain('SA-516-70');
    expect(thk!.detail).toContain('8 mm');
  });

  it('does not suggest harmonization across distant thicknesses', () => {
    const reqs = [
      req({ partName: 'a', count: 20, thk: 8, w: 1000, l: 2000, tag: 'V-101' }),
      req({ partName: 'b', count: 20, thk: 30, w: 1000, l: 2000, tag: 'V-102' }),
    ];
    const plan = optimizeProcurement(reqs, ctx);
    expect(plan.suggestions.find((s) => s.kind === 'thickness')).toBeUndefined();
  });

  it('flags oversized parts as warnings', () => {
    const reqs = [req({ partName: 'huge', count: 1, w: 4000, l: 13000, tag: 'TK-101' })];
    const plan = optimizeProcurement(reqs, ctx);
    expect(plan.suggestions.some((s) => s.kind === 'warning')).toBe(true);
    expect(plan.lines[0].oversized).toBe(true);
  });

  it('optimized totals are finite and cost = mass × price', () => {
    const reqs = [
      req({ partName: 'shell', count: 6, w: 1500, l: 2000, tag: 'V-101' }),
      req({ partName: 'shell2', count: 3, w: 1500, l: 1800, thk: 16, material: 'SA-240-316L', tag: 'V-102' }),
    ];
    const plan = optimizeProcurement(reqs, ctx);
    expect(Number.isFinite(plan.totals.costUSD)).toBe(true);
    expect(plan.totals.costUSD).toBeGreaterThan(0);
    expect(plan.totals.plates).toBeGreaterThan(0);
    for (const l of plan.lines) {
      expect(l.estimatedCostUSD).toBeCloseTo(l.massKg * (ctx.prices[l.material] ?? 1.2), 0);
    }
  });
});
