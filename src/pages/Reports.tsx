// Automated calculation reports — print-ready sheet per tag + CSV exports + CAD export.

import { useMemo } from 'react';
import { useStore, setState } from '../store';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';
import { reportUnits, unitModeLabel } from '../engine/reportUnits';
import { exportDatasheetPdf } from '../pdfexport';
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
  // Reporting units — the engine stays SI; imperial is applied at this edge only.
  const u = reportUnits(settings.units);
  const L = u.labels;

  if (!equip || !calc) return <div className="card">Create equipment tags in the Register first.</div>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={equip.id} onChange={(e) => setState({ selectedEquipId: e.target.value })} style={{ minWidth: 260 }}>
          {equipment.map((e) => <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>)}
        </select>
        <button className="primary" onClick={() => printElementById('report-sheet', `${equip.tag} — calculation report`)}>⎙ PDF — this tag</button>
        <button onClick={() => void exportDatasheetPdf(equip, calc, { projectName: settings.projectName, clientName: settings.clientName, units: settings.units })}>⤓ Datasheet PDF (file)</button>{' '}
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
          <div className="kpi"><span className="v">{u.press(equip.designPressure)} {L.press} / {u.temp(equip.designTemp)} {L.temp}</span><span className="l">Design conditions</span></div>
          <div className="kpi"><span className="v">{u.press(calc.mawpBar)} {L.press} g</span><span className="l">MAWP — {calc.mawpNote}</span></div>
          <div className="kpi"><span className="v">{u.press(calc.hydroTestBar)} {L.press}</span><span className="l">Hydrotest (top / bottom {u.press(calc.hydroTestBottomBar)})</span></div>
          <div className="kpi"><span className="v">{u.mass(calc.weightDryKg)} {L.mass}</span><span className="l">Dry weight (op. {u.mass(calc.weightOperatingKg)} {L.mass})</span></div>
          <div className="kpi"><span className="v">{u.vol(calc.internalVolumeM3)} {L.vol}</span><span className="l">Internal volume · paint {u.area(calc.paintAreaM2)} {L.area}</span></div>
          <div className="kpi"><span className="v">E = {calc.weldEfficiency.toFixed(2)}</span><span className="l">Joint efficiency ({equip.rtCategory} RT) · S = {u.stress(calc.sAllow)} {L.stress}</span></div>
        </div>
        {settings.units === 'imperial' && (
          <p className="small muted" style={{ marginTop: -6 }}>
            Imperial reporting mode — the vessel datasheet above and the exported PDF are in {unitModeLabel(settings.units)}; the editor, tank / exchanger / fin-fan tables and every stored value remain SI (mm · bar · °C · kg).
          </p>
        )}

        <h3>Shell sections</h3>
        <table className="grid" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>Sec</th><th className="num">ID ({L.len})</th><th className="num">T-T ({L.len})</th><th>Material</th><th className="num">t req ({L.len})</th><th className="num">t + CA ({L.len})</th><th className="num">t nom ({L.len})</th><th className="num">t corr ({L.len})</th><th className="num">MAWP hoop/long ({L.press})</th><th className="num">Util %</th><th>Governing</th></tr>
          </thead>
          <tbody>
            {calc.sections.map((s, i) => (
              <tr key={s.spec.id}>
                <td>{i + 1}</td>
                <td className="num">{u.len(s.spec.dia, 1)}</td>
                <td className="num">{u.len(s.spec.ttLength, 0)}</td>
                <td className="small">{getMat(equip.materialKey)?.name ?? equip.materialKey}</td>
                <td className="num calc">{u.len(s.tReq, 2)}</td>
                <td className="num calc">{u.len(s.tMinNominal, 2)}</td>
                <td className="num">{u.len(s.tNominal, 2)}</td>
                <td className="num">{u.len(s.tCorroded, 2)}</td>
                <td className="num calc">{u.press(s.mawpHoop, 1)} / {u.press(s.mawpLong, 1)}</td>
                <td className="num">{(s.utilization * 100).toFixed(0)}</td>
                <td className="small">{s.governing}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Dish ends</h3>
        <table className="grid" style={{ marginBottom: 12 }}>              <thead><tr><th>Sec</th><th>Position</th><th>Type</th><th className="num">Crown R ({L.len})</th><th className="num">Knuckle R ({L.len})</th><th className="num">t req ({L.len})</th><th className="num">t nom ({L.len})</th><th className="num">Blank Ø ({L.len})</th><th className="num">MAWP ({L.press})</th></tr></thead>
          <tbody>
            {calc.sections.flatMap((s, i) =>
              [s.headTop, s.headBot]
                .filter(Boolean)
                .map((h, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>{i + 1}</td>
                    <td>{j === 0 ? 'Top' : 'Bottom'}</td>
                    <td>{h!.type}</td>
                    <td className="num">{u.len(h!.crownR, 1)}</td>
                    <td className="num">{u.len(h!.knuckleR, 1)}</td>
                    <td className="num calc">{u.len(h!.tReq, 2)}</td>
                    <td className="num">{u.len(h!.tMinNominal, 2)}</td>
                    <td className="num">{u.len(h!.blankDia, 0)}</td>
                    <td className="num calc">{u.press(h!.mawp, 1)}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>

        {calc.nozzles.length > 0 && (
          <>
            <h3>Nozzle reinforcement & flange rating</h3>
            <table className="grid" style={{ marginBottom: 12 }}>
              <thead><tr><th>Tag</th><th>Service</th><th className="num">DN bore</th><th className="num">Neck t ({L.len})</th><th className="num">UG-45 min ({L.len})</th><th className="num">A req (mm²)</th><th className="num">A prov (mm²)</th><th>Reinf.</th><th>Flange</th><th className="num">Rating @T ({L.press})</th><th>Local loads</th><th>OK</th></tr></thead>
              <tbody>
                {calc.nozzles.map((n) => (
                  <tr key={n.spec.id}>
                    <td className="mono small">{n.spec.tag}</td>
                    <td className="small">{n.spec.service}</td>
                    <td className="num">{n.spec.dn}</td>
                    <td className="num">{u.len(n.wall, 2)}</td>
                    <td className="num">{u.len(n.ug45min, 2)}</td>
                    <td className="num">{fmt(n.Areq, 0)}</td>
                    <td className="num">{fmt(n.Aprov, 0)}</td>
                    <td>{n.reinforceOK ? <span className="badge ok">OK</span> : <span className="badge err">FAIL</span>}</td>
                    <td className="small">Cl {n.spec.flangeClass}</td>
                    <td className="num calc">{u.press(n.flangeRating, 1)} {L.press}</td>
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
              <thead><tr><th className="num">L ({L.len})</th><th className="num">Do ({L.len})</th><th className="num">t corr ({L.len})</th><th className="num">Do/t</th><th className="num">A</th><th className="num">B (psi)</th><th className="num">P allow ({L.press})</th><th>OK</th></tr></thead>
              <tbody>
                {calc.sections.filter((s) => s.external).map((s, i) => (
                  <tr key={i}>
                    <td className="num">{u.len(s.external!.L, 0)}</td>
                    <td className="num">{u.len(s.external!.Do, 0)}</td>
                    <td className="num">{u.len(s.external!.t, 2)}</td>
                    <td className="num">{fmt(s.external!.DoOverT, 0)}</td>
                    <td className="num">{s.external!.A.toExponential(3)}</td>
                    <td className="num">{fmt(s.external!.B, 0)}</td>
                    <td className="num calc">{u.press(s.external!.pAllowBar, 3)}</td>
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
              <thead><tr><th>Grade</th><th>Type</th><th className="num">Thickness ({L.len})</th><th>Coverage</th><th className="num">Area ({L.area})</th><th className="num">Weight ({L.mass})</th></tr></thead>
              <tbody>
                <tr>
                  <td>{calc.clad.materialName}</td>
                  <td>{equip.clad.kind}</td>
                  <td className="num">{u.len(equip.clad.thicknessMm, 2)}</td>
                  <td>{equip.clad.mode === 'full' ? 'Full length + heads' : `Partial — ${u.len(equip.clad.partialLengthMm, 0)} ${L.len} from bottom`}</td>
                  <td className="num">{u.area(calc.clad.areaM2, 1)}</td>
                  <td className="num">{u.mass(calc.clad.weightKg, 0)}</td>
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

            {calc.hx.shellSide && (
              <>
                <h3>Shell side — Bell–Delaware rating &amp; vibration screen</h3>
                <table className="grid" style={{ marginBottom: 12 }}>
                  <thead><tr><th className="num">Re (shell)</th><th className="num">Pr</th><th className="num">h ideal (W/m²K)</th><th className="num">h shell (W/m²K)</th><th className="num">Jc · JL · JB · JR</th><th className="num">Crossflow V (m/s)</th><th className="num">Shell ΔP (bar)</th></tr></thead>
                  <tbody>
                    <tr>
                      <td className="num">{fmt(calc.hx.shellSide.reynolds, 0)}</td>
                      <td className="num">{fmt(calc.hx.shellSide.prandtl, 2)}</td>
                      <td className="num">{fmt(calc.hx.shellSide.hIdeal, 0)}</td>
                      <td className="num"><strong>{fmt(calc.hx.shellSide.hShell, 0)}</strong></td>
                      <td className="num small">{fmt(calc.hx.shellSide.jC, 3)} · {fmt(calc.hx.shellSide.jL, 3)} · {fmt(calc.hx.shellSide.jB, 3)} · {fmt(calc.hx.shellSide.jR, 3)}</td>
                      <td className="num">{fmt(calc.hx.shellSide.crossVelocityMs, 2)} / max {fmt(calc.hx.shellSide.maxVelocityMs, 2)}</td>
                      <td className="num">{fmt(calc.hx.shellSide.dPBar, 3)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="small muted" style={{ marginTop: -6 }}>
                  Basis: ESDU 73031 ideal tube bank × Bell correction structure (Jc/JL/JB/JR), shell ΔP by Kern's equivalent-diameter method — the Delaware ideal-bank j/f charts and ΔP correction charts are not reproduced. Verify against a licensed rating before specifying.
                </p>
                {calc.hx.shellSide.vibration && (
                  <div className="kpi" style={{ marginTop: 8 }}>
                    <span className="v">
                      V/Vcr {fmt(calc.hx.shellSide.vibration.feiRatio, 2)} · fₙ {fmt(calc.hx.shellSide.vibration.naturalHz, 1)} Hz · shed {fmt(calc.hx.shellSide.vibration.shedHz, 1)} Hz{' '}
                      {calc.hx.shellSide.vibration.feiRatio <= 0.8 ? <span className="badge ok">OK</span> : <span className="badge err">review</span>}
                    </span>
                    <span className="l">
                      Connors screen at span {fmt(calc.hx.shellSide.vibration.spanM, 2)} m, Vcr {fmt(calc.hx.shellSide.vibration.criticalMs, 2)} m/s; shedding ratio f_v/fₙ = {fmt(calc.hx.shellSide.vibration.shedRatio, 2)}
                      {calc.hx.shellSide.vibration.acousticHz !== null ? ` · acoustic mode ${fmt(calc.hx.shellSide.vibration.acousticHz, 1)} Hz (Mach ${fmt(calc.hx.shellSide.vibration.mach, 3)})` : ' · acoustic check needs a speed of sound'}
                    </span>
                  </div>
                )}
              </>
            )}
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
