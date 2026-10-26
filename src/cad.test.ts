// Sheet exports are what management opens in Excel, so the title block,
// headings, totals placement and quoting are pinned here rather than guessed.

import { describe, expect, it } from 'vitest';
import { buildSheetRows, toCsv, type SheetSpec } from './cad';

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
