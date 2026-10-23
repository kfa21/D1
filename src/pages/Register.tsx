// Equipment Register — tabular entry per equipment type with live calculated columns.
// Left block: user inputs (Sr, Tag, Name, Orientation, #Dia, Dia, TT, heads, CA, mat, P, T).
// Right block: calculated (shell/head thickness, MAWP, hydrotest, weight, warnings).

import { useMemo, useState } from 'react';
import type { Equipment, EquipType, HeadType, NozzleSpec, InternalsSpec, SectionSpec } from '../engine/types';
import { computeEquipment } from '../engine/compute';
import { MATERIALS } from '../engine/materials';
import { PIPES, SCHEDULES } from '../engine/pipes';
import { uid, fmt } from '../engine/units';
import { newEquipment, demoProject, defaultNdtPlan } from '../defaults';
import { suggestNdtMethod, NDT_METHOD_LABELS } from '../engine/ndt';
import { recommendStructure } from '../engine/supports';
import type { CladSpec, NdtItemSpec } from '../engine/types';
import { useStore, setState, getStore } from '../store';

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
  return { mode: 'none', kind: 'weldOverlay', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 0, note: '' };
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
    copy.sections = copy.sections.map((s) => ({ ...s, id: uid('sec') }));
    copy.nozzles = copy.nozzles.map((n) => ({ ...n, id: uid('nz'), sectionId: '' }));
    copy.nozzles.forEach((n) => (n.sectionId = copy.sections[0]?.id ?? ''));
    setState((s) => ({ equipment: [...s.equipment, copy] }));
  };

  const selected = rows.find((r) => r.e.id === selectedId);

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
              <th className="num">T-T Length (mm)</th>
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
                  <td><input type="number" className="num" value={e.sections[0]?.ttLength ?? 0} onChange={(ev) => updateSection(e.id, e.sections[0].id, { ttLength: +ev.target.value })} onClick={(ev) => ev.stopPropagation()} /></td>
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
  const [tab, setTab] = useState<'general' | 'sections' | 'nozzles' | 'internals' | 'type'>('general');

  const addNozzle = () => {
    const n: NozzleSpec = {
      id: uid('nz'), tag: `N${equip.nozzles.length + 1}`, service: '', dn: 50, schKey: '40',
      sectionId: equip.sections[0]?.id ?? '', elevation: 500, azimuth: 0, kind: 'process',
      flangeClass: 150, flangeMatKey: 'SA-105', padDia: 0, padThk: 0, projOutside: 120,
    };
    update(equip.id, { nozzles: [...equip.nozzles, n] });
  };
  const upNz = (id: string, patch: Partial<NozzleSpec>) =>
    update(equip.id, { nozzles: equip.nozzles.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const upNdt = (method: string, patch: Partial<NdtItemSpec>) => {
    const plan = equip.ndtPlan ?? defaultNdtPlan(equip.rtCategory);
    update(equip.id, { ndtPlan: plan.map((p) => (p.method === method ? { ...p, ...patch } : p)) });
  };

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
          {(['general', 'sections', 'nozzles', 'internals', 'type'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'type' ? `${equip.equipType === 'hx' ? 'TEMA data' : equip.equipType === 'tank' ? 'Tank data' : equip.equipType === 'finfan' ? 'Fin-fan data' : 'Supports & code'}` : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="grid2">
            <label className="f"><span>Material</span>
              <select value={equip.materialKey} onChange={(e) => update(equip.id, { materialKey: e.target.value })}>
                {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
            </label>
            <label className="f"><span>Corrosion allowance (mm)</span>
              <input type="number" value={equip.corrosionAllowance} onChange={(e) => update(equip.id, { corrosionAllowance: +e.target.value })} />
            </label>
            <label className="f"><span>Design pressure (bar g)</span>
              <input type="number" value={equip.designPressure} onChange={(e) => update(equip.id, { designPressure: +e.target.value })} />
            </label>
            <label className="f"><span>Design temp (°C)</span>
              <input type="number" value={equip.designTemp} onChange={(e) => update(equip.id, { designTemp: +e.target.value })} />
            </label>
            <label className="f"><span>MDMT (°C)</span>
              <input type="number" value={equip.mdmt} onChange={(e) => update(equip.id, { mdmt: +e.target.value })} />
            </label>
            <label className="f"><span>External / vacuum press (bar)</span>
              <input type="number" step="0.05" value={equip.externalPressure} onChange={(e) => update(equip.id, { externalPressure: +e.target.value })} />
            </label>
            <label className="f"><span>RT category (UW-11)</span>
              <select value={equip.rtCategory} onChange={(e) => update(equip.id, { rtCategory: e.target.value as never })}>
                <option value="full">Full RT (E=1.0)</option>
                <option value="spot">Spot RT (E=0.85)</option>
                <option value="none">None (E=0.70)</option>
              </select>
            </label>
            <label className="f"><span>Inspection level</span>
              <select value={equip.inspectionLevel} onChange={(e) => update(equip.id, { inspectionLevel: e.target.value as never })}>
                <option value="3.1">ASME VIII App. 3.1 (standard)</option>
                <option value="3.2">ASME VIII App. 3.2 (enhanced)</option>
              </select>
            </label>
            <label className="f"><span>PWHT</span>
              <select value={equip.pwhtOverride === null ? 'auto' : equip.pwhtOverride ? 'yes' : 'no'} onChange={(e) => update(equip.id, { pwhtOverride: e.target.value === 'auto' ? null : e.target.value === 'yes' })}>
                <option value="auto">Auto (per UCS-56)</option>
                <option value="yes">Force PWHT</option>
                <option value="no">Waive PWHT</option>
              </select>
            </label>
            <label className="f"><span>Test pressure factor (UG-99)</span>
              <input type="number" step="0.05" value={equip.testPressureFactor} onChange={(e) => update(equip.id, { testPressureFactor: +e.target.value })} />
            </label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Notes</span>
              <input value={equip.notes} onChange={(e) => update(equip.id, { notes: e.target.value })} />
            </label>
          </div>
        )}

        {tab === 'general' && equip.orientation === 'vertical' && (equip.equipType === 'vessel' || equip.equipType === 'column') && (
          <div style={{ marginTop: 14 }}>
            <h3>Design Loads — anchor-bolt overturning (wind / seismic)</h3>
            <div className="grid2">
              <label className="f"><span>Wind pressure (kPa)</span>
                <input type="number" step="0.05" value={equip.designLoads?.windPressureKpa ?? 0} onChange={(e) => update(equip.id, { designLoads: { ...(equip.designLoads ?? { windPressureKpa: 0, sds: 0, seismicR: 3, seismicIe: 1 }), windPressureKpa: +e.target.value } })} />
              </label>
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

        {tab === 'general' && (equip.equipType === 'vessel' || equip.equipType === 'column') && (
          <div style={{ marginTop: 14 }}>
            <h3>Cladding / Lining</h3>
            <div className="grid2">
              <label className="f"><span>Coverage</span>
                <select value={equip.clad?.mode ?? 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), mode: e.target.value as never } })}>
                  <option value="none">None</option>
                  <option value="full">Full length (shell + heads)</option>
                  <option value="partial">Partial length</option>
                </select>
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
              <label className="f"><span>Thickness (mm)</span>
                <input type="number" step="0.5" value={equip.clad?.thicknessMm ?? 3} disabled={(equip.clad?.mode ?? 'none') === 'none'} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), thicknessMm: +e.target.value } })} />
              </label>
              {(equip.clad?.mode ?? 'none') === 'partial' && (
                <label className="f"><span>Covered length from bottom (mm)</span>
                  <input type="number" value={equip.clad?.partialLengthMm ?? 0} onChange={(e) => update(equip.id, { clad: { ...(equip.clad ?? defaultClad()), partialLengthMm: +e.target.value } })} />
                </label>
              )}
              {equip.clad && equip.clad.mode !== 'none' && calc.clad && (
                <div className="kpi" style={{ gridColumn: 'span 2' }}>
                  <span className="v">{fmt(calc.clad.weightKg, 0)} kg · {fmt(calc.clad.areaM2, 1)} m²</span>
                  <span className="l">{calc.clad.materialName} {equip.clad.thicknessMm} mm — priced at lining grade $/kg in estimate</span>
                </div>
              )}
            </div>

            <h3 style={{ marginTop: 16 }}>NDT plan (per weld method)</h3>
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Method</th><th>On</th><th>Timing</th><th>Extent</th><th>Note</th></tr></thead>
                <tbody>
                  {(equip.ndtPlan ?? defaultNdtPlan(equip.rtCategory)).map((p, i, arr) => (
                    <tr key={p.method}>
                      <td>{NDT_METHOD_LABELS[p.method]}</td>
                      <td><input type="checkbox" checked={p.enabled} disabled={p.method === 'rt' && equip.rtCategory === 'none'} onChange={(e) => upNdt(arr[i].method, { enabled: e.target.checked })} /></td>
                      <td><select value={p.timing} onChange={(e) => upNdt(arr[i].method, { timing: e.target.value as never })}>
                        <option value="during">Interstage (during welding)</option>
                        <option value="afterPwht">After PWHT</option>
                        <option value="final">Final (before hydro)</option>
                      </select></td>
                      <td><select value={p.extent} onChange={(e) => upNdt(arr[i].method, { extent: e.target.value as never })}>
                        <option value="full">100 %</option><option value="spot">Spot</option><option value="sample">Sample</option>
                      </select></td>
                      <td><input value={p.note} onChange={(e) => upNdt(arr[i].method, { note: e.target.value })} style={{ minWidth: 200 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <p className="muted small">Multi-dia shells: add sections bottom→top. The cone angle at each section transition is the included angle of the reducing cone.</p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th><th className="num">ID (mm)</th><th className="num">T-T (mm)</th>
                    <th>Top head</th><th>Bottom head</th><th className="num">Spec t shell</th>
                    <th className="num">Cone angle°</th><th className="num">Spec t cone</th>
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
                        <td><input type="number" className="num" value={s.dia} onChange={(e) => updateSection(equip.id, s.id, { dia: +e.target.value })} /></td>
                        <td><input type="number" className="num" value={s.ttLength} onChange={(e) => updateSection(equip.id, s.id, { ttLength: +e.target.value })} /></td>
                        <td><select value={s.headTop} onChange={(e) => updateSection(equip.id, s.id, { headTop: e.target.value as HeadType })}>
                          {Object.entries(HEAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                        <td><select value={s.headBottom} onChange={(e) => updateSection(equip.id, s.id, { headBottom: e.target.value as HeadType })}>
                          {Object.entries(HEAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                        <td><input type="number" className="num" value={s.shellThk} placeholder="0=auto" onChange={(e) => updateSection(equip.id, s.id, { shellThk: +e.target.value })} /></td>
                        <td><input type="number" className="num" value={s.coneAngleDeg} disabled={i === 0} onChange={(e) => updateSection(equip.id, s.id, { coneAngleDeg: +e.target.value })} /></td>
                        <td><input type="number" className="num" value={s.coneThk} onChange={(e) => updateSection(equip.id, s.id, { coneThk: +e.target.value })} /></td>
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
            <p className="muted small">Nozzle neck, reinforcement (UG-32/UG-37) and B16.5 flange rating are verified at design temperature automatically.</p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Tag</th><th>Service</th><th>Kind</th><th className="num">Bore (mm)</th><th>Sch</th>
                    <th className="num">Elev (mm)</th><th className="num">Azim°</th><th>Flange</th><th>Flange mat</th>
                    <th className="num">Pad Ø</th><th className="num">Pad t</th>
                    <th className="num grp">Neck t (mm)</th><th className="num grp">A req</th><th className="num grp">A prov</th>
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
                        <td><input type="number" className="num" value={n.dn} onChange={(e) => upNz(n.id, { dn: +e.target.value })} /></td>
                        <td><select value={n.schKey} onChange={(e) => upNz(n.id, { schKey: e.target.value })}>
                          {SCHEDULES.map((s) => <option key={s} value={s}>Sch {s}</option>)}
                        </select></td>
                        <td><input type="number" className="num" value={n.elevation} onChange={(e) => upNz(n.id, { elevation: +e.target.value })} /></td>
                        <td><input type="number" className="num" value={n.azimuth} onChange={(e) => upNz(n.id, { azimuth: +e.target.value })} /></td>
                        <td><select value={n.flangeClass} onChange={(e) => upNz(n.id, { flangeClass: +e.target.value as never })}>
                          {[150, 300, 600, 900, 1500, 2500].map((c) => <option key={c} value={c}>Cl {c0label(c)}</option>)}
                        </select></td>
                        <td><select value={n.flangeMatKey} onChange={(e) => upNz(n.id, { flangeMatKey: e.target.value })}>
                          {MATERIALS.filter((m) => m.form === 'forging' || m.key === 'SA-105').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                        </select></td>
                        <td><input type="number" className="num" value={n.padDia} onChange={(e) => upNz(n.id, { padDia: +e.target.value })} /></td>
                        <td><input type="number" className="num" value={n.padThk} onChange={(e) => upNz(n.id, { padThk: +e.target.value })} /></td>
                        <td className="num calc">{nc ? fmt(nc.wall, 2) : '—'}</td>
                        <td className="num calc">{nc ? nc.Areq.toFixed(0) : '—'}</td>
                        <td className="num calc">{nc ? nc.Aprov.toFixed(0) : '—'}</td>
                        <td className="num calc">{nc ? fmt(nc.flangeRating, 0) : '—'}</td>
                        <td>{nc && (nc.reinforceOK && nc.flangeClassOK && nc.neckOK
                          ? <span className="badge ok">OK</span>
                          : <span className="badge err">{!nc.neckOK ? 'neck' : !nc.reinforceOK ? 'reinf' : 'flange'}</span>)}</td>
                        <td><button className="ghost danger" onClick={() => update(equip.id, { nozzles: equip.nozzles.filter((x) => x.id !== n.id) })}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}><button onClick={addNozzle}>＋ Add nozzle</button></div>
          </div>
        )}

        {tab === 'internals' && (
          <div>
            <p className="muted small">Trays, packing and other internals for columns/vessels — weights flow into BOM, MTO and man-hours.</p>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr><th>Type</th><th className="num">Count</th><th className="num">Spacing (mm)</th><th className="num">Bottom elev (mm)</th><th>Material</th><th className="num">kg/m²</th><th className="num grp">Weight (kg)</th><th>Note</th><th></th></tr>
                </thead>
                <tbody>
                  {equip.internals.map((it, i) => (
                    <tr key={it.id}>
                      <td><select value={it.kind} onChange={(e) => upIn(it.id, { kind: e.target.value as never })}>
                        {['sieveTray', 'valveTray', 'bubbleCapTray', 'randomPacking', 'structuredPacking', 'demister', 'distributor', 'collector', 'chimneyTray', 'supportRing'].map((k) => <option key={k} value={k}>{internalsLabelLocal(k)}</option>)}
                      </select></td>
                      <td><input type="number" className="num" value={it.count} onChange={(e) => upIn(it.id, { count: +e.target.value })} /></td>
                      <td><input type="number" className="num" value={it.spacing} onChange={(e) => upIn(it.id, { spacing: +e.target.value })} /></td>
                      <td><input type="number" className="num" value={it.bottomElevation} onChange={(e) => upIn(it.id, { bottomElevation: +e.target.value })} /></td>
                      <td><select value={it.materialKey} onChange={(e) => upIn(it.id, { materialKey: e.target.value })}>
                        {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                      </select></td>
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

        {tab === 'type' && equip.equipType === 'hx' && equip.hx && <HxEqEditor equip={equip} />}
        {tab === 'type' && equip.equipType === 'tank' && equip.tank && <TankEqEditor equip={equip} calc={calc} />}
        {tab === 'type' && equip.equipType === 'finfan' && equip.finfan && <FinFanEqEditor equip={equip} />}
        {tab === 'type' && <SupportEditor equip={equip} />}

        {calc.warnings.length > 0 && (
          <>
            <hr className="sep" />
            {calc.warnings.map((w, i) => (
              <div key={i} className={`finding ${w.level}`}>[{w.level.toUpperCase()}] {w.code}: {w.msg}</div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function c0label(c: number) { return c; }

function internalsLabelLocal(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function internalsWeightLocal(equip: Equipment, idx: number): number {
  const it = equip.internals[idx];
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
  const p = (patch: Partial<Equipment['support']>) => update(equip.id, { support: { ...s, ...patch } });
  return (
    <div style={{ marginTop: 14 }}>
      <h3>Supports — every type selectable, each calculated separately (hours · material · cost)</h3>
      <div className="grid2">
        <label className="f"><span>Primary support type</span>
          <select value={s.type} onChange={(e) => p({ type: e.target.value as never })}>
            <option value="legs">Legs (vertical vessels)</option>
            <option value="saddle">Saddles (horizontal vessels / HX)</option>
            <option value="skirt">Skirt (columns, vertical vessels)</option>
            <option value="ring">Base ring</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="f"><span>Legs / saddle count</span><input type="number" value={s.legCount} onChange={(e) => p({ legCount: +e.target.value })} /></label>
        <label className="f"><span>Saddle span (mm)</span><input type="number" value={s.saddleSpan} onChange={(e) => p({ saddleSpan: +e.target.value })} /></label>
        <label className="f"><span>Saddle angle (°)</span><input type="number" value={s.saddleAngle} onChange={(e) => p({ saddleAngle: +e.target.value })} /></label>
        <label className="f"><span>Skirt / leg height (mm)</span><input type="number" value={s.skirtH} onChange={(e) => p({ skirtH: +e.target.value })} /></label>
        <label className="f"><span>Leg plate t (mm)</span><input type="number" value={s.legPlateThk} onChange={(e) => p({ legPlateThk: +e.target.value })} /></label>
        <label className="f"><span>Auxiliary (each costed separately)</span>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="small"><input type="checkbox" checked={!!s.baseRing} onChange={(e) => p({ baseRing: e.target.checked })} /> Base ring + anchors</label>
            <label className="small"><input type="checkbox" checked={!!s.padeyes} onChange={(e) => p({ padeyes: e.target.checked })} /> Lifting lugs / padeyes</label>
            <label className="small"><input type="checkbox" checked={!!s.guyLines} onChange={(e) => p({ guyLines: e.target.checked })} /> Guy-wire derrick</label>
          </span>
        </label>
      </div>
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
          <span className="v">Zick horn {fmt(calc.saddle.zickFc, 1)} / {fmt(calc.saddle.zickAllow, 1)} MPa {calc.saddle.ok ? <span className="badge ok">OK</span> : <span className="badge err">review</span>}</span>
          <span className="l">{calc.saddle.note} — membrane {fmt(calc.saddle.hornMembraneMPa, 1)} + bending {fmt(calc.saddle.hornBendingMPa, 1)} MPa · reaction {fmt(calc.saddle.reaction, 1)} kN/saddle</span>
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

import { HXSpec, TankSpec, FinFanSpec } from '../engine/types';
import { SHELL_ODS } from '../engine/tema';

function HxEqEditor({ equip }: { equip: Equipment }) {
  const hx = equip.hx!;
  const p = (patch: Partial<HXSpec>) => update(equip.id, { hx: { ...hx, ...patch } });
  return (
    <div>
      <div className="grid2">
        <label className="f"><span>Tube-to-tubesheet joint</span>
          <select value={hx.tubeJointType ?? 'strengthWelded'} onChange={(e) => p({ tubeJointType: e.target.value as never })}>
            <option value="expanded">Strength expanded</option>
            <option value="strengthWelded">Strength welded + expanded</option>
            <option value="sealWeldExpanded">Seal welded + strength expanded</option>
            <option value="fullyWelded">Fully welded (inner/outer)</option>
          </select>
        </label>
        <label className="f"><span>Tubesheet face cladding</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={hx.tubeSheetClad?.enabled ?? false} onChange={(e) => p({ tubeSheetClad: { enabled: e.target.checked, materialKey: hx.tubeSheetClad?.materialKey ?? 'SA-240-316L', thicknessMm: hx.tubeSheetClad?.thicknessMm ?? 3 } })} />
            <select value={hx.tubeSheetClad?.materialKey ?? 'SA-240-316L'} disabled={!(hx.tubeSheetClad?.enabled)} onChange={(e) => p({ tubeSheetClad: { enabled: hx.tubeSheetClad?.enabled ?? false, materialKey: e.target.value, thicknessMm: hx.tubeSheetClad?.thicknessMm ?? 3 } })} style={{ minWidth: 140 }}>
              {MATERIALS.filter((m) => m.form === 'plate').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
            <input type="number" step="0.5" value={hx.tubeSheetClad?.thicknessMm ?? 3} disabled={!(hx.tubeSheetClad?.enabled)} onChange={(e) => p({ tubeSheetClad: { enabled: hx.tubeSheetClad?.enabled ?? false, materialKey: hx.tubeSheetClad?.materialKey ?? 'SA-240-316L', thicknessMm: +e.target.value } })} style={{ width: 64 }} />
          </span>
        </label>
        <label className="f"><span>TEMA type</span>
          <select value={hx.temaType} onChange={(e) => p({ temaType: e.target.value })}>
            {['BEM', 'BES', 'BEU', 'AEU', 'AEP', 'NEN', 'BKU', 'CKU', 'AFU'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="f"><span>Shell OD (mm, 0=auto)</span><input type="number" value={hx.shellDiaOD} onChange={(e) => p({ shellDiaOD: +e.target.value })} /></label>
        <label className="f"><span>Tube OD (mm)</span><input type="number" value={hx.tubeOD} onChange={(e) => p({ tubeOD: +e.target.value })} /></label>
        <label className="f"><span>Tube wall (mm)</span><input type="number" step="0.1" value={hx.tubeWall} onChange={(e) => p({ tubeWall: +e.target.value })} /></label>
        <label className="f"><span>Tube length T-T (mm)</span><input type="number" value={hx.tubeLength} onChange={(e) => p({ tubeLength: +e.target.value })} /></label>
        <label className="f"><span>Tube count (0=auto)</span><input type="number" value={hx.tubeCount} onChange={(e) => p({ tubeCount: +e.target.value })} /></label>
        <label className="f"><span>Pitch (mm)</span><input type="number" value={hx.pitch} onChange={(e) => p({ pitch: +e.target.value })} /></label>
        <label className="f"><span>Layout angle</span>
          <select value={hx.layoutAngle} onChange={(e) => p({ layoutAngle: +e.target.value as never })}>{[30, 45, 60, 90].map((a) => <option key={a} value={a}>{a}°</option>)}</select>
        </label>
        <label className="f"><span>Baffle type</span>
          <select value={hx.baffleType} onChange={(e) => p({ baffleType: e.target.value as never })}>
            <option value="segmental">Single segmental</option><option value="doubleSeg">Double segmental</option>
            <option value="noTubeInWindow">No tube in window</option><option value="orifice">Orifice</option><option value="single">Single</option>
          </select>
        </label>
        <label className="f"><span>Baffle cut (%)</span><input type="number" value={hx.baffleCut} onChange={(e) => p({ baffleCut: +e.target.value })} /></label>
        <label className="f"><span>Baffle spacing (mm, 0=auto)</span><input type="number" value={hx.baffleSpacing} onChange={(e) => p({ baffleSpacing: +e.target.value })} /></label>
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
        <label className="f"><span>Overall U (W/m²K, 0=auto)</span><input type="number" value={hx.uOverall} onChange={(e) => p({ uOverall: +e.target.value })} /></label>
        <label className="f"><span>Tube material (tube/pipe grades)</span>
          <select value={hx.tubeMatKey} onChange={(e) => p({ tubeMatKey: e.target.value })}>{MATERIALS.filter((m) => m.form === 'pipe').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
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
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Available shell ODs (mm): {SHELL_ODS.join(', ')}</p>
    </div>
  );
}

function TankEqEditor({ equip, calc }: { equip: Equipment; calc: ReturnType<typeof computeEquipment> }) {
  const tk = equip.tank!;
  const p = (patch: Partial<TankSpec>) => update(equip.id, { tank: { ...tk, ...patch } });
  const floating = tk.roofType === 'externalFloating' || tk.roofType === 'internalFloating';
  return (
    <div className="grid2">
      <label className="f"><span>Stored fluid</span><input value={tk.fluidName} onChange={(e) => p({ fluidName: e.target.value })} /></label>
      <label className="f"><span>Specific gravity</span><input type="number" step="0.01" value={tk.specificGravity} onChange={(e) => p({ specificGravity: +e.target.value })} /></label>
      <label className="f"><span>Roof type</span>
        <select value={tk.roofType} onChange={(e) => p({ roofType: e.target.value as never })}>
          <option value="cone">Cone roof</option><option value="dome">Dome roof</option><option value="internalFloating">Internal floating roof</option><option value="externalFloating">External floating roof</option>
        </select>
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
      <label className="f"><span>Bottom t (mm, 0=auto)</span><input type="number" value={tk.bottomThk} onChange={(e) => p({ bottomThk: +e.target.value })} /></label>
      <label className="f"><span>Roof t (mm)</span><input type="number" value={tk.roofThk} onChange={(e) => p({ roofThk: +e.target.value })} /></label>
      <label className="f"><span>Wind pressure (kPa)</span><input type="number" step="0.1" value={tk.windPressure} onChange={(e) => p({ windPressure: +e.target.value })} /></label>
      <label className="f"><span>Annular bottom plate</span><input type="checkbox" checked={tk.annularBottom} onChange={(e) => p({ annularBottom: e.target.checked })} /></label>
      <label className="f"><span>Seismic design</span><input type="checkbox" checked={tk.seismic} onChange={(e) => p({ seismic: e.target.checked })} /></label>
      <label className="f"><span>Shell allowable override (MPa, 0=table)</span><input type="number" step="0.1" value={tk.shellAllowableOverride} onChange={(e) => p({ shellAllowableOverride: +e.target.value })} /></label>
      <label className="f"><span>Max liquid level (mm, 0=TT)</span><input type="number" value={tk.maxDesignLiquidLevel} onChange={(e) => p({ maxDesignLiquidLevel: +e.target.value })} /></label>
    </div>
  );
}

function FinFanEqEditor({ equip }: { equip: Equipment }) {
  const ff = equip.finfan!;
  const p = (patch: Partial<FinFanSpec>) => update(equip.id, { finfan: { ...ff, ...patch } });
  return (
    <div className="grid2">
      <label className="f"><span>Arrangement</span>
        <select value={ff.arrangement} onChange={(e) => p({ arrangement: e.target.value as never })}>
          <option value="forced">Forced draft</option><option value="induced">Induced draft</option><option value="vapor">Vapor condenser</option>
        </select>
      </label>
      <label className="f"><span>Bays</span><input type="number" value={ff.bays} onChange={(e) => p({ bays: +e.target.value })} /></label>
      <label className="f"><span>Rows deep</span><input type="number" value={ff.rows} onChange={(e) => p({ rows: +e.target.value })} /></label>
      <label className="f"><span>Finned length (mm)</span><input type="number" value={ff.tubeLength} onChange={(e) => p({ tubeLength: +e.target.value })} /></label>
      <label className="f"><span>Tube OD (mm)</span><input type="number" step="0.1" value={ff.tubeOD} onChange={(e) => p({ tubeOD: +e.target.value })} /></label>
      <label className="f"><span>Tube wall (mm)</span><input type="number" step="0.1" value={ff.tubeWall} onChange={(e) => p({ tubeWall: +e.target.value })} /></label>
      <label className="f"><span>Fin OD (mm)</span><input type="number" value={ff.finOD} onChange={(e) => p({ finOD: +e.target.value })} /></label>
      <label className="f"><span>Fin pitch (fpi)</span><input type="number" value={ff.finPitch} onChange={(e) => p({ finPitch: +e.target.value })} /></label>
      <label className="f"><span>Fin thickness (mm)</span><input type="number" step="0.05" value={ff.finThk} onChange={(e) => p({ finThk: +e.target.value })} /></label>
      <label className="f"><span>Duty (kW)</span><input type="number" value={ff.dutyKW} onChange={(e) => p({ dutyKW: +e.target.value })} /></label>
      <label className="f"><span>Process in (°C)</span><input type="number" value={ff.processInC} onChange={(e) => p({ processInC: +e.target.value })} /></label>
      <label className="f"><span>Process out (°C)</span><input type="number" value={ff.processOutC} onChange={(e) => p({ processOutC: +e.target.value })} /></label>
      <label className="f"><span>Air in (°C)</span><input type="number" value={ff.airInC} onChange={(e) => p({ airInC: +e.target.value })} /></label>
      <label className="f"><span>U finned area (W/m²K, 0=auto)</span><input type="number" value={ff.uAir} onChange={(e) => p({ uAir: +e.target.value })} /></label>
      <label className="f"><span>Fan efficiency</span><input type="number" step="0.05" value={ff.fanEfficiency} onChange={(e) => p({ fanEfficiency: +e.target.value })} /></label>
      <label className="f"><span>Plenum loss (in H₂O)</span><input type="number" step="0.05" value={ff.plenumLossH2O} onChange={(e) => p({ plenumLossH2O: +e.target.value })} /></label>
      <label className="f"><span>Tube material (tube/pipe grades)</span>
        <select value={ff.tubeMatKey} onChange={(e) => p({ tubeMatKey: e.target.value })}>{MATERIALS.filter((m) => m.form === 'pipe').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
      </label>
      <label className="f"><span>Fin material</span>
        <select value={ff.finMatKey} onChange={(e) => p({ finMatKey: e.target.value })}>{MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
      </label>
      <label className="f"><span>Header t (mm)</span><input type="number" value={ff.headerThk} onChange={(e) => p({ headerThk: +e.target.value })} /></label>
      <label className="f"><span>Tube count (0=auto)</span><input type="number" value={ff.tubeCount} onChange={(e) => p({ tubeCount: +e.target.value })} /></label>
    </div>
  );
}
