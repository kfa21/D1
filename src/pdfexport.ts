// Generated PDF export — a real .pdf file (not print-to-PDF), for the two
// engineering deliverables the roadmap calls out: the per-tag datasheet and
// the bill of quantities / procurement plan.
//
// jsPDF is imported on demand, so the library never lands in the initial
// bundle — the browser only downloads it when a user actually exports
// (same pattern as the lazy 3D viewer). The existing print-to-PDF buttons in
// print.ts still produce styled HTML printouts of any screen; this module is
// the structured, tabulated document.
//
// Reporting units: values are formatted through reportUnits(), so an imperial
// project issues the same documents in in · psi · °F · lb. All maths stays SI.

import type { jsPDF as JsPDFInstance } from 'jspdf';
import type { BOMItem, Equipment, EquipmentCalc } from './engine/types';
import type { PlateProcurementLine } from './engine/plates';
import { getMat } from './engine/materials';
import { reportUnits, unitModeLabel, UnitMode } from './engine/reportUnits';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 186 mm
const ROW_H = 5;
const FONT = 7.4;

export interface DocMeta {
  projectName: string;
  clientName?: string;
  units: UnitMode;
}

type PdfDoc = JsPDFInstance;

type Sheet = {
  doc: PdfDoc;
  y: number;
};

/** jsPDF is pulled in on demand so it never lands in the initial bundle. */
async function loadJsPDF(): Promise<{ new (opts: Record<string, unknown>): PdfDoc }> {
  const mod = await import('jspdf');
  return mod.jsPDF as unknown as { new (opts: Record<string, unknown>): PdfDoc };
}

async function newSheet(title: string): Promise<Sheet> {
  const JsPDFCtor = await loadJsPDF();
  const doc = new JsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title, creator: 'Static Equipment Designer' });
  return { doc, y: MARGIN };
}

function ensureSpace(s: Sheet, h: number) {
  if (s.y + h <= PAGE_H - MARGIN - 6) return;
  s.doc.addPage();
  s.y = MARGIN + 4;
}

function heading(s: Sheet, text: string) {
  ensureSpace(s, 12);
  s.y += 4;
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(10);
  s.doc.setTextColor(20, 40, 70);
  s.doc.text(text, MARGIN, s.y);
  s.doc.setDrawColor(120, 140, 170);
  s.doc.setLineWidth(0.3);
  s.doc.line(MARGIN, s.y + 1.4, MARGIN + CONTENT_W, s.y + 1.4);
  s.doc.setTextColor(0, 0, 0);
  s.y += 6;
}

function header(s: Sheet, meta: DocMeta, title: string, subtitle: string) {
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(15);
  s.doc.setTextColor(20, 40, 70);
  s.doc.text(title, MARGIN, s.y + 7);
  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(8);
  s.doc.setTextColor(90, 90, 90);
  s.doc.text(`${meta.projectName}${meta.clientName ? ` · Client: ${meta.clientName}` : ''}`, MARGIN, s.y + 12);
  s.doc.text(subtitle, MARGIN, s.y + 16);
  s.doc.text(`Units: ${unitModeLabel(meta.units)} · ${new Date().toLocaleString()}`, MARGIN, s.y + 20);
  s.doc.setDrawColor(120, 140, 170);
  s.doc.setLineWidth(0.5);
  s.doc.line(MARGIN, s.y + 23, MARGIN + CONTENT_W, s.y + 23);
  s.doc.setTextColor(0, 0, 0);
  s.y += 29;
}

/** Label/value block, two pairs per row. */
function keyValues(s: Sheet, pairs: [string, string][]) {
  s.doc.setFontSize(FONT);
  const colW = CONTENT_W / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    ensureSpace(s, ROW_H);
    for (let j = 0; j < 2; j++) {
      const p = pairs[i + j];
      if (!p) continue;
      const x = MARGIN + j * colW;
      s.doc.setFont('helvetica', 'normal');
      s.doc.setTextColor(110, 110, 110);
      s.doc.text(p[0], x, s.y);
      s.doc.setFont('helvetica', 'bold');
      s.doc.setTextColor(0, 0, 0);
      s.doc.text(String(p[1]).slice(0, 58), x + 42, s.y);
    }
    s.y += ROW_H;
  }
  s.y += 1;
}

