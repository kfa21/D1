// Inspection & Test Plan page — ASME VIII Appendix 3.1 / 3.2 selection per tag,
// stage timing & duration (phase checkboxes with hours selection on check),
// preferred-method context and hold points. The per-weld NDT plan itself is
// engine-derived (RT category + thickness), read-only here, and feeds costing
// and the ITP rows — it is no longer editable in the Register.

import { useMemo } from 'react';
import { useStore, setState } from '../store';
import { computeEquipment } from '../engine/compute';
import { defaultNdtPlan } from '../defaults';
import { NDT_METHOD_LABELS, NDT_TIMING_LABELS } from '../engine/ndt';
import { defaultItpStages, mergeItpStages, effectiveDurationH, itpStageName, ITP_PHASE_LABELS, ITP_HOUR_PRESETS } from '../engine/itp';
import type { Equipment, ItpStagePhase, ItpStageTiming } from '../engine/types';
import { downloadCSV } from '../cad';
import { printElementById } from '../print';
import { fmt } from '../engine/units';

/**
 * Merged stage schedule for a tag, plus the default phase set used as the
 * apportionment basis: ticking an extra phase box adds hours, unticking one
 * removes them, all unticked drops the stage to 0 h.
 */
function stageData(e: Equipment, calc = computeEquipment(e)) {
  const defaults = defaultItpStages(e, calc);
  const stages = mergeItpStages(defaults, e.itpStages);
  const ref = new Map(defaults.map((d) => [d.code, d.phases]));
  const total = stages.reduce((s, st) => s + effectiveDurationH(st, ref.get(st.code)), 0);
  return { defaults, stages, ref, total };
}

interface ITPRow {
  activity: string;
  code: string;
  level31: string;
  level32: string;
  witness: string;
}

function itpRows(e: Equipment): ITPRow[] {
  const rt = e.rtCategory;
  const plan = e.ndtPlan ?? defaultNdtPlan(rt);
  const NDT_CODE: Record<string, string> = { mt: 'UG-99(a)/UW-11 (surface)', ut: 'UW-11(b) / Sec. V Art. 4', rt: 'UW-11/UW-51 / Sec. V Art. 2', putTofd: 'Sec. V Art. 4/18, VIII-2 App. 12 basis' };
  const ndtRows: ITPRow[] = plan
    .filter((p) => p.enabled)
    .map((p) => ({
      activity: `${NDT_METHOD_LABELS[p.method]} — ${p.extent} extent (${p.note || 'per plan'})`,
      code: NDT_CODE[p.method],
      level31: `${NDT_TIMING_LABELS[p.timing]}`,
      level32: `${NDT_TIMING_LABELS[p.timing]}, witnessed + report review`,
      witness: p.method === 'mt' ? 'R' : 'W',
    }));
  return [
    { activity: 'Material receiving — MTR verification, PMI, marking', code: 'UG-93 / A20', level31: 'Review', level32: 'Review + PMI all items', witness: 'R' },
    { activity: 'Plate identification & traceability', code: 'UG-77', level31: 'Random check', level32: '100% tags recorded', witness: 'R' },
    { activity: 'Forming & shape check (heads, shells)', code: 'UG-80/UG-81', level31: 'First piece', level32: 'Each head', witness: 'W' },
    { activity: 'Fit-up & tack inspection before welding', code: 'UW-13', level31: 'Sample', level32: 'Every joint', witness: 'H' },
    { activity: 'Welding procedure / welder qualification', code: 'UW-26/28', level31: 'Current WPQR', level32: 'WPQR + performance', witness: 'R' },
    ...ndtRows,
    { activity: `Radiography category (joint efficiency basis): ${rt === 'full' ? 'Full RT, E=1.0' : rt === 'spot' ? 'Spot RT, E=0.85' : 'None, E=0.70'}`, code: 'UW-12', level31: 'Per category', level32: 'Upgraded to full RT', witness: 'R' },
    { activity: 'PWHT (if required) — chart & calibration review', code: 'UCS-56', level31: 'Chart review', level32: 'Chart + thermo mapping audit', witness: 'H' },
    { activity: 'Final dimensional & NDE report review', code: 'UW-12', level31: 'Review', level32: 'Review + verification', witness: 'R' },
    { activity: 'Hydrostatic test (1.3×MAWP)', code: 'UG-99', level31: 'Attended', level32: 'Attended + residual gauges', witness: 'H' },
    { activity: 'Nameplate / U-1 form verification', code: 'UG-116 / App. 3', level31: 'U-1A (App. 3.1)', level32: 'U-1 (App. 3.2, 3rd-party sign)', witness: 'H' },
  ];
}

