// ASME B16.5 pressure-temperature ratings (Class 150/300/600) — psig at 100 °F steps.
// Values reproduced from B16.5 Table 2-1.1 group tables (see research note in README).

import { psigToBar } from './units';

export type FlangeGroup = '1.1' | '2.1' | '2.2' | '2.3';

export const FLANGE_GROUPS: { group: FlangeGroup; label: string; materials: string }[] = [
  { group: '1.1', label: 'Group 1.1 — CS A105 / WCB / LF2', materials: 'SA-105, SA-350 LF2, SA-216 WCB' },
  { group: '2.1', label: 'Group 2.1 — 304 / CF8', materials: 'SA-182 F304, SA-351 CF8' },
  { group: '2.2', label: 'Group 2.2 — 316 / CF8M', materials: 'SA-182 F316, SA-351 CF8M' },
  { group: '2.3', label: 'Group 2.3 — 304L / 316L', materials: 'SA-182 F304L / F316L, SA-351 CF3 / CF3M' },
];

// Temperatures in °F: [-20, 100, 200, 300, 400, 500, 600, 700, 800]
export const B165_TEMP_F = [-20, 100, 200, 300, 400, 500, 600, 700, 800];

export const B165_RATINGS: Record<FlangeGroup, Record<'150' | '300' | '600', number[]>> = {
  '1.1': {
    '150': [285, 285, 260, 230, 200, 170, 140, 110, 80],
    '300': [740, 740, 680, 655, 635, 605, 570, 530, 410],
    '600': [1480, 1480, 1360, 1310, 1265, 1205, 1135, 1060, 825],
  },
  '2.1': {
    '150': [275, 275, 230, 205, 190, 170, 140, 110, 80],
    '300': [720, 720, 600, 540, 495, 465, 440, 420, 405],
    '600': [1440, 1440, 1200, 1075, 990, 925, 885, 845, 810],
  },
  '2.2': {
    '150': [275, 275, 235, 215, 195, 170, 140, 110, 80],
    '300': [720, 720, 620, 560, 515, 480, 450, 435, 420],
    '600': [1440, 1440, 1240, 1120, 1025, 955, 900, 870, 845],
  },
  '2.3': {
    '150': [230, 230, 195, 175, 160, 150, 140, 110, 80],
    '300': [600, 600, 510, 455, 420, 395, 370, 360, 345],
    '600': [1200, 1200, 1020, 910, 840, 785, 745, 720, 690],
  },
};

/** Rating in bar at design temperature °C (linear interpolation, no extrapolation). */
export function flangeRatingBar(group: FlangeGroup, flangeClass: number, tC: number): number {
  const cls = (flangeClass <= 150 ? '150' : flangeClass <= 300 ? '300' : '600') as '150' | '300' | '600';
  const ratings = B165_RATINGS[group][cls];
  const tF = (tC * 9) / 5 + 32;
  if (tF <= 100) return psigToBar(ratings[1]);
  if (tF >= 800) return psigToBar(ratings[ratings.length - 1]);
  const i = Math.min(ratings.length - 2, Math.max(1, Math.floor((tF - 100) / 100)));
  const t0 = B165_TEMP_F[i];
  const frac = (tF - t0) / 100;
  return psigToBar(ratings[i] + frac * (ratings[i + 1] - ratings[i]));
}

export interface FlangeCheck {
  ratingBar: number;
  ok: boolean;
  margin: number; // (rating - P)/rating
}

export function verifyFlange(group: FlangeGroup, flangeClass: number, tC: number, pBar: number): FlangeCheck {
  const ratingBar = flangeRatingBar(group, flangeClass, tC);
  return {
    ratingBar,
    ok: pBar <= ratingBar + 1e-9,
    margin: ratingBar > 0 ? (ratingBar - pBar) / ratingBar : 0,
  };
}

/** Minimum flange class (from available list) that covers P/T. */
export function minFlangeClass(group: FlangeGroup, tC: number, pBar: number): number | null {
  for (const cls of [150, 300, 600, 900, 1500, 2500]) {
    const limit = flangeRatingBar(group, Math.min(cls, 600), tC);
    // beyond 600 we don't hold tables; extrapolate conservatively by ratio
    const scaled =
      cls <= 600
        ? limit
        : (flangeRatingBar(group, 600, tC) * cls) / 600;
    if (pBar <= scaled) return cls;
  }
  return null;
}

/** Map a vessel/pipe material key to a flange material group. */
export function flangeGroupForMat(matKey: string): FlangeGroup {
  if (matKey.includes('304L')) return '2.3';
  if (matKey.includes('316L')) return '2.3';
  if (matKey.includes('316') || matKey.includes('CF8M')) return '2.2';
  if (matKey.includes('304') || matKey.includes('321') || matKey.includes('347')) return '2.1';
  return '1.1';
}
