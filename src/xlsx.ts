// Minimal XLSX (OOXML SpreadsheetML) writer — no dependencies.
//
// Every spreadsheet export used to be RFC-4180 CSV text, which opens as raw
// comma-separated values with no widths, no alignment and locale-dependent
// separators. Exports are now real .xlsx workbooks: styled title block, a
// frozen header row, sized columns, numbers stored as numbers (so they align
// right and carry thousand separators) and a bordered totals row.
//
// The archive is written with STORED (uncompressed) ZIP entries — valid ZIP,
// and it keeps this file small and testable without a deflate dependency.

export type CellValue = string | number | boolean;

/** Style key resolved to a concrete cellXf when the sheet is built. */
export type StyleKey = 'title' | 'meta' | 'header' | 'text' | 'note' | 'totalText' | 'num' | 'totalNum';

export interface XlCell {
  v: CellValue;
  s: StyleKey;
  /** decimal places for the 'num'/'totalNum' number formats */
  d?: number;
}

export interface XlRow {
  cells: XlCell[];
  /** explicit row height (points) when set */
  h?: number;
}

export interface XlSheet {
  /** worksheet name (≤ 31 chars, no []:*?/\) */
  name: string;
  /** column widths in characters */
  cols: number[];
  /** rows kept frozen under the scrolling area (title block + header) */
  freezeRows: number;
  rows: XlRow[];
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escape text for an XML text/attribute node and drop illegal control chars. */
export function xmlText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------------------------------------------------------------- ZIP (stored)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP archive of STORED entries (valid for .xlsx packages). */
export function zipStore(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  type Local = { name: Uint8Array; data: Uint8Array; crc: number; offset: number };
  const parts: Uint8Array[] = [];
  const locals: Local[] = [];
  let offset = 0;

  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

  // fixed DOS date: 1980-01-01 00:00 (deterministic output for tests)
  const DOS_TIME = 0;
  const DOS_DATE = 0x21;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const start = offset;
    push(u32(0x04034b50)); // local file header
    push(u16(20)); // version needed
    push(u16(0x0800)); // UTF-8 names
    push(u16(0)); // stored
    push(u16(DOS_TIME));
    push(u16(DOS_DATE));
    push(u32(crc));
    push(u32(e.data.length));
    push(u32(e.data.length));
    push(u16(name.length));
    push(u16(0)); // extra length
    push(name);
    push(e.data);
    locals.push({ name, data: e.data, crc, offset: start });
  }

  const cdStart = offset;
  for (const l of locals) {
    push(u32(0x02014b50)); // central directory header
    push(u16(20)); // version made by
    push(u16(20)); // version needed
    push(u16(0x0800));
    push(u16(0));
    push(u16(DOS_TIME));
    push(u16(DOS_DATE));
    push(u32(l.crc));
    push(u32(l.data.length));
    push(u32(l.data.length));
    push(u16(l.name.length));
    push(u16(0)); // extra
    push(u16(0)); // comment
    push(u16(0)); // disk
    push(u16(0)); // internal attrs
    push(u32(0)); // external attrs
    push(u32(l.offset));
    push(l.name);
  }
  const cdSize = offset - cdStart;

  push(u32(0x06054b50)); // end of central directory
  push(u16(0));
  push(u16(0));
  push(u16(locals.length));
  push(u16(locals.length));
  push(u32(cdSize));
  push(u32(cdStart));
  push(u16(0));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// -------------------------------------------------------------------- styles

interface Xf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'center' | 'top';
  wrap?: boolean;
}

/** Number format for a value shown with `d` decimals and thousands grouping. */
export function numberFormatCode(d: number): string {
  return `#,##0${d > 0 ? `.${'0'.repeat(d)}` : ''}`;
}

/**
 * Cell formats used by the exports. Indices are assigned in a fixed order so
 * the same sheet always serialises to the same styles.xml.
 */
