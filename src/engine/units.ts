// Unit conversions and formatting helpers.
// Internal system: mm, bar(g), °C, kg, MPa.

export const PSI_PER_BAR = 14.5037738;
export const BAR_PER_PSI = 1 / PSI_PER_BAR;
export const BAR_PER_MPA = 10;
export const MPA_PER_BAR = 0.1;
/** 1 MPa = 10 bar = 145.0377 psi */
export const MPA_TO_PSI = 10 * PSI_PER_BAR;
export const IN_PER_MM = 1 / 25.4;
export const MM_PER_IN = 25.4;
export const KGF_PER_KN = 101.9716;
export const L_PER_M3 = 1000;

export const psigToBar = (psig: number) => psig * BAR_PER_PSI;
export const barToPsig = (bar: number) => bar * PSI_PER_BAR;
export const mpaToBar = (mpa: number) => mpa * BAR_PER_MPA;
export const barToMpa = (bar: number) => bar * MPA_PER_BAR;
export const mpaToPsi = (mpa: number) => mpa * MPA_TO_PSI;
export const mmToIn = (mm: number) => mm * IN_PER_MM;
export const inToMm = (inch: number) => inch * MM_PER_IN;

export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}
export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Round to n decimals for display (never NaN on undefined-ish inputs) */
export function r(x: number | undefined | null, n = 2): number {
  if (x === undefined || x === null || !isFinite(x)) return 0;
  const f = Math.pow(10, n);
  return Math.round(x * f) / f;
}

export function fmt(x: number | undefined | null, n = 2): string {
  if (x === undefined || x === null || !isFinite(x)) return '—';
  return r(x, n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: n });
}

export function fmtFixed(x: number | undefined | null, n = 2): string {
  if (x === undefined || x === null || !isFinite(x)) return '—';
  return x.toFixed(n);
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Linear interpolation over a sorted table [[x0,y0],[x1,y1]...] */
export function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

export function nearestHigher(x: number, list: number[]): number {
  const sorted = [...list].sort((a, b) => a - b);
  for (const v of sorted) if (v >= x - 1e-9) return v;
  return sorted[sorted.length - 1];
}
