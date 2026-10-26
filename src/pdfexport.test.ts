// Golden tests for the reporting-unit layer (B10) and the generated PDF
// exporters (B9). The PDF checks are smoke-level (bytes + pages) because the
// documents are binary; the numbers inside them come from the same formatters
// that are pinned here.

import { describe, expect, it } from 'vitest';
import { reportUnits, unitModeLabel } from './engine/reportUnits';
import { buildBoqPdf, buildDatasheetPdf } from './pdfexport';
import { computeEquipment } from './engine/compute';
import { demoProject } from './defaults';
import { generateBOM, buildProcurement } from './engine/bom';
import { DEFAULT_PLATE_STOCK } from './engine/plates';
import { defaultSettings } from './store';

describe('reportUnits — metric is identity, imperial converts at the edge', () => {
  const si = reportUnits('metric');
  const imp = reportUnits('imperial');

  it('metric leaves every value untouched', () => {
    expect(si.len(1234.5678)).toBe('1,234.57');
    expect(si.press(16)).toBe('16');
    expect(si.temp(-46)).toBe('-46');
    expect(si.stress(154)).toBe('154');
    expect(si.mass(2500)).toBe('2,500');
    expect(si.labels.len).toBe('mm');
  });

  it('imperial conversions are exact', () => {
    expect(imp.lenNum(25.4)).toBeCloseTo(1, 9); // mm → in
    expect(imp.len(25.4)).toBe('1.000'); // 3 dp minimum for inches
    expect(imp.press(1)).toBe('14.5'); // bar → psi (14.5038)
    expect(imp.temp(0)).toBe('32'); // °C → °F
    expect(imp.temp(100)).toBe('212');
    expect(imp.stress(1)).toBe('145'); // MPa → psi (145.04)
    expect(imp.massNum(1)).toBeCloseTo(2.20462262, 6); // kg → lb
    expect(imp.area(1)).toBe('10.8'); // m² → ft² (10.7639)
    expect(imp.vol(1)).toBe('35.3'); // m³ → ft³ (35.3147)
    expect(imp.inertia(Math.pow(25.4, 4))).toBe('1.00'); // mm⁴ → in⁴
    expect(imp.labels.press).toBe('psi');
    expect(unitModeLabel('imperial')).toContain('psi');
  });
});

/** jsPDF writes standard-font text literally, so the raw bytes carry it. */
function pdfText(doc: { output(type: 'arraybuffer'): ArrayBuffer }): string {
  const buf = doc.output('arraybuffer');
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

describe('PDF exporters (B9)', () => {
  const equip = demoProject().find((e) => e.equipType === 'vessel')!;
  const calc = computeEquipment(equip);

  it('datasheet builds a multi-block PDF in metric', async () => {
    const doc = await buildDatasheetPdf(equip, calc, {
      projectName: 'Demo',
      clientName: 'Client',
      units: 'metric',
    });
    const bytes = doc.output('arraybuffer').byteLength;
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(bytes).toBeGreaterThan(4000);
    const text = pdfText(doc);
    expect(text).toContain(equip.tag);
    expect(text).toContain('Design conditions');
    expect(text).toContain('Shell sections');
  });

  it('datasheet renders in imperial units when asked', async () => {
    const doc = await buildDatasheetPdf(equip, calc, {
      projectName: 'Demo',
      units: 'imperial',
    });
    const text = pdfText(doc);
    expect(text).toContain('psi');
    expect(text).toContain('Units: in');
    expect(text).not.toContain('Units: mm');
  });

  it('BOQ builds with BOM lines and procurement nesting', async () => {
    const entries = demoProject().map((e) => ({ equip: e, calc: computeEquipment(e) }));
    const items = entries.flatMap((en) => generateBOM(en.equip, en.calc).items);
    const reqs = entries.flatMap((en) => generateBOM(en.equip, en.calc).plateReqs);
    const proc = buildProcurement(reqs, { stockPlates: DEFAULT_PLATE_STOCK, prices: defaultSettings.rates.prices });
    expect(items.length).toBeGreaterThan(10);

    const doc = await buildBoqPdf({
      meta: { projectName: 'Demo Project', units: 'metric' },
      items,
      lines: proc.lines,
      formatCost: (v) => `${v.toFixed(0)}`,
      totalCostText: 'BHD 0',
    });
    const text = pdfText(doc);
    expect(text).toContain('BILL OF QUANTITIES');
    expect(text).toContain('Bill of materials');
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(4000);
  });
});
