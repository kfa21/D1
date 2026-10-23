// Optimized plate procurement — works on the whole project's plate load:
// 1. merges identical parts across tags so nesting counts pool together,
// 2. harmonizes close stock thicknesses within a material (fewer SKUs),
// 3. re-picks the plate size that minimizes plates/wastage for the pooled load,
// and reports concrete suggestions with kg / cost savings vs the naive plan.

import type { PlateRequestFull } from './bom';
import {
  PlateSize,
  PlateProcurementLine,
  MARKET_THICKNESS_MM,
  stockThickness,
  nestParts,
  planPlate,
} from './plates';
import { getMat } from './materials';

export interface OptimizeContext {
  stockPlates: PlateSize[];
  prices: Record<string, number>;
}

export interface MergedGroup {
  key: string;
  material: string;
  thkRequested: number;
  partW: number;
  partL: number;
  partCount: number;
  tags: string[];
}

export interface OptimizedLine extends PlateProcurementLine {
  mergedFromTags: string[];
  baselinePlates: number;
  platesSaved: number;
}

export interface ProcSuggestion {
  kind: 'merge' | 'thickness' | 'plate-size' | 'warning';
  title: string;
  detail: string;
  savingUSD?: number;
  savingKg?: number;
}

export interface OptimizedPlan {
  lines: OptimizedLine[];
  suggestions: ProcSuggestion[];
  totals: {
    plates: number;
    baselinePlates: number;
    massKg: number;
    costUSD: number;
    baselineCostUSD: number;
    wastagePct: number;
    baselineWastagePct: number;
  };
}

function priceOf(material: string, ctx: OptimizeContext): number {
  return ctx.prices[material] ?? getMat(material)?.pricePerKg ?? 0.41;
}

/** Pool identical parts (same material, requested thickness and W×L) across all tags. */
export function mergeRequests(reqs: PlateRequestFull[]): MergedGroup[] {
  const map = new Map<string, MergedGroup>();
  for (const r of reqs) {
    const key = `${r.material}|${r.thk.toFixed(2)}|${r.w}x${r.l}`;
    const g = map.get(key);
    if (g) {
      g.partCount += r.count;
      if (!g.tags.includes(r.tag)) g.tags.push(r.tag);
    } else {
      map.set(key, {
        key,
        material: r.material,
        thkRequested: r.thk,
        partW: r.w,
        partL: r.l,
        partCount: r.count,
        tags: [r.tag],
      });
    }
  }
  return [...map.values()];
}

/** Best stock plate for a pooled load: least purchased mass (cost), then fewest
 *  plates, then least wastage. You buy whole plates, so minimizing the mass you
 *  actually pay for is the real objective — plate count alone can mislead
 *  (fewer, larger plates may mean more steel purchased). */
function bestPlateFor(w: number, l: number, count: number, thkMm: number, stock: PlateSize[]) {
  let best: { plate: PlateSize; nest: ReturnType<typeof nestParts>; massKg: number } | null = null;
  for (const p of stock) {
    for (const swapped of [false, true]) {
      const pw = swapped ? p.l : p.w;
      const pl = swapped ? p.w : p.l;
      if (pw + 1e-6 < w || pl + 1e-6 < l) continue;
      const nest = nestParts(w, l, count, p);
      const massKg = nest.platesNeeded * (p.w / 1000) * (p.l / 1000) * (thkMm / 1000) * 7850;
      if (
        !best ||
        massKg < best.massKg - 1e-6 ||
        (Math.abs(massKg - best.massKg) <= 1e-6 && nest.platesNeeded < best.nest.platesNeeded) ||
        (Math.abs(massKg - best.massKg) <= 1e-6 && nest.platesNeeded === best.nest.platesNeeded && nest.wastagePct < best.nest.wastagePct)
      ) {
        best = { plate: p, nest, massKg };
      }
    }
  }
  return best;
}

/**
 * Build the optimized procurement plan from all project plate requests.
 * Baseline = naive per-request planning (planPlate per request).
 */
