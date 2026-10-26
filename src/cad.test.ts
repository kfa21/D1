// Sheet exports are what management opens in Excel, so the title block,
// headings, totals placement and quoting are pinned here rather than guessed.
// The DXF outline shares its geometry source with the 3D viewer (layout3d),
// so its datum and nozzle placement are pinned too.

import { describe, expect, it } from 'vitest';
import { buildDxf, buildSheetRows, toCsv, type SheetSpec } from './cad';
import { computeEquipment } from './engine/compute';
import { buildBodyLayout, locateNozzle } from './engine/layout3d';
import { newEquipment } from './defaults';
import type { Equipment } from './engine/types';

const spec: SheetSpec = {
  filename: 'demo',
  title: 'COST ESTIMATE — detail lines (3)',
  meta: ['Project Alpha · Client: ACME', '26/10/2026 · base BHD · values shown in USD · Rev 0'],
  columns: ['Tag', 'Activity', 'Amount'],
  rows: [
    ['V-101', 'Shell longitudinal seam welding', 123.45],
    ['V-101', 'Activity, with a comma', 1],
    ['only-tag'], // short row is padded to the column count
    ['X', 'Y', 1, 'extra'], // long row is trimmed to the column count
  ],
  totals: ['', '', '999.00'],
  notes: ['Grand total incl. markups: 1234.00 BHD'],
};

describe('buildSheetRows', () => {
  it('lays the sheet out as title block → headings → data → totals → notes', () => {
    const rows = buildSheetRows(spec);
    expect(rows[0]).toEqual([spec.title]);
    expect(rows[1]).toEqual([spec.meta![0]]);
    expect(rows[2]).toEqual([spec.meta![1]]);
    expect(rows[3]).toEqual([]); // blank separator before the headings
    expect(rows[4]).toEqual(['Tag', 'Activity', 'Amount']);
    expect(rows[5]).toEqual(['V-101', 'Shell longitudinal seam welding', 123.45]);
    expect(rows[9]).toEqual([]); // blank separator before the totals
    expect(rows[10]).toEqual(['', '', '999.00']);
    expect(rows[11]).toEqual([]);
    expect(rows[12]).toEqual(['Grand total incl. markups: 1234.00 BHD']);
  });

  it('pads and trims every data row to the heading width', () => {
    const rows = buildSheetRows(spec);
    for (const r of rows.slice(5, 9)) expect(r).toHaveLength(3);
    expect(rows[7]).toEqual(['only-tag', '', '']);
    expect(rows[8]).toEqual(['X', 'Y', 1]);
  });

  it('omits the totals and notes blocks when they are not given', () => {
    const rows = buildSheetRows({ filename: 'x', title: 'T', columns: ['A'], rows: [[1]] });
    expect(rows).toEqual([['T'], [], ['A'], [1]]);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([
      ['plain', 'with, comma'],
      ['has "quotes"', 'line\nbreak'],
      [42, 0],
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('plain,"with, comma"');
    expect(csv).toContain('"has ""quotes"""');
    expect(csv).toContain('"line\nbreak"'); // a quoted newline stays inside one field
    expect(lines).toHaveLength(4); // …so it costs one extra physical line
    expect(lines[3]).toBe('42,0');
  });
});

/** LINE entities of the DXF outline as [x1, y1, x2, y2]. */
function dxfLines(dxf: string): [number, number, number, number][] {
  const t = dxf.split('\n');
  expect(t.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'ENTITIES']);
  expect(t.slice(-4)).toEqual(['0', 'ENDSEC', '0', 'EOF']);
  const out: [number, number, number, number][] = [];
  for (let i = 4; i + 12 <= t.length - 4; i += 12) {
    expect(t[i]).toBe('0');
    expect(t[i + 1]).toBe('LINE');
    expect(t[i + 3]).toBe('OUTLINE');
    out.push([+t[i + 5], +t[i + 7], +t[i + 9], +t[i + 11]]);
  }
  return out;
}

/** Vertical two-course vessel with a cone step: Ø2000 bottom, Ø1400 top. */
function multiDiaVessel(): Equipment {
  const eq = newEquipment('vessel', 1);
  eq.orientation = 'vertical';
  eq.sections = [
    { ...eq.sections[0], id: 'c1', dia: 2000, ttLength: 4000, shellThk: 20, headTop: 'none', headBottom: 'ellip2' },
    { ...eq.sections[0], id: 'c2', dia: 1400, ttLength: 4000, shellThk: 14, headTop: 'ellip2', headBottom: 'none', coneAngleDeg: 20 },
  ];
  eq.nozzles = [{
    id: 'nz1', tag: 'N1', service: 'Out', dn: 100, schKey: '40', sectionId: 'c1',
    elevation: 6000, azimuth: 0, kind: 'process', flangeClass: 300, flangeMatKey: 'SA-105',
    padDia: 0, padThk: 0, projOutside: 120,
  }];
  return eq;
}

describe('DXF outline shares the viewer layout frame', () => {
  it('draws the bottom head from its tip at y=0 up to the bottom tangent', () => {
    const eq = multiDiaVessel();
    const calc = computeEquipment(eq);
    const layout = buildBodyLayout(calc.sections);
    const segs = dxfLines(buildDxf(eq, calc));
    expect(segs.length).toBeGreaterThan(10);
    // nothing hangs below the head tip — the old head spanned y ∈ [−depth, 0]
    const ys = segs.flatMap((s) => [s[1], s[3]]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    // …and the head closes onto the shell exactly at the bottom tangent
    const tangentEnds = segs.filter((s) =>
      s[0] !== s[2] &&
      ((Math.abs(s[1] - layout.bottomDepth) < 1e-6 && Math.abs(Math.abs(s[0]) - 1000) < 1e-6) ||
       (Math.abs(s[3] - layout.bottomDepth) < 1e-6 && Math.abs(Math.abs(s[2]) - 1000) < 1e-6)));
    expect(tangentEnds.length).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeCloseTo(layout.stackTop + layout.topHeadDepth, 1);
  });

  it('places a nozzle stub from the bottom tangent at the local course radius', () => {
    const eq = multiDiaVessel();
    const calc = computeEquipment(eq);
    const layout = buildBodyLayout(calc.sections);
    const place = locateNozzle(layout, 6000)!;
    expect(place.r).toBeLessThan(1000); // elevation really lands on the small upper course
    const n = eq.nozzles[0];
    const half = n.dn / 2;
    const cy = place.y;
    const segs = dxfLines(buildDxf(eq, calc));
    // two horizontal stub edges at cy ± half the bore, starting on the Ø1400 course
    const stubs = segs.filter((s) =>
      s[1] === s[3] && (Math.abs(s[1] - (cy - half)) < 0.01 || Math.abs(s[1] - (cy + half)) < 0.01));
    expect(stubs).toHaveLength(2);
    for (const s of stubs) expect(Math.abs(Math.abs(s[0]) - place.r)).toBeLessThan(0.01);
  });
});
