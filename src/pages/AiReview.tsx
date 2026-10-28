// Gemini-assisted ASME compliance review — attaches datasheets per tag and asks
// Gemini to evaluate code compliance and suggest design optimizations.
// The API key is entered by the user and stored locally (Settings). Calls go
// directly from the browser to generativelanguage.googleapis.com v1beta.

import { useEffect, useRef, useMemo, useState } from 'react';
import { useStore, setState, getStore, setSettings } from '../store';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';
import type { Equipment } from '../engine/types';
import { IMPORT_PROMPT, applyDatasheetImport, parseDatasheetResponse, type ApplyResult, type DatasheetImport } from '../datasheetImport';

const SYSTEM_PROMPT = `You are a senior pressure-vessel design checker experienced with ASME Section VIII Division 1 & 2, API 650, API 661 and TEMA.
You receive a JSON datasheet of one equipment tag (inputs + calculated results + warnings) and optionally an attached client datasheet document.
Evaluate:
1. Code compliance: thickness, heads (UG-27/UG-32), nozzle reinforcement (UG-32/UG-37), UG-45, external pressure (UG-28), hydrotest (UG-99), flange ratings (B16.5), joint efficiency/RT category, MDMT (UCS-66), PWHT (UCS-56). API 650 / API 661 / TEMA rules where the tag type requires it — including API 650 shell method (one-foot §5.6.3 vs variable design point §5.6.4), annular plates (Table 5-1a) and anchor bolts. Where nozzle local loads are present, check the WRC 107 screening (shell shear, nominal neck stress, Kellogg equivalent pressure into the flange rating; allowable 1.5·S) and note that full curve-based WRC 107/537 stresses need the licensed bulletin.
2. Consistency with the attached client datasheet: flag any input mismatch or missing data.
3. Design optimizations: material alternative, thickness/weight savings, standard plate utilization, nozzle/flange class rationalization, PWHT avoidance.
Respond ONLY with JSON: {"summary": "...", "findings":[{"severity":"error|warning|info","code":"UG-27","message":"..."}],"optimizations":["..."],"datasheetMismatches":["..."],"overall":"compliant|action required"}. Be specific with numbers.`;

interface ReviewResponse {
  summary?: string;
  findings?: { severity: string; code: string; message: string }[];
  optimizations?: string[];
  datasheetMismatches?: string[];
  overall?: string;
}

