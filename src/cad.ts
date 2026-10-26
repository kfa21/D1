// CAD interop: OBJ (3D mesh) and DXF (2D outline) exports.

import type { Equipment, EquipmentCalc } from './engine/types';
import { buildBodyLayout, locateNozzle } from './engine/layout3d';
import { buildXlsx, type XlCell, type XlRow, type XlSheet } from './xlsx';

function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportOBJ(equip: Equipment, calc: EquipmentCalc) {
  const lines: string[] = ['# StaticSuite OBJ export', `# ${equip.tag} ${equip.name}`];
  let vOff = 1;
  const push = (geo: THREE_BufLike, tx: number, ty: number, tz: number, flipZ = false) => {
    const { positions, indices } = geo;
    for (let i = 0; i < positions.length; i += 3) {
      const z = flipZ ? tz - positions[i + 2] : positions[i + 2] + tz;
      lines.push(`v ${(positions[i] + tx).toFixed(3)} ${(positions[i + 1] + ty).toFixed(3)} ${z.toFixed(3)}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      // a mirrored shell reverses its face winding — flip it back
      if (flipZ) lines.push(`f ${indices[i] + vOff} ${indices[i + 2] + vOff} ${indices[i + 1] + vOff}`);
      else lines.push(`f ${indices[i] + vOff} ${indices[i + 1] + vOff} ${indices[i + 2] + vOff}`);
    }
    vOff += positions.length / 3;
  };

  // Same stack as the 3D viewer (buildBodyLayout), so a multi-diameter vessel
  // exports as one connected solid: bottom head → courses → cones → top head.
  const layout = buildBodyLayout(calc.sections);
  if (layout.bottomDepth > 0 && layout.segments[0]) {
    const R = layout.segments[0].r0;
    push(domeMesh(R, layout.bottomDepth), 0, 0, layout.bottomDepth, true); // apex at z = 0
  }
  layout.segments.forEach((seg) => {
    push(cylinderMesh(seg.r0, seg.r1, seg.y1 - seg.y0), 0, 0, seg.y0);
  });
  if (layout.topHeadDepth > 0 && layout.segments.length) {
    const R = layout.segments[layout.segments.length - 1].r1;
    push(domeMesh(R, layout.topHeadDepth), 0, 0, layout.stackTop);
  }
  download(`${equip.tag || 'equipment'}.obj`, lines.join('\n'), 'model/obj');
}

interface THREE_BufLike {
  positions: Float32Array | number[];
  indices: number[];
}

function cylinderMesh(r1: number, r2: number, h: number, seg = 48): THREE_BufLike {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    positions.push(Math.cos(a) * r1, Math.sin(a) * r1, 0);
    positions.push(Math.cos(a) * r2, Math.sin(a) * r2, h);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  return { positions, indices };
}

function domeMesh(r: number, depth: number, seg = 48, rings = 12): THREE_BufLike {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const rr = r * Math.cos((t * Math.PI) / 2);
    const zz = depth * Math.sin((t * Math.PI) / 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      positions.push(Math.cos(a) * rr, Math.sin(a) * rr, zz);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, indices };
}

/** DXF R12 elevation outline: shell rectangle + head profiles + nozzle stubs.
 *  Pure (no DOM) so the geometry is unit-testable; exportDXF only downloads it. */
export function buildDxf(equip: Equipment, calc: EquipmentCalc): string {
  const L: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    L.push('0', 'LINE', '8', 'OUTLINE', '10', x1.toFixed(2), '20', y1.toFixed(2), '11', x2.toFixed(2), '21', y2.toFixed(2));
  };
  // Outline drawn from the same layout as the 3D view: Y = 0 is the bottom-head
  // tip and the bottom tangent (the datum nozzle elevations are measured from)
  // sits at y = bottomDepth — exactly the layout frame, so heads, courses and
  // nozzle stubs line up; both head arcs are drawn in full and the cone
  // transitions close the step between differing diameters.
  const layout = buildBodyLayout(calc.sections);
  const arc = (R: number, d: number, base: number, down: boolean) => {
    // quarter-circle family swept over the full 180° — half of it was skipped before
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI;
      const a1 = ((k + 1) / 16) * Math.PI;
      const y0 = base + (down ? -d : d) * Math.sin(a0);
      const y1 = base + (down ? -d : d) * Math.sin(a1);
      line(down ? -R * Math.cos(a0) : R * Math.cos(a0), y0, down ? -R * Math.cos(a1) : R * Math.cos(a1), y1);
    }
  };
  const segs = layout.segments;
  // bottom head: tangent at y = bottomDepth, tip down at y = 0 (was base 0,
  // which hung the head a full head-depth below the shell)
  if (layout.bottomDepth > 0 && segs[0]) arc(segs[0].r0, layout.bottomDepth, layout.bottomDepth, true);
  segs.forEach((seg) => {
    line(-seg.r0, seg.y0, -seg.r1, seg.y1);
    line(seg.r0, seg.y0, seg.r1, seg.y1);
  });
  if (layout.topHeadDepth > 0 && segs.length) arc(segs[segs.length - 1].r1, layout.topHeadDepth, layout.stackTop, false);
  // nozzles as radial stubs (schematic) — same placement as the viewer:
  // elevation measured from the bottom tangent (y = bottomDepth), radius taken
  // at that height so a stub on an upper, smaller course starts at that course.
  for (const nc of calc.nozzles) {
    const place = locateNozzle(layout, nc.spec.elevation);
    if (!place) continue;
    const R = place.r;
    const yy = place.y;
    const r = nc.spec.dn / 2;
    const side = nc.spec.azimuth < 180 ? 1 : -1;
    line(side * R, yy - r, side * (R + nc.spec.projOutside), yy - r);
    line(side * R, yy + r, side * (R + nc.spec.projOutside), yy + r);
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n');
}

export function exportDXF(equip: Equipment, calc: EquipmentCalc) {
  download(`${equip.tag || 'equipment'}.dxf`, buildDxf(equip, calc), 'application/dxf');
}

/** A spreadsheet-style export: title block, headings, data, totals, notes. */
export interface SheetSpec {
  /** file stem — `.xlsx` is appended */
  filename: string;
  title: string;
  /** context lines under the title (project, client, date, currency, revision) */
  meta?: string[];
  columns: string[];
  rows: (string | number)[][];
  /** totals row, separated from the data by a blank line */
  totals?: (string | number)[];
  /** trailing basis / disclaimer lines */
  notes?: string[];
}

/** Plain or thousands-grouped numerals — what `fmt()` emits. Leading zeros
 *  ("007") and anything with a unit stay text so tags keep their digits. */
const NUMERIC_RE = /^-?(?:0|[1-9]\d*(?:\.\d+)?|0\.\d+|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?)$/;

const decimalsOf = (s: string): number => {
  const i = s.lastIndexOf('.');
  if (i < 0) return 0;
  return Math.min(4, s.length - i - 1);
};

/** Value for the cell plus the decimals its format should keep. Numeric strings
 *  become real numbers so Excel aligns and sums the column. */
function sheetCell(v: string | number): { v: string | number; d: number } {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { v: String(v), d: 0 };
    const s = String(v);
    const d = /[eE]/.test(s) ? (v === 0 ? 0 : 4) : decimalsOf(s);
    return { v, d };
  }
  const s = String(v ?? '').trim();
  if (!NUMERIC_RE.test(s)) return { v: String(v ?? ''), d: 0 };
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return { v: String(v ?? ''), d: 0 };
  return { v: n, d: decimalsOf(s) };
}

/**
 * Lay a sheet spec out as worksheet rows: title block, blank, headings, data,
 * blank, totals, blank, notes — with the heading row marked so it freezes, and
 * per-column widths sized from the headings and data. Pure, so the layout and
 * the alignment decisions are testable before anything is written to a file.
 */
export function buildSheet(spec: SheetSpec): XlSheet {
  const width = spec.columns.length;
  const pad = (r: (string | number)[]): (string | number)[] => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  };
  const num = (v: string | number, style: 'num' | 'totalNum'): XlCell => {
    const c = sheetCell(v);
    return typeof c.v === 'number'
      ? { v: c.v, s: style, d: c.d }
      : { v: c.v, s: style === 'num' ? 'text' : 'totalText' };
  };
  const text = (v: string | number, s: XlCell['s']): XlCell => ({ v: String(v ?? ''), s });

  const rows: XlRow[] = [];
  rows.push({ cells: [text(spec.title, 'title')], h: 22 });
  for (const m of spec.meta ?? []) rows.push({ cells: [text(m, 'meta')], h: 14 });
  rows.push({ cells: [] });
  rows.push({ cells: spec.columns.map((c) => text(c, 'header')), h: 30 });
  const headerRow = rows.length; // title + meta + blank + heading
  for (const r of spec.rows) rows.push({ cells: pad(r).map((v) => num(v, 'num')) });
  if (spec.totals) {
    rows.push({ cells: [] });
    rows.push({ cells: pad(spec.totals).map((v) => num(v, 'totalNum')) });
  }
  if (spec.notes?.length) {
    rows.push({ cells: [] });
    for (const n of spec.notes) rows.push({ cells: [text(n, 'note')], h: 14 });
  }

  // widths from the headings and data only — the title block and notes spill
  // over the empty cells to their right instead of stretching column A
  const widths = Array.from({ length: width }, (_, i) => {
    let w = String(spec.columns[i] ?? '').length;
    for (const r of spec.rows) w = Math.max(w, String(r[i] ?? '').length);
    for (const t of spec.totals ?? []) w = Math.max(w, String(t ?? '').length);
    return Math.min(60, Math.max(6, w + 2));
  });

  return { name: spec.filename, cols: widths, freezeRows: headerRow, rows };
}

/** Title block shared by every export so files carry their project context. */
export function sheetMeta(settings: { projectName: string; clientName: string; rateBase: string; currency: string }, extra?: string): string[] {
  const lines = [`${settings.projectName}${settings.clientName ? ` · Client: ${settings.clientName}` : ''}`];
  lines.push(`${new Date().toLocaleString()} · base ${settings.rateBase} · values shown in ${settings.currency} · Rev 0`);
  if (extra) lines.push(extra);
  return lines;
}

/** Download a titled, headed sheet as a formatted .xlsx workbook. */
export function exportSheet(spec: SheetSpec) {
  downloadBytes(
    `${spec.filename}.xlsx`,
    buildXlsx(buildSheet(spec)),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}
