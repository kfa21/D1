// Datasheet import: parser tolerance and defensive application of the patch.

import { describe, expect, it } from 'vitest';
import { applyDatasheetImport, parseDatasheetResponse } from './datasheetImport';
import { demoProject, newEquipment } from './defaults';
import { computeEquipment } from './engine/compute';

const vessel = () => demoProject().find((e) => e.tag === 'V-101')!;

describe('parseDatasheetResponse', () => {
  it('parses bare JSON', () => {
    const r = parseDatasheetResponse('{"patch":{"designPressure":25},"derived":["P = 395 psi / 14.5038 ≈ 27 → 25"]}');
    expect(r.patch.designPressure).toBe(25);
    expect(r.derived).toHaveLength(1);
    expect(r.missing).toEqual([]);
  });

  it('parses fenced JSON embedded in prose', () => {
    const text = 'Here is the result:\n```json\n{"patch":{"designTemp":200},"missing":["MDMT not stated"],"notes":"ok"}\n```';
    const r = parseDatasheetResponse(text);
    expect(r.patch.designTemp).toBe(200);
    expect(r.missing).toEqual(['MDMT not stated']);
    expect(r.notes).toBe('ok');
  });

  it('throws a clear error on non-JSON replies', () => {
    expect(() => parseDatasheetResponse('sorry, I cannot read this scan')).toThrow(/parseable JSON/);
    expect(() => parseDatasheetResponse('[1,2,3]')).toThrow(/not an object/);
  });
});

