// Presentation-level aggregation of an estimate.
//
// Kept in the engine (pure, no React) so the Estimate screen, the PDF report
// and the CSV exports all quote exactly the same numbers — and so the maths is
// unit-tested rather than eyeballed in JSX.

import type { EstimateLine, EstimateResult } from './estimate';

export type EstimateGroup = EstimateLine['group'];

export interface GroupSummary {
  group: EstimateGroup;
  amountUSD: number;
  /** share of the direct cost (subtotal before markups) */
  pct: number;
  lines: number;
  /** man-hours carried by this group (only lines measured in hours) */
  hours: number;
}

export interface SplitShare {
  key: 'material' | 'labor' | 'consumables' | 'services';
  label: string;
  amountUSD: number;
  /** share of the direct cost */
  pct: number;
}

export interface MarkupStep {
  label: string;
  amountUSD: number;
  /** share of the grand total */
  pctOfGrand: number;
  /** the rate that adds this step, when it is a percentage uplift */
  ratePct?: number;
}

export interface EstimateMetrics {
  tags: number;
  lineCount: number;
  dryKg: number;
  weldM: number;
  shopHours: number;
  grandUSD: number;
  costPerTagUSD: number;
  /** BHD of finished equipment per kg of dry steel */
  costPerKgUSD: number;
  costPerWeldMUSD: number;
  hoursPerWeldM: number;
  hoursPerTag: number;
  /** "02 Special": grand price per tonne of empty (dry) equipment weight */
  costPerEmptyTonUSD: number;
  /** "02 Special": shop man-hours per tonne of empty equipment weight */
  hoursPerEmptyTon: number;
}

export interface EstimateSummary {
  /** cost groups, largest first */
  groups: GroupSummary[];
  /** the four direct-cost buckets with their share of the direct cost */
  split: SplitShare[];
  /** subtotal → overhead → profit → contingency → grand total */
  ladder: MarkupStep[];
  /** largest single cost lines, for a "top cost drivers" panel */
  topDrivers: EstimateLine[];
  metrics: EstimateMetrics;
}

export interface SummaryOptions {
  /** markup rates, to label the ladder steps */
  markups?: { overheadPct: number; profitPct: number; contingencyPct: number };
  /** how many lines the top-drivers panel shows (default 8) */
  topN?: number;
}

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

export function summarizeEstimate(
  res: EstimateResult,
  phys: { dryKg: number; weldM: number },
  opts: SummaryOptions = {}
): EstimateSummary {
  const t = res.totals;
  const direct = t.subtotalUSD; // everything before markups (incl. engineering/QA)
  const pctOfDirect = (v: number) => safeDiv(v, direct) * 100;
  const pctOfGrand = (v: number) => safeDiv(v, t.grandUSD) * 100;

  // ---- cost groups ----
  const byGroup = new Map<EstimateGroup, GroupSummary>();
  for (const l of res.lines) {
    const g = byGroup.get(l.group) ?? { group: l.group, amountUSD: 0, pct: 0, lines: 0, hours: 0 };
    g.amountUSD += l.amountUSD;
    g.lines += 1;
    if (l.unit === 'h') g.hours += l.qty;
    byGroup.set(l.group, g);
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, pct: pctOfDirect(g.amountUSD) }))
    .sort((a, b) => b.amountUSD - a.amountUSD);

  // ---- direct-cost split (the four headline buckets) ----
  const splitParts: { key: SplitShare['key']; label: string; amountUSD: number }[] = [
    { key: 'material', label: 'Material', amountUSD: t.materialUSD },
    { key: 'labor', label: 'Shop labor & welding', amountUSD: t.laborUSD },
    { key: 'consumables', label: 'Consumables', amountUSD: t.consumableUSD },
    { key: 'services', label: 'Services — NDT · PWHT · hydro · paint · outside', amountUSD: t.serviceUSD },
  ];
  const split: SplitShare[] = splitParts.map((s) => ({ ...s, pct: pctOfDirect(s.amountUSD) }));

  // ---- markup ladder ----
  const m = opts.markups;
  const ladder: MarkupStep[] = [
    { label: 'Direct cost subtotal', amountUSD: t.subtotalUSD, pctOfGrand: pctOfGrand(t.subtotalUSD) },
    { label: 'Overhead', amountUSD: t.overheadUSD, pctOfGrand: pctOfGrand(t.overheadUSD), ratePct: m?.overheadPct },
    { label: 'Profit', amountUSD: t.profitUSD, pctOfGrand: pctOfGrand(t.profitUSD), ratePct: m?.profitPct },
    { label: 'Contingency', amountUSD: t.contingencyUSD, pctOfGrand: pctOfGrand(t.contingencyUSD), ratePct: m?.contingencyPct },
    { label: 'Grand total', amountUSD: t.grandUSD, pctOfGrand: 100 },
  ];

  // ---- top cost drivers ----
  const topDrivers = [...res.lines].sort((a, b) => b.amountUSD - a.amountUSD).slice(0, opts.topN ?? 8);

  // ---- unit metrics ----
  const metrics: EstimateMetrics = {
    tags: res.perTag.length,
    lineCount: res.lines.length,
    dryKg: phys.dryKg,
    weldM: phys.weldM,
    shopHours: t.shopHours,
    grandUSD: t.grandUSD,
    costPerTagUSD: safeDiv(t.grandUSD, res.perTag.length),
    costPerKgUSD: safeDiv(t.grandUSD, phys.dryKg),
    costPerWeldMUSD: safeDiv(t.grandUSD, phys.weldM),
    hoursPerWeldM: safeDiv(t.shopHours, phys.weldM),
    hoursPerTag: safeDiv(t.shopHours, res.perTag.length),
    // "02 Special" ratios — price and man-hours per TONNE of empty equipment
    // weight (dryKg is kg, so divide by 1000 to get tonnes)
    costPerEmptyTonUSD: safeDiv(t.grandUSD, phys.dryKg / 1000),
    hoursPerEmptyTon: safeDiv(t.shopHours, phys.dryKg / 1000),
  };

  return { groups, split, ladder, topDrivers, metrics };
}
