// Automated calculation reports — print-ready sheet per tag + CSV exports + CAD export.

import { useMemo } from 'react';
import { useStore, setState } from '../store';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';
import { downloadCSV, exportDXF, exportOBJ } from '../cad';
import { getMat } from '../engine/materials';
import { printElementById } from '../print';

const JOINT_LABELS: Record<string, string> = {
  expanded: 'Strength expanded',
  strengthWelded: 'Strength welded + expanded',
  sealWeldExpanded: 'Seal welded + expanded',
  fullyWelded: 'Fully welded',
};

export default function Reports() {
  const equipment = useStore((s) => s.equipment);
  const selectedId = useStore((s) => s.selectedEquipId);
  const settings = useStore((s) => s.settings);

  const equip = equipment.find((e) => e.id === selectedId) ?? equipment[0];
  const calc = useMemo(() => (equip ? computeEquipment(equip) : null), [equip]);

  if (!equip || !calc) return <div className="card">Create equipment tags in the Register first.</div>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={equip.id} onChange={(e) => setState({ selectedEquipId: e.target.value })} style={{ minWidth: 260 }}>
          {equipment.map((e) => <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>)}
        </select>
        <button className="primary" onClick={() => printElementById('report-sheet', `${equip.tag} — calculation report`)}>⎙ PDF — this tag</button>
        <button className="green" onClick={() => printElementById('project-report', `${settings.projectName} — project report`)}>⎙ PDF — full project</button>
        <button onClick={() => downloadCSV(`${equip.tag}_calc.csv`, reportRows(equip.tag, equip.name, equip.designPressure, equip.designTemp, calc))}>Export calc CSV</button>
        <button onClick={() => exportDXF(equip, calc)}>Export DXF outline</button>
        <button onClick={() => exportOBJ(equip, calc)}>Export OBJ model</button>
      </div>

      <div className="card" id="report-sheet">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <img
              src="ramsis-logo.png"
              alt="Ramsis Engineering"
              style={{ height: 46, display: 'block' }}
              onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <div>
              <h2 style={{ margin: 0 }}>DESIGN CALCULATION REPORT</h2>
              <div className="muted small">{settings.projectName} · Client: {settings.clientName || '—'}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }} className="small">
            <div><strong>{equip.tag}</strong> — {equip.name}</div>
            <div className="muted">{calc.codeRef} · Rev 0 · {new Date().toLocaleDateString()}</div>
          </div>
        </div>

        <div className="grid2" style={{ marginBottom: 12 }}>
          <div className="kpi"><span className="v">{equip.designPressure} bar / {equip.designTemp} °C</span><span className="l">Design conditions</span></div>
          <div className="kpi"><span className="v">{fmt(calc.mawpBar, 2)} bar g</span><span className="l">MAWP — {calc.mawpNote}</span></div>
          <div className="kpi"><span className="v">{fmt(calc.hydroTestBar, 2)} bar</span><span className="l">Hydrotest (top / bottom {fmt(calc.hydroTestBottomBar, 2)})</span></div>
          <div className="kpi"><span className="v">{fmt(calc.weightDryKg, 0)} kg</span><span className="l">Dry weight (op. {fmt(calc.weightOperatingKg, 0)} kg)</span></div>
          <div className="kpi"><span className="v">{fmt(calc.internalVolumeM3, 2)} m³</span><span className="l">Internal volume · paint {fmt(calc.paintAreaM2, 1)} m²</span></div>
          <div className="kpi"><span className="v">E = {calc.weldEfficiency.toFixed(2)}</span><span className="l">Joint efficiency ({equip.rtCategory} RT) · S = {fmt(calc.sAllow, 1)} MPa</span></div>
        </div>

        <h3>Shell sections</h3>
        <table className="grid" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>Sec</th><th className="num">ID (mm)</th><th className="num">T-T (mm)</th><th>Material</th><th className="num">t req (mm)</th><th className="num">t + CA (mm)</th><th className="num">t nom (mm)</th><th className="num">t corr (mm)</th><th className="num">MAWP hoop/long</th><th className="num">Util %</th><th>Governing</th></tr>
          </thead>
          <tbody>
            {calc.sections.map((s, i) => (
              <tr key={s.spec.id}>
                <td>{i + 1}</td>
                <td className="num">{s.spec.dia}</td>
                <td className="num">{s.spec.ttLength}</td>
                <td className="small">{getMat(equip.materialKey)?.name ?? equip.materialKey}</td>
                <td className="num calc">{fmt(s.tReq, 2)}</td>
                <td className="num calc">{fmt(s.tMinNominal, 2)}</td>
                <td className="num">{s.tNominal}</td>
                <td className="num">{fmt(s.tCorroded, 2)}</td>
                <td className="num calc">{fmt(s.mawpHoop, 2)} / {fmt(s.mawpLong, 2)}</td>
                <td className="num">{(s.utilization * 100).toFixed(0)}</td>
                <td className="small">{s.governing}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Dish ends</h3>
        <table className="grid" style={{ marginBottom: 12 }}>
          <thead><tr><th>Sec</th><th>Position</th><th>Type</th><th className="num">Crown R</th><th className="num">Knuckle R</th><th className="num">t req</th><th className="num">t nom</th><th className="num">Blank Ø</th><th className="num">MAWP</th></tr></thead>
          <tbody>
            {calc.sections.flatMap((s, i) =>
              [s.headTop, s.headBot]
                .filter(Boolean)
                .map((h, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>{i + 1}</td>
                    <td>{j === 0 ? 'Top' : 'Bottom'}</td>
                    <td>{h!.type}</td>
                    <td className="num">{fmt(h!.crownR, 0)}</td>
                    <td className="num">{fmt(h!.knuckleR, 0)}</td>
                    <td className="num calc">{fmt(h!.tReq, 2)}</td>
                    <td className="num">{h!.tMinNominal}</td>
                    <td className="num">{fmt(h!.blankDia, 0)}</td>
                    <td className="num calc">{fmt(h!.mawp, 2)}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>

        {calc.nozzles.length > 0 && (
          <>
            <h3>Nozzle reinforcement & flange rating</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th>Tag</th><th>Service</th><th className="num">Bore</th><th className="num">Neck t</th><th className="num">UG-45 min</th><th className="num">A req</th><th className="num">A prov</th><th>Reinf.</th><th>Flange</th><th className="num">Rating @T</th><th>Local loads</th><th>OK</th></tr></thead>
              <tbody>
                {calc.nozzles.map((n) => (
                  <tr key={n.spec.id}>
                    <td className="mono small">{n.spec.tag}</td>
                    <td className="small">{n.spec.service}</td>
                    <td className="num">{n.spec.dn}</td>
                    <td className="num">{fmt(n.wall, 2)}</td>
                    <td className="num">{fmt(n.ug45min, 2)}</td>
                    <td className="num">{fmt(n.Areq, 0)}</td>
                    <td className="num">{fmt(n.Aprov, 0)}</td>
                    <td>{n.reinforceOK ? <span className="badge ok">OK</span> : <span className="badge err">FAIL</span>}</td>
                    <td className="small">Cl {n.spec.flangeClass}</td>
                    <td className="num calc">{fmt(n.flangeRating, 1)} bar</td>
                    <td className="small">
                      {n.load ? (
                        <>
                          <span className={`badge ${n.load.ok ? 'ok' : 'err'}`}>{fmt(n.load.util * 100, 0)}%</span>{' '}
                          <span className="muted">Pe {fmt(n.load.equivPressureBar, 1)} bar</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{n.flangeClassOK && n.neckOK && (n.load?.ok ?? true) ? <span className="badge ok">OK</span> : <span className="badge err">FAIL</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {calc.sections.some((s) => s.external) && (
          <>
            <h3>External pressure (UG-28)</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th className="num">L (mm)</th><th className="num">Do</th><th className="num">t corr</th><th className="num">Do/t</th><th className="num">A</th><th className="num">B (psi)</th><th className="num">P allow (bar)</th><th>OK</th></tr></thead>
              <tbody>
                {calc.sections.filter((s) => s.external).map((s, i) => (
                  <tr key={i}>
                    <td className="num">{fmt(s.external!.L, 0)}</td>
                    <td className="num">{fmt(s.external!.Do, 0)}</td>
                    <td className="num">{fmt(s.external!.t, 2)}</td>
                    <td className="num">{fmt(s.external!.DoOverT, 0)}</td>
                    <td className="num">{s.external!.A.toExponential(3)}</td>
                    <td className="num">{fmt(s.external!.B, 0)}</td>
                    <td className="num calc">{fmt(s.external!.pAllowBar, 3)}</td>
                    <td>{s.external!.ok ? <span className="badge ok">OK</span> : <span className="badge err">FAIL</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {calc.clad && equip.clad && (
          <>
            <h3>Cladding / lining</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th>Grade</th><th>Type</th><th className="num">Thickness (mm)</th><th>Coverage</th><th className="num">Area (m²)</th><th className="num">Weight (kg)</th></tr></thead>
              <tbody>
                <tr>
                  <td>{calc.clad.materialName}</td>
                  <td>{equip.clad.kind}</td>
                  <td className="num">{equip.clad.thicknessMm}</td>
                  <td>{equip.clad.mode === 'full' ? 'Full length + heads' : `Partial — ${equip.clad.partialLengthMm} mm from bottom`}</td>
                  <td className="num">{fmt(calc.clad.areaM2, 1)}</td>
                  <td className="num">{fmt(calc.clad.weightKg, 0)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {calc.tank && (
          <>
            <h3>API 650 shell courses — {calc.tank!.shellMethod === 'vdp' ? 'variable design point (§5.6.4)' : 'one-foot (§5.6.3)'}</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr>                    <th>Course (from top)</th><th className="num">Height (mm)</th><th className="num">Design head (m)</th><th className="num">Design pt (mm)</th><th className="num">t design (mm)</th><th className="num">t test (mm)</th><th className="num">t nominal (mm)</th></tr></thead>
              <tbody>
                {calc.tank.shellCourses.map((c) => (
                  <tr key={c.courseNo}>
                    <td className="num">{c.courseNo}</td>
                    <td className="num">{fmt(c.heightMm, 0)}</td>
                    <td className="num">{fmt(c.designHeadM, 2)}</td>
                    <td className="num">{c.designPointMm !== undefined ? fmt(c.designPointMm, 0) : '—'}</td>
                    <td className="num calc">{fmt(c.tDesign, 2)}</td>
                    <td className="num">{fmt(c.tTest, 2)}</td>
                    <td className="num">{fmt(c.tNominal, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small">Bottom plate {calc.tank.bottomThk} mm{calc.tank.annularThk > calc.tank.bottomThk ? ` (annular ${calc.tank.annularThk} mm)` : ''} · roof {calc.tank.roofThk} mm · volume {fmt(calc.tank.volumeM3, 0)} m³ · test water {fmt(calc.tank.hydroWaterKg / 1000, 0)} m³{calc.tank.windGirderRequired ? ' · wind girder recommended' : ''}</p>
          </>
        )}

        {calc.hx && equip.hx && (
          <>
            <h3>TEMA exchanger summary</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th>TEMA type</th><th className="num">Shell OD/ID (mm)</th><th className="num">Tubes</th><th className="num">Bundle Ø (mm)</th><th className="num">Tubesheet t (mm)</th><th>Tube joint</th><th className="num">TS clad</th><th className="num">LMTD·F (°C)</th><th className="num">Area req/prov (m²)</th></tr></thead>
              <tbody>
                <tr>
                  <td>{equip.hx.temaType}</td>
                  <td className="num">{calc.hx.shellOD} / {calc.hx.shellID}</td>
                  <td className="num">{calc.hx.tubeCountActual}</td>
                  <td className="num">{fmt(calc.hx.bundleOD, 0)}</td>
                  <td className="num">{fmt(calc.hx.tubeSheetThk, 1)}</td>
                  <td className="small">{JOINT_LABELS[equip.hx.tubeJointType ?? 'strengthWelded']}</td>
                  <td className="num small">{equip.hx.tubeSheetClad?.enabled ? `${equip.hx.tubeSheetClad.materialKey} ${equip.hx.tubeSheetClad.thicknessMm} mm (${fmt(calc.hx.tubeSheetCladKg, 0)} kg)` : '—'}</td>
                  <td className="num">{fmt(calc.hx.lmtd, 1)}</td>
                  <td className="num">{fmt(calc.hx.requiredArea, 1)} / {fmt(calc.hx.providedArea, 1)} {calc.hx.areaOK ? <span className="badge ok">OK</span> : <span className="badge err">SHORT</span>}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {calc.finfan && equip.finfan && (
          <>
            <h3>API 661 fin-fan summary</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th>Arrangement</th><th className="num">Bays × rows</th><th className="num">Tubes</th><th className="num">Finned area (m²)</th><th className="num">Air flow (m³/h)</th><th className="num">Air ΔP (in H₂O)</th><th className="num">Fan (kW)</th><th className="num">Air rise (°C)</th><th>Thermal</th></tr></thead>
              <tbody>
                <tr>
                  <td>{equip.finfan.arrangement}</td>
                  <td className="num">{equip.finfan.bays} × {equip.finfan.rows}</td>
                  <td className="num">{calc.finfan.tubeCountActual}</td>
                  <td className="num">{fmt(calc.finfan.finnedAreaM2, 0)}</td>
                  <td className="num">{fmt(calc.finfan.airFlowCMH, 0)}</td>
                  <td className="num">{fmt(calc.finfan.airDPH2O, 2)}</td>
                  <td className="num">{fmt(calc.finfan.fanKW, 1)}</td>
                  <td className="num">{fmt(calc.finfan.airTempRise, 1)}</td>
                  <td>{calc.finfan.thermalOK ? <span className="badge ok">OK</span> : <span className="badge err">SHORT</span>}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <h3>PWHT & test</h3>
        <p className="small"><strong>PWHT:</strong> {calc.pwht.required ? 'REQUIRED' : 'Not required'} — {calc.pwht.basis}</p>
        <p className="small"><strong>Preheat:</strong> {calc.pwht.preheat}</p>
        <p className="small"><strong>Fillers:</strong> {calc.pwht.fillers.join(' · ')}</p>
        <p className="small"><strong>Hydrotest:</strong> {fmt(calc.hydroTestBar, 2)} bar at top (factor {equip.testPressureFactor} × MAWP × S_test/S_design, UG-99)</p>

        {calc.warnings.length > 0 && (
          <>
            <h3>Warnings & advisories</h3>
            {calc.warnings.map((w, i) => (
              <div key={i} className={`finding ${w.level}`}>[{w.level.toUpperCase()}] {w.code}: {w.msg}</div>
            ))}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 8 }} className="small muted">
          <span>Prepared by: ______________  (Design Engineer)</span>
          <span>Reviewed: ______________  (QA)</span>
          <span>Approved: ______________</span>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Calculations are indicative engineering estimates based on ASME VIII-1 / API 650 / API 661 / TEMA formulae as implemented in
          this tool. Verify all inputs and results against the licensed current code editions before fabrication.
        </p>
      </div>

      {/* Project-level PDF: hidden on screen, printed via iframe copy */}
      <div id="project-report" style={{ display: 'none' }}>
        <div className="print-head">
          <img src="ramsis-logo.png" alt="Ramsis Engineering" />
          <div>
            <h2 style={{ margin: 0 }}>PROJECT EQUIPMENT REPORT</h2>
            <div className="small">{settings.projectName} · Client: {settings.clientName || '—'} · {equipment.length} tags · Rev 0 · {new Date().toLocaleDateString()}</div>
          </div>
        </div>
        <table className="grid">
          <thead>
            <tr><th>Sr</th><th>Tag</th><th>Name</th><th>Type</th><th className="num">P (bar)</th><th className="num">T (°C)</th><th>Material</th><th className="num">MAWP (bar)</th><th className="num">Hydro (bar)</th><th className="num">Dry wt (kg)</th><th className="num">Weld (m)</th><th>PWHT</th><th>Status</th></tr>
          </thead>
          <tbody>
            {equipment.map((e, i) => {
              const c = e.id === equip.id ? calc : computeEquipment(e);
              const errs = c.warnings.filter((w) => w.level === 'error').length;
              const warns = c.warnings.filter((w) => w.level === 'warning').length;
              return (
                <tr key={e.id}>
                  <td>{i + 1}</td><td>{e.tag}</td><td>{e.name}</td><td>{e.equipType}</td>
                  <td className="num">{e.designPressure}</td><td className="num">{e.designTemp}</td>
                  <td>{getMat(e.materialKey)?.name ?? e.materialKey}</td>
                  <td className="num">{fmt(c.mawpBar, 2)}</td><td className="num">{fmt(c.hydroTestBar, 2)}</td>
                  <td className="num">{fmt(c.weightDryKg, 0)}</td><td className="num">{fmt(c.weldLengthM, 1)}</td>
                  <td>{c.pwht.required ? 'Required' : 'No'}</td>
                  <td>{errs > 0 ? `${errs} err` : warns > 0 ? `${warns} warn` : 'OK'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9}><strong>Project totals</strong></td>
              <td className="num"><strong>{fmt(equipment.reduce((s, e) => s + (e.id === equip.id ? calc : computeEquipment(e)).weightDryKg, 0) / 1000, 2)} t</strong></td>
              <td className="num"><strong>{fmt(equipment.reduce((s, e) => s + (e.id === equip.id ? calc : computeEquipment(e)).weldLengthM, 0), 1)}</strong></td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
        <h3>Warnings & advisories by tag</h3>
        {equipment.map((e) => {
          const c = e.id === equip.id ? calc : computeEquipment(e);
          return c.warnings.length > 0 ? (
            <div key={e.id}>
              <p className="small"><strong>{e.tag}</strong> — {e.name}</p>
              {c.warnings.map((w, i) => <div key={i} className={`finding ${w.level}`}>[{w.level.toUpperCase()}] {w.code}: {w.msg}</div>)}
            </div>
          ) : null;
        })}
        <p className="small" style={{ marginTop: 10 }}>
          Indicative estimates per ASME VIII-1 / API 650 / API 661 / TEMA — verify against licensed current code editions.
        </p>
      </div>
    </div>
  );
}

function reportRows(
  tag: string,
  name: string,
  designP: number,
  designT: number,
  calc: ReturnType<typeof computeEquipment>
): (string | number)[][] {
  const rows: (string | number)[][] = [['Section', 'ID mm', 'T-T mm', 't req', 't+CA', 't nom', 'MAWP bar', 'Util %', 'Governing']];
  calc.sections.forEach((s, i) => {
    rows.push([i + 1, s.spec.dia, s.spec.ttLength, fmt(s.tReq, 2), fmt(s.tMinNominal, 2), s.tNominal, fmt(s.mawpHoop, 2), (s.utilization * 100).toFixed(0), s.governing]);
  });
  rows.push([]);
  rows.push(['Tag', tag, name, designP + ' bar', designT + ' °C', 'MAWP ' + fmt(calc.mawpBar, 2) + ' bar', 'Hydro ' + fmt(calc.hydroTestBar, 2) + ' bar']);
  return rows;
}
