// Estimate engine: material, consumables, welding and man-hours by activity.
// Productivity norms are indicative shop-estimating starting points (see README
// research note) — all rates are editable in Settings.

import type { BOMItem, Equipment, EquipmentCalc } from './types';
import { getMat } from './materials';
import { buildProcurement, generateBOM, ProcurementContext } from './bom';
import { consumablesFor } from './pwht';
import { recommendStructure } from './supports';

export interface RateCard {
  prices: Record<string, number>; // material key -> BHD/kg (plate basis)
  pipePrice: number;
  flangePrice: number;
  boltPrice: number;
  gasketPrice: number;
  internalsPrice: number;
  structuralPrice: number;
  equipmentPrice: number; // fans/motors etc.
  electrodePrice: number; // BHD/kg (SMAW)
  wirePrice: number; // BHD/kg (GTAW filler / SAW wire)
  /** SAW flux price (BHD/kg) — submerged-arc cover flux for fill/cap passes */
  sawFluxPrice: number;
  discPrice: number;
  gasCylPrice: number;
  paintUSDperM2: number;
  pwhtCycleUSD: number;
  hydroUSDperM3: number;
  /** Outsourced dish-end forming service rate (BHD/h) — press, tooling & operator */
  formingRate: number;
  /** PaUT/TOFD crew + equipment day rate (BHD/day) */
  putTofdDayUSD: number;
  /** Conventional RT crew + film day rate (BHD/day) */
  rtDayUSD: number;
  labor: {
    fitter: number;
    welder: number;
    helper: number;
    qc: number;
    engineer: number;
    pwht: number;
    painter: number;
  };
  overheadPct: number;
  profitPct: number;
  contingencyPct: number;
}

// Base currency BHD — values are indicative budgetary rates in Bahraini Dinars.
export const DEFAULT_RATES: RateCard = {
  prices: {},
  pipePrice: 0.6,
  flangePrice: 0.98,
  boltPrice: 1.28,
  gasketPrice: 16.9,
  internalsPrice: 1.2,
  structuralPrice: 0.4,
  equipmentPrice: 2.44,
  electrodePrice: 0.98,
  wirePrice: 1.43,
  sawFluxPrice: 0.55,
  discPrice: 1.32,
  gasCylPrice: 24.4,
  paintUSDperM2: 2.63,
  pwhtCycleUSD: 526,
  hydroUSDperM3: 0.094,
  formingRate: 32,
  putTofdDayUSD: 338,
  rtDayUSD: 169,
  labor: { fitter: 9, welder: 10.2, helper: 6, qc: 11.3, engineer: 16.9, pwht: 10.5, painter: 7.9 },
  overheadPct: 22,
  profitPct: 10,
  contingencyPct: 5,
};

export type LaborTrade = keyof RateCard['labor'];

/** A documented man-hour item: what the estimate counts, how its auto hours are derived, who does it. */
export interface ManhourBasis {
  key: string;
  label: string;
  /** activity TYPE — the group heading in the Settings matrix (Welding, NDT…);
   *  derived from the key by `manhourGroup()` when not set explicitly */
  group?: ManhourGroup;
  /** labor trade charged (\'outsourced\' = billed as an outside service, not shop hours) */
  trade: LaborTrade | 'outsourced';
  /** how the automatic hours are derived — shown verbatim in Settings */
  basis: string;
}

/** Project total of one man-hour item: the engine's auto basis vs what is actually applied. */
export interface ManhourUsage {
  key: string;
  autoH: number;
  appliedH: number;
}

/**
 * Every man-hour the estimate engine considers. Settings shows this table with the
 * derivation and a manual input per row; the difference from the auto value is booked
 * as one adjustment line so the automatic basis stays visible in the detailed estimate.
 */
/** Activity types shown as group headings in Settings → man-hour matrix. */
export type ManhourGroup =
  | 'Welding'
  | 'Cutting & edge prep'
  | 'Forming & fitting'
  | 'Assembly & supports'
  | 'Machining & finishing'
  | 'Non-destructive testing'
  | 'Heat treatment'
  | 'Testing'
  | 'Painting & insulation'
  | 'Handling & erection'
  | 'Engineering & QA';

export const MANHOUR_GROUP_ORDER: ManhourGroup[] = [
  'Welding',
  'Cutting & edge prep',
  'Forming & fitting',
  'Assembly & supports',
  'Machining & finishing',
  'Non-destructive testing',
  'Heat treatment',
  'Testing',
  'Painting & insulation',
  'Handling & erection',
  'Engineering & QA',
];