interface Col {
  head: string;
  w: number;
  right?: boolean;
}

/** Tabulated block with a repeated header and page breaks. */
function table(s: Sheet, cols: Col[], rows: string[][]) {
  const drawHeader = () => {
    ensureSpace(s, ROW_H + 2);
    s.doc.setFont('helvetica', 'bold');
    s.doc.setFontSize(FONT - 0.4);
    s.doc.setFillColor(233, 238, 246);
    s.doc.rect(MARGIN, s.y - 3.6, CONTENT_W, ROW_H, 'F');
    let x = MARGIN;
    for (const c of cols) {
      s.doc.setTextColor(20, 40, 70);
      s.doc.text(c.head, c.right ? x + c.w - 1.5 : x + 1.5, s.y, { align: c.right ? 'right' : 'left' });
      x += c.w;
    }
    s.doc.setTextColor(0, 0, 0);
    s.y += ROW_H;
  };
  drawHeader();
  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(FONT);
  for (const row of rows) {
    if (s.y > PAGE_H - MARGIN - 6) {
      s.doc.addPage();
      s.y = MARGIN + 4;
      drawHeader();
      s.doc.setFont('helvetica', 'normal');
      s.doc.setFontSize(FONT);
    }
    let x = MARGIN;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const text = String(row[i] ?? '');
      const clipped = s.doc.splitTextToSize(text, c.w - 2)[0] ?? '';
      s.doc.text(clipped, c.right ? x + c.w - 1.5 : x + 1.5, s.y, { align: c.right ? 'right' : 'left' });
      x += c.w;
    }
    s.doc.setDrawColor(215, 218, 222);
    s.doc.setLineWidth(0.1);
    s.doc.line(MARGIN, s.y + 1.4, MARGIN + CONTENT_W, s.y + 1.4);
    s.y += ROW_H;
  }
  s.y += 2;
}

function notes(s: Sheet, items: { level: string; code: string; msg: string }[]) {
  s.doc.setFontSize(FONT - 0.4);
  for (const w of items) {
    const lines: string[] = s.doc.splitTextToSize(`[${w.code}] ${w.msg}`, CONTENT_W - 2);
    ensureSpace(s, lines.length * 3.6 + 2);
    s.doc.setFont('helvetica', 'bold');
    s.doc.setTextColor(w.level === 'error' ? 170 : w.level === 'warning' ? 150 : 90, 40, 40);
    s.doc.text(`${w.level.toUpperCase()} ${w.code}`, MARGIN, s.y);
    s.doc.setFont('helvetica', 'normal');
    s.doc.setTextColor(60, 60, 60);
    for (const line of lines) {
      s.doc.text(line, MARGIN + 22, s.y);
      s.y += 3.6;
    }
    s.doc.setTextColor(0, 0, 0);
    s.y += 0.8;
  }
  s.y += 1;
}

function footers(doc: PdfDoc, label: string) {
  const pages = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.text(label, MARGIN, PAGE_H - 7);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
  }
}