export default function AiReview() {
  const equipment = useStore((s) => s.equipment);
  const selectedId = useStore((s) => s.selectedEquipId);
  const settings = useStore((s) => s.settings);
  const datasheets = useStore((s) => s.datasheets);
  const staleDatasheets = useStore((s) => s.staleDatasheets);
  const reviews = useStore((s) => s.reviews);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [parsed, setParsed] = useState<Record<string, ReviewResponse>>({});
  /** pending datasheet→tag import: parsed patch + computed preview, before/after apply */
  const [imp, setImp] = useState<{ parsed: DatasheetImport; preview: ApplyResult; applied: boolean } | null>(null);
  /** the exact request body of the last Gemini call, for the "data sent" panel */
  const [lastCall, setLastCall] = useState<{ kind: 'review' | 'import'; at: number; bytes: number; attachment: string | null; json: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const equip = equipment.find((e) => e.id === selectedId) ?? equipment[0];

  const attachFile = async (file: File) => {
    if (!equip) return;
    if (file.size > 20 * 1024 * 1024) {
      setErr('File too large for inline review (20 MB limit).');
      return;
    }
    const data = await fileToBase64(file);
    getStore()._datasheetData[equip.id] = data;
    setState((s) => ({
      datasheets: [...s.datasheets.filter((d) => d.equipId !== equip.id), { equipId: equip.id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size }],
      staleDatasheets: s.staleDatasheets.filter((d) => d.equipId !== equip.id),
    }));
  };

  const runReview = async () => {
    if (!equip) return;
    if (!settings.geminiKey) {
      setErr('Add your Gemini API key in Settings first.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const calc = computeEquipment(equip);
      const payload = {
        tag: equip.tag,
        name: equip.name,
        type: equip.equipType,
        orientation: equip.orientation,
        designPressure_bar: equip.designPressure,
        designTemp_C: equip.designTemp,
        mdmt_C: equip.mdmt,
        corrosionAllowance_mm: equip.corrosionAllowance,
        material: equip.materialKey,
        rtCategory: equip.rtCategory,
        inspectionLevel: equip.inspectionLevel,
        sections: equip.sections,
        nozzles: equip.nozzles,
        internals: equip.internals,
        clad: equip.clad?.mode !== 'none' ? equip.clad : undefined,
        ndtPlan: equip.ndtPlan,
        calculated: {
          mawp_bar: fmt(calc.mawpBar, 2),
          hydroTest_bar: fmt(calc.hydroTestBar, 2),
          sections: calc.sections.map((s) => ({
            id: s.spec.id, tRequired_mm: fmt(s.tReq, 2), tNominal_mm: s.tNominal, tCorroded_mm: fmt(s.tCorroded, 2),
            utilization: fmt(s.utilization * 100, 0) + '%', governing: s.governing,
            headTop: s.headTop ? { tReq: fmt(s.headTop.tReq, 2), tNominal: s.headTop.tMinNominal } : null,
            headBot: s.headBot ? { tReq: fmt(s.headBot.tReq, 2), tNominal: s.headBot.tMinNominal } : null,
            externalPressure: s.external ? { pAllow_bar: fmt(s.external.pAllowBar, 3), ok: s.external.ok } : null,
          })),
          nozzles: calc.nozzles.map((n) => ({
            tag: n.spec.tag, dn: n.spec.dn, wall: fmt(n.wall, 2), Areq: fmt(n.Areq, 0), Aprov: fmt(n.Aprov, 0),
            reinforceOK: n.reinforceOK, flangeClass: n.spec.flangeClass, flangeRating_bar: fmt(n.flangeRating, 0), flangeOK: n.flangeClassOK,
            localLoad: n.load ? {
              util_pct: fmt(n.load.util * 100, 0), ok: n.load.ok,
              equivPressure_bar: fmt(n.load.equivPressureBar, 1),
              shellShear_MPa: fmt(n.load.shellShearMPa, 1), neckVonMises_MPa: fmt(n.load.neckVonMisesMPa, 1),
              gamma: fmt(n.load.gamma, 1), beta: fmt(n.load.beta, 3),
            } : null,
          })),
          tank: calc.tank ? {
            shellMethod: calc.tank.shellMethod,
            annularThk_mm: calc.tank.annularThk,
            bottomThk_mm: calc.tank.bottomThk,
            anchorBoltArea_mm2: fmt(calc.tank.anchorBoltAreaMm2, 0),
            windGirderRequired: calc.tank.windGirderRequired,
            courses: calc.tank.shellCourses.map((c) => ({
              course: c.courseNo, designHead_m: c.designHeadM, designPoint_mm: c.designPointMm,
              tDesign_mm: fmt(c.tDesign, 2), tNominal_mm: c.tNominal, grade: c.material,
            })),
          } : undefined,
          pwht: calc.pwht,
          clad: calc.clad ? { grade: calc.clad.materialName, weight_kg: fmt(calc.clad.weightKg, 0), area_m2: fmt(calc.clad.areaM2, 1) } : undefined,
          weightDry_kg: fmt(calc.weightDryKg, 0),
        },
        warnings: calc.warnings,
      };

      const parts: unknown[] = [{ text: `Equipment datasheet JSON:\n${JSON.stringify(payload, null, 2)}` }];
      const ds = getStore()._datasheetData[equip.id];
      const dsMeta = datasheets.find((d) => d.equipId === equip.id);
      if (ds && dsMeta) {
        parts.push({ text: `Attached client datasheet: ${dsMeta.name}` });
        parts.push({ inline_data: { mime_type: dsMeta.mime, data: ds } });
      }

      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      };
      setLastCall({ kind: 'review', at: Date.now(), bytes: JSON.stringify(body).length, attachment: dsMeta?.name ?? null, json: displayBody(body) });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Gemini API ${res.status}: ${t.slice(0, 400)}`);
      }
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      let review: ReviewResponse;
      try {
        review = JSON.parse(text);
      } catch {
        review = { summary: text.slice(0, 4000), overall: 'parse error' };
      }
      setParsed((p) => ({ ...p, [equip.id]: review }));
      setState((s) => ({
        reviews: [
          { equipId: equip.id, at: new Date().toISOString(), model: settings.geminiModel, findings: (review.findings ?? []).map((f) => `[${f.severity.toUpperCase()}] ${f.code}: ${f.message}`).join('\n'), raw: text },
          ...s.reviews.filter((r) => r.equipId !== equip.id),
        ],
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** current INPUTS only — what the model must reconcile against (no calculated data) */
  const snapshotOf = (e: Equipment) => ({
    tag: e.tag,
    name: e.name,
    type: e.equipType,
    orientation: e.orientation,
    designPressure_bar: e.designPressure,
    designTemp_C: e.designTemp,
    mdmt_C: e.mdmt,
    corrosionAllowance_mm: e.corrosionAllowance,
    materialKey: e.materialKey,
    rtCategory: e.rtCategory,
    sections: e.sections.map((s) => ({
      dia: s.dia, ttLength: s.ttLength, headTop: s.headTop, headBottom: s.headBottom,
      shellThk: s.shellThk, headThkTop: s.headThkTop, headThkBot: s.headThkBot,
    })),
    nozzles: e.nozzles.map((n) => ({
      tag: n.tag, service: n.service, dn: n.dn, flangeClass: n.flangeClass,
      elevation: n.elevation, azimuth: n.azimuth, kind: n.kind,
    })),
    tank: e.tank
      ? {
          fluidName: e.tank.fluidName, specificGravity: e.tank.specificGravity, roofType: e.tank.roofType,
          maxDesignLiquidLevel: e.tank.maxDesignLiquidLevel, bottomThk: e.tank.bottomThk,
        }
      : undefined,
  });

  /** Read the attached datasheet with Gemini and propose a patch for this tag. */
  const runImport = async () => {
    if (!equip) return;
    if (!settings.geminiKey) {
      setErr('Add your Gemini API key in Settings first.');
      return;
    }
    const ds = getStore()._datasheetData[equip.id];
    const dsMeta = datasheets.find((d) => d.equipId === equip.id);
    if (!ds || !dsMeta) {
      setErr('Attach the client datasheet first (📎 Attach datasheet) — the import reads that file.');
      return;
    }
    setBusy(true);
    setErr('');
    setImp(null);
    try {
      const body = {
        systemInstruction: { parts: [{ text: IMPORT_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: `Current tag input values (JSON):\n${JSON.stringify(snapshotOf(equip), null, 2)}` },
              { text: `Attached client datasheet: ${dsMeta.name}` },
              { inline_data: { mime_type: dsMeta.mime, data: ds } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      };
      setLastCall({ kind: 'import', at: Date.now(), bytes: JSON.stringify(body).length, attachment: dsMeta.name, json: displayBody(body) });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Gemini API ${res.status}: ${t.slice(0, 400)}`);
      }
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      const parsedImp = parseDatasheetResponse(text);
      // compute the preview NOW — applying later uses exactly this result
      setImp({ parsed: parsedImp, preview: applyDatasheetImport(equip, parsedImp), applied: false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyImport = () => {
    if (!equip || !imp || imp.applied) return;
    setState((s) => ({ equipment: s.equipment.map((e) => (e.id === equip.id ? imp.preview.equip : e)) }));
    setImp({ ...imp, applied: true });
  };

  const review = equip ? parsed[equip.id] ?? null : null;
  const stored = equip ? reviews.find((r) => r.equipId === equip.id) : null;
  const attachedMeta = equip ? datasheets.find((d) => d.equipId === equip.id) ?? null : null;

  /** engine results before and after the proposed patch — what entering the data will change */
  const impact = useMemo(() => {
    if (!equip) return null;
    const before = computeEquipment(equip);
    const after = imp ? computeEquipment(imp.preview.equip) : null;
    return { before, after };
  }, [equip, imp]);

  if (equipment.length === 0) return <div className="card">Create equipment tags in the Register first.</div>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={equip?.id} onChange={(e) => setState({ selectedEquipId: e.target.value })} style={{ minWidth: 260 }}>
          {equipment.map((e) => <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>)}
        </select>
        <button className="primary" onClick={runReview} disabled={busy || !equip}>
          {busy ? '✦ Reviewing…' : '✦ Run Gemini compliance review'}
        </button>
        <button onClick={() => fileRef.current?.click()}>📎 Attach datasheet (PDF/image)</button>
        <input ref={fileRef} type="file" accept=".pdf,image/*,.txt,.csv" hidden onChange={(e) => e.target.files?.[0] && attachFile(e.target.files[0])} />
        <button className="primary" onClick={runImport} disabled={busy || !equip}>📥 Import datasheet → fill tag</button>
        {!settings.geminiKey && <span className="badge warn">API key not set — configure in Settings</span>}
      </div>

      {err && <div className="finding error">{err}</div>}

      {equip && datasheets.some((d) => d.equipId === equip.id) && (
        <p className="small muted">
          Attached: {datasheets.find((d) => d.equipId === equip.id)!.name} (
          {(datasheets.find((d) => d.equipId === equip.id)!.size / 1024).toFixed(0)} KB)
        </p>
      )}

      {equip && !datasheets.some((d) => d.equipId === equip.id) && staleDatasheets.some((d) => d.equipId === equip.id) && (
        <div className="finding warning">
          ⚠ “{staleDatasheets.find((d) => d.equipId === equip.id)!.name}” was attached earlier, but its file content is
          not saved in this browser — it will be <strong>omitted</strong> from the review. Re-attach the file to include it.
        </div>
      )}

      {equip && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Data being sent to Gemini</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Model <strong>{settings.geminiModel}</strong> · endpoint <span className="mono">generativelanguage.googleapis.com/v1beta</span> ·
            temperature {lastCall?.kind === 'import' ? '0' : '0.2'} · the API key stays in this browser.
            {lastCall && (
              <>
                {' '}Last call: <strong>{lastCall.kind === 'review' ? 'compliance review' : 'datasheet import'}</strong> at{' '}
                {new Date(lastCall.at).toLocaleTimeString()} — {(lastCall.bytes / 1024).toFixed(1)} KB sent.
              </>
            )}
          </p>
          <table className="grid">
            <tbody>
              {inputSummary(equip).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 250 }}><strong className="small">{k}</strong></td>
                  <td className="small">{v}</td>
                </tr>
              ))}
              <tr>
                <td><strong className="small">Engine results sent</strong></td>
                <td className="small">
                  MAWP {fmt(impact?.before.mawpBar ?? 0, 2)} bar · dry weight {fmt(impact?.before.weightDryKg ?? 0, 0)} kg ·{' '}
                  {impact?.before.warnings.length ?? 0} finding(s) — every thickness, utilisation and warning shown
                  above is re-derived locally from these inputs, never accepted from the model.
                </td>
              </tr>
              <tr>
                <td><strong className="small">Client datasheet file</strong></td>
                <td className="small">
                  {attachedMeta ? `${attachedMeta.name} · ${(attachedMeta.size / 1024).toFixed(0)} KB · ${attachedMeta.mime}` : 'none attached — only the tag JSON below is sent'}
                </td>
              </tr>
            </tbody>
          </table>
          {lastCall && (
            <details style={{ marginTop: 8 }}>
              <summary className="small muted">Exact request body of the last call ({(lastCall.bytes / 1024).toFixed(1)} KB)</summary>
              <pre className="code" style={{ maxHeight: 280, overflow: 'auto' }}>{lastCall.json}</pre>
            </details>
          )}
        </div>
      )}

      {imp && !imp.applied && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Proposed data entry for {equip!.tag} — review before applying</h3>
          <div className="row" style={{ marginBottom: 8, gap: 6 }}>
            <span className="badge info">{imp.preview.changes.length} to enter</span>
            <span className="badge">{imp.preview.unchanged.length} verified identical</span>
            <span className="badge warn">{imp.preview.skipped.length + imp.parsed.missing.length} not applied</span>
          </div>
          {impact?.after && (
            <div className="finding" style={{ marginBottom: 8 }}>
              <strong>What entering this data changes:</strong> MAWP {fmt(impact.before.mawpBar, 2)} →{' '}
              {fmt(impact.after.mawpBar, 2)} bar · dry weight {fmt(impact.before.weightDryKg, 0)} →{' '}
              {fmt(impact.after.weightDryKg, 0)} kg · findings {impact.before.warnings.length} →{' '}
              {impact.after.warnings.length}
              {imp.preview.changes.length === 0 && ' (no input changes, so nothing moves)'}
            </div>
          )}
          {imp.parsed.derived.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="small"><strong>Derived from stated data (arithmetic for audit):</strong></div>
              <ul className="small muted" style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {imp.parsed.derived.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {imp.preview.changes.length > 0 ? (
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Group</th><th>Field</th><th className="num">Current</th><th className="num">Entering</th><th className="num">Δ</th></tr></thead>
                <tbody>
                  {imp.preview.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="small muted">{groupOf(c.field)}</td>
                      <td className="small"><strong>{labelOf(c.field)}</strong> <span className="mono muted small">{c.field}</span></td>
                      <td className="num small">{c.from}</td>
                      <td className="num calc small"><strong>{c.to}</strong></td>
                      <td className="num small">{deltaOf(c.from, c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">Nothing to change — the datasheet matches the current values.</p>
          )}
          {imp.preview.unchanged.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="small muted">
                {imp.preview.unchanged.length} stated value(s) already match the tag — read and verified, not written
              </summary>
              <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {imp.preview.unchanged.map((f, i) => <li key={i}>{labelOf(f)} <span className="mono">{f}</span></li>)}
              </ul>
            </details>
          )}
          {(imp.preview.skipped.length > 0 || imp.parsed.missing.length > 0) && (
            <details style={{ marginTop: 6 }} open={imp.preview.skipped.length > 0}>
              <summary className="small">
                Not applied ({imp.preview.skipped.length + imp.parsed.missing.length}) — rejected by validation or not stated on the datasheet
              </summary>
              <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {[...imp.preview.skipped, ...imp.parsed.missing].map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </details>
          )}
          {imp.parsed.notes && <p className="small" style={{ marginTop: 6 }}>Model note: {imp.parsed.notes}</p>}
          <details style={{ marginTop: 6 }}>
            <summary className="small muted">Raw model response (exactly what was parsed into the table above)</summary>
            <pre className="code" style={{ maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(imp.parsed, null, 2)}</pre>
          </details>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={applyImport} disabled={imp.preview.changes.length === 0}>
              ✔ Enter {imp.preview.changes.length} value(s) into the tag
            </button>
            <button onClick={() => setImp(null)}>✕ Discard</button>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Only inputs are patched. Thicknesses, MAWP, weights, volumes and warnings are re-derived by the engine
            after applying — the model never writes calculated values.
          </p>
        </div>
      )}

      {imp?.applied && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--ok, #2e7d32)' }}>
          <h3>✅ Data entered into {equip!.tag}</h3>
          <table className="grid">
            <thead><tr><th>Group</th><th>Field</th><th className="num">Was</th><th className="num">Now</th></tr></thead>
            <tbody>
              {imp.preview.changes.map((c, i) => (
                <tr key={i}>
                  <td className="small muted">{groupOf(c.field)}</td>
                  <td className="small">{labelOf(c.field)} <span className="mono muted small">{c.field}</span></td>
                  <td className="num small">{c.from}</td>
                  <td className="num small calc"><strong>{c.to}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {impact?.after && (
            <p className="small" style={{ marginTop: 8 }}>
              Engine re-derived from the entered data: MAWP {fmt(impact.after.mawpBar, 2)} bar · dry weight{' '}
              {fmt(impact.after.weightDryKg, 0)} kg · {impact.after.warnings.length} finding(s). Re-run the compliance
              review to refresh the results.
            </p>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => setImp(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {review && (
        <div className="row">
          <div className="card" style={{ flex: 2 }}>
            <h3>Review of {equip!.tag} — {review.overall ?? 'done'}</h3>
            {review.summary && <p>{review.summary}</p>}
            {(review.findings ?? []).map((f, i) => (
              <div key={i} className={`finding ${f.severity}`}>[{f.severity.toUpperCase()}] {f.code} — {f.message}</div>
            ))}
          </div>
          <div className="card" style={{ flex: 1 }}>
            <h3>Optimizations</h3>
            {(review.optimizations ?? []).map((o, i) => <div key={i} className="finding">💡 {o}</div>)}
            {(review.datasheetMismatches ?? []).length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>Datasheet mismatches</h3>
                {review.datasheetMismatches!.map((m, i) => <div key={i} className="finding warning">⚠ {m}</div>)}
              </>
            )}
          </div>
        </div>
      )}

      {!review && stored && (
        <div className="card">
          <h3>Last stored review ({stored.model} · {new Date(stored.at).toLocaleString()})</h3>
          <pre className="code">{stored.raw ?? stored.findings}</pre>
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h3>How this works</h3>
        <p className="muted small">
          The tag's full input datasheet and all calculated results are sent to Google Gemini ({settings.geminiModel}) together with any
          attached client datasheet file. Gemini checks the design against the applicable code clauses and proposes optimizations.
          <br />
          <strong>Import datasheet → fill tag</strong> reads the attached client datasheet (PDF or image), proposes only
          the INPUT values stated on it (P, T, MDMT, material, geometry, nozzles — with every derivation listed for
          audit), and lets you review and apply the patch; anything not stated stays as it is, and everything the
          engine calculates is re-derived locally after applying.
          The key stays in your browser (Settings) and calls go straight to the Gemini API. For production use, route calls through
          your own backend to keep the key server-side.
        </p>
        <label className="f" style={{ maxWidth: 320 }}>
          <span>Model</span>
          <select value={settings.geminiModel} onChange={(e) => setSettings({ geminiModel: e.target.value })}>
            {/* Current stable IDs per https://ai.google.dev/gemini-api/docs/models (3.8 / 3.5 families recommended for new projects). */}
            {['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-4-argon', 'gemini-2.5-flash'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

/** Pretty request body with the base64 attachment elided (it can be 20 MB). */
function displayBody(body: unknown): string {
  return JSON.stringify(
    body,
    (k, v: unknown) => (k === 'data' && typeof v === 'string' ? `[base64, ${v.length} chars elided]` : v),
    2
  );
}

/** Field path → readable label, so the entry table reads like a datasheet. */
const FIELD_LABELS: Record<string, string> = {
  tag: 'Tag number', name: 'Equipment name', orientation: 'Orientation',
  'designPressure (bar g)': 'Design pressure', 'designTemp (°C)': 'Design temperature',
  'mdmt (°C)': 'MDMT', 'externalPressure (bar)': 'External pressure',
  'corrosionAllowance (mm)': 'Corrosion allowance', materialKey: 'Material', rtCategory: 'RT category',
  'tank.fluidName': 'Stored fluid', 'tank.specificGravity': 'Specific gravity',
  'tank.roofType': 'Roof type', 'tank.maxDesignLiquidLevel (mm)': 'Max design liquid level',
  'tank.bottomThk (mm)': 'Bottom plate thickness',
};
const SECTION_LABELS: Record<string, string> = {
  dia: 'Inside diameter', ttLength: 'Tan-to-tan length', headTop: 'Top head form', headBottom: 'Bottom head form',
  shellThk: 'Shell spec t', headThkTop: 'Top head spec t', headThkBot: 'Bottom head spec t',
};
const NOZZLE_LABELS: Record<string, string> = {
  dn: 'Bore', flangeClass: 'Flange class', elevation: 'Elevation', azimuth: 'Azimuth',
  service: 'Service', kind: 'Nozzle kind',
};

function labelOf(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const s = field.match(/^sections\[(\d+)]\.(\w+)/);
  if (s) return `Section ${Number(s[1]) + 1} · ${SECTION_LABELS[s[2]] ?? s[2]}`;
  const n = field.match(/^nozzle (.+)\.(\w+)/);
  if (n) return `${n[1]} · ${NOZZLE_LABELS[n[2]] ?? n[2]}`;
  if (field.endsWith('(new)')) return `${field.replace(' (new)', '')} — new nozzle`;
  return field;
}

function groupOf(field: string): string {
  if (field.startsWith('sections[')) return 'Shell & heads';
  if (field.startsWith('nozzle')) return 'Nozzles';
  if (field.startsWith('tank.')) return 'Tank';
  return 'Tag data';
}

/** "+6" / "−0.25" when both ends of a change are numeric, otherwise an em dash. */
function deltaOf(from: string, to: string): string {
  const a = Number(from);
  const b = Number(to);
  if (from.trim() === '' || to.trim() === '' || !Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const d = Math.round((b - a) * 1000) / 1000;
  if (d === 0) return 'same';
  return `${d > 0 ? '+' : ''}${d}`;
}

/** One row per input group actually included in the request payload. */
function inputSummary(e: Equipment): [string, string][] {
  const out: [string, string][] = [
    ['Tag', `${e.tag} — ${e.name} · ${e.equipType}${e.orientation ? ` · ${e.orientation}` : ''}`],
    ['Design pressure / temperature / MDMT', `${e.designPressure} bar g · ${e.designTemp} °C · MDMT ${e.mdmt} °C`],
    ['Corrosion allowance / material / RT', `${e.corrosionAllowance} mm · ${e.materialKey} · RT ${e.rtCategory} · LI ${e.inspectionLevel}`],
    [`Shell sections (${e.sections.length})`,
      e.sections.map((x, i) => `S${i + 1} Ø${x.dia} × ${x.ttLength} mm, heads ${x.headTop}/${x.headBottom}, spec t ${x.shellThk || 'auto'}`).join(' · ') || '—'],
    [`Nozzles (${e.nozzles.length})`,
      e.nozzles.map((n) => `${n.tag} DN${n.dn} Cl${n.flangeClass} @ ${n.elevation} mm, ${n.kind}`).join(' · ') || '—'],
    [`Internals (${e.internals.length})`, e.internals.map((i) => i.kind).join(', ') || '—'],
  ];
  if (e.clad && e.clad.mode !== 'none') out.push(['Cladding', `${e.clad.mode} ${e.clad.materialKey} ${e.clad.thicknessMm} mm`]);
  if (e.ndtPlan) {
    out.push(['NDT plan', e.ndtPlan.filter((n) => n.enabled).map((n) => `${n.method === 'putTofd' ? 'PaUT/TOFD' : n.method.toUpperCase()} ${n.extent} (${n.timing})`).join(' · ') || '—']);
  }
  if (e.tank) {
    out.push(['Tank service', `${e.tank.fluidName} SG ${e.tank.specificGravity} · roof ${e.tank.roofType} · liquid level ${e.tank.maxDesignLiquidLevel} mm`]);
  }
  return out;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result as string;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
