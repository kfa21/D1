// Pipe data: NPS outside diameters (ASME B36.10M) and schedule walls (mm, indicative).

export interface PipeSize {
  nps: string;
  od: number; // mm
  bore: number; // mm (nominal, no CA)
  walls: Record<string, number>; // schedule -> wall mm
}

const P = (nps: string, od: number, walls: Record<string, number>): PipeSize => ({
  nps,
  od,
  bore: od - 2 * walls['40'],
  walls,
});

export const PIPES: PipeSize[] = [
  P('1/2"', 21.3, { '5S': 1.65, '10S': 2.11, '40': 2.77, '80': 3.73, '160': 4.78, 'XXS': 7.47 }),
  P('3/4"', 26.7, { '5S': 1.65, '10S': 2.11, '40': 2.87, '80': 3.91, '160': 5.56, 'XXS': 7.82 }),
  P('1"', 33.4, { '5S': 1.65, '10S': 2.77, '40': 3.38, '80': 4.55, '160': 6.35, 'XXS': 9.09 }),
  P('1-1/4"', 42.2, { '5S': 1.65, '10S': 2.77, '40': 3.56, '80': 4.85, '160': 6.35, 'XXS': 9.7 }),
  P('1-1/2"', 48.3, { '5S': 1.65, '10S': 2.77, '40': 3.73, '80': 5.08, '160': 7.14, 'XXS': 10.15 }),
  P('2"', 60.3, { '5S': 1.65, '10S': 2.77, '40': 3.91, '80': 5.54, '160': 8.74, 'XXS': 11.07 }),
  P('2-1/2"', 73.0, { '5S': 2.11, '10S': 3.05, '40': 5.16, '80': 7.01, '160': 10.97, 'XXS': 14.02 }),
  P('3"', 88.9, { '5S': 2.11, '10S': 3.05, '40': 5.49, '80': 7.62, '160': 12.7, 'XXS': 15.24 }),
  P('4"', 114.3, { '5S': 2.11, '10S': 3.05, '40': 6.02, '80': 8.56, '160': 15.09, 'XXS': 17.12 }),
  P('5"', 141.3, { '5S': 2.77, '10S': 3.4, '40': 6.55, '80': 9.53, '160': 18.26, 'XXS': 21.95 }),
  P('6"', 168.3, { '5S': 2.77, '10S': 3.4, '40': 7.11, '80': 10.97, '160': 21.95, 'XXS': 25.4 }),
  P('8"', 219.1, { '5S': 2.77, '10S': 3.76, '40': 8.18, '80': 12.7, '160': 27.79, 'XXS': 35.71 }),
  P('10"', 273.1, { '5S': 3.4, '10S': 4.19, '40': 9.27, '80': 15.09, '160': 35.71, 'XXS': 44.45 }),
  P('12"', 323.9, { '5S': 3.96, '10S': 4.57, '40': 10.31, '80': 17.48, '160': 38.1, 'XXS': 48.26 }),
  P('14"', 355.6, { '5S': 3.96, '10S': 4.78, '40': 11.13, '80': 19.05, '160': 38.1, 'XXS': 52.37 }),
  P('16"', 406.4, { '5S': 4.19, '10S': 5.08, '40': 12.7, '80': 21.44, '160': 44.45, 'XXS': 55.58 }),
  P('18"', 457.0, { '5S': 4.19, '10S': 5.54, '40': 14.27, '80': 23.83, '160': 50.01, 'XXS': 59.53 }),
  P('20"', 508.0, { '5S': 4.78, '10S': 5.54, '40': 15.09, '80': 26.19, '160': 55.58, 'XXS': 63.5 }),
  P('24"', 609.6, { '5S': 5.54, '10S': 6.35, '40': 17.48, '80': 30.96, '160': 65.09, 'XXS': 72.25 }),
];

export const SCHEDULES = ['5S', '10S', '40', '80', '160', 'XXS'];

/**
 * Nozzle bore picker: the sizes a designer actually specifies, in INCHES, with the
 * nominal bore in mm that the engine stores and calculates with. `dn` stays the
 * finished bore in mm, so every existing check (UG-37/UG-45, schedules, flanges)
 * is unchanged — only the way the bore is chosen became an NPS choice.
 */
export const NPS_SIZES: { nps: string; dnMm: number }[] = [
  { nps: '1/2"', dnMm: 15 },
  { nps: '3/4"', dnMm: 20 },
  { nps: '1"', dnMm: 25 },
  { nps: '1-1/4"', dnMm: 32 },
  { nps: '1-1/2"', dnMm: 40 },
  { nps: '2"', dnMm: 50 },
  { nps: '2-1/2"', dnMm: 65 },
  { nps: '3"', dnMm: 80 },
  { nps: '4"', dnMm: 100 },
  { nps: '5"', dnMm: 125 },
  { nps: '6"', dnMm: 150 },
  { nps: '8"', dnMm: 200 },
  { nps: '10"', dnMm: 250 },
  { nps: '12"', dnMm: 300 },
  { nps: '14"', dnMm: 350 },
  { nps: '16"', dnMm: 400 },
  { nps: '18"', dnMm: 450 },
  { nps: '20"', dnMm: 500 },
  { nps: '24"', dnMm: 600 },
];