export const MANHOUR_BASIS: ManhourBasis[] = [
  { key: 'weld.ls', label: 'Shell longitudinal seam welding', trade: 'welder', basis: 'h/m welding norm by governing thickness (SAW root+fill deposition model where SAW-eligible), × joint position factor' },
  { key: 'weld.cs', label: 'Shell circumferential seam welding', trade: 'welder', basis: 'h/m welding norm by governing thickness; course count from 2 m plate lengths' },
  { key: 'weld.head', label: 'Head-to-shell seam welding', trade: 'welder', basis: 'h/m welding norm per head-to-shell circumferential seam (one per head)' },
  { key: 'weld.blank', label: 'Head blank seam welding (multi-plate blanks)', trade: 'welder', basis: 'blank-chord seam length × h/m norm at head thickness × 1.1 fit/position factor' },
  { key: 'weld.cone', label: 'Cone transition seam welding', trade: 'welder', basis: 'h/m norm × (2 long + 2 circumferential equivalent) per cone transition' },
  { key: 'weld.nozzle', label: 'Nozzle attachment welds', trade: 'welder', basis: 'h/m norm × 0.7 over Σ nozzle neck circumference — always manual welds (no SAW)' },
  { key: 'cut', label: 'Plate cutting & edge prep', trade: 'helper', basis: '2.2 × total weld length (m) × cutting h/m norm by thickness' },
  { key: 'edge', label: 'Edge planning / milling', trade: 'fitter', basis: '2.2 × total weld length (m) × milling h/m norm by thickness' },
  { key: 'fitup', label: 'Fit-up & assembly', trade: 'fitter', basis: '0.55 × total seam welding hours' },
  { key: 'rolling', label: 'Shell rolling / forming', trade: 'fitter', basis: 'per shell course: 0.35 × t (mm) + 2 h' },
  { key: 'forming', label: 'Head forming & trimming (outsourced)', trade: 'outsourced', basis: 'per dish end: 0.6 × head thickness (mm) × blank diameter (m), at the Settings outside-service rate — hours, not shop labor' },
  { key: 'nzfit', label: 'Nozzle fit & attachment', trade: 'fitter', basis: '1.2 + 0.5 × DN/25.4 h per nozzle' },
  { key: 'internals', label: 'Internals installation (trays, demisters…)', trade: 'fitter', basis: 'per item: count × (2 h + 0.4 × internal area m²)' },
  { key: 'mech', label: 'Mechanical completion, bolting & trim', trade: 'fitter', basis: '6 h per tonne dry weight' },
  { key: 'supports', label: 'Supports, lugs, legs & anchor bolts', trade: 'welder', basis: 'per support item from its own fabrication norm + 0.3 h per anchor bolt set' },
  { key: 'struct', label: 'Structural steelwork fabrication (skid / portal / platform)', trade: 'fitter', basis: 'from the recommended-structure module (member count × weight norm) — counted only when a structure is selected' },
  { key: 'ndt.mt', label: 'MT/DP surface NDT & visual', trade: 'qc', basis: 'weld length × extent factor × 0.12 h/m + 0.5 h per nozzle' },
  { key: 'ndt.ut', label: 'Conventional UT (pulse-echo)', trade: 'qc', basis: 'weld length × extent factor × 0.5 h/m (crew day rate billed separately)' },
  { key: 'ndt.rt', label: 'Conventional RT (film, UW-51)', trade: 'qc', basis: 'weld length × extent factor × 1.2 h/m (RT crew & film day rate billed separately)' },
  { key: 'ndt.putTofd', label: 'PaUT/TOFD volumetric scanning', trade: 'qc', basis: 'weld length × extent factor × 0.8 h/m (scanner crew day rate billed separately)' },
  { key: 'pwht', label: 'PWHT operation (charge/discharge, chart)', trade: 'pwht', basis: '18 h per cycle when PWHT is required by UCS-56 (furnace cycle billed separately)' },
  { key: 'hydro', label: 'Hydrostatic test (fill, hold, drain, dry)', trade: 'fitter', basis: '8 h + 0.3 h per nozzle (test water billed separately)' },
  { key: 'paint', label: 'Blasting & painting (SA 2.5, 2 coats)', trade: 'painter', basis: '0.12 h per m² paint area (paint billed per m² separately)' },
  { key: 'eng', label: 'Design, planning & documentation', trade: 'engineer', basis: '6 % of total shop hours (project level)' },
  { key: 'qa', label: 'QA/QC surveillance', trade: 'qc', basis: '2 % of total shop hours (project level)' },
  // ---- added subtypes: the welding that is easy to forget when estimating ----
  { key: 'weld.ring', label: 'Stiffening ring welding (vacuum rings)', trade: 'welder', basis: 'ring circumference × number of rings, both sides, at shell thickness × 0.8 position factor — only when a ring is specified' },
  { key: 'weld.intRing', label: 'Internal support ring welding (tray / packing supports)', trade: 'welder', basis: 'one support ring per three internals levels, π·D each side at shell thickness × 0.6 — only when internals are fitted' },
  { key: 'weld.clip', label: 'Insulation, refractory & platform clip welding', trade: 'welder', basis: '4 clips per access platform + 4 per m² when cladding/refractory is specified, 0.24 m of weld per clip (60 mm fillets, both sides)' },
  { key: 'handle', label: 'Handling, turning & crane', trade: 'fitter', basis: '0.6 h per tonne dry weight for lifts, rotation and yard moves' },
];

/** Activity TYPE for a man-hour key (used for the Settings matrix headings). */
export function manhourGroup(key: string): ManhourGroup {
  if (key.startsWith('weld.')) return 'Welding';
  if (key === 'cut' || key === 'edge') return 'Cutting & edge prep';
  if (key === 'fitup' || key === 'rolling' || key === 'forming') return 'Forming & fitting';
  if (key === 'nzfit' || key === 'internals' || key === 'mech' || key === 'supports' || key === 'struct') return 'Assembly & supports';
  if (key.startsWith('ndt.')) return 'Non-destructive testing';
  if (key === 'pwht') return 'Heat treatment';
  if (key === 'hydro') return 'Testing';
  if (key === 'paint') return 'Painting & insulation';
  if (key === 'handle') return 'Handling & erection';
  return 'Engineering & QA';
}

/** The documented items grouped by activity type, in the published order. */
export function manhourMatrix(): { group: ManhourGroup; items: ManhourBasis[] }[] {
  return MANHOUR_GROUP_ORDER.map((group) => ({
    group,
    items: MANHOUR_BASIS.filter((b) => (b.group ?? manhourGroup(b.key)) === group),
  })).filter((g) => g.items.length > 0);
}

export interface EstimateLine {
  equipId: string;
  tag: string;
  group: 'Material' | 'Welding' | 'Shop labor' | 'Consumables' | 'NDT' | 'PWHT' | 'Hydro & test' | 'Painting' | 'Outside services' | 'Engineering/QA';
  activity: string;
  qty: number;
  unit: string;
  rateUSD: number;
  amountUSD: number;
  trade?: LaborTrade;
  /** man-hour basis key when this line is (or adjusts) a man-hour item */
  key?: string;
}

/** Structured weld breakdown: hours, deposit, joint config and electrodes per weld area. */
export interface WeldSegment {
  area: string;
  lengthM: number;
  joint: string;
  rootProcess: string;
  fillProcess: string;
  electrode: string;
  /** fill-process family — drives consumable split and timing */
  process: 'saw' | 'manual';
  /** manual GTAW root hours (timing: when fill passes can start) */
  rootHours: number;
  /** fill/cap man-hours (SAW deposition model or SMAW norm) */
  fillHours: number;
  hours: number;
  depositKg: number;
}