/** Datasheet PDF for one tag. */
export async function buildDatasheetPdf(equip: Equipment, calc: EquipmentCalc, meta: DocMeta): Promise<PdfDoc> {
  const u = reportUnits(meta.units);
  const L = u.labels;
  const s = await newSheet(`${equip.tag} datasheet`);
  header(
    s,
    meta,
    `EQUIPMENT DATASHEET — ${equip.tag}`,
    `${equip.name} · ${equip.equipType.toUpperCase()} · ${calc.codeRef} · Rev 0`
  );

  heading(s, 'Design conditions');
  keyValues(s, [
    ['Design pressure', `${u.press(equip.designPressure)} ${L.press}`],
    ['Design temperature', `${u.temp(equip.designTemp)} ${L.temp}`],
    ['MAWP (corroded)', `${u.press(calc.mawpBar)} ${L.press}`],
    ['External / vacuum', `${u.press(equip.externalPressure)} ${L.press}`],
    ['MDMT', `${u.temp(equip.mdmt)} ${L.temp}`],
    ['Corrosion allowance', `${u.len(equip.corrosionAllowance, 2)} ${L.len}`],
    ['Material', calc.materialName],
    ['Allowable S @ T', `${u.stress(calc.sAllow)} ${L.stress}`],
    ['Joint efficiency E', calc.weldEfficiency.toFixed(2)],
    ['Hydrotest (top/bot)', `${u.press(calc.hydroTestBar)} / ${u.press(calc.hydroTestBottomBar)} ${L.press}`],
    ['Dry / operating mass', `${u.mass(calc.weightDryKg)} / ${u.mass(calc.weightOperatingKg)} ${L.mass}`],
    ['Volume / paint area', `${u.vol(calc.internalVolumeM3)} ${L.vol} · ${u.area(calc.paintAreaM2)} ${L.area}`],
    ['RT category', equip.rtCategory.toUpperCase()],
    ['Inspection level', equip.inspectionLevel],
  ]);

  heading(s, 'Shell sections');
  table(
    s,
    [
      { head: 'Sec', w: 10 },
      { head: `ID (${L.len})`, w: 18, right: true },
      { head: `T-T (${L.len})`, w: 18, right: true },
      { head: `t req (${L.len})`, w: 18, right: true },
      { head: `t + CA (${L.len})`, w: 20, right: true },
      { head: `t nom (${L.len})`, w: 18, right: true },
      { head: `t corr (${L.len})`, w: 18, right: true },
      { head: `MAWP h/l (${L.press})`, w: 28, right: true },
      { head: 'Util %', w: 14, right: true },
      { head: 'Governing', w: 42 },
    ],
    calc.sections.map((sec, i) => [
      String(i + 1),
      u.len(sec.spec.dia, 1),
      u.len(sec.spec.ttLength, 0),
      u.len(sec.tReq, 2),
      u.len(sec.tMinNominal, 2),
      u.len(sec.tNominal, 2),
      u.len(sec.tCorroded, 2),
      `${u.press(sec.mawpHoop, 1)} / ${u.press(sec.mawpLong, 1)}`,
      (sec.utilization * 100).toFixed(0),
      sec.governing,
    ])
  );

  const heads = calc.sections.flatMap((sec, i) =>
    [sec.headTop, sec.headBot].filter(Boolean).map((h, j) => ({ h: h!, i, pos: j === 0 ? 'Top' : 'Bottom' }))
  );
  if (heads.length) {
    heading(s, 'Dish ends');
    table(
      s,
      [
        { head: 'Sec', w: 10 },
        { head: 'Position', w: 20 },
        { head: 'Type', w: 20 },
        { head: `Crown R (${L.len})`, w: 22, right: true },
        { head: `Knuckle R (${L.len})`, w: 22, right: true },
        { head: `t req (${L.len})`, w: 18, right: true },
        { head: `t nom (${L.len})`, w: 18, right: true },
        { head: `Blank Ø (${L.len})`, w: 22, right: true },
        { head: `MAWP (${L.press})`, w: 34, right: true },
      ],
      heads.map((x) => [
        String(x.i + 1),
        x.pos,
        x.h.type,
        u.len(x.h.crownR, 1),
        u.len(x.h.knuckleR, 1),
        u.len(x.h.tReq, 2),
        u.len(x.h.tMinNominal, 2),
        u.len(x.h.blankDia, 0),
        u.press(x.h.mawp, 1),
      ])
    );
  }

  if (calc.nozzles.length) {
    heading(s, 'Nozzle reinforcement & flange rating');
    table(
      s,
      [
        { head: 'Tag', w: 14 },
        { head: 'Service', w: 40 },
        { head: 'DN', w: 12, right: true },
        { head: 'Schedule / class', w: 24 },
        { head: 'Material', w: 28 },
        { head: `t req (${L.len})`, w: 18, right: true },
        { head: `t nom (${L.len})`, w: 18, right: true },
        { head: 'Reinforce', w: 16 },
        { head: 'Flange', w: 16 },
      ],
      calc.nozzles.map((n) => [
        n.spec.tag,
        n.spec.service,
        String(n.spec.dn),
        `${n.spec.schKey} / Cl ${n.spec.flangeClass}`,
        getMat(n.spec.flangeMatKey)?.name ?? n.spec.flangeMatKey,
        u.len(n.trn, 2),
        u.len(n.wall, 2),
        n.reinforceOK ? 'OK' : 'SHORT',
        n.flangeClassOK ? 'OK' : 'CHECK',
      ])
    );
  }

  if (calc.saddle) {
    heading(s, 'Saddle supports (Zick)');
    keyValues(s, [
      ['Reaction / saddle', `${fmtNum(calc.saddle.reaction)} kN`],
      ['Saddle width b₀', `${u.len(calc.saddle.saddleWidthMm, 0)} ${L.len}`],
      ['Zick horn S3 / allow', `${fmtNum(calc.saddle.zickFc, 1)} / ${fmtNum(calc.saddle.zickAllow, 1)} ${L.stress}`],
      ['Horn membrane / bend', `${fmtNum(calc.saddle.hornMembraneMPa, 1)} / ${fmtNum(calc.saddle.hornBendingMPa, 1)} ${L.stress}`],
      ['Tangential shear', `${fmtNum(calc.saddle.shearMPa, 1)} / ${fmtNum(calc.saddle.shearAllowMPa, 1)} ${L.stress}`],
      ['Longitudinal / comp', `${fmtNum(calc.saddle.longStressMPa, 1)} / ${fmtNum(calc.saddle.longCompMPa, 1)} ${L.stress}`],
      ['K2 / K3 (120°)', `${fmtNum(calc.saddle.k2, 3)} / ${fmtNum(calc.saddle.k3, 3)}`],
      ['Utilisation', calc.saddle.ok ? 'OK' : 'REVIEW'],
    ]);
  }

  if (calc.ring) {
    heading(s, 'External-pressure stiffening ring');
    const sec = calc.ring.section;
    keyValues(s, [
      ['Effective shell (each side)', `${u.len(calc.ring.effectiveWidthMm, 1)} ${L.len}`],
      ['Unsupported length L', `${u.len(calc.ring.lengthMm, 0)} ${L.len}`],
      ['Required I (ring alone)', `${u.inertia(calc.ring.reqRingMm4)} ${L.len}⁴`],
      ['Required I′ (combined)', `${u.inertia(calc.ring.reqCombinedMm4)} ${L.len}⁴`],
      ['Available I′ (combined)', sec ? `${u.inertia(sec.inertiaMm4)} ${L.len}⁴` : 'no ring section drawn'],
      ['Section modulus Z', sec ? `${fmtNum(sec.sectionModulusMm3, 0)} ${L.len}³` : '—'],
      ['Extreme fibre c', sec ? `${u.len(sec.cMm, 1)} ${L.len}` : '—'],
      ['Check', sec ? (calc.ring.ok ? 'OK' : 'SHORT') : 'not drawn'],
    ]);
    s.doc.setFontSize(6.8);
    s.doc.setTextColor(90, 90, 90);
    for (const line of s.doc.splitTextToSize(calc.ring.basis, CONTENT_W)) {
      s.doc.text(line, MARGIN, s.y);
      s.y += 3.4;
    }
    s.doc.setTextColor(0, 0, 0);
    s.y += 1;
  }

  if (calc.warnings.length) {
    heading(s, `Warnings & advisories (${calc.warnings.length})`);
    notes(s, calc.warnings);
  }

  footers(s.doc, `${meta.projectName} · ${equip.tag} datasheet · preliminary — verify against the licensed code edition`);
  return s.doc;
}

