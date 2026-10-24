// Gemini-assisted ASME compliance review — attaches datasheets per tag and asks
// Gemini to evaluate code compliance and suggest design optimizations.
// The API key is entered by the user and stored locally (Settings). Calls go
// directly from the browser to generativelanguage.googleapis.com v1beta.

import { useRef, useState } from 'react';
import { useStore, setState, getStore, setSettings } from '../store';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';

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
  const reviews = useStore((s) => s.reviews);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [parsed, setParsed] = useState<Record<string, ReviewResponse>>({});
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
              tDesign_mm: fmt(c.tDesign, 2), tNominal_mm: c.tNominal,
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

  const review = equip ? parsed[equip.id] ?? null : null;
  const stored = equip ? reviews.find((r) => r.equipId === equip.id) : null;

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
        {!settings.geminiKey && <span className="badge warn">API key not set — configure in Settings</span>}
      </div>

      {err && <div className="finding error">{err}</div>}

      {equip && datasheets.some((d) => d.equipId === equip.id) && (
        <p className="small muted">
          Attached: {datasheets.find((d) => d.equipId === equip.id)!.name} (
          {(datasheets.find((d) => d.equipId === equip.id)!.size / 1024).toFixed(0)} KB)
        </p>
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