export function optimizeProcurement(reqs: PlateRequestFull[], ctx: OptimizeContext): OptimizedPlan {
  const suggestions: ProcSuggestion[] = [];

  // ---- baseline (what the naive planner would buy) ----
  const baselineLines = reqs.map((r) =>
    planPlate(r, ctx.stockPlates, priceOf(r.material, ctx), `${r.tag}|${r.material}|${r.thk.toFixed(1)}|${r.partName}`)
  );
  const baselinePlates = baselineLines.reduce((s, l) => s + (l.oversized ? 0 : l.platesNeeded), 0);
  const baselineCost = baselineLines.reduce((s, l) => s + l.estimatedCostUSD, 0);
  const baselineMass = baselineLines.reduce((s, l) => s + l.massKg, 0);
  const baselineArea = baselineLines.reduce(
    (s, l) => s + (l.oversized ? 0 : (l.platesNeeded * l.plateW * l.plateL) / 1e6),
    0
  );

  // ---- 1. merge identical parts across tags ----
  const groups = mergeRequests(reqs);
  const mergeCount = reqs.length - groups.length;
  if (mergeCount > 0) {
    const pooled = groups.filter((g) => g.tags.length > 1);
    suggestions.push({
      kind: 'merge',
      title: `${mergeCount} duplicate line${mergeCount === 1 ? '' : 's'} pooled across tags`,
      detail:
        pooled.length > 0
          ? `Identical parts on ${pooled.length} group(s) (${pooled.map((g) => g.tags.join('+')).slice(0, 3).join('; ')}${pooled.length > 3 ? '…' : ''}) are nested together — fewer plates than planning each tag alone.`
          : 'Parts with identical material/thickness/dimensions are nested together across the project.',
    });
  }

  // ---- 2. plan each merged group, choose optimal plate ----
  const lines: OptimizedLine[] = [];
  for (const g of groups) {
    const price = priceOf(g.material, ctx);
    const thk = stockThickness(g.thkRequested);
    const best = bestPlateFor(g.partW, g.partL, g.partCount, thk.chosen, ctx.stockPlates);
    const id = `${g.key}|${g.tags.join(',')}`;
    if (!best) {
      const pl = planPlate(
        { material: g.material, thk: g.thkRequested, w: g.partW, l: g.partL, count: g.partCount },
        ctx.stockPlates,
        price,
        id
      );
      lines.push({ ...pl, mergedFromTags: g.tags, baselinePlates: 0, platesSaved: 0 });
      suggestions.push({
        kind: 'warning',
        title: `Part ${g.partW}×${g.partL} mm exceeds largest stock plate`,
        detail: `${g.material} ${g.partW}×${g.partL} × ${g.partCount} — segment with weld seams or place a special mill order.`,
      });
      continue;
    }
    const massKg = best.massKg;
    // naive baseline for this pooled load: plan each tag's share separately
    let baselinePlates = 0;
    const perTagCounts = new Map<string, number>();
    for (const r of reqs) {
      const rk = `${r.material}|${r.thk.toFixed(2)}|${r.w}x${r.l}`;
      if (rk !== g.key) continue;
      perTagCounts.set(r.tag, (perTagCounts.get(r.tag) ?? 0) + r.count);
    }
    for (const [, cnt] of perTagCounts) {
      const b = bestPlateFor(g.partW, g.partL, cnt, thk.chosen, ctx.stockPlates);
      baselinePlates += b ? b.nest.platesNeeded : 0;
    }
    lines.push({
      id,
      material: g.material,
      thkRequested: g.thkRequested,
      thkStock: thk.chosen,
      thkIsStandard: thk.isStandard,
      thkAdded: thk.addedMm,
      partW: g.partW,
      partL: g.partL,
      partCount: g.partCount,
      plateW: best.plate.w,
      plateL: best.plate.l,
      platesNeeded: best.nest.platesNeeded,
      partsPerPlate: best.nest.partsPerPlate,
      wastagePct: best.nest.wastagePct,
      massKg,
      estimatedCostUSD: massKg * price,
      oversized: false,
      note: thk.isStandard
        ? `pooled ${g.tags.length > 1 ? `×${g.tags.length} tags` : 'stock size'}`
        : `specified ${g.thkRequested.toFixed(1)} mm → stock ${thk.chosen} mm`,
      mergedFromTags: g.tags,
      baselinePlates,
      platesSaved: Math.max(0, baselinePlates - best.nest.platesNeeded),
    });
  }

  // ---- 3. thickness harmonization suggestions per material ----
  const byMat = new Map<string, OptimizedLine[]>();
  for (const l of lines) {
    const arr = byMat.get(l.material) ?? [];
    arr.push(l);
    byMat.set(l.material, arr);
  }
  for (const [mat, ls] of byMat) {
    const used = [...new Set(ls.map((l) => l.thkStock))].sort((a, b) => a - b);
    for (let i = 0; i < used.length - 1; i++) {
      const lo = used[i];
      const hi = used[i + 1];
      const idxLo = MARKET_THICKNESS_MM.indexOf(lo);
      const idxHi = MARKET_THICKNESS_MM.indexOf(hi);
      if (idxLo < 0 || idxHi < 0 || idxHi - idxLo > 1) continue; // only adjacent stock steps
      const loLines = ls.filter((l) => l.thkStock === lo);
      const loMass = loLines.reduce((s, l) => s + l.massKg, 0);
      const loCost = loLines.reduce((s, l) => s + l.estimatedCostUSD, 0);
      const uplift = ((hi - lo) / lo) * 100;
      if (uplift <= 25 && loMass > 500) {
        suggestions.push({
          kind: 'thickness',
          title: `Harmonize ${mat}: ${lo} mm → ${hi} mm`,
          detail: `${loLines.length} line(s) at ${lo} mm (${fmtKg(loMass)}, ${fmtUSD(loCost)}). Uplift ${uplift.toFixed(0)}% buys one SKU fewer, better nesting and simpler procurement — confirm with engineering that ${hi} mm is acceptable (pressure parts need re-check).`,
          savingKg: 0,
        });
      }
    }
  }

  // ---- totals ----
  const plates = lines.reduce((s, l) => s + (l.oversized ? 0 : l.platesNeeded), 0);
  const cost = lines.reduce((s, l) => s + l.estimatedCostUSD, 0);
  const mass = lines.reduce((s, l) => s + l.massKg, 0);
  const area = lines.reduce((s, l) => s + (l.oversized ? 0 : (l.platesNeeded * l.plateW * l.plateL) / 1e6), 0);

  const costSaved = baselineCost - cost;
  const kgSaved = baselineMass - mass;
  const totalsBaselineWastage =
    baselineLines.length > 0 ? baselineLines.reduce((s, l) => s + l.wastagePct, 0) / baselineLines.length : 0;
  if (costSaved > 0.5 || plates < baselinePlates) {
    suggestions.unshift({
      kind: 'plate-size',
      title:
        baselinePlates - plates > 0
          ? `${baselinePlates - plates} fewer plate${baselinePlates - plates === 1 ? '' : 's'} to buy`
          : 'Cheaper plate mix for the pooled load',
      detail: `Project-wide nesting moves the load from ${baselinePlates} plates (${fmtKg(baselineMass)}) to ${plates} plates (${fmtKg(mass)}), cutting purchased steel by ${fmtKg(Math.max(0, kgSaved))} (${fmtUSD(Math.max(0, costSaved))}). Average wastage ${fmtPct(totalsBaselineWastage)} → ${fmtPct(lines.length > 0 ? lines.reduce((s, l) => s + l.wastagePct, 0) / lines.length : 0)}.`,
      savingUSD: Math.max(0, costSaved),
      savingKg: Math.max(0, kgSaved),
    });
  }

  // lines sorted by savings first
  lines.sort((a, b) => b.platesSaved - a.platesSaved || b.partCount - a.partCount);

  return {
    lines,
    suggestions,
    totals: {
      plates,
      baselinePlates,
      massKg: mass,
      costUSD: cost,
      baselineCostUSD: baselineCost,
      wastagePct: lines.length > 0 ? lines.reduce((s, l) => s + l.wastagePct, 0) / lines.length : 0,
      baselineWastagePct:
        baselineLines.length > 0 ? baselineLines.reduce((s, l) => s + l.wastagePct, 0) / baselineLines.length : 0,
    },
  };
}

function fmtKg(kg: number): string {
  return `${(kg / 1000).toFixed(2)} t`;
}
function fmtUSD(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}