/** NPS label for a bore in mm (e.g. 150 → 6"), for readouts and hover text. */
export function npsLabelForBore(dnMm: number): string {
  const hit = NPS_SIZES.find((s) => Math.abs(s.dnMm - dnMm) <= 2);
  return hit ? hit.nps : `${dnMm} mm`;
}

export function findPipe(nps: string): PipeSize | undefined {
  return PIPES.find((p) => p.nps === nps);
}

/** Wall for the closest standard bore. Returns undefined if dn not a standard NPS. */
export function wallForBore(dnBore: number, sch: string): { pipe: PipeSize; wall: number } | undefined {
  // nozzle DN is specified as the nominal pipe bore; match nearest NPS by nominal bore (OD - 2*sch40)
  let best: PipeSize | undefined;
  let bestErr = Infinity;
  for (const p of PIPES) {
    const err = Math.abs(p.bore - dnBore);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  if (!best) return undefined;
  const wall = best.walls[sch] ?? best.walls['40'];
  return { pipe: best, wall };
}

/** Linear mass kg/m for a pipe (density kg/m3) */
export function pipeMassKgPerM(od: number, wall: number, density: number): number {
  const idm = Math.max(0, od - 2 * wall) / 1000;
  const odm = od / 1000;
  return (Math.PI / 4) * (odm * odm - idm * idm) * density;
}

/** Flange weights (kg), indicative for WN RF forgings, interpolated by NPS. */
const FLANGE_WT: Record<string, [number, number][]> = {
  // npsIndex: [[npsNumber, class150 kg], ...] handled below
};

const FLANGE_WT_TABLE: { n: number; c150: number; c300: number; c600: number }[] = [
  { n: 0.5, c150: 0.6, c300: 0.8, c600: 1.2 },
  { n: 0.75, c150: 0.8, c300: 1.1, c600: 1.8 },
  { n: 1, c150: 1.3, c300: 1.8, c600: 3.0 },
  { n: 1.25, c150: 1.8, c300: 2.6, c600: 4.4 },
  { n: 1.5, c150: 2.3, c300: 3.3, c600: 5.8 },
  { n: 2, c150: 3.6, c300: 5.4, c600: 9.5 },
  { n: 2.5, c150: 5.0, c300: 7.6, c600: 13.5 },
  { n: 3, c150: 6.8, c300: 9.9, c600: 18.5 },
  { n: 4, c150: 12.0, c300: 17.3, c600: 31.0 },
  { n: 5, c150: 16.0, c300: 24.0, c600: 43.0 },
  { n: 6, c150: 22.0, c300: 31.0, c600: 61.0 },
  { n: 8, c150: 37.0, c300: 49.0, c600: 98.0 },
  { n: 10, c150: 53.0, c300: 71.0, c600: 143.0 },
  { n: 12, c150: 73.0, c300: 98.0, c600: 200.0 },
  { n: 14, c150: 90.0, c300: 118.0, c600: 265.0 },
  { n: 16, c150: 107.0, c300: 144.0, c600: 340.0 },
  { n: 18, c150: 130.0, c300: 172.0, c600: 420.0 },
  { n: 20, c150: 155.0, c300: 203.0, c600: 520.0 },
  { n: 24, c150: 205.0, c300: 265.0, c600: 760.0 },
];

export function flangeWeightKg(npsNumber: number, flangeClass: number): number {
  const pick = (v: 'c150' | 'c300' | 'c600') => FLANGE_WT_TABLE.map((r) => [r.n, r[v]] as [number, number]);
  const table =
    flangeClass <= 150 ? pick('c150') : flangeClass <= 300 ? pick('c300') : pick('c600');
  if (npsNumber <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (npsNumber >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    if (npsNumber <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((npsNumber - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

export function npsNumber(nps: string): number {
  const s = nps.replace('"', '').trim();
  const parts = s.split('-');
  if (parts.length === 1) return parseFloat(parts[0]);
  return parseFloat(parts[0]) + parseFloat(parts[1]) / 12;
}

/** Stud count per ASME B16.5 Table 9 (Class 150/300 raised-face flanges, NPS ≤ 24). */
const STUD_COUNT: [number, number][] = [
  [0.5, 4], [1, 4], [1.5, 4], [2, 4], [2.5, 4], [3, 4], [4, 8], [6, 12],
  [8, 16], [10, 20], [12, 20], [14, 24], [16, 24], [18, 24], [20, 24], [24, 24],
];

export function studCount(npsNumber: number): number {
  for (const [n, c] of STUD_COUNT) if (npsNumber <= n) return c;
  return 24;
}