export interface TagEstimate {
  equipId: string;
  tag: string;
  name: string;
  welds: WeldSegment[];
  materialUSD: number;
  laborUSD: number;
  consumableUSD: number;
  serviceUSD: number;
  shopHours: number;
  totalUSD: number;
  hoursByActivity: { activity: string; hours: number; trade: LaborTrade }[];
  /** auto vs applied man-hours for this tag (Settings shows the project roll-up) */
  manhours: ManhourUsage[];
}

export interface EstimateResult {
  lines: EstimateLine[];
  perTag: TagEstimate[];
  totals: {
    materialUSD: number;
    laborUSD: number;
    consumableUSD: number;
    serviceUSD: number;
    shopHours: number;
    subtotalUSD: number;
    overheadUSD: number;
    profitUSD: number;
    contingencyUSD: number;
    grandUSD: number;
  };
  /** every documented man-hour item: engine auto basis vs hours actually applied */
  manhours: ManhourUsage[];
}

// --- productivity norms (hours per metre / per item) ---
function hPerM_ls(t: number): number {
  return t < 15 ? 4.3 : t < 30 ? 7.8 : t < 75 ? 15.1 : 22.1;
}
function hPerM_cs(t: number): number {
  return t < 15 ? 4.3 : t < 30 ? 9.6 : t < 75 ? 16 : 38.1;
}
function hPerM_cut(t: number): number {
  return t < 20 ? 0.07 : t < 30 ? 0.18 : t < 75 ? 0.37 : 0.69;
}
function hPerM_edge(t: number): number {
  return t < 20 ? 0.38 : t < 30 ? 0.5 : t < 75 ? 1.15 : 2.3;
}

// --- SAW (submerged arc) fill-pass model: deposition-driven timing & man-hours ---
/** Effective SAW deposition rate (kg/h) — single wire, incl. pass changes, cleaning & flux handling. */
export function sawDepositRateKgPerH(t: number): number {
  return t <= 30 ? 4.5 : t <= 60 ? 3.8 : 3.0;
}
/** SAW fill+cap hours per metre: manual-root-excluded deposit / deposition rate + setup allowance. */
export function sawFillHoursPerMeter(t: number): number {
  return (depositPerMeter(t) * 0.85) / sawDepositRateKgPerH(t) + 0.12;
}
/** Manual GTAW root hours per metre on SAW-built seams (root welded before automatic fill). */
export function sawRootHoursPerMeter(t: number): number {
  return t <= 12 ? 0.6 : t <= 25 ? 0.8 : 1.1;
}

/**
 * Total multi-plate head-blank seam length (m): a circular blank of ØD (mm) that does not fit
 * one stock plate (width W, default 2440 mm) is cut into strips — seams are chords across the
 * circle. (Previously this sum was accumulated in mm while consumed as metres — a 1000× hours
 * error — and used a flat 0.85×D per-seam guess regardless of strip count.)
 */
export function blankSeamLengthM(blankDiaMm: number, plateWidthMm = 2440): number {
  const strips = Math.max(1, Math.ceil(blankDiaMm / plateWidthMm));
  if (strips <= 1) return 0;
  const R = blankDiaMm / 2;
  let total = 0;
  for (let i = 1; i < strips; i++) {
    const x = -R + (i * blankDiaMm) / strips; // seam offset from blank centre
    total += 2 * Math.sqrt(Math.max(0, R * R - x * x)); // chord length
  }
  return total / 1000; // mm → m
}

/** Groove-weld weld-metal area (mm²) for a double-V butt joint at thickness t (mm). */
export function weldAreaMm2(t: number): number {
  return 0.58 * t * t + 2 * t; // double-V groove + cap allowance
}
/** Double-V butt weld deposit kg per metre of weld at thickness t (mm) */
export function depositPerMeter(t: number): number {
  return weldAreaMm2(t) * 0.00785; // kg/m
}
/**
 * Head-blank multi-plate seams: X-groove at half thickness per side.
 * Area ≈ 0.5×(0.58·t²) + two cap beads — clamped to at least a single-V/square
 * minimum (1.05·t + 1 mm²) so thin heads don't get a near-zero deposit.
 */
export function blankSeamDepositKgPerM(t: number): number {
  const areaMm2 = Math.max(1.05 * t + 1, 0.5 * 0.58 * t * t + 2 * t);
  return areaMm2 * 0.00785;
}

export function materialPriceOf(
  item: BOMItem,
  rates: RateCard
): number {
  const p =
    item.category === 'Plate'
      ? (rates.prices[item.material] ?? getMat(item.material)?.pricePerKg ?? 0.41)
      : item.category === 'Pipe'
      ? (rates.prices[item.material] ?? rates.pipePrice)
      : item.category === 'Flange'
      ? (rates.prices[item.material] ?? rates.flangePrice)
      : item.category === 'Bolting'
      ? rates.boltPrice
      : item.category === 'Gasket'
      ? rates.gasketPrice
      : item.category === 'Internals'
      ? rates.internalsPrice
      : item.category === 'Structural'
      ? rates.structuralPrice
      : item.category === 'Other'
      ? rates.equipmentPrice
      : rates.structuralPrice;
  return p;
}

export interface EstimateInput {
  equip: Equipment;
  calc: EquipmentCalc;
  bom: BOMItem[];
  procurementCostUSD: number; // plate cost incl. stock thickness & wastage
}

