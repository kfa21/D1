// Datasheet → tag auto-fill (AI integration).
//
// Gemini reads the attached client datasheet (PDF/image) and returns a JSON
// patch; this module parses that response and applies it to an Equipment
// record purely and defensively — unknown keys, bad types and out-of-range
// values are skipped and reported, never applied. Everything the engine can
// calculate (thicknesses, MAWP, weights…) is deliberately NOT part of the
// patch: after the inputs land, computeEquipment derives them.

import type { Equipment, HeadType, NozzleKind, NozzleSpec, Orientation, RtCategory, SectionSpec, TankSpec } from './engine/types';
import { MATERIALS } from './engine/materials';
import { uid } from './engine/units';

export interface DatasheetPatch {
  tag?: string;
  name?: string;
  orientation?: Orientation;
  designPressure?: number; // bar g
  designTemp?: number; // °C
  mdmt?: number; // °C
  externalPressure?: number; // bar
  corrosionAllowance?: number; // mm
  materialKey?: string;
  rtCategory?: RtCategory;
  /** main shell first: inside dia, tan-to-tan length, head forms, spec t (0 = auto) */
  sections?: Partial<Pick<SectionSpec, 'dia' | 'ttLength' | 'headTop' | 'headBottom' | 'shellThk' | 'headThkTop' | 'headThkBot'>>[];
  nozzles?: Partial<Pick<NozzleSpec, 'tag' | 'service' | 'dn' | 'flangeClass' | 'elevation' | 'azimuth' | 'kind'>>[];
  tank?: Partial<Pick<TankSpec, 'fluidName' | 'specificGravity' | 'roofType' | 'maxDesignLiquidLevel' | 'bottomThk'>>;
}

export interface DatasheetImport {
  patch: DatasheetPatch;
  /** values the model DERIVED from stated data — shown to the user for audit */
  derived: string[];
  /** datasheet items it could not map — left unchanged */
  missing: string[];
  notes?: string;
}

export interface AppliedChange {
  /** dotted path of the field that changed */
  field: string;
  from: string;
  to: string;
}

export interface ApplyResult {
  equip: Equipment;
  changes: AppliedChange[];
  /** values rejected by validation (bad type / out of range / unknown enum) */
  skipped: string[];
}

/** System instruction for the fill-from-datasheet call. */
export const IMPORT_PROMPT = `You are a datasheet-extraction engine for a static equipment design suite (ASME VIII / API 650 / API 661 / TEMA).
You receive the CURRENT field values of one equipment tag plus an attached client datasheet (PDF or image). Produce a JSON patch that fills the tag's fields from the datasheet.

Strict rules:
1. Only report values STATED on the datasheet. Never invent a value.
2. Derive a missing required input ONLY from other stated values using the relations below, and list every derivation in "derived" with its arithmetic. If a field is neither stated nor derivable, omit it and list it in "missing".
   - design pressure P (bar g) from a hydrotest pressure: P = hydro / 1.3 (UG-99 factor), rounded sensibly.
   - design temperature = the stated maximum design/operating temperature.
   - MDMT = the stated minimum design metal temperature (omit if absent).
   - corrosion allowance: only when the datasheet states it (or a CA + service life); otherwise omit so the app keeps its current value.
   - shell/head CONE thicknesses and MAWP: NEVER patch — the engine calculates them (spec t 0 = auto). Stated thicknesses go into "missing" as informational only.
3. Units: lengths mm, pressure bar g, temperature °C. Convert psi -> bar (/14.5038), degF -> degC, in -> mm (x25.4), ft -> mm (x304.8) and record the conversion in "derived".
4. sections[0] is the main shell: dia = inside diameter (mm), ttLength = tan-to-tan (mm).
5. nozzles are matched by tag; dn = nominal bore (mm).
6. headTop/headBottom must be exactly one of "ellip2", "toriFD", "toriD", "hemi", "none" ("2:1 ellipsoidal" -> ellip2, "F&D / torispherical" -> toriFD, "spherical / hemispherical" -> hemi, "flat" -> none).
7. orientation: "vertical" | "horizontal". rtCategory: "full" | "spot" | "none". materialKey: an ASME key such as SA-516-70.
8. If a stated value contradicts the CURRENT value, the datasheet wins — put it in the patch.
9. Sanity bounds: designPressure 0-1000 bar, designTemp -273..1500 °C, corrosionAllowance 0-50 mm, dia 50-200000 mm, ttLength 0-400000 mm, dn 6-4000 mm, elevation >= 0, flangeClass one of 150/300/600/900/1500/2500.

Respond ONLY with JSON:
{"patch":{...},"derived":["design P = 395 psi / 14.5038 = 27.2 -> 27 bar g"],"missing":["nozzle N4 not listed on the datasheet"],"notes":"optional summary"}`;

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const ORIENTATIONS: Orientation[] = ['vertical', 'horizontal'];
const RT_CATEGORIES: RtCategory[] = ['full', 'spot', 'none'];
const FLANGE_CLASSES = [150, 300, 600, 900, 1500, 2500];
const NOZZLE_KINDS: NozzleKind[] = ['process', 'vent', 'drain', 'instrument', 'manway', 'safety', 'safetyRelief', 'spare', 'support'];
const ROOF_TYPES = ['cone', 'dome', 'internalFloating', 'externalFloating'] as const;