function fmtNum(v: number | undefined | null, dp = 2): string {
  if (v === undefined || v === null || !isFinite(v)) return '—';
  return v.toFixed(dp);
}

export interface BoqInput {
  meta: DocMeta;
  items: BOMItem[];
  lines: PlateProcurementLine[];
  /** formatted money for a plate line cost (base currency, display currency applied) */
  formatCost: (base: number) => string;
  totalCostText: string;
}

/** Bill of quantities + plate procurement PDF for the whole project. */
export async function buildBoqPdf(input: BoqInput): Promise<PdfDoc> {
  const u = reportUnits(input.meta.units);
  const L = u.labels;
  const s = await newSheet('BOQ');
  header(s, input.meta, 'BILL OF QUANTITIES & PROCUREMENT', `${input.items.length} BOM lines · ${input.lines.length} plate nesting lines`);

  const totalMass = input.items.reduce((a, i) => a + i.massKg, 0);
  heading(s, 'Summary');
  keyValues(s, [
    ['BOM lines', String(input.items.length)],
    ['Total mass', `${u.mass(totalMass)} ${L.mass}`],
    ['Plate lines', String(input.lines.length)],
    ['Plate material cost', input.totalCostText],
  ]);

  heading(s, 'Bill of materials');
  table(
    s,
    [
      { head: 'Tag', w: 14 },
      { head: 'Category', w: 20 },
      { head: 'Item', w: 44 },
      { head: 'Spec', w: 38 },
      { head: 'Material', w: 30 },
      { head: 'Qty', w: 14, right: true },
      { head: 'Unit', w: 10 },
      { head: `Mass (${L.mass})`, w: 16, right: true },
    ],
    input.items.map((i) => [
      i.tag,
      i.category,
      i.item,
      i.spec,
      getMat(i.material)?.name ?? i.material,
      // only mass-denominated quantities follow the unit mode; counts and
      // lengths are dimensionless or stay in the internal unit system
      i.unit === 'kg' ? u.mass(i.qty, 1).replace(/,/g, '') : fmtNum(i.qty, 1),
      i.unit,
      u.mass(i.massKg, 0),
    ])
  );

  if (input.lines.length) {
    heading(s, 'Plate procurement plan');
    table(
      s,
      [
        { head: 'Part', w: 30 },
        { head: 'Material', w: 24 },
        { head: `Req t (${L.len})`, w: 12, right: true },
        { head: `Stock (${L.len})`, w: 14, right: true },
        { head: `Part W×L (${L.len})`, w: 22, right: true },
        { head: 'Parts', w: 12, right: true },
        { head: `Plate W×L (${L.len})`, w: 22, right: true },
        { head: 'Plates', w: 12, right: true },
        { head: 'Waste %', w: 12, right: true },
        { head: `Mass (${L.mass})`, w: 12, right: true },
        { head: 'Cost', w: 16, right: true },
      ],
      input.lines.map((l) => [
        l.id.split('|')[0],
        getMat(l.material)?.name ?? l.material,
        u.len(l.thkRequested, 1),
        String(l.thkStock),
        `${u.len(l.partW, 0)}×${u.len(l.partL, 0)}`,
        String(l.partCount),
        `${u.len(l.plateW, 0)}×${u.len(l.plateL, 0)}`,
        String(l.platesNeeded),
        fmtNum(l.wastagePct, 1),
        u.mass(l.massKg, 0),
        input.formatCost(l.estimatedCostUSD),
      ])
    );
  }

  footers(s.doc, `${input.meta.projectName} · BOQ / MTO · preliminary — verify against the licensed code edition`);
  return s.doc;
}

function save(doc: PdfDoc, filename: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Build and download the datasheet PDF (jsPDF loaded on demand). */
export async function exportDatasheetPdf(equip: Equipment, calc: EquipmentCalc, meta: DocMeta) {
  const doc = await buildDatasheetPdf(equip, calc, meta);
  save(doc, `${equip.tag}_datasheet.pdf`);
}

/** Build and download the BOQ PDF (jsPDF loaded on demand). */
export async function exportBoqPdf(input: BoqInput) {
  const doc = await buildBoqPdf(input);
  save(doc, `${input.meta.projectName.replace(/[^\w.-]+/g, '_')}_BOQ.pdf`);
}
