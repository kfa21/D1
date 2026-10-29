// Equipment Register — tabular entry per equipment type with live calculated columns.
// Left block: user inputs (Sr, Tag, Name, Orientation, #Dia, Dia, TT, heads, CA, mat, P, T).
// Right block: calculated (shell/head thickness, MAWP, hydrotest, weight, warnings).

import { useEffect, useMemo, useState } from 'react';
import type { Equipment, EquipType, HeadType, NozzleSpec, NozzleLoads, InternalsSpec, SectionSpec } from '../engine/types';
import { computeEquipment } from '../engine/compute';
import { MATERIALS } from '../engine/materials';
import { NPS_SIZES, PIPES, SCHEDULES, npsLabelForBore } from '../engine/pipes';
import { uid, fmt } from '../engine/units';
import { newEquipment, demoProject } from '../defaults';
import { suggestNdtMethod } from '../engine/ndt';
import { siteAirDensity } from '../engine/api661';
import { API650_STRESSES } from '../engine/api650';
import { recommendStructure } from '../engine/supports';
import { equipmentDims } from '../engine/dims';
import type { CladSpec, NozzleStyle } from '../engine/types';
import { scopeFor } from '../engine/scope';
import { useStore, setState, getStore } from '../store';
import { requestFixFor, subscribeFix, getFix, useFix, FixNote, focusField } from '../fixNav';
import { fieldId, fixFor } from '../fixes';

/** Total tangent-to-tangent length: the sum of the cylindrical section lengths. */
const totalTTMm = (e: Equipment) => e.sections.reduce((s, x) => s + (x.ttLength || 0), 0);

/** Human labels for nozzle kinds (SR = safety relief). */
export const NOZZLE_KIND_LABELS: Record<string, string> = {
  process: 'Process',
  vent: 'Vent / vapour',
  drain: 'Drain',
  instrument: 'Instrument',
  manway: 'Manway',
  safety: 'Safety valve (PSV)',
  safetyRelief: 'SR — safety relief',
  spare: 'Spare',
  support: 'Support / attachment',
};

function defaultClad(): CladSpec {
  return {
    mode: 'none',
    kind: 'weldOverlay',
    materialKey: 'SA-240-316L',
    thicknessMm: 3,
    partialLengthMm: 0,
    note: '',
    // two-layer overlay: 309L buffer run + corrosion-resistant finish layer
    overlay: { baseMatKey: 'SA-240-309L', baseThkMm: 1.5, finishThkMm: 1.5, furnaceHeating: false },
  };
}

/** Cladding defaults for an existing spec that predates the overlay layers. */
function cladWithOverlay(c: CladSpec): CladSpec {
  return {
    ...c,
    overlay: c.overlay ?? { baseMatKey: 'SA-240-309L', baseThkMm: 1.5, finishThkMm: 1.5, furnaceHeating: false },
  };
}

const TYPES: { key: EquipType; label: string }[] = [
  { key: 'vessel', label: 'Pressure Vessels' },
  { key: 'column', label: 'Columns / Towers' },
  { key: 'hx', label: 'Heat Exchangers (TEMA)' },
  { key: 'finfan', label: 'Fin-Fan Coolers (API 661)' },
  { key: 'tank', label: 'Storage Tanks (API 650)' },
];

const HEAD_LABELS: Record<HeadType, string> = {
  ellip2: '2:1 Ellipsoidal',
  toriFD: 'Torispherical F&D',
  toriD: 'Torispherical D',
  hemi: 'Hemispherical',
  none: 'None (flat/BN)',
};

function update(id: string, patch: Partial<Equipment>) {
  setState((s) => ({
    equipment: s.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }));
}

function updateSection(equipId: string, secId: string, patch: Partial<SectionSpec>) {
  const e = getStore().equipment.find((x) => x.id === equipId);
  if (!e) return;
  update(equipId, { sections: e.sections.map((s) => (s.id === secId ? { ...s, ...patch } : s)) });
}

/** 1-based label of the shell course a nozzle sits on — the engine resolves it
 *  from the nozzle elevation against the body layout (not the stored sectionId). */
function courseOf(calc: ReturnType<typeof computeEquipment>, nc: { sectionId: string }): string {
  const i = calc.sections.findIndex((s) => s.spec.id === nc.sectionId);
  return i >= 0 ? `C${i + 1}` : '—';
}