export function estimateEquipment(
  input: EstimateInput,
  rates: RateCard,
  manhourOverrides?: Record<string, number>
): { lines: EstimateLine[]; tag: TagEstimate } {
  const { equip, calc, bom, procurementCostUSD } = input;
  const lines: EstimateLine[] = [];
  const tag = equip.tag;
  const id = equip.id;
  const push = (l: Omit<EstimateLine, 'tag' | 'equipId'>) => lines.push({ ...l, tag, equipId: id });

  // ---- MATERIAL ----
  const plateCost = procurementCostUSD;
  const nonPlate = bom
    .filter((b) => b.category !== 'Plate')
    .reduce((s, b) => s + b.massKg * materialPriceOf(b, rates), 0);
  const gaskets = bom.filter((b) => b.category === 'Gasket').length * rates.gasketPrice;
  push({ group: 'Material', activity: 'Plates (procured to stock sizes, incl. wastage)', qty: 1, unit: 'lot', rateUSD: plateCost, amountUSD: plateCost });
  push({ group: 'Material', activity: 'Pipe, forgings, bolting, internals & structural (BOM)', qty: 1, unit: 'lot', rateUSD: nonPlate, amountUSD: nonPlate });
  if (gaskets > 0) push({ group: 'Material', activity: 'Gaskets', qty: bom.filter((b) => b.category === 'Gasket').length, unit: 'ea', rateUSD: rates.gasketPrice, amountUSD: gaskets });

  // ---- weld split (structured per area: joint config + electrodes) ----
  const tGov = Math.max(4, ...calc.sections.map((s) => s.tNominal), equip.hx ? 16 : 0, equip.finfan ? 8 : 0);
  const cons = consumablesFor(equip.materialKey);
  const rootProcess = equip.materialKey.startsWith('SA-240') || equip.materialKey.startsWith('SB-')
    ? 'GTAW root (ER matching)'
    : 'GTAW root (ER70S)';

  // Fill-process selection — SAW (submerged arc) fill/cap on positioners/turning rolls for long
  // shell & head seams: automatic for ferritic vessels/columns with t ≥ 10 mm; nozzle welds and
  // thin shells stay manual (GTAW root + SMAW fill/cap). Per-tag override: weldProcess.
  const ferriticForSAW = !equip.materialKey.startsWith('SA-240') && !equip.materialKey.startsWith('SB-');
  const sawEligible = (equip.equipType === 'vessel' || equip.equipType === 'column') && ferriticForSAW && tGov >= 10;
  const useSAW = equip.weldProcess === 'saw' || (equip.weldProcess !== 'smaw' && sawEligible);

  const manualJoint =
    tGov <= 12
      ? 'Butt, single-V 60°, GTAW root (no ring), SMAW fill/cap — Type 1 joint (UW-12)'
      : tGov <= 38
      ? 'Butt, double-V (X) 60°, GTAW root + back-gouge, SMAW fill/cap — Type 1 joint (UW-12)'
      : 'Butt, double-V/U-groove, GTAW root + back-gouge, SMAW fill/cap — Type 1 joint, full RT zone (UW-11(a))';
  const sawJoint =
    tGov <= 12
      ? 'Butt, single-V 60°, GTAW root + SAW fill/cap — Type 1 joint (UW-12)'
      : 'Butt, double-V (X) 60°, GTAW root + back-gouge + SAW fill/cap — Type 1 joint (UW-12)';
  const manualElectrode = `${cons.gtaw} root / ${cons.smaw} fill & cap`;
  const sawElectrode = `${cons.gtaw} root / SAW wire + flux fill & cap`;

  const welds: WeldSegment[] = [];
  /** Hours split (root / fill-cap) for `len` m of seam at `thk`; SAW deposition model where eligible. */
  const seamHours = (len: number, thk: number, smawRate: number, factor: number, allowSaw: boolean) => {
    if (allowSaw && useSAW && thk >= 8) {
      const root = len * sawRootHoursPerMeter(thk) * factor;
      const fill = len * sawFillHoursPerMeter(thk) * factor;
      return { root, fill, total: root + fill, saw: true };
    }
    const total = len * smawRate * factor;
    const root = Math.min(total * 0.35, len * 0.6); // display split: manual GTAW root portion
    return { root, fill: total - root, total, saw: false };
  };
  const addWeld = (
    area: string,
    len: number,
    thk: number,
    smawRate: number,
    factor = 1,
    allowSaw = true,
    depositKgPerM: (t: number) => number = depositPerMeter
  ): number => {
    if (len <= 1e-6) return 0;
    const h = seamHours(len, thk, smawRate, factor, allowSaw);
    welds.push({
      area,
      lengthM: len,
      joint: h.saw ? sawJoint : manualJoint,
      rootProcess,
      fillProcess: h.saw ? 'SAW fill/cap (submerged arc — flux + wire, automatic)' : 'SMAW fill/cap (FCAW optional on heavy sections)',
      electrode: h.saw ? sawElectrode : manualElectrode,
      process: h.saw ? 'saw' : 'manual',
      rootHours: h.root,
      fillHours: h.fill,
      hours: h.total,
      depositKg: len * depositKgPerM(thk),
    });
    return h.total;
  };

  let ls = 0, cs = 0, nz = 0, headWeldM = 0, coneWeldM = 0, headBlankSeamM = 0;
  const blankSeams: { m: number; thk: number }[] = [];
  for (const s of calc.sections) {
    const D = s.spec.dia;
    const nCourses = Math.max(1, Math.ceil(s.spec.ttLength / 2000));
    ls += (Math.PI * D) / 1000;
    cs += Math.max(0, nCourses - 1) * (Math.PI * D) / 1000;
    if (s.headTop) headWeldM += (Math.PI * D) / 1000;
    if (s.headBot) headWeldM += (Math.PI * D) / 1000;
    // multi-plate head blanks: chord seams across the circle, welded at HEAD thickness
    const headThks: [typeof s.headTop, number][] = [
      [s.headTop, s.spec.headThkTop || s.headTop?.tMinNominal || s.tNominal],
      [s.headBot, s.spec.headThkBot || s.headBot?.tMinNominal || s.tNominal],
    ];
    for (const [hc, headThk] of headThks) {
      if (!hc) continue;
      const seamM = blankSeamLengthM(hc.blankDia);
      if (seamM > 0) {
        headBlankSeamM += seamM;
        blankSeams.push({ m: seamM, thk: headThk });
      }
    }
    if (s.cone) coneWeldM += (Math.PI * D) / 1000 * 2.2; // 2 long + 2 circ equivalent
  }
  for (const n of calc.nozzles) nz += (2 * Math.PI * n.dn) / 1000;

  const lsH = addWeld('Shell longitudinal seams', ls, tGov, hPerM_ls(tGov));
  const csH = addWeld('Shell circumferential seams (course-to-course)', cs, tGov, hPerM_cs(tGov));
  const headSeamH = addWeld('Head-to-shell seams', headWeldM, tGov, hPerM_cs(tGov));
  // head blank seams: flat bench position before forming — fit/position factor 1.1, welded at
  // head thickness; deposit per metre from blankSeamDepositKgPerM (X-groove, half-thickness/side)
  let blankSeamH = 0;
  for (const b of blankSeams) {
    blankSeamH += addWeld('Head blank seams (multi-plate blanks)', b.m, b.thk, hPerM_cs(b.thk), 1.1, true, blankSeamDepositKgPerM);
  }
  const coneH = addWeld('Cone transition seams', coneWeldM, tGov, hPerM_cs(tGov));
  const nzThk = Math.min(tGov, 20);
  const nzH = addWeld('Nozzle attachment welds', nz, nzThk, hPerM_ls(nzThk) * 0.7, 1, false);
  const seamTotalH = lsH + csH + headSeamH + blankSeamH + coneH + nzH;
  const weldM = ls + cs + headWeldM + headBlankSeamM + coneWeldM + nz;

  // ---- SHOP LABOR ----
  const hoursByActivity: { activity: string; hours: number; trade: LaborTrade }[] = [];
  /** automatic hours accumulated per man-hour basis key (pre-override) */
  const autoByKey: Record<string, number> = {};
  const labor = (activity: string, hours: number, trade: LaborTrade, key?: string) => {
    if (key) autoByKey[key] = (autoByKey[key] ?? 0) + hours;
    if (hours <= 0) return;
    const rate = rates.labor[trade];
    push({ group: trade === 'welder' ? 'Welding' : 'Shop labor', activity, qty: hours, unit: 'h', rateUSD: rate, amountUSD: hours * rate, trade, key });
    hoursByActivity.push({ activity, hours, trade });
  };

  labor(`Longitudinal seam welding — shell (${ls.toFixed(1)} m @ ${(lsH / Math.max(ls, 1e-6)).toFixed(1)} h/m${useSAW ? ', SAW fill/cap' : ', SMAW'})`, lsH, 'welder', 'weld.ls');
  labor(`Shell circumferential seam welding (${cs.toFixed(1)} m @ ${(csH / Math.max(cs, 1e-6)).toFixed(1)} h/m)`, csH, 'welder', 'weld.cs');
  labor(`Head-to-shell seam welding (${headWeldM.toFixed(1)} m)`, headSeamH, 'welder', 'weld.head');
  labor(`Head blank seam welding — multi-plate, ${headBlankSeamM.toFixed(1)} m at head thickness`, blankSeamH, 'welder', 'weld.blank');
  labor(`Cone transition seam welding (${coneWeldM.toFixed(1)} m)`, coneH, 'welder', 'weld.cone');
  labor(`Nozzle welds (${nz.toFixed(1)} m)`, nzH, 'welder', 'weld.nozzle');

  const cutLen = 2.2 * Math.max(weldM, 1);
  labor(`Plate cutting & edge prep (${cutLen.toFixed(0)} m)`, cutLen * hPerM_cut(tGov), 'helper', 'cut');
  labor(`Edge planning/milling (${cutLen.toFixed(0)} m)`, cutLen * hPerM_edge(tGov), 'fitter', 'edge');

  const fitH = 0.55 * seamTotalH;
  labor('Fit-up & assembly', fitH, 'fitter', 'fitup');

  let rollH = 0;
  for (const s of calc.sections) {
    const nCourses = Math.max(1, Math.ceil(s.spec.ttLength / 2000));
    rollH += nCourses * (0.35 * s.tNominal + 2);
  }
  labor('Shell rolling / forming', rollH, 'fitter', 'rolling');

  // ---- Head forming — OUTSOURCED service (outside cost, not in-house shop hours) ----
  // Auto hours = Σ 0.6 × head thickness (mm) × blank diameter (m) per dish end; priced at the
  // Settings outside-service rate (BHD/h). Manual entry per tag: formingHoursOverride / formingRateOverride.
  let formHAuto = 0;
  for (const s of calc.sections) {
    const heads: [typeof s.headTop, number][] = [
      [s.headTop, s.spec.headThkTop || s.headTop?.tMinNominal || s.tNominal],
      [s.headBot, s.spec.headThkBot || s.headBot?.tMinNominal || s.tNominal],
    ];
    for (const [hc, headThk] of heads) {
      if (hc) formHAuto += 0.6 * headThk * (hc.blankDia / 1000);
    }
  }
  const formingOverride = manhourOverrides?.forming;
  autoByKey.forming = formHAuto;
  const formingHours =
    equip.formingHoursOverride != null && equip.formingHoursOverride >= 0
      ? equip.formingHoursOverride
      : formingOverride != null && Number.isFinite(formingOverride)
      ? formingOverride
      : formHAuto;
  const formingRate =
    equip.formingRateOverride != null && equip.formingRateOverride >= 0 ? equip.formingRateOverride : rates.formingRate;
  if (formingHours > 0) {
    push({
      group: 'Outside services',
      activity: `Head forming & trimming — outsourced dish ends (${formingHours.toFixed(1)} h @ ${formingRate}/h${equip.formingHoursOverride != null ? ', manual hours (tag)' : formingOverride != null ? ', manual hours (settings)' : ', auto hours'})`,
      qty: formingHours,
      unit: 'h',
      rateUSD: formingRate,
      amountUSD: formingHours * formingRate,
    });
  }

  const nzFit = calc.nozzles.reduce((s, n) => s + 1.2 + 0.5 * (n.spec.dn / 25.4), 0);
  labor('Nozzle fit & attachment', nzFit, 'fitter', 'nzfit');

  // ---- welding subtypes that are easy to leave out of an estimate ----

  // external-pressure stiffening rings: every ring is welded both sides
  let ringWeldM = 0;
  const ringSpec = equip.ring;
  if (ringSpec?.enabled) {
    const rings = Math.max(1, Math.round(ringSpec.count || 1));
    const ringDia = (calc.sections[0]?.spec.dia ?? 1000) + 2 * (calc.sections[0]?.tNominal ?? 0) + 2 * (ringSpec.webDepthMm || 0);
    ringWeldM = (rings * Math.PI * ringDia) / 1000;
  }
  const ringWeldH = addWeld('Stiffening ring welds (both sides)', ringWeldM, tGov, hPerM_ls(tGov) * 0.8, 1, false);
  labor(`Stiffening ring welding (${ringWeldM.toFixed(1)} m)`, ringWeldH, 'welder', 'weld.ring');

  // internal support rings: one per three internals levels
  let intRingWeldM = 0;
  const shellDiaM = (calc.sections[0]?.spec.dia ?? 1000) / 1000;
  for (const it of equip.internals) {
    const rings = Math.max(1, Math.ceil((it.count || 1) / 3));
    intRingWeldM += rings * Math.PI * shellDiaM;
  }
  const intRingH = addWeld('Internal support ring welds', intRingWeldM, Math.min(tGov, 16), hPerM_ls(Math.min(tGov, 16)) * 0.6, 1, false);
  labor(`Internal support ring welding (${intRingWeldM.toFixed(1)} m)`, intRingH, 'welder', 'weld.intRing');

  // clips: access platforms and insulation/refractory fixings
  const platformCount = calc.access?.platforms ?? 0;
  const cladOn = equip.clad != null && equip.clad.mode !== 'none';
  const clipCount = platformCount * 4 + (cladOn ? Math.ceil(calc.paintAreaM2 * 4) : 0);
  const clipWeldM = clipCount * 0.24; // 60 mm fillets, both sides
  const clipH = addWeld('Insulation / platform clip welds', clipWeldM, 8, hPerM_ls(8), 1.4, false);
  labor(
    `Insulation, refractory & platform clip welding (${clipCount} clips${cladOn ? ', cladding included' : ''})`,
    clipH,
    'welder',
    'weld.clip'
  );
  // every weld above (including the ring/clip welds) is subject to the NDT plan
  const weldMAll = weldM + ringWeldM + intRingWeldM + clipWeldM;

  let intH = 0;
  const area = (Math.PI / 4) * Math.pow(((equip.sections[0]?.dia ?? 1000) - 150) / 1000, 2);
  for (const it of equip.internals) intH += it.count * (2 + area * 0.4);
  labor('Internals installation', intH, 'fitter', 'internals');

  const mechH = calc.weightDryKg / 1000 * 6; // mechanical completion
  labor('Mechanical completion, bolting & trim', mechH, 'fitter', 'mech');

  // handling, turning and yard lifts — distinct from fabrication hours
  const handleH = (calc.weightDryKg / 1000) * 0.6;
  labor(`Handling, turning & crane (${(calc.weightDryKg / 1000).toFixed(1)} t dry)`, handleH, 'fitter', 'handle');

  // ---- SUPPORTS — each support kind fabricated & costed separately (steel via BOM Structural) ----
  const sup = calc.supports;
  let supWeldLenM = 0;
  if (sup) {
    for (const it of sup.items) {
      if (it.hours <= 0) continue;
      labor(`${it.label} — fit-up & welding (${it.count} × ${(it.hours / it.count).toFixed(1)} h each)`, it.hours, 'welder', 'supports');
      supWeldLenM += it.weldLenM;
    }
    if (sup.anchorBolts) {
      labor(`Anchor bolt setting & grouting (${sup.anchorBolts.count} × M${sup.anchorBolts.diaMm})`, sup.anchorBolts.count * 0.3, 'fitter', 'supports');
    }
  }

  // ---- STRUCTURAL STEELWORK (skid / portal / pedestal / platform) — costed only when selected ----
  const structRec = recommendStructure(equip, calc);
  if (structRec.enabled && structRec.weightKg > 0) {
    labor(`Structural steelwork fabrication (${structRec.kind}: ${structRec.members.length} member types, ${structRec.weightKg.toFixed(0)} kg)`, structRec.hours, 'fitter', 'struct');
  }

  // ---- NDT (from per-tag plan: DP/MT, UT, conventional RT, PaUT/TOFD) ----
  const NDT_LABEL: Record<string, string> = {
    mt: 'MT/DP surface NDT & visual',
    ut: 'Conventional UT (pulse-echo)',
    rt: 'Conventional RT (film, UW-51)',
    putTofd: 'PaUT/TOFD (volumetric, Sec. V Art. 4/18)',
  };
  const NDT_RATE: Record<string, number> = { mt: 0.12, ut: 0.5, rt: 1.2, putTofd: 0.8 };
  const EXTENT: Record<string, number> = { full: 1.0, spot: 0.3, sample: 0.15 };
  const plan = equip.ndtPlan?.length
    ? equip.ndtPlan
    : [
        { method: 'rt' as const, enabled: equip.rtCategory !== 'none', timing: 'afterPwht' as const, extent: (equip.rtCategory === 'full' ? 'full' : 'spot') as 'full' | 'spot', note: '' },
        { method: 'mt' as const, enabled: true, timing: 'final' as const, extent: 'spot' as const, note: '' },
      ];
  for (const p of plan) {
    if (!p.enabled) continue;
    const extentF = EXTENT[p.extent] ?? 0.3;
    const timingLabel = p.timing === 'during' ? 'interstage, during welding' : p.timing === 'afterPwht' ? 'after PWHT' : 'final, before hydrotest';
    const h = weldMAll * extentF * (NDT_RATE[p.method] ?? 0.3) + (p.method === 'mt' ? calc.nozzles.length * 0.5 : 0);
    labor(`${NDT_LABEL[p.method]} — ${p.extent} extent, ${timingLabel}`, h, 'qc', `ndt.${p.method}`);
    if (p.method === 'rt') {
      const days = Math.max(1, Math.ceil((weldMAll * extentF) / 25));
      push({ group: 'NDT', activity: `Conventional RT crew & film (${days} day${days > 1 ? 's' : ''})`, qty: days, unit: 'day', rateUSD: rates.rtDayUSD, amountUSD: days * rates.rtDayUSD });
    }
    if (p.method === 'putTofd') {
      const days = Math.max(1, Math.ceil((weldMAll * extentF) / 40));
      push({ group: 'NDT', activity: `PaUT/TOFD scanner crew & equipment (${days} day${days > 1 ? 's' : ''})`, qty: days, unit: 'day', rateUSD: rates.putTofdDayUSD, amountUSD: days * rates.putTofdDayUSD });
    }
  }

  // ---- PWHT ----
  if (calc.pwht.required) {
    labor('PWHT operation (charge/discharge, chart recording)', 18, 'pwht', 'pwht');
    push({ group: 'PWHT', activity: 'PWHT furnace/rig cycle incl. insulation & fuel', qty: 1, unit: 'cycle', rateUSD: rates.pwhtCycleUSD, amountUSD: rates.pwhtCycleUSD });
  }

  // ---- Hydrotest ----
  const hydroH = 8 + calc.nozzles.length * 0.3;
  labor('Hydrostatic test (fill, hold, drain, dry)', hydroH, 'fitter', 'hydro');
  push({ group: 'Hydro & test', activity: 'Test water', qty: calc.internalVolumeM3, unit: 'm³', rateUSD: rates.hydroUSDperM3, amountUSD: calc.internalVolumeM3 * rates.hydroUSDperM3 });

  // ---- Painting ----
  const paintM2 = calc.paintAreaM2;
  labor('Blasting & painting (SA 2.5, 2 coats)', paintM2 * 0.12, 'painter', 'paint');
  push({ group: 'Painting', activity: 'Paint & consumables', qty: paintM2, unit: 'm²', rateUSD: rates.paintUSDperM2, amountUSD: paintM2 * rates.paintUSDperM2 });

  // ---- MANUAL MANHOUR OVERRIDES (Settings) ----
  // Settings documents every man-hour above and accepts a manual value per item; the
  // difference from the auto basis is booked as one adjustment line so both stay visible.
  const appliedByKey: Record<string, number> = { ...autoByKey, forming: formingHours };
  for (const b of MANHOUR_BASIS) {
    if (b.key === 'eng' || b.key === 'qa') continue; // project level — applied in estimateProject
    if (b.trade === 'outsourced') continue; // forming hours ride on the outside-service line above
    const ov = manhourOverrides?.[b.key];
    if (ov == null || !Number.isFinite(ov)) continue;
    const auto = autoByKey[b.key] ?? 0;
    appliedByKey[b.key] = ov;
    const delta = ov - auto;
    if (Math.abs(delta) < 1e-9) continue;
    const trade = b.trade as LaborTrade;
    const rate = rates.labor[trade];
    const activity = `Manual manhour adjustment — ${b.label} (auto ${auto.toFixed(1)} h → manual ${ov.toFixed(1)} h)`;
    push({ group: trade === 'welder' ? 'Welding' : 'Shop labor', activity, qty: delta, unit: 'h', rateUSD: rate, amountUSD: delta * rate, trade, key: b.key });
    hoursByActivity.push({ activity, hours: delta, trade });
  }

  // ---- Consumables ----
  // Deposit is taken from the per-segment weld breakdown so SAW seams consume wire + flux and
  // only manual (non-SAW) segments consume SMAW electrodes; GTAW roots are wire everywhere.
  const totalDeposit = welds.reduce((s, w) => s + w.depositKg, 0);
  const sawFillDeposit = welds.filter((w) => w.process === 'saw').reduce((s, w) => s + w.depositKg * 0.85, 0);
  const manualDeposit = welds.filter((w) => w.process === 'manual').reduce((s, w) => s + w.depositKg, 0);
  const smawKg = manualDeposit * 0.85 * 1.8; // SMAW fill/cap on manual welds (roots are GTAW)
  const rootWireKg = totalDeposit * 0.15 * 1.15; // GTAW roots, incl. on SAW seams
  const sawWireKg = sawFillDeposit * 1.1; // SAW wire incl. stubs & run-offs
  const sawFluxKg = sawFillDeposit * 1.15; // cover flux consumption
  const discs = weldM * 0.07;
  const cyls = Math.max(1, weldM / 45);
  if (smawKg > 0) push({ group: 'Consumables', activity: `SMAW electrodes (manual deposit ${(manualDeposit * 0.85).toFixed(0)} kg × 1.8)`, qty: smawKg, unit: 'kg', rateUSD: rates.electrodePrice, amountUSD: smawKg * rates.electrodePrice });
  if (sawWireKg > 0) push({ group: 'Consumables', activity: `SAW wire (deposit ${sawFillDeposit.toFixed(0)} kg × 1.1)`, qty: sawWireKg, unit: 'kg', rateUSD: rates.wirePrice, amountUSD: sawWireKg * rates.wirePrice });
  if (sawFluxKg > 0) push({ group: 'Consumables', activity: `SAW flux (deposit ${sawFillDeposit.toFixed(0)} kg × 1.15)`, qty: sawFluxKg, unit: 'kg', rateUSD: rates.sawFluxPrice, amountUSD: sawFluxKg * rates.sawFluxPrice });
  if (rootWireKg > 0) push({ group: 'Consumables', activity: 'GTAW root filler wire', qty: rootWireKg, unit: 'kg', rateUSD: rates.wirePrice, amountUSD: rootWireKg * rates.wirePrice });
  if (supWeldLenM > 0) {
    const supElecKg = supWeldLenM * 0.25; // ≈6 mm fillet deposit × SMAW utilization
    push({ group: 'Consumables', activity: `Support & structural fillet electrodes (${supWeldLenM.toFixed(0)} m weld)`, qty: supElecKg, unit: 'kg', rateUSD: rates.electrodePrice, amountUSD: supElecKg * rates.electrodePrice });
  }
  push({ group: 'Consumables', activity: 'Grinding discs, backing, gas & rigging consumables', qty: 1, unit: 'lot', rateUSD: discs * rates.discPrice + cyls * rates.gasCylPrice, amountUSD: discs * rates.discPrice + cyls * rates.gasCylPrice });

  const materialUSD = lines.filter((l) => l.group === 'Material').reduce((s, l) => s + l.amountUSD, 0);
  const laborUSD = lines.filter((l) => l.group === 'Welding' || l.group === 'Shop labor').reduce((s, l) => s + l.amountUSD, 0);
  const consumableUSD = lines.filter((l) => l.group === 'Consumables').reduce((s, l) => s + l.amountUSD, 0);
  const serviceUSD = lines
    .filter((l) => l.group === 'NDT' || l.group === 'PWHT' || l.group === 'Hydro & test' || l.group === 'Painting' || l.group === 'Outside services')
    .reduce((s, l) => s + l.amountUSD, 0);
  const shopHours = hoursByActivity.reduce((s, h) => s + h.hours, 0);

  return {
    lines,
    tag: {
      equipId: id,
      tag,
      name: equip.name,
      materialUSD,
      laborUSD,
      consumableUSD,
      serviceUSD,
      shopHours,
      totalUSD: materialUSD + laborUSD + consumableUSD + serviceUSD,
      hoursByActivity,
      welds,
      manhours: MANHOUR_BASIS.filter((b) => b.key !== 'eng' && b.key !== 'qa').map((b) => ({
        key: b.key,
        autoH: autoByKey[b.key] ?? 0,
        appliedH: appliedByKey[b.key] ?? autoByKey[b.key] ?? 0,
      })),
    },
  };
}