/** datasheet head wording → HeadType (normalised: lowercase, alphanumerics only) */
const HEAD_TABLE: Record<string, HeadType> = {
  ellip2: 'ellip2', ellipsoidal: 'ellip2', '21ellipsoidal': 'ellip2', '21ellip': 'ellip2', e2: 'ellip2',
  torifd: 'toriFD', torispherical: 'toriFD', '21torispherical': 'toriFD', fd: 'toriFD', fandd: 'toriFD', fdishe: 'toriFD',
  torid: 'toriD', ddish: 'toriD', '21d': 'toriD',
  hemi: 'hemi', hemispherical: 'hemi', spherical: 'hemi',
  '21ellipsoidalhead': 'ellip2', '21dished': 'ellip2',
  'torisphericalfd': 'toriFD', 'torisphericalfdhead': 'toriFD', 'fandishhead': 'toriFD',
  none: 'none', flat: 'none', flathead: 'none', blank: 'none',
};

function normHead(v: unknown): HeadType | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (s in HEAD_TABLE) return HEAD_TABLE[s];
  return HEAD_TABLE[s.toLowerCase().replace(/[^a-z0-9]/g, '')];
}

function normMaterial(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const exact = MATERIALS.find((m) => m.key === s);
  if (exact) return exact.key;
  const ci = MATERIALS.find((m) => m.key.toLowerCase() === s.toLowerCase());
  if (ci) return ci.key;
  // tolerate "SA-516 Gr.70" style names
  const loose = MATERIALS.find((m) => m.key.toLowerCase().replace(/[^a-z0-9]/g, '') === s.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return loose?.key;
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Parse the model's reply into a DatasheetImport (tolerates fences/prose). */
export function parseDatasheetResponse(text: string): DatasheetImport {
  let t = (text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    throw new Error('The model did not return parseable JSON — try again or pick another model in Settings.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('The model returned JSON that is not an object — try again.');
  }
  const o = obj as Record<string, unknown>;
  const patch = o.patch && typeof o.patch === 'object' && !Array.isArray(o.patch) ? (o.patch as DatasheetPatch) : {};
  return {
    patch,
    derived: strArr(o.derived),
    missing: strArr(o.missing),
    notes: str(o.notes),
  };
}

const fmtNum = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v ?? '—'));

/** Apply a parsed import to an equipment record. Pure — returns a new record. */
export function applyDatasheetImport(equip: Equipment, imp: DatasheetImport): ApplyResult {
  const next: Equipment = JSON.parse(JSON.stringify(equip)) as Equipment;
  const changes: AppliedChange[] = [];
  const skipped: string[] = [];
  const p = imp.patch ?? {};

  const put = (field: string, current: unknown, value: unknown, accept: boolean) => {
    if (!accept || value === undefined) return;
    if (JSON.stringify(current) === JSON.stringify(value)) return;
    changes.push({ field, from: fmtNum(current), to: fmtNum(value) });
  };

  // ---- tag-level scalars ----
  const tag = str(p.tag);
  put('tag', equip.tag, tag, tag !== undefined);
  if (tag) next.tag = tag;
  const name = str(p.name);
  put('name', equip.name, name, name !== undefined);
  if (name) next.name = name;

  const orient = ORIENTATIONS.includes(p.orientation as Orientation) ? (p.orientation as Orientation) : undefined;
  put('orientation', equip.orientation, orient, orient !== undefined);
  if (orient) next.orientation = orient;

  const dp = num(p.designPressure);
  const dpOk = dp !== undefined && dp >= 0 && dp <= 1000;
  put('designPressure (bar g)', equip.designPressure, dp, dpOk);
  if (dpOk && dp !== undefined) next.designPressure = dp;

  const dt = num(p.designTemp);
  const dtOk = dt !== undefined && dt >= -273 && dt <= 1500;
  put('designTemp (°C)', equip.designTemp, dt, dtOk);
  if (dtOk && dt !== undefined) next.designTemp = dt;

  const mdmt = num(p.mdmt);
  const mdmtOk = mdmt !== undefined && mdmt >= -273 && mdmt <= 1500;
  put('mdmt (°C)', equip.mdmt, mdmt, mdmtOk);
  if (mdmtOk && mdmt !== undefined) next.mdmt = mdmt;

  const ep = num(p.externalPressure);
  const epOk = ep !== undefined && ep >= 0 && ep <= 1000;
  put('externalPressure (bar)', equip.externalPressure, ep, epOk);
  if (epOk && ep !== undefined) next.externalPressure = ep;

  const ca = num(p.corrosionAllowance);
  const caOk = ca !== undefined && ca >= 0 && ca <= 50;
  put('corrosionAllowance (mm)', equip.corrosionAllowance, ca, caOk);
  if (caOk && ca !== undefined) next.corrosionAllowance = ca;

  const mat = normMaterial(p.materialKey);
  put('materialKey', equip.materialKey, mat, mat !== undefined);
  if (mat) next.materialKey = mat;

  const rt = RT_CATEGORIES.includes(p.rtCategory as RtCategory) ? (p.rtCategory as RtCategory) : undefined;
  put('rtCategory', equip.rtCategory, rt, rt !== undefined);
  if (rt) next.rtCategory = rt;

  // ---- sections ----
  if (Array.isArray(p.sections)) {
    p.sections.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      if (i >= next.sections.length) {
        skipped.push(`sections[${i}] — the tag has ${next.sections.length} section(s)`);
        return;
      }
      const cur = next.sections[i];
      const dia = num(s.dia);
      if (dia !== undefined && dia >= 50 && dia <= 200000) {
        put(`sections[${i}].dia (mm)`, cur.dia, dia, true);
        cur.dia = dia;
      } else if (s.dia !== undefined) skipped.push(`sections[${i}].dia`);
      const tt = num(s.ttLength);
      if (tt !== undefined && tt >= 0 && tt <= 400000) {
        put(`sections[${i}].ttLength (mm)`, cur.ttLength, tt, true);
        cur.ttLength = tt;
      } else if (s.ttLength !== undefined) skipped.push(`sections[${i}].ttLength`);
      const hTop = normHead(s.headTop);
      if (hTop) {
        put(`sections[${i}].headTop`, cur.headTop, hTop, true);
        cur.headTop = hTop;
      } else if (s.headTop !== undefined) skipped.push(`sections[${i}].headTop`);
      const hBot = normHead(s.headBottom);
      if (hBot) {
        put(`sections[${i}].headBottom`, cur.headBottom, hBot, true);
        cur.headBottom = hBot;
      } else if (s.headBottom !== undefined) skipped.push(`sections[${i}].headBottom`);
      // stated nominal thicknesses: accepted (0/valid ≥ 0 means "spec t")
      for (const k of ['shellThk', 'headThkTop', 'headThkBot'] as const) {
        const v = num(s[k]);
        if (v !== undefined && v >= 0 && v <= 400) {
          put(`sections[${i}].${k} (mm)`, cur[k], v, true);
          cur[k] = v;
        } else if (s[k] !== undefined) skipped.push(`sections[${i}].${k}`);
      }
    });
  }

  // ---- nozzles: merge by tag, create unknown tags ----
  if (Array.isArray(p.nozzles)) {
    for (const nz of p.nozzles) {
      if (!nz || typeof nz !== 'object') continue;
      const tagN = str(nz.tag);
      const dn = num(nz.dn);
      if (!tagN) {
        skipped.push('nozzle without a tag');
        continue;
      }
      if (dn === undefined || dn < 6 || dn > 4000) {
        skipped.push(`nozzle ${tagN}: dn`);
        continue;
      }
      const flangeClass = num(nz.flangeClass);
      const fc = flangeClass !== undefined && FLANGE_CLASSES.includes(flangeClass) ? (flangeClass as NozzleSpec['flangeClass']) : undefined;
      const elev = num(nz.elevation);
      const azim = num(nz.azimuth);
      const kind = NOZZLE_KINDS.includes(nz.kind as NozzleKind) ? (nz.kind as NozzleKind) : undefined;
      const service = str(nz.service);

      const existing = next.nozzles.find((n) => n.tag.toLowerCase() === tagN.toLowerCase());
      if (existing) {
        put(`nozzle ${tagN}.dn (mm)`, existing.dn, dn, true);
        existing.dn = dn;
        if (fc !== undefined) {
          put(`nozzle ${tagN}.flangeClass`, existing.flangeClass, fc, true);
          existing.flangeClass = fc;
        } else if (nz.flangeClass !== undefined) skipped.push(`nozzle ${tagN}.flangeClass`);
        if (elev !== undefined && elev >= 0) {
          put(`nozzle ${tagN}.elevation (mm)`, existing.elevation, elev, true);
          existing.elevation = elev;
        } else if (nz.elevation !== undefined) skipped.push(`nozzle ${tagN}.elevation`);
        if (azim !== undefined && azim >= 0 && azim <= 360) {
          put(`nozzle ${tagN}.azimuth (°)`, existing.azimuth, azim, true);
          existing.azimuth = azim;
        } else if (nz.azimuth !== undefined) skipped.push(`nozzle ${tagN}.azimuth`);
        if (service) {
          put(`nozzle ${tagN}.service`, existing.service, service, true);
          existing.service = service;
        }
        if (kind) {
          put(`nozzle ${tagN}.kind`, existing.kind, kind, true);
          existing.kind = kind;
        }
      } else {
        const created: NozzleSpec = {
          id: uid('nz'),
          tag: tagN,
          service: service ?? '',
          dn,
          schKey: '40',
          sectionId: next.sections[0]?.id ?? '',
          elevation: elev !== undefined && elev >= 0 ? elev : 500,
          azimuth: azim !== undefined && azim >= 0 && azim <= 360 ? azim : 0,
          kind: kind ?? 'process',
          flangeClass: fc ?? 150,
          flangeMatKey: 'SA-105',
          padDia: 0,
          padThk: 0,
          projOutside: 120,
        };
        next.nozzles.push(created);
        changes.push({ field: `nozzle ${tagN} (new)`, from: '—', to: `DN${dn} @ ${created.elevation} mm, Cl ${created.flangeClass}` });
      }
    }
  }

  // ---- tank extras ----
  if (p.tank && next.tank) {
    const t = next.tank;
    const fluid = str(p.tank.fluidName);
    if (fluid) {
      put('tank.fluidName', t.fluidName, fluid, true);
      t.fluidName = fluid;
    }
    const sg = num(p.tank.specificGravity);
    if (sg !== undefined && sg > 0 && sg <= 5) {
      put('tank.specificGravity', t.specificGravity, sg, true);
      t.specificGravity = sg;
    } else if (p.tank.specificGravity !== undefined) skipped.push('tank.specificGravity');
    const roof = ROOF_TYPES.includes(p.tank.roofType as (typeof ROOF_TYPES)[number]) ? (p.tank.roofType as TankSpec['roofType']) : undefined;
    if (roof) {
      put('tank.roofType', t.roofType, roof, true);
      t.roofType = roof;
    } else if (p.tank.roofType !== undefined) skipped.push('tank.roofType');
    const lvl = num(p.tank.maxDesignLiquidLevel);
    if (lvl !== undefined && lvl >= 0 && lvl <= 400000) {
      put('tank.maxDesignLiquidLevel (mm)', t.maxDesignLiquidLevel, lvl, true);
      t.maxDesignLiquidLevel = lvl;
    } else if (p.tank.maxDesignLiquidLevel !== undefined) skipped.push('tank.maxDesignLiquidLevel');
    const bt = num(p.tank.bottomThk);
    if (bt !== undefined && bt >= 0 && bt <= 200) {
      put('tank.bottomThk (mm)', t.bottomThk, bt, true);
      t.bottomThk = bt;
    } else if (p.tank.bottomThk !== undefined) skipped.push('tank.bottomThk');
  } else if (p.tank && !next.tank) {
    skipped.push('tank (tag is not a tank)');
  }

  return { equip: next, changes, skipped };
}