export default function Register() {
  const equipment = useStore((s) => s.equipment);
  const selectedId = useStore((s) => s.selectedEquipId);
  const [typeTab, setTypeTab] = useState<EquipType>('vessel');

  const ensureSeed = () => {
    if (equipment.length === 0) setState({ equipment: demoProject() });
  };

  const rows = useMemo(
    () => equipment.filter((e) => e.equipType === typeTab).map((e) => ({ e, calc: computeEquipment(e) })),
    [equipment, typeTab]
  );

  const addRow = () => {
    const sr = Math.max(0, ...equipment.map((e) => e.srNo)) + 1;
    const eq = newEquipment(typeTab, sr);
    eq.tag = `${typeTab === 'vessel' ? 'V' : typeTab === 'column' ? 'C' : typeTab === 'hx' ? 'E' : typeTab === 'finfan' ? 'AC' : 'TK'}-${100 + sr}`;
    eq.name = 'New Equipment';
    setState((s) => ({ equipment: [...s.equipment, eq], selectedEquipId: eq.id }));
  };

  const delRow = (id: string) => {
    setState((s) => ({
      equipment: s.equipment.filter((e) => e.id !== id),
      selectedEquipId: s.selectedEquipId === id ? null : s.selectedEquipId,
    }));
  };

  const dupRow = (id: string) => {
    const src = getStore().equipment.find((e) => e.id === id);
    if (!src) return;
    const copy: Equipment = JSON.parse(JSON.stringify(src));
    copy.id = uid('eq');
    copy.srNo = Math.max(0, ...getStore().equipment.map((e) => e.srNo)) + 1;
    copy.tag = src.tag + '-COPY';
    // re-issue section ids, keeping every nozzle on the course it came from
    const courseMap = new Map<string, string>();
    copy.sections = copy.sections.map((s) => {
      const nid = uid('sec');
      courseMap.set(s.id, nid);
      return { ...s, id: nid };
    });
    copy.nozzles = copy.nozzles.map((n) => ({
      ...n,
      id: uid('nz'),
      sectionId: courseMap.get(n.sectionId) ?? copy.sections[0]?.id ?? '',
    }));
    setState((s) => ({ equipment: [...s.equipment, copy] }));
  };

  const selected = rows.find((r) => r.e.id === selectedId);

  // Click-to-fix: jump to the tag and type tab that host the offending field
  // (applies on mount too — the request may arrive just as this page opens).
  useEffect(() => {
    const apply = () => {
      const r = getFix();
      if (!r) return;
      const e = getStore().equipment.find((x) => x.id === r.equipId);
      if (!e) return;
      setState((s) => (s.selectedEquipId === e.id ? s : { selectedEquipId: e.id }));
      setTypeTab((prev) => (prev === e.equipType ? prev : e.equipType));
    };
    apply();
    return subscribeFix(apply);
  }, []);

  return (
    <div>
      <div className="tabs">
        {TYPES.map((t) => (
          <button key={t.key} className={typeTab === t.key ? 'active' : ''} onClick={() => setTypeTab(t.key)}>
            {t.label} ({equipment.filter((e) => e.equipType === t.key).length})
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <button className="primary" onClick={addRow}>＋ Add {TYPES.find((t) => t.key === typeTab)?.label.replace(/s$/, '')}</button>
        {equipment.length === 0 && (
          <button onClick={ensureSeed}>Load demo project (5 tags)</button>
        )}
        <span className="muted small">
          Filled fields are editable; blue calculated columns update live. Click a row to open its detailed editor.
        </span>
      </div>

      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Sr.</th>
              <th>Tag No.</th>
              <th>Equipment Name</th>
              <th>Orientation</th>
              <th className="num">#Dia</th>
              <th className="num">Dia (mm)</th>
              <th className="num">T-T total (mm)</th>
              <th className="num" title="Tip-to-tip overall length including cones and dished ends">Overall (mm)</th>
              <th>Dish End (T/B)</th>
              <th className="num">CA (mm)</th>
              <th>Material</th>
              <th className="num">P (bar g)</th>
              <th className="num">T (°C)</th>
              <th className="num grp">t Shell (mm)</th>
              <th className="num grp">t Head (mm)</th>
              <th className="num grp">MAWP (bar)</th>
              <th className="num grp">Test P (bar)</th>
              <th className="num grp">Dry Wt (kg)</th>
              <th className="grp">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, calc }, i) => {
              const sec0 = calc.sections[0];
              const errors = calc.warnings.filter((w) => w.level === 'error').length;
              const warns = calc.warnings.filter((w) => w.level === 'warning').length;
              const tHead = Math.max(sec0?.headTop?.tMinNominal ?? 0, sec0?.headBot?.tMinNominal ?? 0);
              return (
                <tr key={e.id} className={`${selectedId === e.id ? 'selected' : ''} ${errors > 0 ? 'stat-err' : warns > 0 ? 'stat-warn' : 'stat-ok'}`} onClick={() => setState({ selectedEquipId: e.id })} style={{ cursor: 'pointer' }}>
                  <td className="num">{i + 1}</td>
                  <td><input value={e.tag} onChange={(ev) => update(e.id, { tag: ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td><input value={e.name} style={{ minWidth: 150 }} onChange={(ev) => update(e.id, { name: ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td>
                    <select value={e.orientation} onChange={(ev) => update(e.id, { orientation: ev.target.value as never })} onClick={(ev) => ev.stopPropagation()}>
                      <option value="vertical">Vertical</option>
                      <option value="horizontal">Horizontal</option>
                    </select>
                  </td>
                  <td className="num calc">{e.sections.length}</td>
                  <td><input type="number" className="num" value={e.sections[0]?.dia ?? 0} onChange={(ev) => updateSection(e.id, e.sections[0].id, { dia: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td>
                    {e.sections.length > 1 ? (
                      <span className="calc" title="Sum of the section lengths — edit them on the Sections tab">
                        {fmt(totalTTMm(e), 0)}
                      </span>
                    ) : (
                      <input type="number" className="num" value={e.sections[0]?.ttLength ?? 0} onChange={(ev) => updateSection(e.id, e.sections[0].id, { ttLength: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} />
                    )}
                  </td>
                  <td className="num calc" title="Tip-to-tip: sections + cones + dished ends">
                    {fmt(equipmentDims(e, calc).overallMm, 0)}
                  </td>
                  <td>
                    <select
                      value={e.sections[0]?.headTop ?? 'none'}
                      onChange={(ev) => {
                        const ht = ev.target.value as HeadType;
                        update(e.id, { sections: e.sections.map((s, idx) => (idx === 0 ? { ...s, headTop: ht } : s)) });
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {Object.entries(HEAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input type="number" className="num" value={e.corrosionAllowance} onChange={(ev) => update(e.id, { corrosionAllowance: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td>
                    <select value={e.materialKey} onChange={(ev) => update(e.id, { materialKey: ev.target.value })} onClick={(ev) => ev.stopPropagation()} style={{ minWidth: 130 }}>
                      {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </td>
                  <td><input type="number" className="num" value={e.designPressure} onChange={(ev) => update(e.id, { designPressure: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td><input type="number" className="num" value={e.designTemp} onChange={(ev) => update(e.id, { designTemp: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td className="num calc grp">{fmt(sec0?.tNominal, 1)}</td>
                  <td className="num calc grp">{tHead > 0 ? fmt(tHead, 1) : '—'}</td>
                  <td className="num calc grp">{fmt(calc.mawpBar, 2)}</td>
                  <td className="num calc grp">{fmt(calc.hydroTestBar, 2)}</td>
                  <td className="num calc grp">{fmt(calc.weightDryKg, 0)}</td>
                  <td className="grp">
                    {errors > 0 ? <span className="badge err">{errors} err</span> : warns > 0 ? <span className="badge warn">{warns} warn</span> : <span className="badge ok">OK</span>}
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <button className="ghost" title="Duplicate" onClick={() => dupRow(e.id)}>⧉</button>{' '}
                    <button className="ghost danger" title="Delete" onClick={() => delRow(e.id)}>✕</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={19} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No {TYPES.find((t) => t.key === typeTab)?.label.toLowerCase()} yet — click Add to create the first tag.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <DetailEditor key={selected.e.id} equip={selected.e} calc={selected.calc} />}
    </div>
  );
}

/* =============== detail editor =============== */

function DetailEditor({ equip, calc }: { equip: Equipment; calc: ReturnType<typeof computeEquipment> }) {
  // overall dimensions: T-T total, per-section cone length and tip-to-tip length
  const dims = equipmentDims(equip, calc);
  // only the inputs and tabs that this equipment type's code actually uses
  const scope = scopeFor(equip.equipType);
  const tabs = scope.tabs;
  const [tab, setTab] = useState<'general' | 'sections' | 'nozzles' | 'internals' | 'type'>('general');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const fix = useFix();
  const fid = (f: string) => fieldId(equip.id, f);

  // a click-to-fix opens the tab that hosts the field, then scrolls to and focuses it
  useEffect(() => {
    if (fix && fix.equipId === equip.id) setTab(fix.tab);
  }, [fix, equip.id]);
  // a tab can disappear when the type scope says it is not relevant — never leave
  // the editor pointing at a tab that is no longer rendered
  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tabs, tab]);
  useEffect(() => {
    if (!fix || fix.equipId !== equip.id || fix.tab !== tab) return;
    const t = window.setTimeout(() => focusField(fix), 90);
    return () => window.clearTimeout(t);
  }, [fix, tab, equip.id]);

  const addNozzle = () => {
    const n: NozzleSpec = {
      id: uid('nz'), tag: `N${equip.nozzles.length + 1}`, service: '', dn: 50, schKey: '40',
      sectionId: equip.sections[0]?.id ?? '', elevation: 500, azimuth: 0, kind: 'process', style: 'pad',
      flangeClass: 150, flangeMatKey: 'SA-105', padDia: 0, padThk: 0, projOutside: 120,
    };
    update(equip.id, { nozzles: [...equip.nozzles, n] });
  };
  const upNz = (id: string, patch: Partial<NozzleSpec>) =>
    update(equip.id, { nozzles: equip.nozzles.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const addInternal = () => {
    const it: InternalsSpec = {
      id: uid('in'), kind: 'sieveTray', count: 10, spacing: 600,
      bottomElevation: 1500, materialKey: 'SA-240-316L', kgPerM2: 60, note: '',
    };
    update(equip.id, { internals: [...equip.internals, it] });
  };
  const upIn = (id: string, patch: Partial<InternalsSpec>) =>
    update(equip.id, { internals: equip.internals.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  return (
    <div style={{ marginTop: 18 }}>
      <div className="card">
        <h3>
          {equip.tag} — {equip.name} <span className="muted">({calc.codeRef})</span>{' '}
          <span className={`badge ${calc.warnings.some((w) => w.level === 'error') ? 'err' : calc.warnings.some((w) => w.level === 'warning') ? 'warn' : 'ok'}`}>
            {calc.warnings.some((w) => w.level === 'error') ? 'Action required' : calc.warnings.length ? `${calc.warnings.length} advisory` : 'Compliant'}
          </span>
        </h3>

        <div className="tabs">
          {tabs.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'type' ? scope.typeTabLabel : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="grid2">
            <label className="f"><span>Material</span>
              <select id={fid('materialKey')} value={equip.materialKey} onChange={(e) => update(equip.id, { materialKey: e.target.value })}>
                {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
              <FixNote equipId={equip.id} field="materialKey" />
            </label>
            {scope.general.corrosionAllowance && (
              <label className="f"><span>Corrosion allowance (mm)</span>
                <input id={fid('corrosionAllowance')} type="number" value={equip.corrosionAllowance} onChange={(e) => update(equip.id, { corrosionAllowance: +e.target.value })} />
                <FixNote equipId={equip.id} field="corrosionAllowance" />
              </label>
            )}
            <label className="f"><span>Design pressure (bar g)</span>
              <input id={fid('designPressure')} type="number" value={equip.designPressure} onChange={(e) => update(equip.id, { designPressure: +e.target.value })} />
              <FixNote equipId={equip.id} field="designPressure" />
            </label>
            <label className="f"><span>Design temp (°C)</span>
              <input type="number" value={equip.designTemp} onChange={(e) => update(equip.id, { designTemp: +e.target.value })} />
            </label>
            {scope.general.mdmt && (
              <label className="f"><span>MDMT (°C)</span>
                <input id={fid('mdmt')} type="number" value={equip.mdmt} onChange={(e) => update(equip.id, { mdmt: +e.target.value })} />
                <FixNote equipId={equip.id} field="mdmt" />
              </label>
            )}
            {scope.general.externalPressure && (
              <label className="f"><span>External / vacuum press (bar)</span>
                <input id={fid('externalPressure')} type="number" step="0.05" value={equip.externalPressure} onChange={(e) => update(equip.id, { externalPressure: +e.target.value })} />
                <FixNote equipId={equip.id} field="externalPressure" />
              </label>
            )}
            {scope.general.rtCategory && (
              <label className="f"><span>RT category (UW-11)</span>
                <select value={equip.rtCategory} onChange={(e) => update(equip.id, { rtCategory: e.target.value as never })}>
                  <option value="full">Full RT (E=1.0)</option>
                  <option value="spot">Spot RT (E=0.85)</option>
                  <option value="none">None (E=0.70)</option>
                </select>
              </label>
            )}
            {scope.general.inspectionLevel && (
              <label className="f"><span>Inspection level</span>
                <select value={equip.inspectionLevel} onChange={(e) => update(equip.id, { inspectionLevel: e.target.value as never })}>
                  <option value="3.1">ASME VIII App. 3.1 (standard)</option>
                  <option value="3.2">ASME VIII App. 3.2 (enhanced)</option>
                </select>
              </label>
            )}
            {scope.general.pwht && (
              <label className="f"><span>PWHT</span>
                <select id={fid('pwhtOverride')} value={equip.pwhtOverride === null ? 'auto' : equip.pwhtOverride ? 'yes' : 'no'} onChange={(e) => update(equip.id, { pwhtOverride: e.target.value === 'auto' ? null : e.target.value === 'yes' })}>
                  <option value="auto">Auto (per UCS-56)</option>
                  <option value="yes">Force PWHT</option>
                  <option value="no">Waive PWHT</option>
                </select>
                <FixNote equipId={equip.id} field="pwhtOverride" />
              </label>
            )}
            {scope.general.testPressureFactor && (
              <label className="f"><span>Test pressure factor (UG-99)</span>
                <input type="number" step="0.05" value={equip.testPressureFactor} onChange={(e) => update(equip.id, { testPressureFactor: +e.target.value })} />
              </label>
            )}
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Notes</span>
              <input value={equip.notes} onChange={(e) => update(equip.id, { notes: e.target.value })} />
            </label>
          </div>
        )}

        {tab === 'general' && scope.designLoads && equip.orientation === 'vertical' && (
          <div style={{ marginTop: 14 }}>
            <h3>Design Loads — anchor-bolt overturning (wind / seismic)</h3>
            <div className="grid2">
              {equip.equipType === 'tank' ? (
                <div className="small muted" style={{ gridColumn: 'span 2' }}>
                  Wind pressure is entered on the Tank data tab — that single value drives both the
                  wind-girder check and the anchor wind case (API 650 §5.11). Sds / R / Ie below feed
                  the seismic anchor case; leave Sds at 0 for wind-only design.
                </div>
              ) : (
                <label className="f"><span>Wind pressure (kPa)</span>
                  <input type="number" step="0.05" value={equip.designLoads?.windPressureKpa ?? 0} onChange={(e) => update(equip.id, { designLoads: { ...(equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 }), windPressureKpa: +e.target.value } })} />
                </label>
              )}
              <label className="f"><span>Seismic Sds (g · 0 = none)</span>
                <input type="number" step="0.05" value={equip.designLoads?.sds ?? 0} onChange={(e) => update(equip.id, { designLoads: { ...(equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 }), sds: +e.target.value } })} />
              </label>
              <label className="f"><span>Seismic R (response mod.)</span>
                <input type="number" step="0.1" value={equip.designLoads?.seismicR ?? 3} onChange={(e) => update(equip.id, { designLoads: { ...(equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 }), seismicR: +e.target.value } })} />
              </label>
              <label className="f"><span>Seismic Ie (importance)</span>
                <input type="number" step="0.05" value={equip.designLoads?.seismicIe ?? 1} onChange={(e) => update(equip.id, { designLoads: { ...(equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 }), seismicIe: +e.target.value } })} />
              </label>
              {calc.bolts && (
                <div className="kpi" style={{ gridColumn: 'span 2' }}>
                  <span className="v">{fmt(calc.bolts.overturnMomentKNm, 0)} kN·m ({calc.bolts.governing}) · A<sub>req</sub> {fmt(calc.bolts.reqArea, 0)} mm²</span>
                  <span className="l">{calc.bolts.count} × M24 on Ø{calc.bolts.boltCircle} — bolt stress {fmt(calc.bolts.boltStressMPa, 1)} / {calc.bolts.boltAllowMPa} MPa (indicative)</span>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'general' && scope.cladding && (
          <div style={{ marginTop: 14 }}>
            <h3>Cladding / Lining</h3>
            <div className="grid2">
              <label className="f"><span>Coverage</span>
                <select id={fid('cladMode')} value={equip.clad?.mode ?? 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), mode: e.target.value as never } })}>
                  <option value="none">None</option>
                  <option value="full">Full length (shell + heads)</option>
                  <option value="partial">Partial length</option>
                </select>
                <FixNote equipId={equip.id} field="cladMode" />
              </label>
              <label className="f"><span>Type</span>
                <select value={equip.clad?.kind ?? 'weldOverlay'} disabled={(equip.clad?.mode ?? 'none') === 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), kind: e.target.value as never } })}>
                  <option value="weldOverlay">Weld overlay (strip/heat band)</option>
                  <option value="explosionBonded">Explosion-bonded clad plate</option>
                  <option value="rollBonded">Roll-bonded clad plate</option>
                  <option value="mechanicalLiner">Mechanical liner (non-pressure)</option>
                </select>
              </label>
              <label className="f"><span>Lining grade</span>
                <select value={equip.clad?.materialKey ?? 'SA-240-316L'} disabled={(equip.clad?.mode ?? 'none') === 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), materialKey: e.target.value } })}>
                  {MATERIALS.filter((m) => m.form === 'plate').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
              </label>
              {equip.clad?.kind === 'weldOverlay' ? (
                <>
                  {/* An overlay is a two-layer build-up: a 309L buffer run so the
                      ferritic base cannot dilute the finish layer, then the
                      corrosion-resistant finish of the specified grade. */}
                  <label className="f"><span>Base (buffer) run grade</span>
                    <select
                      value={equip.clad?.overlay?.baseMatKey ?? 'SA-240-309L'}
                      disabled={(equip.clad?.mode ?? 'none') === 'none'}
                      onChange={(e) =>
                        update(equip.id, {
                          clad: { ...cladWithOverlay(equip.clad ?? defaultClad()), overlay: { ...cladWithOverlay(equip.clad ?? defaultClad()).overlay!, baseMatKey: e.target.value } },
                        })
                      }
                    >
                      {MATERIALS.filter((m) => m.form === 'plate').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </label>
                  <label className="f"><span>Base-run thickness (mm, min 1.5)</span>
                    <input
                      type="number"
                      step="0.5"
                      min={1.5}
                      value={equip.clad?.overlay?.baseThkMm ?? 1.5}
                      disabled={(equip.clad?.mode ?? 'none') === 'none'}
                      onChange={(e) => {
                        const c = cladWithOverlay(equip.clad ?? defaultClad());
                        update(equip.id, { clad: { ...c, overlay: { ...c.overlay!, baseThkMm: +e.target.value } } });
                      }}
                    />
                  </label>
                  <label className="f"><span>Finish-layer thickness (mm, min 1.5)</span>
                    <input
                      type="number"
                      step="0.5"
                      min={1.5}
                      value={equip.clad?.overlay?.finishThkMm ?? 1.5}
                      disabled={(equip.clad?.mode ?? 'none') === 'none'}
                      onChange={(e) => {
                        const c = cladWithOverlay(equip.clad ?? defaultClad());
                        update(equip.id, { clad: { ...c, overlay: { ...c.overlay!, finishThkMm: +e.target.value } } });
                      }}
                    />
                    <FixNote equipId={equip.id} field="cladThk" />
                  </label>
                  <label className="f"><span>Furnace heating after overlay</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        id={fid('cladFurnace')}
                        type="checkbox"
                        checked={!!equip.clad?.overlay?.furnaceHeating}
                        disabled={(equip.clad?.mode ?? 'none') === 'none'}
                        onChange={(e) => {
                          const c = cladWithOverlay(equip.clad ?? defaultClad());
                          update(equip.id, { clad: { ...c, overlay: { ...c.overlay!, furnaceHeating: e.target.checked } } });
                        }}
                      />
                      <span className="small muted">
                        {calc.clad?.overlay
                          ? calc.clad.overlay.furnaceSuggested
                            ? `Suggested — ${calc.clad.overlay.basis}`
                            : 'Not indicated by thickness or base metal'
                          : '—'}
                      </span>
                    </span>
                    <FixNote equipId={equip.id} field="cladFurnace" />
                  </label>
                  <div className="small muted" style={{ gridColumn: 'span 2' }}>
                    Overlay thickness = <strong>{((equip.clad?.overlay?.baseThkMm ?? 1.5) + (equip.clad?.overlay?.finishThkMm ?? 1.5)).toFixed(1)} mm</strong>{' '}
                    (base {(equip.clad?.overlay?.baseThkMm ?? 1.5)} mm + finish {(equip.clad?.overlay?.finishThkMm ?? 1.5)} mm).
                    The base run is deposited on the shell first; the finish layer is the corrosion barrier and takes its
                    grade from “Lining grade” above.
                  </div>
                </>
              ) : (
                <label className="f"><span>Thickness (mm)</span>
                  <input id={fid('cladThk')} type="number" step="0.5" value={equip.clad?.thicknessMm ?? 3} disabled={(equip.clad?.mode ?? 'none') === 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), thicknessMm: +e.target.value } })} />
                  <FixNote equipId={equip.id} field="cladThk" />
                </label>
              )}
              {(equip.clad?.mode ?? 'none') === 'partial' && (
                <label className="f"><span>Covered length from bottom (mm)</span>
                  <input id={fid('cladLength')} type="number" value={equip.clad?.partialLengthMm ?? 0} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), partialLengthMm: +e.target.value } })} />
                  <FixNote equipId={equip.id} field="cladLength" />
                </label>
              )}
              {equip.clad && equip.clad.mode !== 'none' && calc.clad && (
                <div className="kpi" style={{ gridColumn: 'span 2' }}>
                  <span className="v">{fmt(calc.clad.weightKg, 0)} kg · {fmt(calc.clad.areaM2, 1)} m²</span>
                  <span className="l">
                    {calc.clad.overlay
                      ? `${calc.clad.overlay.baseMatName} base ${calc.clad.overlay.baseThkMm} mm (${fmt(calc.clad.overlay.baseWeightKg, 0)} kg) + ${calc.clad.materialName} finish ${calc.clad.overlay.finishThkMm} mm (${fmt(calc.clad.overlay.finishWeightKg, 0)} kg)${equip.clad.overlay?.furnaceHeating ? ' · furnace cycle costed' : ''}`
                      : `${calc.clad.materialName} ${equip.clad.thicknessMm} mm`}
                    {' '}— priced at lining grade $/kg in the estimate
                  </span>
                </div>
              )}
            </div>

          </div>
        )}

        {tab === 'general' && scope.ndtMethod && (
          <div style={{ marginTop: 14 }}>
            <h3>Preferred NDT method</h3>
            <p className="muted small">
              The per-weld NDT plan is derived from the RT category, shell thickness and clad condition — it is shown
              read-only on the Inspection &amp; ITP page and drives estimate costing from there.
            </p>
            {(() => {
              const maxT = Math.max(0, ...calc.sections.map((s) => s.tNominal));
              const sug = suggestNdtMethod(maxT, equip.orientation, !!calc.clad);
              return (
                <div className={`finding ${sug.preferred === 'putTofd' ? 'warning' : ''}`} style={{ marginTop: 8 }}>
                  Preferred method: <strong>{sug.preferred === 'putTofd' ? 'PaUT/TOFD' : 'Conventional RT'}</strong> — {sug.reason}
                </div>
              );
            })()}
          </div>
        )}

        {tab === 'sections' && (
          <div>
            <p className="muted small">
              <b>Total T-T length {fmt(dims.ttMm, 0)} mm</b> — the sum of the section lengths below. Cones add{' '}
              <b>{fmt(dims.coneMm, 0)} mm</b> and the dished ends <b>{fmt(dims.bottomHeadMm + dims.topHeadMm, 0)} mm</b>,
              so the <b>overall {equip.orientation === 'horizontal' ? 'length' : 'height'} is {fmt(dims.overallMm, 0)} mm</b>
              {dims.heightMm !== dims.overallMm ? ` (${fmt(dims.heightMm, 0)} mm on its support above grade)` : ''}. Nozzle
              elevations are measured from the bottom tangent of this total.
            </p>
            <p className="muted small">Multi-dia shells: add sections bottom→top. The cone angle at each section transition is the included angle of the reducing cone.</p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th><th className="num">ID (mm)</th><th className="num">Section L (mm)</th>
                    <th>Top head</th><th>Bottom head</th><th className="num">Spec t shell</th>
                    <th className="num">Cone angle°</th><th className="num grp">Cone L (mm)</th><th className="num">Spec t cone</th>
                    <th className="num grp">Req t (mm)</th><th className="num grp">Nominal</th>
                    <th className="num grp">Util %</th><th className="num grp">Wt (kg)</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {equip.sections.map((s, i) => {
                    const cc = calc.sections[i];
                    return (
                      <tr key={s.id}>
                        <td className="num">{i + 1}</td>
                        <td><input id={fid(`sec${i}-dia`)} type="number" className="num" value={s.dia} onChange={(e) => updateSection(equip.id, s.id, { dia: +e.target.value })} /><FixNote equipId={equip.id} field={`sec${i}-dia`} /></td>
                        <td><input id={fid(`sec${i}-ttLength`)} type="number" className="num" value={s.ttLength} onChange={(e) => updateSection(equip.id, s.id, { ttLength: +e.target.value })} /><FixNote equipId={equip.id} field={`sec${i}-ttLength`} /></td>
                        <td><select id={fid(`sec${i}-headTop`)} value={s.headTop} onChange={(e) => updateSection(equip.id, s.id, { headTop: e.target.value as HeadType })}>
                          {Object.entries(HEAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><FixNote equipId={equip.id} field={`sec${i}-headTop`} /></td>
                        <td><select value={s.headBottom} onChange={(e) => updateSection(equip.id, s.id, { headBottom: e.target.value as HeadType })}>
                          {Object.entries(HEAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                        <td><input id={fid(`sec${i}-shellThk`)} type="number" className="num" value={s.shellThk} placeholder="0=auto" onChange={(e) => updateSection(equip.id, s.id, { shellThk: +e.target.value })} /><FixNote equipId={equip.id} field={`sec${i}-shellThk`} /></td>
                        <td><input id={fid(`sec${i}-coneAngleDeg`)} type="number" className="num" value={s.coneAngleDeg} disabled={i === 0} onChange={(e) => updateSection(equip.id, s.id, { coneAngleDeg: +e.target.value })} /><FixNote equipId={equip.id} field={`sec${i}-coneAngleDeg`} /></td>
                        <td className="num calc" title="Axial length of the cone joining this section to the one below (from the included angle)">
                          {dims.coneLengthsMm[i] > 0 ? fmt(dims.coneLengthsMm[i], 0) : '—'}
                        </td>
                        <td><input id={fid(`sec${i}-coneThk`)} type="number" className="num" value={s.coneThk} onChange={(e) => updateSection(equip.id, s.id, { coneThk: +e.target.value })} /><FixNote equipId={equip.id} field={`sec${i}-coneThk`} /></td>
                        <td className="num calc">{fmt(cc?.tReq, 2)}</td>
                        <td className="num calc">{fmt(cc?.tNominal, 1)}</td>
                        <td className="num calc">{cc ? (cc.utilization * 100).toFixed(0) : '—'}</td>
                        <td className="num calc">{fmt(cc?.weightShellKg, 0)}</td>
                        <td>{equip.sections.length > 1 && (
                          <button className="ghost danger" onClick={() => update(equip.id, { sections: equip.sections.filter((x) => x.id !== s.id) })}>✕</button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => update(equip.id, { sections: [...equip.sections, { id: uid('sec'), dia: equip.sections[equip.sections.length - 1]?.dia ?? 1000, ttLength: 2000, headTop: 'none', headBottom: 'none', shellThk: 0, headThkTop: 0, headThkBot: 0, coneAngleDeg: 0, coneThk: 0 }] })}>
                ＋ Add section (multi-dia)
              </button>
            </div>
          </div>
        )}

        {tab === 'nozzles' && (
          <div>
            <p className="muted small">
              Nozzle neck, reinforcement (UG-32/UG-37) and B16.5 flange rating are verified at design temperature
              automatically. <strong>Attach</strong> places a nozzle on the shell or on <em>either</em> dished end — on a
              head the elevation is measured inward from that head's tangent line and the azimuth around it, and UG-37
              is checked against the head thickness. <strong>Type</strong> selects the neck construction: a set-on neck
              with an <strong>RF pad</strong> (only the pad Ø is an input — the ring thickness is derived from the bore,
              the neck schedule and the shell/head thickness), an <strong>SRN</strong> self-reinforced neck that carries
              reinforcement itself (enter its wall; the engine reports the minimum that closes UG-37, no pad is bought),
              or a <strong>set-in</strong> neck that passes through the shell so the inside projection counts in A<sub>2</sub>.
            </p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Tag</th><th>Service</th><th>Kind</th>
                    <th title="Neck construction and reinforcement: set-on with a ring, self-reinforced (SRN) or set-in">Type</th>
                    <th>Attach</th><th className="num">Bore (NPS)</th><th>Sch</th>
                    <th className="num">Elev (mm)</th>
                    {scope.sections && <th className="num" title="Shell course the nozzle sits on — resolved from its elevation">Course</th>}
                    <th className="num">Azim°</th><th>Flange</th><th>Flange mat</th>
                    {scope.pad && <th className="num">RF pad Ø</th>}
                    {scope.pad && <th className="num" title="Derived from the bore, neck wall and shell thickness for the pad Ø entered">Pad t (auto)</th>}
                    <th className="num grp">Neck t (mm)</th>
                    {scope.reinforcement && <th className="num grp">A req</th>}
                    {scope.reinforcement && <th className="num grp">A prov</th>}
                    <th className="num grp">Rating (bar)</th><th className="grp">Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {equip.nozzles.map((n, i) => {
                    const nc = calc.nozzles[i];
                    return (
                      <tr key={n.id}>
                        <td><input value={n.tag} onChange={(e) => upNz(n.id, { tag: e.target.value })} style={{ width: 64 }} /></td>
                        <td><input value={n.service} onChange={(e) => upNz(n.id, { service: e.target.value })} style={{ width: 110 }} /></td>
                        <td><select value={n.kind} onChange={(e) => upNz(n.id, { kind: e.target.value as never })}>
                          {Object.keys(NOZZLE_KIND_LABELS).map((k) => <option key={k} value={k}>{NOZZLE_KIND_LABELS[k]}</option>)}
                        </select></td>
                        <td>
                          <select
                            id={fid(`nz${i}-style`)}
                            value={n.style ?? 'pad'}
                            onChange={(e) => upNz(n.id, { style: e.target.value as NozzleStyle })}
                            title="Set-on + reinforcing ring, self-reinforced neck (SRN — no pad, the neck carries UG-37), or a neck set through the shell"
                          >
                            <option value="pad">Set-on + RF pad</option>
                            <option value="srn">SRN (self-reinforced)</option>
                            <option value="setIn">Set-in (through shell)</option>
                          </select>
                          <FixNote equipId={equip.id} field={`nz${i}-style`} />
                        </td>
                        <td>
                          <select
                            id={fid(`nz${i}-attach`)}
                            value={n.attach ?? 'shell'}
                            onChange={(e) => upNz(n.id, { attach: e.target.value as 'shell' | 'topHead' | 'bottomHead' })}
                            title="Penetration: shell course, or one of the dished ends"
                          >
                            <option value="shell">Shell</option>
                            <option value="topHead">Top head</option>
                            <option value="bottomHead">Bottom head</option>
                          </select>
                          <FixNote equipId={equip.id} field={`nz${i}-attach`} />
                        </td>
                        <td>
                          <select id={fid(`nz${i}-dn`)} className="num" value={n.dn} onChange={(e) => upNz(n.id, { dn: +e.target.value })}>
                            {NPS_SIZES.map((o) => (
                              <option key={o.dnMm} value={o.dnMm}>
                                {o.nps} · {o.dnMm} mm
                              </option>
                            ))}
                            {!NPS_SIZES.some((o) => o.dnMm === n.dn) && (
                              <option value={n.dn}>{`${npsLabelForBore(n.dn)} · ${n.dn} mm (custom)`}</option>
                            )}
                          </select>
                          <FixNote equipId={equip.id} field={`nz${i}-dn`} />
                        </td>
                        <td><select value={n.schKey} onChange={(e) => upNz(n.id, { schKey: e.target.value })}>
                          {SCHEDULES.map((s) => <option key={s} value={s}>Sch {s}</option>)}
                        </select></td>
                        <td><input id={fid(`nz${i}-elevation`)} type="number" className="num" value={n.elevation} onChange={(e) => upNz(n.id, { elevation: +e.target.value })} /><FixNote equipId={equip.id} field={`nz${i}-elevation`} /></td>
                        {scope.sections && (
                          <td className="num calc" title="Course resolved by the engine from the nozzle elevation (bottom tangent = 0)">{nc ? courseOf(calc, nc) : '—'}</td>
                        )}
                        <td><input type="number" className="num" value={n.azimuth} onChange={(e) => upNz(n.id, { azimuth: +e.target.value })} /></td>                        <td><select id={fid(`nz${i}-flangeClass`)} value={n.flangeClass} onChange={(e) => upNz(n.id, { flangeClass: +e.target.value as never })}>
                          {[150, 300, 600, 900, 1500, 2500].map((c) => <option key={c} value={c}>Cl {c0label(c)}</option>)}</select><FixNote equipId={equip.id} field={`nz${i}-flangeClass`} /></td>
                        <td><select value={n.flangeMatKey} onChange={(e) => upNz(n.id, { flangeMatKey: e.target.value })}>
                          {MATERIALS.filter((m) => m.form === 'forging' || m.key === 'SA-105').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                        </select></td>
                        {/* RF pad: the ring THICKNESS is derived from the nozzle bore, its
                            schedule and the shell/head thickness — only the pad OD is an input
                            (setting it rewrites padThk to 0 = auto). An SRN neck carries its
                            own reinforcement, so the ring is not offered at all. */}
                        {scope.pad && (
                          <td>
                            <input
                              id={fid(`nz${i}-padDia`)}
                              type="number"
                              className="num"
                              value={n.style === 'srn' ? 0 : n.padDia}
                              step={10}
                              disabled={n.style === 'srn'}
                              title={
                                n.style === 'srn'
                                  ? 'Self-reinforced neck — no pad; thicken the neck instead'
                                  : `Suggested ${nc?.padDiaSuggested ?? '—'} mm (≈ twice the bore)`
                              }
                              onChange={(e) => upNz(n.id, { padDia: +e.target.value, padThk: 0 })}
                            />
                            <FixNote equipId={equip.id} field={`nz${i}-padDia`} />
                          </td>
                        )}
                        {scope.pad && (
                          <td className="num calc" title="Pad thickness derived by UG-37 for this pad OD — no entry needed">
                            {nc ? (nc.padDiaUsed > 0 ? fmt(nc.padThkUsed, 1) : '—') : '—'}
                          </td>
                        )}
                        <td className={n.style === 'srn' ? '' : 'num calc'} title={n.style === 'srn' ? 'Self-reinforced neck wall — enter the forged neck thickness; the engine checks that it closes UG-37 without a pad' : 'Nominal neck wall from the schedule' }>
                          {n.style === 'srn' ? (
                            <>
                              <input
                                id={fid(`nz${i}-neckThk`)}
                                type="number"
                                step={0.5}
                                className="num"
                                style={{ width: 72 }}
                                value={n.neckThkMm ?? 0}
                                placeholder="sch"
                                onChange={(e) => upNz(n.id, { neckThkMm: +e.target.value })}
                              />
                              <FixNote equipId={equip.id} field={`nz${i}-neckThk`} />
                              {nc && nc.srnNeckThkRequired > 0 && (
                                <div className="small" style={{ color: 'var(--err, #b4232a)' }}>
                                  needs ≥ {nc.srnNeckThkRequired.toFixed(1)}
                                </div>
                              )}
                            </>
                          ) : nc ? (
                            fmt(nc.wall, 2)
                          ) : (
                            '—'
                          )}
                        </td>
                        {scope.reinforcement && <td className="num calc">{nc ? nc.Areq.toFixed(0) : '—'}</td>}
                        {scope.reinforcement && <td className="num calc">{nc ? nc.Aprov.toFixed(0) : '—'}</td>}
                        <td className="num calc">{nc ? fmt(nc.flangeRating, 0) : '—'}</td>
                        <td>{nc && (nc.reinforceOK && nc.flangeClassOK && nc.neckOK && (nc.load?.ok ?? true)
                          ? <span className="badge ok">OK</span>
                          : <span className="badge err">{!nc.neckOK ? 'neck' : !nc.reinforceOK ? 'reinf' : nc.load && !nc.load.ok ? 'loads' : 'flange'}</span>)}</td>
                        <td><button className="ghost danger" onClick={() => update(equip.id, { nozzles: equip.nozzles.filter((x) => x.id !== n.id) })}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}><button onClick={addNozzle}>＋ Add nozzle</button></div>
            {scope.localLoads && equip.nozzles.length > 0 && (
              <div style={{ marginTop: 16, border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 12 }}>
                <h4 style={{ margin: '0 0 4px' }}>Local loads — WRC 107 screening</h4>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Optional piping/external loads at the nozzle–shell junction, in nozzle local axes (fx axial,
                  fy/fz transverse shear, mx torsion, my/mz overturning). Shell shear uses the exact WRC 107
                  equations, the neck check is nominal, and the B16.5 flange rating is verified against design +
                  Kellogg equivalent pressure. Full curve-based WRC 107/537 shell stresses require the licensed
                  bulletin — this is a screening (NL-01), allowable 1.5·S.
                </p>
                <div className="grid2">
                  {equip.nozzles.map((n, i) => {
                    const lc = calc.nozzles[i]?.load;
                    const l = n.loads;
                    const set = (patch: Partial<NozzleLoads>) =>
                      upNz(n.id, { loads: { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...l, ...patch } });
                    const fields = [
                      ['fx', 'Fx axial (kN)'], ['fy', 'Fy shear (kN)'], ['fz', 'Fz shear (kN)'],
                      ['mx', 'Mx torsion (kN·m)'], ['my', 'My overturn (kN·m)'], ['mz', 'Mz overturn (kN·m)'],
                    ] as const;
                    return (
                      <div key={n.id} style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <strong className="small">{n.tag}{n.service ? ` · ${n.service}` : ''}</strong>
                          {lc ? (
                            <span className={`badge ${lc.ok ? 'ok' : 'err'}`}>
                              util {(lc.util * 100).toFixed(0)}% · Pe {lc.equivPressureBar.toFixed(1)} bar
                            </span>
                          ) : (
                            <span className="muted small">no loads</span>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 4, marginTop: 6 }}>
                          {fields.map(([k, label]) => (
                            <label key={k} className="small" style={{ display: 'block' }}>
                              <span className="muted">{label}</span>
                              <input
                                type="number"
                                step="0.1"
                                value={l?.[k] ?? 0}
                                onChange={(e) => set({ [k]: +e.target.value } as unknown as Partial<NozzleLoads>)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'internals' && (
          <div>
            <p className="muted small">Trays, packing and other internals for columns/vessels — weights flow into BOM, MTO and man-hours.</p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr><th>Type</th><th>Scope</th><th className="num">Count</th><th className="num">Spacing (mm)</th><th className="num">Bottom elev (mm)</th><th>Material</th><th className="num">kg/m²</th><th className="num grp">Weight (kg)</th><th>Note</th><th></th></tr>
                </thead>
                <tbody>
                  {equip.internals.map((it, i) => (
                    <tr key={it.id}>
                      <td><select value={it.kind} onChange={(e) => upIn(it.id, { kind: e.target.value as never })}>
                        {['sieveTray', 'valveTray', 'bubbleCapTray', 'randomPacking', 'structuredPacking', 'demister', 'distributor', 'collector', 'chimneyTray', 'supportRing'].map((k) => <option key={k} value={k}>{internalsLabelLocal(k)}</option>)}
                      </select></td>
                      <td>
                        <select
                          value={it.supplied === false ? 'ring' : 'full'}
                          title="Support-ring only: the tray/bed rings are welded in, but no trays, decks or packing are supplied"
                          onChange={(e) => upIn(it.id, { supplied: e.target.value === 'full' ? undefined : false })}
                        >
                          <option value="full">Supply &amp; install</option>
                          <option value="ring">Support ring only (TSR)</option>
                        </select>
                      </td>
                      <td><input type="number" className="num" value={it.count} onChange={(e) => upIn(it.id, { count: +e.target.value })} /></td>
                      <td><input type="number" className="num" value={it.spacing} onChange={(e) => upIn(it.id, { spacing: +e.target.value })} /></td>
                      <td><input type="number" className="num" value={it.bottomElevation} onChange={(e) => upIn(it.id, { bottomElevation: +e.target.value })} /></td>
                      <td className="small">
                        {it.kind === 'supportRing' && equip.clad && equip.clad.mode !== 'none' ? (
                          <>
                            <select value={it.ringMaterialKey ?? equip.clad.materialKey} onChange={(e) => upIn(it.id, { ringMaterialKey: e.target.value })}>
                              {MATERIALS.filter((m) => m.form === 'plate').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                            </select>
                            <div className="small muted" title="A support ring inside the clad zone is welded with the clad final-layer grade">
                              clad final layer
                            </div>
                          </>
                        ) : (
                          <select value={it.materialKey} onChange={(e) => upIn(it.id, { materialKey: e.target.value })}>
                            {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td><input type="number" className="num" value={it.kgPerM2} onChange={(e) => upIn(it.id, { kgPerM2: +e.target.value })} /></td>
                      <td className="num calc">{fmt(internalsWeightLocal(equip, i), 0)}</td>
                      <td><input value={it.note} onChange={(e) => upIn(it.id, { note: e.target.value })} style={{ width: 140 }} /></td>
                      <td><button className="ghost danger" onClick={() => update(equip.id, { internals: equip.internals.filter((x) => x.id !== it.id) })}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}><button onClick={addInternal}>＋ Add internals</button></div>
          </div>
        )}

        {tab === 'type' && equip.equipType === 'hx' && equip.hx && <HxEqEditor equip={equip} calc={calc} />}
        {tab === 'type' && equip.equipType === 'tank' && equip.tank && <TankEqEditor equip={equip} calc={calc} />}
        {tab === 'type' && equip.equipType === 'finfan' && equip.finfan && <FinFanEqEditor equip={equip} calc={calc} />}
        {tab === 'type' && <SupportEditor equip={equip} />}

        {calc.warnings.length > 0 && (
          <>
            <hr className="sep" />
            <p className="muted small" style={{ marginTop: 0 }}>
              Click a finding to jump to the field that needs correcting — its correction hint appears below that field.
            </p>
            {calc.warnings.map((w, i) => {
              const fx = fixFor(w.code);
              return (
                <div
                  key={i}
                  className={`finding ${w.level} clickable`}
                  title="Click to go to the field to correct"
                  onClick={() => {
                    setOpenCode(w.code);
                    requestFixFor(equip.id, w.code);
                  }}
                >
                  [{w.level.toUpperCase()}] {w.code}: {w.msg}
                  {openCode === w.code && fx && (
                    <div className="fix-inline">→ {fx.suggest}</div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function c0label(c: number) { return c; }

function internalsLabelLocal(k: string): string {
  if (k === 'supportRing') return 'Tray / bed support ring (TSR)';
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function internalsWeightLocal(equip: Equipment, idx: number): number {
  const it = equip.internals[idx];
  if (it.supplied === false) return 0; // support-ring-only scope: nothing supplied
  const D = equip.sections[0]?.dia ?? 1000;
  const area = (Math.PI / 4) * Math.pow((D - 150) / 1000, 2);
  return it.count * area * it.kgPerM2;
}

/* ---- type-specific editors ---- */

function SupportEditor({ equip }: { equip: Equipment }) {
  const s = equip.support;
  const calc = computeEquipment(equip);
  const rec = recommendStructure(equip, calc);
  const sup = calc.supports;
  const fid = (f: string) => fieldId(equip.id, f);
  const p = (patch: Partial<Equipment['support']>) => update(equip.id, { support: { ...s, ...patch } });
  return (
    <div style={{ marginTop: 14 }}>
      <h3>Supports — every type selectable, each calculated separately (hours · material · cost)</h3>
      <div className="grid2">
        <label className="f"><span>Primary support type</span>
          <select id={fid('supType')} value={s.type} onChange={(e) => p({ type: e.target.value as never })}>
            <optgroup label="Legs (vertical vessels)">
              <option value="legs">Legs — plate post</option>
              <option value="legsAngle">Legs — angle section</option>
              <option value="legsBeam">Legs — rolled beam</option>
            </optgroup>
            <optgroup label="Saddles (horizontal vessels / HX)">
              <option value="saddle">Saddles</option>
            </optgroup>
            <optgroup label="Skirts (columns / vertical vessels)">
              <option value="skirt">Skirt — cylindrical</option>
              <option value="skirtCone">Skirt — conical</option>
              <option value="angleSkirt">Angle skirt (rolled angle ring)</option>
              <option value="bodyAngleSkirt">Body angle skirt (angle on the shell)</option>
            </optgroup>
            <optgroup label="Base">
              <option value="ring">Base ring</option>
              <option value="none">None</option>
            </optgroup>
          </select>
          <FixNote equipId={equip.id} field="supType" />
        </label>
        <label className="f"><span>{(s.type === 'legs' || s.type === 'legsAngle' || s.type === 'legsBeam') ? 'Leg count' : s.type === 'saddle' ? 'Saddle count' : 'Count'}</span>
          <input type="number" value={s.legCount} onChange={(e) => p({ legCount: +e.target.value })} />
        </label>
        {/* only the fields that belong to the selected support are shown */}
        {(s.type === 'legs' || s.type === 'legsAngle' || s.type === 'legsBeam') && (
          <>
            <label className="f"><span>Leg height (mm)</span><input type="number" value={s.skirtH} onChange={(e) => p({ skirtH: +e.target.value })} /></label>
            <label className="f"><span>Leg plate t (mm)</span><input type="number" value={s.legPlateThk} onChange={(e) => p({ legPlateThk: +e.target.value })} /></label>
          </>
        )}
        {s.type === 'saddle' && (
          <>
            <label className="f"><span>Saddle span (mm)</span><input id={fid('supSaddleSpan')} type="number" value={s.saddleSpan} onChange={(e) => p({ saddleSpan: +e.target.value })} /><FixNote equipId={equip.id} field="supSaddleSpan" /></label>
            <label className="f"><span>Saddle angle (°)</span><input id={fid('supSaddleAngle')} type="number" value={s.saddleAngle} onChange={(e) => p({ saddleAngle: +e.target.value })} /><FixNote equipId={equip.id} field="supSaddleAngle" /></label>
          </>
        )}
        {(s.type === 'skirt' || s.type === 'skirtCone' || s.type === 'angleSkirt' || s.type === 'bodyAngleSkirt') && (
          <label className="f"><span>Skirt height (mm, 0 = typical)</span><input type="number" value={s.skirtH} onChange={(e) => p({ skirtH: +e.target.value })} /></label>
        )}
        <label className="f"><span>Auxiliary (each costed separately)</span>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="small"><input id={fid('supBaseRing')} type="checkbox" checked={!!s.baseRing} onChange={(e) => p({ baseRing: e.target.checked })} /> Base ring + anchors</label>
            <label className="small"><input type="checkbox" checked={!!s.guyLines} onChange={(e) => p({ guyLines: e.target.checked })} /> Guy-wire derrick</label>
          </span>
          <FixNote equipId={equip.id} field="supBaseRing" />
        </label>
      </div>

      {/* ---- Lifting arrangement: sized, not just a checkbox ------------------- */}
      <h3 style={{ marginTop: 16 }}>Lifting arrangement</h3>
      <div className="grid2">
        <label className="f"><span>Include lifting gear</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={s.lifting?.enabled ?? !!s.padeyes}
              onChange={(e) => p({ lifting: { enabled: e.target.checked, kind: s.lifting?.kind ?? 'lugs', count: s.lifting?.count ?? 0, plateThkMm: s.lifting?.plateThkMm ?? 0, liftFactor: s.lifting?.liftFactor ?? 1, trunnionBoreMm: s.lifting?.trunnionBoreMm ?? 0 } })}
            />
            <span className="small muted">adds lugs/trunnions to the BOM, welds and hours</span>
          </span>
        </label>
        {(s.lifting?.enabled ?? !!s.padeyes) && (
          <>
            <label className="f"><span>Lifting type</span>
              <select value={s.lifting?.kind ?? 'lugs'} onChange={(e) => p({ lifting: { enabled: true, kind: e.target.value as never, count: s.lifting?.count ?? 0, plateThkMm: s.lifting?.plateThkMm ?? 0, liftFactor: s.lifting?.liftFactor ?? 1, trunnionBoreMm: s.lifting?.trunnionBoreMm ?? 0 } })}>
                <option value="lugs">Lifting lugs (vertical lift)</option>
                <option value="trunnion">Trunnions (radial, one per side)</option>
                <option value="trunnionPair">Trunnion pair (horizontal vessel roll)</option>
                <option value="tailLug">Tailing lug (erection tail end)</option>
              </select>
            </label>
            <label className="f"><span>Number (0 = auto)</span>
              <input type="number" value={s.lifting?.count ?? 0} onChange={(e) => p({ lifting: { enabled: true, kind: s.lifting?.kind ?? 'lugs', count: +e.target.value, plateThkMm: s.lifting?.plateThkMm ?? 0, liftFactor: s.lifting?.liftFactor ?? 1, trunnionBoreMm: s.lifting?.trunnionBoreMm ?? 0 } })} />
            </label>
            <label className="f"><span>Lug plate t (mm, 0 = auto)</span>
              <input type="number" value={s.lifting?.plateThkMm ?? 0} onChange={(e) => p({ lifting: { enabled: true, kind: s.lifting?.kind ?? 'lugs', count: s.lifting?.count ?? 0, plateThkMm: +e.target.value, liftFactor: s.lifting?.liftFactor ?? 1, trunnionBoreMm: s.lifting?.trunnionBoreMm ?? 0 } })} />
            </label>
            <label className="f"><span>Lift factor (1.0 dead · 1.5 dynamic)</span>
              <input type="number" step="0.05" value={s.lifting?.liftFactor ?? 1} onChange={(e) => p({ lifting: { enabled: true, kind: s.lifting?.kind ?? 'lugs', count: s.lifting?.count ?? 0, plateThkMm: s.lifting?.plateThkMm ?? 0, liftFactor: +e.target.value, trunnionBoreMm: s.lifting?.trunnionBoreMm ?? 0 } })} />
            </label>
            {(s.lifting?.kind === 'trunnion' || s.lifting?.kind === 'trunnionPair') && (
              <label className="f"><span>Trunnion bore (mm, 0 = auto)</span>
                <input type="number" value={s.lifting?.trunnionBoreMm ?? 0} onChange={(e) => p({ lifting: { enabled: true, kind: s.lifting?.kind ?? 'trunnion', count: s.lifting?.count ?? 0, plateThkMm: s.lifting?.plateThkMm ?? 0, liftFactor: s.lifting?.liftFactor ?? 1, trunnionBoreMm: +e.target.value } })} />
              </label>
            )}
          </>
        )}
      </div>

      {/* ---- Transportation saddles (horizontal equipment only) ----------------- */}
      {equip.orientation === 'horizontal' && (
        <>
          <h3 style={{ marginTop: 16 }}>Transportation saddles</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Shipping saddles are separate from the design saddles: they carry the vessel on the transporter and are
            normally timber cribbing on light drums and a fabricated steel frame on heavy ones.
          </p>
          <div className="grid2">
            <label className="f"><span>Provide transportation saddles</span>
              <input
                type="checkbox"
                checked={!!s.transportSaddle?.enabled}
                onChange={(e) => p({ transportSaddle: { enabled: e.target.checked, kind: s.transportSaddle?.kind ?? 'auto', count: s.transportSaddle?.count ?? 0, includeInPrice: s.transportSaddle?.includeInPrice ?? true } })}
              />
            </label>
            {s.transportSaddle?.enabled && (
              <>
                <label className="f"><span>Type</span>
                  <select value={s.transportSaddle.kind} onChange={(e) => p({ transportSaddle: { ...s.transportSaddle!, kind: e.target.value as never } })}>
                    <option value="auto">Auto — wood under 8 t, steel above</option>
                    <option value="wood">Wooden (hardwood crib + chocks)</option>
                    <option value="metal">Metal (fabricated shipping saddle)</option>
                  </select>
                </label>
                <label className="f"><span>Count (0 = auto)</span>
                  <input type="number" value={s.transportSaddle.count} onChange={(e) => p({ transportSaddle: { ...s.transportSaddle!, count: +e.target.value } })} />
                </label>
                <label className="f"><span>Include in the price</span>
                  <input type="checkbox" checked={s.transportSaddle.includeInPrice} onChange={(e) => p({ transportSaddle: { ...s.transportSaddle!, includeInPrice: e.target.checked } })} />
                </label>
              </>
            )}
          </div>
        </>
      )}
      {sup && sup.items.length > 0 ? (
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="grid">
            <thead><tr><th>Support (separate calc)</th><th className="num">Count</th><th className="num">Weight (kg)</th><th className="num">Weld (m)</th><th className="num">Hours</th><th>Notes</th></tr></thead>
            <tbody>
              {sup.items.map((it) => (
                <tr key={it.kind}>
                  <td>{it.label}</td>
                  <td className="num">{it.count}</td>
                  <td className="num calc">{fmt(it.weightKg, 0)}</td>
                  <td className="num">{fmt(it.weldLenM, 1)}</td>
                  <td className="num calc">{fmt(it.hours, 1)}</td>
                  <td className="small muted">{it.note}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><strong>Total</strong></td><td></td>
              <td className="num"><strong>{fmt(sup.totalWeightKg, 0)}</strong></td><td></td>
              <td className="num"><strong>{fmt(sup.totalHours, 1)}</strong></td>
              <td className="small muted">
                {sup.anchorBolts ? `Anchor bolts: ${sup.anchorBolts.count} × M${sup.anchorBolts.diaMm}` : 'No anchor bolt group'}
              </td>
            </tr></tfoot>
          </table>
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 8 }}>No supports calculated — select a support type above.</p>
      )}

      {calc.saddle && (
        <div className="kpi" style={{ marginTop: 10 }}>
          <span className="v">Zick horn {fmt(calc.saddle.zickFc, 1)}/{fmt(calc.saddle.zickAllow, 1)} · shear {fmt(calc.saddle.shearMPa, 1)}/{fmt(calc.saddle.shearAllowMPa, 1)} · long. {fmt(calc.saddle.longStressMPa, 1)}/{fmt(calc.saddle.longAllowMPa, 1)} MPa {calc.saddle.ok ? <span className="badge ok">OK</span> : <span className="badge err">review</span>}</span>
          <span className="l">{calc.saddle.note} — reaction {fmt(calc.saddle.reaction, 1)} kN/saddle, compressive fibre {fmt(calc.saddle.longCompMPa, 1)} MPa</span>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Structure calculation recommendation {rec.enabled ? <span className="badge ok">selected — in estimate</span> : <span className="badge">not costed</span>}</h3>
      <p className="small">{rec.basis}</p>
      <div className="tablewrap" style={{ marginTop: 6 }}>
        <table className="grid">
          <thead><tr><th>Member</th><th>Section</th><th className="num">Qty</th><th className="num">Length (m)</th><th className="num">kg/m</th><th className="num">Weight (kg)</th></tr></thead>
          <tbody>
            {rec.members.map((m, i) => (
              <tr key={i}><td>{m.label}</td><td className="mono small">{m.section}</td><td className="num">{m.count}</td><td className="num">{fmt(m.lengthM, 2)}</td><td className="num">{m.kgPerM}</td><td className="num calc">{fmt(m.kg, 0)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}><strong>Total — {rec.kind} frame</strong></td><td className="num"><strong>{fmt(rec.weightKg, 0)} kg · {fmt(rec.hours, 1)} h</strong></td></tr></tfoot>
        </table>
      </div>
      <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={!!equip.structure?.enabled}
          onChange={(e) => update(equip.id, { structure: { enabled: e.target.checked, kind: equip.structure?.kind ?? rec.kind } })}
        />{' '}
        Include this structure in hours & material cost
      </label>
    </div>
  );
}

import { HXSpec, TankSpec, FinFanSpec, ShellSideFlow } from '../engine/types';
import { SHELL_ODS } from '../engine/tema';

const EMPTY_SHELL_FLOW: ShellSideFlow = {
  massFlowKgS: 0,
  densityKgM3: 0,
  viscCp: 0,
  cpKjKgK: 0,
  condWmK: 0,
};

/** Shell-side flow inputs: [field, label, step]. */
const SHELL_FLOW_FIELDS: [keyof ShellSideFlow, string, string][] = [
  ['massFlowKgS', 'Shell mass flow (kg/s)', '0.1'],
  ['densityKgM3', 'Shell fluid density (kg/m³)', '1'],
  ['viscCp', 'Shell fluid viscosity (cP)', '0.01'],
  ['viscWallCp', 'Wall viscosity (cP, 0 = bulk)', '0.01'],
  ['cpKjKgK', 'Shell fluid cp (kJ/kg·K)', '0.01'],
  ['condWmK', 'Shell fluid conductivity (W/m·K)', '0.01'],
  ['soundSpeedMs', 'Speed of sound (m/s, 0 = no acoustic check)', '1'],
  ['logDecrement', 'Log decrement δ (0 = 0.1)', '0.01'],
  ['strouhal', 'Strouhal number (0 = 0.2)', '0.01'],
  ['connorsK', 'Connors K (0 = 3.3)', '0.1'],
];

function HxEqEditor({ equip, calc }: { equip: Equipment; calc: ReturnType<typeof computeEquipment> }) {
  const hx = equip.hx!;
  const c = calc.hx;
  const p = (patch: Partial<HXSpec>) => update(equip.id, { hx: { ...hx, ...patch } });
  const fid = (f: string) => fieldId(equip.id, f);
  const joint = hx.tubeJointType ?? 'strengthWelded';
  const jointCount = (c?.tubeCountActual ?? 0) * 2;
  return (
    <div>
      <div className="grid2">
        <label className="f"><span>Tube-to-tubesheet joint</span>
          <select id={fid('hxTubeJoint')} value={joint} onChange={(e) => p({ tubeJointType: e.target.value as never })}>
            <option value="expanded">Strength expanded (rolled only, no weld)</option>
            <option value="strengthWelded">Strength welded + expanded (GTAW cap, then roll)</option>
            <option value="sealWeldExpanded">Seal welded + strength expanded (light GTAW seal, then roll)</option>
            <option value="fullyWelded">Fully welded, both ends (two GTAW passes, no roll)</option>
          </select>
          <FixNote equipId={equip.id} field="hxTubeJoint" />
        </label>
        <label className="f"><span>Tube joint work (derived)</span>
          <b className="small">
            {jointCount > 0 ? `${jointCount} joints (${c!.tubeCountActual} tubes × 2 tubesheets) — ` : '— '}
            {joint === 'expanded'
              ? 'every joint machine-rolled, no weld hours'
              : joint === 'sealWeldExpanded'
              ? 'machine roll + one light GTAW seal pass per joint'
              : joint === 'fullyWelded'
              ? 'two manual GTAW passes per joint, no expansion'
              : 'machine roll + one manual GTAW strength pass per joint'}
          </b>
        </label>
        <label className="f"><span>Tubesheet face cladding</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={hx.tubeSheetClad?.enabled ?? false} onChange={(e) => p({ tubeSheetClad: { enabled: e.target.checked, materialKey: hx.tubeSheetClad?.materialKey ?? 'SA-240-316L', thicknessMm: hx.tubeSheetClad?.thicknessMm ?? 3 } })} />
            <select value={hx.tubeSheetClad?.materialKey ?? 'SA-240-316L'} disabled={!(hx.tubeSheetClad?.enabled)} onChange={(e) => p({ tubeSheetClad: { enabled: hx.tubeSheetClad?.enabled ?? false, materialKey: e.target.value, thicknessMm: hx.tubeSheetClad?.thicknessMm ?? 3 } })} style={{ minWidth: 140 }}>
              {MATERIALS.filter((m) => m.form === 'plate').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
            <input type="number" step="0.5" value={hx.tubeSheetClad?.thicknessMm ?? 3} disabled={!(hx.tubeSheetClad?.enabled)} onChange={(e) => p({ tubeSheetClad: { enabled: hx.tubeSheetClad?.enabled ?? false, materialKey: hx.tubeSheetClad?.materialKey ?? 'SA-240-316L', thicknessMm: +e.target.value } })} style={{ width: 64 }} />
          </span>
          <FixNote equipId={equip.id} field="hxTubeSheetClad" />
        </label>
        <label className="f"><span>TEMA type</span>
          <select value={hx.temaType} onChange={(e) => p({ temaType: e.target.value })}>
            {['BEM', 'BES', 'BEU', 'AEU', 'AEP', 'NEN', 'BKU', 'CKU', 'AFU'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="f"><span>Shell OD (mm, 0=auto)</span><input id={fid('hxShellDiaOD')} type="number" value={hx.shellDiaOD} onChange={(e) => p({ shellDiaOD: +e.target.value })} /><FixNote equipId={equip.id} field="hxShellDiaOD" /></label>
        <label className="f"><span>Tube OD (mm)</span><input type="number" value={hx.tubeOD} onChange={(e) => p({ tubeOD: +e.target.value })} /></label>
        <label className="f"><span>Tube wall (mm)</span><input type="number" step="0.1" value={hx.tubeWall} onChange={(e) => p({ tubeWall: +e.target.value })} /></label>
        <label className="f"><span>Tube length T-T (mm)</span><input type="number" value={hx.tubeLength} onChange={(e) => p({ tubeLength: +e.target.value })} /></label>
        <label className="f"><span>Tube count (0=auto)</span><input id={fid('hxTubeCount')} type="number" value={hx.tubeCount} onChange={(e) => p({ tubeCount: +e.target.value })} /><FixNote equipId={equip.id} field="hxTubeCount" /></label>
        <label className="f"><span>Pitch (mm)</span><input id={fid('hxPitch')} type="number" value={hx.pitch} onChange={(e) => p({ pitch: +e.target.value })} /><FixNote equipId={equip.id} field="hxPitch" /></label>
        <label className="f"><span>Layout angle</span>
          <select value={hx.layoutAngle} onChange={(e) => p({ layoutAngle: +e.target.value as never })}>{[30, 45, 60, 90].map((a) => <option key={a} value={a}>{a}°</option>)}</select>
        </label>
        <label className="f"><span>Baffle type</span>
          <select value={hx.baffleType} onChange={(e) => p({ baffleType: e.target.value as never })}>
            <option value="segmental">Single segmental</option><option value="doubleSeg">Double segmental</option>
            <option value="noTubeInWindow">No tube in window</option><option value="orifice">Orifice</option><option value="single">Single</option>
          </select>
        </label>
        <label className="f"><span>Baffle cut (%)</span><input id={fid('hxBaffleCut')} type="number" value={hx.baffleCut} onChange={(e) => p({ baffleCut: +e.target.value })} /><FixNote equipId={equip.id} field="hxBaffleCut" /></label>
        <label className="f"><span>Baffle spacing (mm, 0=auto)</span><input id={fid('hxBaffleSpacing')} type="number" value={hx.baffleSpacing} onChange={(e) => p({ baffleSpacing: +e.target.value })} /><FixNote equipId={equip.id} field="hxBaffleSpacing" /></label>
        <label className="f"><span>Tube passes</span>
          <select value={hx.passesTube} onChange={(e) => p({ passesTube: +e.target.value as never })}>{[1, 2, 4, 6, 8].map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </label>
        <label className="f"><span>Shell design P (bar)</span><input type="number" value={hx.designPShell} onChange={(e) => p({ designPShell: +e.target.value })} /></label>
        <label className="f"><span>Shell design T (°C)</span><input type="number" value={hx.designTShell} onChange={(e) => p({ designTShell: +e.target.value })} /></label>
        <label className="f"><span>Tube design P (bar)</span><input type="number" value={hx.designPTube} onChange={(e) => p({ designPTube: +e.target.value })} /></label>
        <label className="f"><span>Tube design T (°C)</span><input type="number" value={hx.designTTube} onChange={(e) => p({ designTTube: +e.target.value })} /></label>
        <label className="f"><span>Duty (kW)</span><input type="number" value={hx.dutyKW} onChange={(e) => p({ dutyKW: +e.target.value })} /></label>
        <label className="f"><span>Shell in / out (°C)</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <input type="number" value={hx.tShellIn} onChange={(e) => p({ tShellIn: +e.target.value })} />
            <input type="number" value={hx.tShellOut} onChange={(e) => p({ tShellOut: +e.target.value })} />
          </span>
        </label>
        <label className="f"><span>Tube in / out (°C)</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <input type="number" value={hx.tTubeIn} onChange={(e) => p({ tTubeIn: +e.target.value })} />
            <input type="number" value={hx.tTubeOut} onChange={(e) => p({ tTubeOut: +e.target.value })} />
          </span>
        </label>
        <label className="f"><span>Overall U (W/m²K, 0=auto)</span><input id={fid('hxUOverall')} type="number" value={hx.uOverall} onChange={(e) => p({ uOverall: +e.target.value })} /><FixNote equipId={equip.id} field="hxUOverall" /></label>
        <label className="f"><span>Tube material (tube/pipe grades)</span>
          <select id={fid('hxTubeMatKey')} value={hx.tubeMatKey} onChange={(e) => p({ tubeMatKey: e.target.value })}>{MATERIALS.filter((m) => m.form === 'pipe').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
          <FixNote equipId={equip.id} field="hxTubeMatKey" />
        </label>
        <label className="f"><span>Shell material</span>
          <select value={hx.shellMatKey} onChange={(e) => p({ shellMatKey: e.target.value })}>{MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
        </label>
        <label className="f"><span>Tubesheet material</span>
          <select value={hx.tsMatKey} onChange={(e) => p({ tsMatKey: e.target.value })}>{MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
        </label>
        <label className="f"><span>Baffle material</span>
          <select value={hx.baffleMatKey} onChange={(e) => p({ baffleMatKey: e.target.value })}>{MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
        </label>
        <p className="muted small" style={{ gridColumn: '1 / -1', margin: '10px 0 0' }}>
          <strong>Shell-side flow — Bell–Delaware rating &amp; tube-vibration screen</strong> (enter process data to replace the guidance-only ΔP)
        </p>
        {SHELL_FLOW_FIELDS.map(([key, label, step]) => (
          <label className="f" key={key}>
            <span>{label}</span>
            <input
              id={fid(`shellFlow-${key}`)}
              type="number"
              step={step}
              value={(hx.shellFlow?.[key] as number | undefined) ?? 0}
              onChange={(e) => p({ shellFlow: { ...(hx.shellFlow ?? EMPTY_SHELL_FLOW), [key]: +e.target.value } })}
            />
            <FixNote equipId={equip.id} field={`shellFlow-${key}`} />
          </label>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Available shell ODs (mm): {SHELL_ODS.join(', ')}</p>
    </div>
  );
}

function TankEqEditor({ equip, calc }: { equip: Equipment; calc: ReturnType<typeof computeEquipment> }) {
  const tk = equip.tank!;
  const p = (patch: Partial<TankSpec>) => update(equip.id, { tank: { ...tk, ...patch } });
  const fid = (f: string) => fieldId(equip.id, f);
  const floating = tk.roofType === 'externalFloating' || tk.roofType === 'internalFloating';
  return (
    <div className="grid2">
      <label className="f"><span>Stored fluid</span><input value={tk.fluidName} onChange={(e) => p({ fluidName: e.target.value })} /></label>
      <label className="f"><span>Specific gravity</span><input type="number" step="0.01" value={tk.specificGravity} onChange={(e) => p({ specificGravity: +e.target.value })} /></label>
      <label className="f"><span>Roof type</span>
        <select id={fid('tankRoofType')} value={tk.roofType} onChange={(e) => p({ roofType: e.target.value as never })}>
          <option value="cone">Cone roof</option><option value="dome">Dome roof</option><option value="internalFloating">Internal floating roof</option><option value="externalFloating">External floating roof</option>
        </select>
        <FixNote equipId={equip.id} field="tankRoofType" />
      </label>
      {floating && (
        <label className="f"><span>Primary seal (API 650 §5.8.3)</span>
          <select value={tk.primarySeal ?? 'shoe'} onChange={(e) => p({ primarySeal: e.target.value as never })}>
            <option value="shoe">Shoe-mounted primary seal</option>
            <option value="fabric">Fabric primary seal</option>
            <option value="liquidMounted">Liquid-mounted primary seal</option>
            <option value="doubleContact">Double-contacting shoe seal</option>
            <option value="none">No primary seal</option>
          </select>
        </label>
      )}
      {tk.roofType === 'externalFloating' && (
        <label className="f"><span>Secondary seal</span>
          <select value={tk.secondarySeal ?? 'metal'} onChange={(e) => p({ secondarySeal: e.target.value as never })}>
            <option value="metal">Metal-type secondary seal</option>
            <option value="fabric">Fabric secondary seal</option>
            <option value="panCover">Pan-cover secondary seal</option>
            <option value="none">No secondary seal</option>
          </select>
        </label>
      )}
      {floating && calc.tank && calc.tank.sealWeightKg > 0 && (
        <div className="kpi" style={{ gridColumn: 'span 2' }}>
          <span className="v">{fmt(calc.tank.sealWeightKg, 0)} kg</span>
          <span className="l">Seal assemblies (primary + secondary) — priced as purchased items in BOM & estimate</span>
        </div>
      )}
      <label className="f"><span>Bottom t (mm, 0=auto)</span><input id={fid('tankBottomThk')} type="number" value={tk.bottomThk} onChange={(e) => p({ bottomThk: +e.target.value })} /><FixNote equipId={equip.id} field="tankBottomThk" /></label>
      <label className="f"><span>Roof t (mm)</span><input type="number" value={tk.roofThk} onChange={(e) => p({ roofThk: +e.target.value })} /></label>
      <label className="f"><span>Cone roof slope (rise 1 : N)</span>
        <select id={fid('tankRoofSlope')} value={tk.roofSlope ?? '1:16'} onChange={(e) => p({ roofSlope: e.target.value as never })}>
          <option value="1:16">1:16 — API 650 standard slope</option>
          <option value="1:20">1:20 — shallow (structurally supported)</option>
          <option value="custom">Custom…</option>
        </select>
        <FixNote equipId={equip.id} field="tankRoofSlope" />
      </label>
      {tk.roofSlope === 'custom' && (
        <label className="f"><span>Custom slope run N (1:N)</span><input type="number" min={4} step={1} value={tk.roofSlopeCustom ?? 16} onChange={(e) => p({ roofSlopeCustom: +e.target.value })} /></label>
      )}
      <label className="f"><span>Wind pressure (kPa)</span><input type="number" step="0.1" value={tk.windPressure} onChange={(e) => p({ windPressure: +e.target.value })} /></label>
      <label className="f"><span>Annular bottom plate</span><input id={fid('tankAnnularBottom')} type="checkbox" checked={tk.annularBottom} onChange={(e) => p({ annularBottom: e.target.checked })} /><FixNote equipId={equip.id} field="tankAnnularBottom" /></label>
      {tk.annularBottom && (
        <label className="f"><span>Annular ring width from shell (mm, ≥ 600 §5.5.3)</span>
          <input id={fid('tankAnnularRingWidth')} type="number" min={100} step={50} value={tk.annularRingWidthMm ?? 600} onChange={(e) => p({ annularRingWidthMm: +e.target.value })} />
          <FixNote equipId={equip.id} field="tankAnnularRingWidth" />
        </label>
      )}
      <label className="f"><span>Annular / field thickness (calc)</span>
        <b className="small">
          {tk.annularBottom
            ? `${fmt(calc.tank!.annularThk, 1)} mm ring (Table 5-1a) · ${fmt(calc.tank!.bottomThk, 1)} mm field · ${tk.annularRingWidthMm ?? 600} mm ring width`
            : `${fmt(calc.tank!.bottomThk, 1)} mm field (6 mm corroded + CA)`}
        </b>
      </label>
      <label className="f"><span>Shell method (calc)</span>
        <b className="small">{calc.tank!.shellMethod === 'vdp' ? 'Variable design point §5.6.4 (D > 61 m)' : 'One-foot §5.6.3'}</b>
      </label>
      <label className="f"><span>Seismic design</span><input type="checkbox" checked={tk.seismic} onChange={(e) => p({ seismic: e.target.checked })} /></label>
      <label className="f"><span>Wind / stiffening rings provided (§5.8.7)</span><input id={fid('tankStiffenerRings')} type="checkbox" checked={tk.stiffenerRings} onChange={(e) => p({ stiffenerRings: e.target.checked })} /><FixNote equipId={equip.id} field="tankStiffenerRings" /></label>
      <label className="f"><span>Shell allowable override (MPa, 0=table)</span><input type="number" step="0.1" value={tk.shellAllowableOverride} onChange={(e) => p({ shellAllowableOverride: +e.target.value })} /></label>
      <label className="f"><span>Max liquid level (mm, 0=TT)</span><input id={fid('tankMaxDesignLiquidLevel')} type="number" value={tk.maxDesignLiquidLevel} onChange={(e) => p({ maxDesignLiquidLevel: +e.target.value })} /><FixNote equipId={equip.id} field="tankMaxDesignLiquidLevel" /></label>
      <label className="f"><span>Hydrotest medium ρ (kg/m³)</span><input id={fid('tankHydroDensity')} type="number" step="1" min={500} value={tk.hydroTestDensity ?? 997} onChange={(e) => p({ hydroTestDensity: +e.target.value })} /></label>
      {calc.tank && (
        <div style={{ gridColumn: 'span 2', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 10 }}>
          <h4 style={{ margin: '0 0 6px' }}>
            Shell course plate grade <span className="muted small">(API 650 allows a different grade per course — blank = inherit tag material; sized against Table 5.2 stresses)</span>
          </h4>
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Course (from bottom)</th><th className="num">Height (mm)</th><th className="num">t required (mm)</th><th className="num" title="ordered plate — required rounded up to the ASTM A6/A20 series">plate t (mm)</th><th>Plate grade</th></tr></thead>
              <tbody>
                {/** render bottom-up: shellCourses[i] AND courseGrades[i] are both indexed
                 *  from the BOTTOM course, so the row you pick a grade on is the course
                 *  that grade sizes (they were labelled from the top before, and the
                 *  selection landed on the opposite course) */}
                {calc.tank.shellCourses.map((c, i) => (
                  <tr key={c.courseNo}>
                    <td className="num">{i + 1}{i === 0 ? ' (bottom)' : ''}</td>
                    <td className="num">{fmt(c.heightMm, 0)}</td>
                    <td className="num calc">{fmt(c.tRequired ?? c.tNominal, 2)}</td>
                    <td className="num calc">{fmt(c.tNominal, 1)}</td>
                    <td>
                      <select
                        id={fid(`tankCourseGrade${i}`)}
                        value={tk.courseGrades?.[i] ?? ''}
                        onChange={(e) => {
                          const g = [...(tk.courseGrades ?? [])];
                          g[i] = e.target.value;
                          p({ courseGrades: g });
                        }}
                      >
                        <option value="">— inherit tag material ({equip.materialKey}) —</option>
                        {Object.keys(API650_STRESSES)
                          .filter((k) => k !== 'default')
                          .map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FinFanEqEditor({ equip, calc }: { equip: Equipment; calc: ReturnType<typeof computeEquipment> }) {
  const ff = equip.finfan!;
  const c = calc.finfan;
  const p = (patch: Partial<FinFanSpec>) => update(equip.id, { finfan: { ...ff, ...patch } });
  const fid = (f: string) => fieldId(equip.id, f);
  return (
    <div className="grid2">
      <label className="f"><span>Arrangement</span>
        <select value={ff.arrangement} onChange={(e) => p({ arrangement: e.target.value as never })}>
          <option value="forced">Forced draft</option><option value="induced">Induced draft</option><option value="vapor">Vapor condenser</option>
        </select>
      </label>
      <label className="f"><span>Bays</span><input type="number" value={ff.bays} onChange={(e) => p({ bays: +e.target.value })} /></label>
      <label className="f"><span>Rows deep</span><input id={fid('ffRows')} type="number" value={ff.rows} onChange={(e) => p({ rows: +e.target.value })} /><FixNote equipId={equip.id} field="ffRows" /></label>
      <label className="f"><span>Finned length (mm)</span><input type="number" value={ff.tubeLength} onChange={(e) => p({ tubeLength: +e.target.value })} /></label>
      <label className="f"><span>Tube OD (mm)</span><input type="number" step="0.1" value={ff.tubeOD} onChange={(e) => p({ tubeOD: +e.target.value })} /></label>
      <label className="f"><span>Tube wall (mm)</span><input type="number" step="0.1" value={ff.tubeWall} onChange={(e) => p({ tubeWall: +e.target.value })} /></label>
      <label className="f"><span>Fin OD (mm)</span><input type="number" value={ff.finOD} onChange={(e) => p({ finOD: +e.target.value })} /></label>
      <label className="f"><span>Fin pitch (fpi)</span><input type="number" value={ff.finPitch} onChange={(e) => p({ finPitch: +e.target.value })} /></label>
      <label className="f"><span>Fin thickness (mm)</span><input type="number" step="0.05" value={ff.finThk} onChange={(e) => p({ finThk: +e.target.value })} /></label>
      <label className="f"><span>Fin type</span>
        <select value={ff.finType ?? 'lFooted'} onChange={(e) => p({ finType: e.target.value as never })} title="Recorded on the datasheet and BOM; the thermal rating still uses the entered/auto overall U">
          <option value="lFooted">L-footed (ring)</option>
          <option value="serrated">Serrated L-footed</option>
          <option value="gFooted">G-footed / embedded</option>
          <option value="integral">Integral (extruded)</option>
        </select>
      </label>
      <label className="f"><span>Duty (kW)</span><input id={fid('ffDutyKW')} type="number" value={ff.dutyKW} onChange={(e) => p({ dutyKW: +e.target.value })} /><FixNote equipId={equip.id} field="ffDutyKW" /></label>
      <label className="f"><span>Process in (°C)</span><input type="number" value={ff.processInC} onChange={(e) => p({ processInC: +e.target.value })} /></label>
      <label className="f"><span>Process out (°C)</span><input type="number" value={ff.processOutC} onChange={(e) => p({ processOutC: +e.target.value })} /></label>
      <label className="f"><span>Air in (°C)</span><input type="number" value={ff.airInC} onChange={(e) => p({ airInC: +e.target.value })} /></label>
      <label className="f"><span>Air temperature rise (°C, 0 = 15)</span><input type="number" value={ff.airRiseC} onChange={(e) => p({ airRiseC: +e.target.value })} /></label>
      <label className="f"><span>Site elevation (m)</span>
        <input
          type="number"
          title={`ISA air density at this elevation: ${siteAirDensity(ff.siteElevationM ?? 0).toFixed(3)} kg/m³ — drives air volume flow, face velocity and fan power`}
          value={ff.siteElevationM ?? 0}
          onChange={(e) => p({ siteElevationM: +e.target.value })}
        />
      </label>
      <label className="f"><span>U finned area (W/m²K, 0=auto)</span><input type="number" value={ff.uAir} onChange={(e) => p({ uAir: +e.target.value })} /></label>
      <label className="f"><span>Fan efficiency</span><input type="number" step="0.05" value={ff.fanEfficiency} onChange={(e) => p({ fanEfficiency: +e.target.value })} /></label>
      <label className="f"><span>Plenum loss (in H₂O)</span><input type="number" step="0.05" value={ff.plenumLossH2O} onChange={(e) => p({ plenumLossH2O: +e.target.value })} /></label>
      <label className="f"><span>Fan Ø (mm, 0 = auto ≥40%)</span>
        <input id={fid('ffFanDia')} type="number" value={ff.fanDiaMm ?? 0} onChange={(e) => p({ fanDiaMm: +e.target.value })} />
        <FixNote equipId={equip.id} field="ffFanDia" />
      </label>
      <label className="f"><span>Motor (kW, 0 = n/a)</span>
        <input id={fid('ffMotorKw')} type="number" value={ff.motorKw ?? 0} onChange={(e) => p({ motorKw: +e.target.value })} />
        <FixNote equipId={equip.id} field="ffMotorKw" />
      </label>
      <label className="f"><span>Tube material (tube/pipe grades)</span>
        <select value={ff.tubeMatKey} onChange={(e) => p({ tubeMatKey: e.target.value })}>{MATERIALS.filter((m) => m.form === 'pipe').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
      </label>
      <label className="f"><span>Fin material</span>
        <select value={ff.finMatKey} onChange={(e) => p({ finMatKey: e.target.value })}>{MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
      </label>
      <label className="f"><span>Header t (mm)</span><input type="number" value={ff.headerThk} onChange={(e) => p({ headerThk: +e.target.value })} /></label>
      <label className="f"><span>Tube count (0=auto)</span><input id={fid('ffTubeCount')} type="number" value={ff.tubeCount} onChange={(e) => p({ tubeCount: +e.target.value })} /><FixNote equipId={equip.id} field="ffTubeCount" /></label>
      {c && (
        <>
          <div className="kpi" style={{ gridColumn: 'span 2' }}>
            <span className="v">{fmt(c.faceVelMs, 1)} m/s · {fmt(c.airFlowCMH, 0)} m³/h</span>
            <span className="l">Face velocity & air flow at ρ = {fmt(c.airDensity, 3)} kg/m³ (site) — finned area {fmt(c.finnedAreaM2, 0)} m² over {c.tubeCountActual} tubes</span>
          </div>
          <div className="kpi" style={{ gridColumn: 'span 2' }}>
            <span className="v">Fan Ø{fmt(c.fanDiaMm, 0)} mm ({fmt(c.fanCoveragePct, 0)}% of bay) · {fmt(c.fanBHP, 0)} BHP / {fmt(c.fanKW, 1)} kW</span>
            <span className="l">Air ΔP {fmt(c.airDPH2O, 2)} in H₂O incl. plenum{ff.bays > 1 ? ` · ${fmt(c.fanKW / Math.max(1, ff.bays), 1)} kW per fan across ${ff.bays} bays` : ''}</span>
          </div>
          <div className="kpi" style={{ gridColumn: 'span 2' }}>
            <span className="v">{c.thermalOK ? '✓' : '✗'} thermal margin {c.thermalMarginPct >= 0 ? '+' : ''}{fmt(c.thermalMarginPct, 0)}%</span>
            <span className="l">Available vs duty at U = {ff.uAir > 0 ? fmt(ff.uAir, 0) : 'auto 55'} W/m²K — a negative margin raises AF-03</span>
          </div>
        </>
      )}
    </div>
  );
}
