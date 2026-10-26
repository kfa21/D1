// Sheet exports are what management opens in Excel, so the title block,
// headings, totals placement and quoting are pinned here rather than guessed.
// The DXF outline shares its geometry source with the 3D viewer (layout3d),
// so its datum and nozzle placement are pinned too.

import { describe, expect, it } from 'vitest';
import { buildDxf, buildSheet, type SheetSpec } from './cad';
import { buildXlsx, colLetter, crc32, xmlText, zipStore } from './xlsx';
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

/** Read back a stored-entry ZIP (what our writer emits) → path → bytes. */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: scan back for PK\x05\x06
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(-1);
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(off, true)).toBe(0x02014b50);
    const crc = dv.getUint32(off + 16, true);
    const size = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const data = bytes.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + size);
    expect(crc32(data)).toBe(crc); // archive integrity
    out.set(name, data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('buildSheet', () => {
  it('lays the sheet out as title block → headings → data → totals → notes', () => {
    const rows = buildSheet(spec).rows;
    expect(rows[0].cells).toEqual([{ v: spec.title, s: 'title' }]);
    expect(rows[1].cells).toEqual([{ v: spec.meta![0], s: 'meta' }]);
    expect(rows[2].cells).toEqual([{ v: spec.meta![1], s: 'meta' }]);
    expect(rows[3].cells).toEqual([]); // blank separator before the headings
    expect(rows[4].cells.map((c) => c.v)).toEqual(['Tag', 'Activity', 'Amount']);
    expect(rows[4].cells.every((c) => c.s === 'header')).toBe(true);
    expect(rows[9].cells).toEqual([]); // blank separator before the totals
    expect(rows[10].cells).toEqual([
      { v: '', s: 'totalText' },
      { v: '', s: 'totalText' },
      { v: 999, s: 'totalNum', d: 2 },
    ]);
    expect(rows[11].cells).toEqual([]);
    expect(rows[12].cells).toEqual([{ v: 'Grand total incl. markups: 1234.00 BHD', s: 'note' }]);
  });

  it('pads and trims every data row to the heading width', () => {
    const rows = buildSheet(spec).rows;
    for (const r of rows.slice(5, 9)) expect(r.cells).toHaveLength(3);
    expect(rows[7].cells.map((c) => c.v)).toEqual(['only-tag', '', '']);
    expect(rows[8].cells).toEqual([{ v: 'X', s: 'text' }, { v: 'Y', s: 'text' }, { v: 1, s: 'num', d: 0 }]);
  });

  it('freezes the header row and sizes the columns from headings and data', () => {
    const sheet = buildSheet(spec);
    expect(sheet.freezeRows).toBe(5); // title + 2 meta + blank + headings
    expect(sheet.cols).toHaveLength(3);
    expect(sheet.cols[0]).toBeGreaterThanOrEqual('Shell'.length + 2); // Tag vs longest activity…
    expect(sheet.cols[1]).toBeCloseTo('Shell longitudinal seam welding'.length + 2, 5);
    expect(sheet.cols[2]).toBeGreaterThanOrEqual('Amount'.length + 2);
  });

  it('keeps fmt() strings numeric so Excel aligns them, and tags as text', () => {
    const s = buildSheet({
      filename: 'x',
      title: 'T',
      columns: ['A', 'B'],
      rows: [
        ['1,234.56', 'V-101'], // grouped numeral → number, 2 decimals kept
        ['007', '—'], // leading zeros and em dashes stay text
        ['12.3', 'N1'],
        ['0.5', 'x'],
      ],
    });
    const d = (i: number, j: number) => s.rows[i].cells[j];
    // no meta lines here: title 0, blank 1, headings 2, data 3…6
    expect(d(3, 0)).toEqual({ v: 1234.56, s: 'num', d: 2 });
    expect(d(3, 1)).toEqual({ v: 'V-101', s: 'text' });
    expect(d(4, 0)).toEqual({ v: '007', s: 'text' }); // tags keep their digits
    expect(d(4, 1)).toEqual({ v: '—', s: 'text' });
    expect(d(5, 0)).toEqual({ v: 12.3, s: 'num', d: 1 });
    expect(d(6, 0)).toEqual({ v: 0.5, s: 'num', d: 1 });
  });

  it('omits the totals and notes blocks when they are not given', () => {
    const rows = buildSheet({ filename: 'x', title: 'T', columns: ['A'], rows: [[1]] }).rows;
    expect(rows.map((r) => r.cells.map((c) => c.v))).toEqual([['T'], [], ['A'], [1]]);
  });
});

describe('buildXlsx', () => {
  it('packages a valid workbook: content types, styles, sheet and rels', () => {
    const files = readZip(buildXlsx(buildSheet(spec)));
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const dec = (n: string) => new TextDecoder().decode(files.get(n)!);
    expect(dec('[Content_Types].xml')).toContain('spreadsheetml.sheet.main+xml');
    expect(dec('xl/workbook.xml')).toContain('<sheet name="demo"');
    // formatted: number formats, header style, frozen headings, sized columns
    expect(dec('xl/styles.xml')).toContain('formatCode="#,##0.00"');
    const sheet = dec('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<pane ySplit="5"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<col min="2" max="2"');
    expect(sheet).toContain('<v>123.45</v>'); // numbers are numbers, not text
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('r="A5"'); // cell references are real
  });

  it('escapes XML and sanitises the sheet name', () => {
    expect(xmlText('a & b < c > "d" \'e\'')).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
    expect(xmlText('bad\u0000chars')).toBe('badchars');
    const files = readZip(buildXlsx({
      name: 'a/b:c*d',
      cols: [10],
      freezeRows: 0,
      rows: [{ cells: [{ v: '<tag>', s: 'text' }] }],
    }));
    expect(new TextDecoder().decode(files.get('xl/workbook.xml'))).toContain('name="a b c d"');
    expect(new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'))).toContain('&lt;tag&gt;');
  });

  it('writes stored ZIP entries that round-trip byte for byte', () => {
    const payload = new TextEncoder().encode('hello spreadsheet');
    const zip = zipStore([{ name: 'a/b.txt', data: payload }, { name: 'c.bin', data: new Uint8Array([1, 2, 3]) }]);
    const back = readZip(zip);
    expect(new TextDecoder().decode(back.get('a/b.txt')!)).toBe('hello spreadsheet');
    expect([...back.get('c.bin')!]).toEqual([1, 2, 3]);
  });
});

describe('colLetter', () => {
  it('maps column indices to spreadsheet letters', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(51)).toBe('AZ');
    expect(colLetter(52)).toBe('BA');
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
