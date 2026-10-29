// Overall dimensions of a tag, from the same layout the 3D viewer and the CAD
// exports use.
//
// A multi-section vessel is not just the sum of its cylinders: between two courses
// of different diameter there is a CONE whose axial length depends on the included
// angle, and the ends add the dish depth. The register used to show only the
// section lengths (the T-T total), so the actual overall length — the number that
// matters for shipping, the shop bay and the plot plan — was missing.

import type { Equipment, EquipmentCalc } from './types';
import { buildBodyLayout, headDepthMm } from './layout3d';
import { finFanModel, tankModel } from './model3d';
import { sectionsFor, supportHeightMm } from './structure3d';

export interface EquipmentDims {
  /** sum of the cylindrical section lengths (the T-T total) */
  ttMm: number;
  /** axial length of the cone transitions between sections */
  coneMm: number;
  /** dish depth of the bottom / top ends */
  bottomHeadMm: number;
  topHeadMm: number;
  /** tip-to-tip axial length: heads + sections + cones */
  overallMm: number;
  /** erected height above grade (overall + support height for a vertical tag) */
  heightMm: number;
  /** plan footprint diameter used for the "length" of a tank / cooler */
  planMm: number;
  /** per-section cone length, indexed like equip.sections (0 = no cone) */
  coneLengthsMm: number[];
  /** what the overall number measures, for the label */
  note: string;
}

/**
 * Dimensions of one tag. Vessels/columns/exchangers are measured axis-tip to
 * axis-tip (including dishes and cones); tanks are measured by diameter and
 * overall height (floor to roof apex); air coolers by bundle length and overall
 * height above grade.
 */
export function equipmentDims(equip: Equipment, calc: EquipmentCalc): EquipmentDims {
  const empty: EquipmentDims = {
    ttMm: 0,
    coneMm: 0,
    bottomHeadMm: 0,
    topHeadMm: 0,
    overallMm: 0,
    heightMm: 0,
    planMm: 0,
    coneLengthsMm: [],
    note: '',
  };

  if (equip.equipType === 'tank') {
    const tm = tankModel(equip, calc);
    if (!tm) return empty;
    return {
      ...empty,
      ttMm: Math.max(0, tm.shellTopY - tm.shellBaseY),
      overallMm: tm.overallHeightMm,
      heightMm: tm.overallHeightMm,
      planMm: tm.diameterMm,
      note: 'Overall height = floor to roof apex (cone/dome rise included)',
    };
  }

  if (equip.equipType === 'finfan') {
    const fm = finFanModel(equip, calc);
    if (!fm) return empty;
    return {
      ...empty,
      ttMm: fm.tubeLengthMm,
      overallMm: fm.tubeLengthMm,
      heightMm: fm.overallHeightMm,
      planMm: fm.totalDepthMm,
      note: 'Overall length = finned tube length; height above grade to the fan deck',
    };
  }

  // ---- vessels, columns, shell-and-tube exchangers ----
  const sections = sectionsFor(equip, calc);
  if (!sections.length) return empty;
  const layout = buildBodyLayout(sections);
  const ttMm = equip.sections.reduce((s, x) => s + (x.ttLength || 0), 0);

  // a cone is owned by the section ABOVE the step (layout3d builds it from the
  // next section's cone angle), so its length belongs in that section's row
  const coneLengthsMm = equip.sections.map(() => 0);
  let coneMm = 0;
  for (const seg of layout.segments) {
    if (seg.kind !== 'cone') continue;
    coneLengthsMm[seg.sectionIndex] = seg.y1 - seg.y0;
    coneMm += seg.y1 - seg.y0;
  }

  const bottomHeadMm = layout.bottomDepth;
  const topHeadMm = layout.topHeadDepth;
  const overallMm = ttMm + coneMm + bottomHeadMm + topHeadMm;
  const supportH = equip.orientation === 'horizontal' ? 0 : supportHeightMm(equip);
  const headCount = sections.reduce(
    (n, s) => n + (s.headTop && s.headTop.type !== 'none' ? 1 : 0) + (s.headBot && s.headBot.type !== 'none' ? 1 : 0),
    0
  );

  return {
    ttMm,
    coneMm,
    bottomHeadMm,
    topHeadMm,
    overallMm,
    heightMm: overallMm + supportH,
    planMm: Math.max(...layout.segments.map((sg) => Math.max(sg.r0, sg.r1)), 0) * 2,
    coneLengthsMm,
    note:
      `Overall ${equip.orientation === 'horizontal' ? 'length' : 'height'} = ` +
      `${headCount ? 'dished ends + ' : ''}sections${coneMm > 0 ? ' + cones' : ''}` +
      `${supportH > 0 ? ` + ${Math.round(supportH)} mm support` : ''}`,
  };
}

/** Head depth helper re-exported so callers can size the ends without importing layout3d. */
export { headDepthMm };