export default function Inspection() {
  const equipment = useStore((s) => s.equipment);
  const settings = useStore((s) => s.settings);

  const summary = useMemo(
    () => equipment.map((e) => ({ e, calc: computeEquipment(e) })),
    [equipment]
  );

  if (equipment.length === 0) return <div className="card">Create equipment tags in the Register first.</div>;

  const rows = (e: Equipment) =>
    itpRows(e).map((r) => [e.tag, r.activity, r.code, e.inspectionLevel === '3.1' ? r.level31 : r.level32, r.witness]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="kpi"><span className="v">{equipment.filter((e) => e.inspectionLevel === '3.1').length}</span><span className="l">App. 3.1 tags (U-1A)</span></div>
        <div className="kpi"><span className="v">{equipment.filter((e) => e.inspectionLevel === '3.2').length}</span><span className="l">App. 3.2 tags (U-1)</span></div>
        <div className="kpi"><span className="v">{fmt(equipment.reduce((s, e) => s + computeEquipment(e).weldLengthM, 0), 0)} m</span><span className="l">Weld length under ITP</span></div>
        <div className="kpi"><span className="v">{equipment.filter((e) => e.ndtPlan?.some((p) => p.enabled && p.method === 'putTofd')).length}</span><span className="l">Tags with PaUT/TOFD</span></div>
        <div className="kpi green"><span className="v">{fmt(equipment.reduce((s, e) => s + stageData(e).total, 0), 0)} h</span><span className="l">Total inspection hours (project)</span></div>
      </div>

      <div className="tablewrap" style={{ marginBottom: 16 }}>
        <table className="grid">
          <thead>
            <tr><th>Sr.</th><th>Tag</th><th>Name</th><th>Code basis</th><th>RT category</th><th>Inspection level</th><th>Form</th><th className="num">Warnings</th></tr>
          </thead>
          <tbody>
            {summary.map(({ e, calc }, i) => (
              <tr key={e.id}>
                <td className="num">{i + 1}</td>
                <td className="mono">{e.tag}</td>
                <td>{e.name}</td>
                <td className="small muted">{calc.codeRef.split(':')[0]}</td>
                <td>
                  <select value={e.rtCategory} onChange={(ev) => setState((s) => ({ equipment: s.equipment.map((x) => (x.id === e.id ? { ...x, rtCategory: ev.target.value as never } : x)) }))}>
                    <option value="full">Full RT (E=1.0)</option><option value="spot">Spot RT (E=0.85)</option><option value="none">None (E=0.70)</option>
                  </select>
                </td>
                <td>
                  <select value={e.inspectionLevel} onChange={(ev) => setState((s) => ({ equipment: s.equipment.map((x) => (x.id === e.id ? { ...x, inspectionLevel: ev.target.value as never } : x)) }))}>
                    <option value="3.1">3.1 — Standard</option>
                    <option value="3.2">3.2 — Enhanced (AIA)</option>
                  </select>
                </td>
                <td className="small">{e.inspectionLevel === '3.1' ? "U-1A Manufacturer's Data Report" : 'U-1 Data Report (Authorized Inspector)'}</td>
                <td className="num">{calc.warnings.length ? <span className="badge warn">{calc.warnings.length}</span> : <span className="badge ok">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Stage timing & duration — check the phases each stage applies to; tick a box to unlock its hours selection (auto or manual)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Every box you tick adds that phase's share of the stage hours to the tag total; untick a box and the hours
          drop back out. A stage with nothing ticked is skipped (0 h). Auto hours come from the engine norms; the
          manual box replaces them before the same phase scaling is applied.
        </p>
        {summary.map(({ e, calc }) => {
          const { stages, ref, total: totalH } = stageData(e, calc);
          const upStage = (code: string, patch: Partial<ItpStageTiming>) => {
            setState((s) => ({
              equipment: s.equipment.map((x) => {
                if (x.id !== e.id) return x;
                const cur = mergeItpStages(defaultItpStages(x, computeEquipment(x)), x.itpStages);
                return { ...x, itpStages: cur.map((st) => (st.code === code ? { ...st, ...patch } : st)) };
              }),
            }));
          };
          const togglePhase = (code: string, phase: ItpStagePhase) => {
            const st = stages.find((s) => s.code === code)!;
            const phases = st.phases.includes(phase) ? st.phases.filter((p) => p !== phase) : [...st.phases, phase];
            upStage(code, { phases });
          };
          return (
            <details key={e.id} style={{ marginBottom: 10 }} open={summary.length === 1}>
              <summary>
                <strong className="mono">{e.tag}</strong> — {e.name} ·{' '}
                <span className="badge info">total {fmt(totalH, 1)} h</span>{' '}
                <span className="muted small">
                  ({stages.filter((s) => s.phases.length > 0).length}/{stages.length} stages active ·{' '}
                  {stages.filter((s) => s.durationOverrideH !== null && s.phases.length > 0).length} manual)
                </span>
              </summary>
              <div className="tablewrap" style={{ marginTop: 6 }}>
                <table className="grid">
                  <thead>
                    <tr><th>Stage</th><th>Timing (checkbox per phase)</th><th className="num">Auto (h)</th><th className="num">Hours selection (h)</th><th className="num">Effective (h)</th></tr>
                  </thead>
                  <tbody>
                    {stages.map((st) => {
                      const active = st.phases.length > 0;
                      const eff = effectiveDurationH(st, ref.get(st.code));
                      const deltaVsAuto = eff - st.durationH;
                      const selValue =
                        st.durationOverrideH === null
                          ? 'auto'
                          : ITP_HOUR_PRESETS.includes(st.durationOverrideH)
                          ? String(st.durationOverrideH)
                          : 'custom';
                      return (
                        <tr key={st.code} className={active ? '' : 'muted'}>
                          <td className="small">{itpStageName(st.code)}</td>
                          <td>
                            <span className="timing-boxes">
                              {(Object.keys(ITP_PHASE_LABELS) as ItpStagePhase[]).map((ph) => (
                                <label key={ph} className={st.phases.includes(ph) ? 'on' : ''}>
                                  <input type="checkbox" checked={st.phases.includes(ph)} onChange={() => togglePhase(st.code, ph)} />
                                  {ITP_PHASE_LABELS[ph]}
                                </label>
                              ))}
                            </span>
                          </td>
                          <td className="num calc" title="Engine estimate at the default phase coverage">{active ? fmt(st.durationH, 1) : '—'}</td>
                          <td className="num">
                            {active ? (
                              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                <select
                                  value={selValue}
                                  onChange={(ev) => {
                                    if (ev.target.value === 'auto') upStage(st.code, { durationOverrideH: null });
                                    else if (ev.target.value !== 'custom') upStage(st.code, { durationOverrideH: +ev.target.value });
                                  }}
                                  title="Pick hours when the stage is checked — Auto uses the engine estimate"
                                  style={{ width: 118 }}
                                >
                                  <option value="auto">Auto ({fmt(st.durationH, 1)} h)</option>
                                  {ITP_HOUR_PRESETS.map((h) => (
                                    <option key={h} value={h}>{h} h</option>
                                  ))}
                                  {selValue === 'custom' && (
                                    <option value="custom">{st.durationOverrideH} h (manual)</option>
                                  )}
                                </select>
                                <input
                                  type="number"
                                  className="num"
                                  min={0}
                                  step={0.5}
                                  placeholder="manual"
                                  value={st.durationOverrideH ?? ''}
                                  onChange={(ev) => upStage(st.code, { durationOverrideH: ev.target.value === '' ? null : +ev.target.value })}
                                  style={{ width: 70 }}
                                  title="Manual hours entry (any value)"
                                />
                              </span>
                            ) : (
                              <span className="muted small">unticked — 0 h</span>
                            )}
                          </td>
                          <td className="num">
                            <strong>{fmt(eff, 1)}</strong>
                            {active && Math.abs(deltaVsAuto) >= 0.05 && (
                              <span className="small muted" style={{ marginLeft: 4 }} title="Change caused by the phase boxes you ticked">
                                {deltaVsAuto > 0 ? '▲ +' : '▼ −'}{fmt(Math.abs(deltaVsAuto), 1)} h
                              </span>
                            )}
                            {!active && <span className="badge" style={{ marginLeft: 4 }}>skipped</span>}
                            {active && st.durationOverrideH !== null && <span className="badge warn" style={{ marginLeft: 4 }}>manual</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4}><strong>Total inspection hours — {e.tag}</strong></td><td className="num"><strong>{fmt(totalH, 1)}</strong></td></tr>
                  </tfoot>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <div className="card">
        <h3>Combined ITP — requirement per selected inspection level (W = witness, H = hold, R = review)</h3>
        <div style={{ marginBottom: 8 }} className="no-print">
          <button className="primary" onClick={() => printElementById('itp-print-root', 'Inspection & Test Plan')}>⎙ PDF — ITP</button>{' '}
          <button onClick={() => downloadCSV('itp.csv', [['Tag', 'Activity', 'Code', 'Requirement', 'Witness'], ...equipment.flatMap(rows)],)}>{' '}Export ITP CSV</button>
          <button onClick={() => downloadCSV('itp_stages.csv', [['Tag', 'Stage code', 'Stage', 'Timing phases', 'Est. h', 'Manual h', 'Effective h'], ...equipment.flatMap((e) => { const d = stageData(e); return d.stages.map((st) => [e.tag, st.code, itpStageName(st.code), st.phases.length ? st.phases.map((p) => ITP_PHASE_LABELS[p]).join(' | ') : 'not ticked (skipped)', fmt(st.durationH, 1), st.durationOverrideH ?? '', fmt(effectiveDurationH(st, d.ref.get(st.code)), 1)]); })])}>Export stage schedule CSV</button>
        </div>
        <div id="itp-print-root" style={{ display: 'none' }}>
          <h2>Inspection & Test Plan — {settings.projectName ?? 'project'}</h2>
          <table className="grid">
            <thead><tr><th>Tag</th><th>Stage</th><th>Timing phases</th><th>Est. h</th><th>Manual h</th><th>Effective h</th></tr></thead>
            <tbody>{equipment.flatMap((e) => { const d = stageData(e); return d.stages.map((st) => <tr key={e.id + st.code}><td>{e.tag}</td><td>{itpStageName(st.code)}</td><td>{st.phases.length ? st.phases.map((p) => ITP_PHASE_LABELS[p]).join(', ') : 'not ticked (skipped)'}</td><td>{fmt(st.durationH, 1)}</td><td>{st.durationOverrideH ?? '—'}</td><td>{fmt(effectiveDurationH(st, d.ref.get(st.code)), 1)}</td></tr>); })}</tbody>
            <tfoot><tr><td colSpan={5}>Project inspection hours</td><td>{fmt(equipment.reduce((s, e) => s + stageData(e).total, 0), 1)}</td></tr></tfoot>
          </table>
          <h2>Combined ITP</h2>
          <table className="grid">
            <thead><tr><th>Tag</th><th>Activity</th><th>Code</th><th>Requirement</th><th>Witness</th></tr></thead>
            <tbody>{equipment.flatMap(rows).map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="tablewrap" style={{ maxHeight: 480 }}>
          <table className="grid">
            <thead><tr><th>Tag</th><th>Activity</th><th>Code</th><th>Requirement (per selected level)</th><th>Witness</th></tr></thead>
            <tbody>
              {equipment.slice(0, 4).map((e) =>
                itpRows(e).map((r, i) => (
                  <tr key={e.id + i}>
                    <td className="mono small">{e.tag}</td>
                    <td>{r.activity}</td>
                    <td className="small muted">{r.code}</td>
                    <td>{e.inspectionLevel === '3.1' ? r.level31 : r.level32}</td>
                    <td className={r.witness === 'H' ? 'err' : r.witness === 'W' ? 'warn' : 'muted'}>{r.witness}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">Showing first 4 tags in detail; CSV export covers all {equipment.length} tags.</p>
      </div>
    </div>
  );
}