function buildStyles(usedDecimals: number[]) {
  const fonts = [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>', // 0 body
    '<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/></font>', // 1 bold heading
    '<font><i/><sz val="9"/><color rgb="FF7F7F7F"/><name val="Calibri"/><family val="2"/></font>', // 2 caption
    '<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/></font>', // 3 title
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>', // 2 header
  ];
  const side = (name: 'left' | 'right' | 'top' | 'bottom', style: boolean) =>
    style ? `<${name} style="thin"><color rgb="FFBFBFBF"/></${name}>` : `<${name}/>`;
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border>${side('left', true)}${side('right', true)}${side('top', true)}${side('bottom', true)}<diagonal/></border>`,
    `<border>${side('left', false)}${side('right', false)}${side('top', true)}${side('bottom', false)}<diagonal/></border>`,
  ];

  const numFmts: string[] = [];
  const numFmtIdFor = (d: number) => {
    let idx = numFmts.findIndex((f) => f.endsWith(`"${numberFormatCode(d)}"`));
    if (idx < 0) {
      numFmts.push(`<numFmt numFmtId="${164 + numFmts.length}" formatCode="${numberFormatCode(d)}"/>`);
      idx = numFmts.length - 1;
    }
    return 164 + idx;
  };

  const xfs: Xf[] = [];
  const add = (xf: Xf) => {
    xfs.push(xf);
    return xfs.length - 1;
  };
  const base = { numFmtId: 0, fontId: 0, fillId: 0, borderId: 0 };
  const ids = {
    body: add({ ...base }), // 0
    title: add({ ...base, fontId: 3, vertical: 'center' }),
    meta: add({ ...base, fontId: 2, vertical: 'center' }),
    header: add({ ...base, fontId: 1, fillId: 2, borderId: 1, horizontal: 'center', vertical: 'center', wrap: true }),
    text: add({ ...base, borderId: 1, horizontal: 'left', vertical: 'center' }),
    note: add({ ...base, fontId: 2, horizontal: 'left', vertical: 'top' }),
    totalText: add({ ...base, fontId: 1, borderId: 2, horizontal: 'left', vertical: 'center' }),
  };
  const numIds = new Map<number, number>();
  const totalNumIds = new Map<number, number>();
  for (const d of usedDecimals) {
    if (!numIds.has(d)) {
      numIds.set(d, add({ ...base, numFmtId: numFmtIdFor(d), borderId: 1, horizontal: 'right', vertical: 'center' }));
      totalNumIds.set(d, add({ ...base, numFmtId: numFmtIdFor(d), fontId: 1, borderId: 2, horizontal: 'right', vertical: 'center' }));
    }
  }

  const xfXml = (xf: Xf) => {
    const align = xf.horizontal || xf.vertical || xf.wrap
      ? `<alignment${xf.horizontal ? ` horizontal="${xf.horizontal}"` : ''}${xf.vertical ? ` vertical="${xf.vertical}"` : ''}${xf.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    return `<xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  };

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '') +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    `<borders count="${borders.length}">${borders.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.map(xfXml).join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  return {
    stylesXml,
    resolve: (cell: XlCell): number => {
      switch (cell.s) {
        case 'title':
          return ids.title;
        case 'meta':
          return ids.meta;
        case 'header':
          return ids.header;
        case 'text':
          return ids.text;
        case 'note':
          return ids.note;
        case 'totalText':
          return ids.totalText;
        case 'num':
          return numIds.get(cell.d ?? 0) ?? ids.text;
        case 'totalNum':
          return totalNumIds.get(cell.d ?? 0) ?? ids.totalText;
        default:
          return ids.body;
      }
    },
  };
}

// ----------------------------------------------------------------- workbook

function sheetXml(sheet: XlSheet, resolve: (c: XlCell) => number): string {
  const n = Math.max(1, sheet.cols.length);
  const rowCount = Math.max(1, sheet.rows.length);
  const body: string[] = [];
  sheet.rows.forEach((row, r) => {
    const rn = r + 1;
    const attrs = row.h != null ? ` r="${rn}" ht="${row.h}" customHeight="1"` : ` r="${rn}"`;
    const cells = row.cells
      .map((c, i) => {
        const ref = `${colLetter(i)}${rn}`;
        const s = resolve(c);
        if (typeof c.v === 'number') {
          if (!Number.isFinite(c.v)) return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${xmlText(String(c.v))}</t></is></c>`;
          return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
        }
        if (typeof c.v === 'boolean') return `<c r="${ref}" s="${s}" t="b"><v>${c.v ? 1 : 0}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlText(c.v)}</t></is></c>`;
      })
      .join('');
    body.push(`<row${attrs}>${cells}</row>`);
  });

  const view = sheet.freezeRows > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

  const cols = `<cols>${sheet.cols
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
    .join('')}</cols>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${colLetter(n - 1)}${rowCount}"/>` +
    view +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${body.join('')}</sheetData>` +
    '</worksheet>'
  );
}

/** Serialise a sheet to .xlsx bytes (single worksheet, styled as specified). */
export function buildXlsx(sheet: XlSheet): Uint8Array {
  const decimals = new Set<number>();
  for (const row of sheet.rows) {
    for (const c of row.cells) {
      if ((c.s === 'num' || c.s === 'totalNum') && typeof c.v === 'number' && Number.isFinite(c.v)) {
        decimals.add(Math.max(0, Math.min(4, c.d ?? 0)));
      }
    }
  }
  const styles = buildStyles([...decimals]);
  // worksheet names reject []:*?/\ — replace them rather than escape them
  const raw = (sheet.name || 'Sheet').slice(0, 31);
  const name = xmlText([...raw].map((ch) => ('[]:*?/\\'.includes(ch) ? ' ' : ch)).join(''));

  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  const put = (path: string, xml: string) => files.push({ name: path, data: enc.encode(xml) });

  put(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'
  );
  put(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );
  put(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
      '</workbook>'
  );
  put(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'
  );
  put('xl/styles.xml', styles.stylesXml);
  put('xl/worksheets/sheet1.xml', sheetXml(sheet, styles.resolve));

  return zipStore(files);
}
