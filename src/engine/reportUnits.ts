// Reporting-unit layer.
//
// The engine and all saved data stay in the internal SI system (mm, bar g,
// °C, MPa, kg, m², m³) — see the design principles in the README. This module
// converts at the REPORTING edge only, so a project can be authored in SI and
// issued in imperial units without any risk of a conversion creeping into the
// calculations.
//
// Scope (deliberate, and stated in the UI and the README):
//  * Imperial applies to the vessel datasheet tables, their KPI tiles and the
//    generated PDF exports.
//  * The editor, tank / exchanger / fin-fan tables and every stored number
//    remain SI. Nominal pipe sizes stay as NPS/DN designators in both modes.

import { MM_PER_IN, PSI_PER_BAR, MPA_TO_PSI, r, fmt } from './units';

export type UnitMode = 'metric' | 'imperial';

const LB_PER_KG = 2.20462262185;
const FT2_PER_M2 = 10.7639104167;
const FT3_PER_M3 = 35.3146667215;
const IN4_PER_MM4 = 1 / Math.pow(25.4, 4);

export interface ReportUnits {
  mode: UnitMode;
  /** Length: mm → mm | in */
  len(mm: number | null | undefined, dp?: number): string;
  /** Converted length value (for arithmetic such as mass from geometry) */
  lenNum(mm: number): number;
  /** Pressure: bar → bar | psi */
  press(bar: number | null | undefined, dp?: number): string;
  /** Temperature: °C → °C | °F */
  temp(c: number | null | undefined, dp?: number): string;
  /** Stress: MPa → MPa | psi */
  stress(mpa: number | null | undefined, dp?: number): string;
  /** Mass: kg → kg | lb */
  mass(kg: number | null | undefined, dp?: number): string;
  /** Converted mass value */
  massNum(kg: number): number;
  /** Area: m² → m² | ft² */
  area(m2: number | null | undefined, dp?: number): string;
  /** Volume: m³ → m³ | ft³ */
  vol(m3: number | null | undefined, dp?: number): string;
  /** Second moment of area: mm⁴ → mm⁴ | in⁴ */
  inertia(mm4: number | null | undefined, dp?: number): string;
  /** Unit captions for table headers and legends */
  labels: { len: string; press: string; temp: string; stress: string; mass: string; area: string; vol: string; massShort: string };
}

/** toLocaleString with a real minimum fraction count (fmt() trims zeros). */
function num(x: number, dp: number, minDp: number): string {
  if (!isFinite(x)) return '—';
  return x.toLocaleString('en-US', { minimumFractionDigits: minDp, maximumFractionDigits: dp });
}

/** Build the formatter set for a unit mode. */
export function reportUnits(mode: UnitMode): ReportUnits {
  const imp = mode === 'imperial';
  const lenNum = (mm: number) => (imp ? mm / MM_PER_IN : mm);
  const massNum = (kg: number) => (imp ? kg * LB_PER_KG : kg);
  const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && isFinite(v);
  return {
    mode,
    lenNum,
    massNum,
    // imperial: inches to 3 dp, psi to 1 dp, lb/psi rounded — the customary
    // issue precision. metric: unchanged display (fmt, trailing zeros trimmed).
    len: (mm, dp = 2) => (ok(mm) ? (imp ? num(lenNum(mm), 3, 3) : fmt(mm, dp)) : '—'),
    press: (bar, dp = 2) => (ok(bar) ? (imp ? num(bar * PSI_PER_BAR, 1, 1) : fmt(bar, dp)) : '—'),
    temp: (c, dp = 0) => (ok(c) ? (imp ? num((c * 9) / 5 + 32, 0, 0) : fmt(c, dp)) : '—'),
    stress: (mpa, dp = 1) => (ok(mpa) ? (imp ? num(mpa * MPA_TO_PSI, 0, 0) : fmt(mpa, dp)) : '—'),
    mass: (kg, dp = 0) => (ok(kg) ? (imp ? num(kg * LB_PER_KG, 0, 0) : fmt(kg, dp)) : '—'),
    area: (m2, dp = 2) => (ok(m2) ? (imp ? num(m2 * FT2_PER_M2, 1, 1) : fmt(m2, dp)) : '—'),
    vol: (m3, dp = 2) => (ok(m3) ? (imp ? num(m3 * FT3_PER_M3, 1, 1) : fmt(m3, dp)) : '—'),
    inertia: (mm4, dp = 1) => (ok(mm4) ? (imp ? num(mm4 * IN4_PER_MM4, 2, 2) : fmt(mm4, dp)) : '—'),
    labels: imp
      ? { len: 'in', press: 'psi', temp: '°F', stress: 'psi', mass: 'lb', area: 'ft²', vol: 'ft³', massShort: 'lb' }
      : { len: 'mm', press: 'bar', temp: '°C', stress: 'MPa', mass: 'kg', area: 'm²', vol: 'm³', massShort: 'kg' },
  };
}

/** Short human label for the mode, for badges and PDF footers. */
export function unitModeLabel(mode: UnitMode): string {
  return mode === 'imperial' ? 'in · psi · °F · lb' : 'mm · bar · °C · kg';
}

export { r, fmt };