export function estimateProject(
  entries: { equip: Equipment; calc: EquipmentCalc }[],
  rates: RateCard,
  stockCtx: ProcurementContext,
  manhourOverrides?: Record<string, number>
): EstimateResult {
  const lines: EstimateLine[] = [];
  const perTag: TagEstimate[] = [];

  for (const e of entries) {
    const { items, plateReqs } = generateBOM(e.equip, e.calc);
    const proc = buildProcurement(plateReqs, stockCtx);
    const procurementCost = proc.lines.reduce((s, l) => s + l.estimatedCostUSD, 0);
    const res = estimateEquipment({ equip: e.equip, calc: e.calc, bom: items, procurementCostUSD: procurementCost }, rates, manhourOverrides);
    lines.push(...res.lines);
    perTag.push(res.tag);
  }

  const materialUSD = perTag.reduce((s, t) => s + t.materialUSD, 0);
  const laborUSD = perTag.reduce((s, t) => s + t.laborUSD, 0);
  const consumableUSD = perTag.reduce((s, t) => s + t.consumableUSD, 0);
  const serviceUSD = perTag.reduce((s, t) => s + t.serviceUSD, 0);
  const shopHours = perTag.reduce((s, t) => s + t.shopHours, 0);
  const subtotal = materialUSD + laborUSD + consumableUSD + serviceUSD;

  // engineering & QA overlay (auto percentages, replaceable from Settings)
  const engAuto = shopHours * 0.06;
  const engHours = manhourOverrides?.eng ?? engAuto;
  const engUSD = engHours * rates.labor.engineer;
  const qaAuto = shopHours * 0.02;
  const qaHours = manhourOverrides?.qa ?? qaAuto;
  const qaUSD = qaHours * rates.labor.qc;
  if (engUSD > 0)
    lines.push({ equipId: 'project', tag: 'ALL', group: 'Engineering/QA', activity: `Design, planning & documentation${manhourOverrides?.eng != null ? ' (manual hours)' : ' (6% of shop hours)'}`, qty: engHours, unit: 'h', rateUSD: rates.labor.engineer, amountUSD: engUSD, trade: 'engineer', key: 'eng' });
  if (qaUSD > 0)
    lines.push({ equipId: 'project', tag: 'ALL', group: 'Engineering/QA', activity: `QA/QC surveillance${manhourOverrides?.qa != null ? ' (manual hours)' : ' (2% of shop hours)'}`, qty: qaHours, unit: 'h', rateUSD: rates.labor.qc, amountUSD: qaUSD, trade: 'qc', key: 'qa' });

  const withEng = subtotal + engUSD + qaUSD;
  const overheadUSD = (withEng * rates.overheadPct) / 100;
  const profitUSD = ((withEng + overheadUSD) * rates.profitPct) / 100;
  const contingencyUSD = ((withEng + overheadUSD + profitUSD) * rates.contingencyPct) / 100;

  // roll up auto vs applied man-hours across tags, plus the project-level items
  const mh = new Map<string, ManhourUsage>();
  for (const t of perTag) {
    for (const m of t.manhours) {
      const cur = mh.get(m.key) ?? { key: m.key, autoH: 0, appliedH: 0 };
      cur.autoH += m.autoH;
      cur.appliedH += m.appliedH;
      mh.set(m.key, cur);
    }
  }
  mh.set('eng', { key: 'eng', autoH: engAuto, appliedH: engHours });
  mh.set('qa', { key: 'qa', autoH: qaAuto, appliedH: qaHours });
  const manhours: ManhourUsage[] = MANHOUR_BASIS.map((b) => mh.get(b.key) ?? { key: b.key, autoH: 0, appliedH: 0 });

  return {
    lines,
    perTag,
    manhours,
    totals: {
      materialUSD,
      laborUSD,
      consumableUSD,
      serviceUSD,
      shopHours,
      subtotalUSD: withEng,
      overheadUSD,
      profitUSD,
      contingencyUSD,
      grandUSD: withEng + overheadUSD + profitUSD + contingencyUSD,
    },
  };
}