describe('applyDatasheetImport', () => {
  it('fills scalars, sections, nozzles and tank extras; keeps everything else', () => {
    const v = vessel();
    const imp = parseDatasheetResponse(
      JSON.stringify({
        patch: {
          designPressure: 25,
          designTemp: 200,
          mdmt: -20,
          corrosionAllowance: 3,
          materialKey: 'sa-516-70', // case-insensitive
          rtCategory: 'spot',
          orientation: 'horizontal',
          sections: [{ dia: 2600, ttLength: 8000, headTop: '2:1 Ellipsoidal', headBottom: 'F&D', shellThk: 0 }],
          nozzles: [
            { tag: 'N1', service: 'Feed inlet', dn: 150, flangeClass: 300, elevation: 4000 },
            { tag: 'N9', service: 'Spare', dn: 50, elevation: 2000 },
          ],
        },
        derived: ['design P from hydro 32.5 bar / 1.3 = 25 bar g'],
        missing: ['MDMT not on datasheet'],
      })
    );
    const before = JSON.parse(JSON.stringify(v));
    const res = applyDatasheetImport(v, imp);

    // applied scalars
    expect(res.equip.designPressure).toBe(25);
    expect(res.equip.designTemp).toBe(200);
    expect(res.equip.mdmt).toBe(-20);
    expect(res.equip.corrosionAllowance).toBe(3);
    expect(res.equip.materialKey).toBe('SA-516-70');
    expect(res.equip.rtCategory).toBe('spot');
    // sections: head aliases mapped, shell spec t kept (0 = auto)
    expect(res.equip.sections[0].dia).toBe(2600);
    expect(res.equip.sections[0].ttLength).toBe(8000);
    expect(res.equip.sections[0].headTop).toBe('ellip2');
    expect(res.equip.sections[0].headBottom).toBe('toriFD');
    expect(res.equip.sections[0].shellThk).toBe(0);
    // nozzle merge by tag + a brand-new nozzle
    expect(res.equip.nozzles[0].dn).toBe(150);
    expect(res.equip.nozzles[0].flangeClass).toBe(300);
    expect(res.equip.nozzles[0].service).toBe('Feed inlet');
    const created = res.equip.nozzles.find((n) => n.tag === 'N9')!;
    expect(created).toBeDefined();
    expect(created.id).toMatch(/^nz/);
    expect(created.dn).toBe(50);
    expect(created.elevation).toBe(2000);
    expect(created.sectionId).toBe(res.equip.sections[0].id);
    // change log is complete and readable
    const fields = res.changes.map((c) => c.field);
    expect(fields).toContain('designPressure (bar g)');
    expect(fields).toContain('sections[0].dia (mm)');
    expect(fields).toContain('nozzle N9 (new)');
    expect(res.skipped).toEqual([]);
    // untouched input is not mutated (pure)
    expect(v).toEqual(before);
  });

  it('rejects out-of-range and unknown values instead of applying them', () => {
    const v = vessel();
    const imp = parseDatasheetResponse(
      JSON.stringify({
        patch: {
          designPressure: -5, // invalid
          materialKey: 'UNOBTAINIUM', // unknown
          rtCategory: '4.2', // bad enum
          sections: [{ dia: 5 }, { dia: 'abc' }], // out of range / bad type
          // dn matches the current value so only the bad flange class is judged
          nozzles: [{ tag: 'N1', dn: v.nozzles[0].dn, flangeClass: 17 }],
        },
      })
    );
    const res = applyDatasheetImport(v, imp);
    expect(res.equip.designPressure).toBe(v.designPressure);
    expect(res.equip.materialKey).toBe(v.materialKey);
    expect(res.equip.rtCategory).toBe(v.rtCategory);
    expect(res.equip.sections[0].dia).toBe(v.sections[0].dia);
    expect(res.equip.nozzles[0].flangeClass).toBe(v.nozzles[0].flangeClass);
    expect(res.changes).toEqual([]);
    expect(res.skipped).toContain('sections[0].dia');
    // the demo vessel has a single section — the second patch entry is reported
    expect(res.skipped.some((s) => s.startsWith('sections[1]'))).toBe(true);
    expect(res.skipped).toContain('nozzle N1.flangeClass');
  });

  it('leaves the record valid for the engine after a realistic import', () => {
    const tk = newEquipment('tank', 41);
    const imp = parseDatasheetResponse(
      JSON.stringify({
        patch: {
          designPressure: 0.5,
          designTemp: 90,
          materialKey: 'SA-516-60',
          tank: { fluidName: 'Diesel', specificGravity: 0.82, roofType: 'cone', maxDesignLiquidLevel: 12000, bottomThk: 8 },
          sections: [{ dia: 30000, ttLength: 14000 }],
        },
        derived: [],
        missing: [],
      })
    );
    const res = applyDatasheetImport(tk, imp);
    expect(res.equip.tank!.fluidName).toBe('Diesel');
    expect(res.equip.tank!.specificGravity).toBe(0.82);
    expect(res.equip.tank!.maxDesignLiquidLevel).toBe(12000);
    const calc = computeEquipment(res.equip);
    expect(Number.isFinite(calc.weightDryKg)).toBe(true);
    expect(calc.warnings.every((w) => w.msg && w.code)).toBe(true);
  });

  it('reports stated values that already match as verified, separately from real changes', () => {
    const v = vessel();
    const imp = parseDatasheetResponse(
      JSON.stringify({
        patch: {
          designPressure: v.designPressure + 4, // a real change
          designTemp: v.designTemp, // stated and already correct
          corrosionAllowance: v.corrosionAllowance, // stated and already correct
          sections: [{ dia: v.sections[0].dia, ttLength: v.sections[0].ttLength + 500 }],
        },
      })
    );
    const res = applyDatasheetImport(v, imp);

    expect(res.changes.map((c) => c.field)).toEqual(['designPressure (bar g)', 'sections[0].ttLength (mm)']);
    expect(res.unchanged).toContain('designTemp (°C)');
    expect(res.unchanged).toContain('corrosionAllowance (mm)');
    expect(res.unchanged).toContain('sections[0].dia (mm)');
    // an unchanged value is never written: the record is untouched there
    expect(res.equip.designTemp).toBe(v.designTemp);
    expect(res.equip.corrosionAllowance).toBe(v.corrosionAllowance);
  });

  it('ignores a tank patch on a non-tank tag', () => {
    const v = vessel();
    const res = applyDatasheetImport(v, { patch: { tank: { fluidName: 'X' } }, derived: [], missing: [] });
    expect(res.equip.tank).toBeUndefined();
    expect(res.skipped).toContain('tank (tag is not a tank)');
  });
});
