// Settings — project info, units, currency & FX, plate stock, rate card, Gemini key, data backup.

import { Fragment, useMemo, useState } from 'react';
import { useStore, setSettings, setState, money, defaultSettings, exportProjectJson, importProjectData } from '../store';
import {
  CLOUD_RULES,
  cloudLoadApiSettings,
  cloudSaveApiSettings,
  connectCloud,
  isConfigured,
  parseFirebaseConfig,
} from '../cloud';
import { CURRENCIES, CurrencyCode } from '../engine/currency';
import type { PlateSize } from '../engine/plates';
import { MATERIALS } from '../engine/materials';
import { estimateProject, manhourMatrix } from '../engine/estimate';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';

/** Human labels for the manual labor trades. */
const LABOR_LABEL: Record<string, string> = {
  fitter: 'Fitter / fabricator',
  welder: 'General welder (fit-up, supports)',
  gtaw: 'GTAW/TIG welder (root, overlay)',
  smaw: 'SMAW/stick welder (fill & cap)',
  grinder: 'Grinder / dresser',
  helper: 'Helper',
  qc: 'QC inspector',
  engineer: 'Engineer',
  pwht: 'Heat-treatment operator',
  painter: 'Painter / blaster',
};

const MACHINE_LABEL: Record<string, string> = {
  saw: 'SAW welding set (machine hour)',
  plasma: 'CNC plasma cutting table',
  bevel: 'Plate bevelling machine',
  roll: 'Plate rolling machine',
  drill: 'Radial / magnetic drill',
  crane: 'Overhead crane / yard handling',
  expander: 'Tube rolling / expander unit',
};

export default function SettingsPage() {
  const s = useStore((x) => x.settings);
  const equipment = useStore((x) => x.equipment);

  // live man-hour basis: what the engine would book for this project right now
  const est = useMemo(
    () =>
      estimateProject(
        equipment.map((e) => ({ equip: e, calc: computeEquipment(e) })),
        s.rates,
        { stockPlates: s.plateStock, prices: s.rates.prices },
        s.manhourOverrides
      ),
    [equipment, s.rates, s.plateStock, s.manhourOverrides]
  );

  // ---- cloud backup (Firebase) — setup lives here, save/list/load lives on My Projects ----
  const [pasted, setPasted] = useState('');
  const [pastedOk, setPastedOk] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const cfg = s.firebaseConfig;
  const hasCfg = isConfigured(cfg);

  const cloudRun = async (fn: () => Promise<void>) => {
    setCloudBusy(true);
    setCloudMsg(null);
    try {
      await fn();
    } catch (e) {
      setCloudMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCloudBusy(false);
    }
  };

  const connect = () =>
    cloudRun(async () => {
      const uid = await connectCloud(cfg);
      setCloudMsg({ kind: 'ok', text: `Connected (user ${uid.slice(0, 8)}…). Saving, listing and loading happens on the My Projects page.` });
    });

  // API settings (Gemini key + Firebase config) live in one cloud document per
  // user — deliberately separate from project saves, which stay key-free.
  const saveApi = () =>
    cloudRun(async () => {
      await connectCloud(cfg);
      await cloudSaveApiSettings({ geminiKey: s.geminiKey, firebaseConfig: cfg });
      setCloudMsg({ kind: 'ok', text: 'API settings saved to the cloud — load them on any device after connecting.' });
    });

  const loadApi = () =>
    cloudRun(async () => {
      await connectCloud(cfg);
      const api = await cloudLoadApiSettings();
      if (!api || (!api.geminiKey && !api.firebaseConfig)) {
        setCloudMsg({
          kind: 'err',
          text: 'No API settings are saved in the cloud yet — press “Save API settings” on a device that has them.',
        });
        return;
      }
      setSettings({
        ...(api.geminiKey ? { geminiKey: api.geminiKey } : {}),
        ...(api.firebaseConfig ? { firebaseConfig: api.firebaseConfig } : {}),
      });
      const what = [
        api.geminiKey ? 'Gemini key' : '',
        api.firebaseConfig ? 'Firebase config' : '',
      ].filter(Boolean).join(' and ');
      setCloudMsg({ kind: 'ok', text: `Loaded the ${what} from the cloud — it is now stored in this browser.` });
    });

  const setPlate = (i: number, patch: Partial<PlateSize>) => {
    const stock = s.plateStock.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setSettings({ plateStock: stock });
  };

  const exportData = () => {
    const blob = new Blob([exportProjectJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'staticsuite_project.json';
    a.click();
  };

  const importData = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const parsed = JSON.parse(String(fr.result));
        importProjectData(parsed);
        alert('Project imported.\n\nNote: attached datasheet files are never stored in the export — re-attach them on the AI Review page.');
      } catch {
        alert('Invalid project file');
      }
    };
    fr.readAsText(file);
  };

  return (
    <div>
    <div className="row">
      <div className="card">
        <h3>Project</h3>
        <div className="grid2">
          <label className="f"><span>Project name</span><input value={s.projectName} onChange={(e) => setSettings({ projectName: e.target.value })} /></label>
          <label className="f"><span>Client</span><input value={s.clientName} onChange={(e) => setSettings({ clientName: e.target.value })} /></label>
          <label className="f"><span>Units</span>
            <select value={s.units} onChange={(e) => setSettings({ units: e.target.value as never })}>
              <option value="metric">Metric (mm · bar · °C)</option>
              <option value="imperial">Imperial (in · psi · °F)</option>
            </select>
          </label>
          <label className="f"><span>Currency (display)</span>
            <select value={s.currency} onChange={(e) => setSettings({ currency: e.target.value as CurrencyCode })}>
              {Object.entries(CURRENCIES).map(([code, c]) => <option key={code} value={code}>{code} — {c.name}</option>)}
            </select>
          </label>
        </div>
        <p className="muted small">Base currency: <strong>BHD (Bahraini Dinar)</strong> — all rates, prices and estimates below are entered and stored in BHD. The display currency only converts values for presentation.</p>
        <hr className="sep" />
        <h3>Exchange rates ({s.currency} per 1 BHD)</h3>
        <div className="grid2">
          {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
            <label className="f" key={code}>
              <span>{code} {CURRENCIES[code].symbol} — default {CURRENCIES[code].rate}</span>
              <input
                type="number"
                step="0.01"
                placeholder={String(CURRENCIES[code].rate)}
                value={s.fxRates[code] ?? ''}
                onChange={(e) => {
                  const fx = { ...s.fxRates };
                  if (e.target.value === '') delete fx[code];
                  else fx[code] = +e.target.value;
                  setSettings({ fxRates: fx });
                }}
              />
            </label>
          ))}
        </div>
        <p className="muted small">Leave blank to use built-in indicative rates (per 1 BHD). Update with live market rates as needed.</p>
      </div>

      <div className="card">
        <h3>Market plate stock (mm)</h3>
        <table className="grid">
          <thead><tr><th className="num">Width</th><th className="num">Length</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {s.plateStock.map((p, i) => (
              <tr key={i}>
                <td><input type="number" className="num" value={p.w} onChange={(e) => setPlate(i, { w: +e.target.value })} /></td>
                <td><input type="number" className="num" value={p.l} onChange={(e) => setPlate(i, { l: +e.target.value })} /></td>
                <td><input value={p.note ?? ''} onChange={(e) => setPlate(i, { note: e.target.value })} /></td>
                <td><button className="ghost danger" onClick={() => setSettings({ plateStock: s.plateStock.filter((_, idx) => idx !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setSettings({ plateStock: [...s.plateStock, { w: 2500, l: 12000 }] })}>＋ Add plate size</button>
        </div>

        <hr className="sep" />
        <h3>Material price overrides (BHD/kg)</h3>
        <div className="grid2">
          {MATERIALS.map((m) => (
            <label className="f" key={m.key}>
              <span>{m.name} (default {m.pricePerKg} BHD)</span>
              <input
                type="number"
                step="0.001"
                placeholder={String(m.pricePerKg)}
                value={s.rates.prices[m.key] ?? ''}
                onChange={(e) => {
                  const prices = { ...s.rates.prices };
                  if (e.target.value === '') delete prices[m.key];
                  else prices[m.key] = +e.target.value;
                  setSettings({ rates: { ...s.rates, prices } });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Estimate rate card (BHD)</h3>
        <div className="grid2">
          {([
            ['pipePrice', 'Pipe (BHD/kg)'],
            ['flangePrice', 'Flanges (BHD/kg)'],
            ['boltPrice', 'Bolting (BHD/kg)'],
            ['gasketPrice', 'Gaskets (BHD/ea)'],
            ['internalsPrice', 'Internals (BHD/kg)'],
            ['structuralPrice', 'Structural steel (BHD/kg)'],
            ['equipmentPrice', 'Misc equipment (BHD/kg)'],
            ['electrodePrice', 'SMAW electrodes (BHD/kg)'],
            ['wirePrice', 'Filler / SAW wire (BHD/kg)'],
            ['sawFluxPrice', 'SAW flux (BHD/kg)'],
            ['discPrice', 'Grinding discs (BHD/ea)'],
            ['gasCylPrice', 'Gas cylinder (BHD/ea)'],
            ['pwhtCycleUSD', 'PWHT cycle (BHD/cycle)'],
            ['formingRate', 'Head forming — outside service (BHD/h)'],
            ['putTofdDayUSD', 'PaUT/TOFD crew (BHD/day)'],
            ['rtDayUSD', 'RT crew & film (BHD/day)'],
          ] as const).map(([k, label]) => (
            <label className="f" key={k}>
              <span>{label}</span>
              <input type="number" step="0.01" value={s.rates[k]} onChange={(e) => setSettings({ rates: { ...s.rates, [k]: +e.target.value } })} />
            </label>
          ))}
          <label className="f"><span>Paint (BHD/m²)</span><input type="number" step="0.1" value={s.rates.paintUSDperM2} onChange={(e) => setSettings({ rates: { ...s.rates, paintUSDperM2: +e.target.value } })} /></label>
          <label className="f"><span>Hydro water (BHD/m³)</span><input type="number" step="0.01" value={s.rates.hydroUSDperM3} onChange={(e) => setSettings({ rates: { ...s.rates, hydroUSDperM3: +e.target.value } })} /></label>
        </div>
        <h3 style={{ marginTop: 12 }}>Manual labor rates (BHD/h)</h3>
        <div className="grid2">
          {(Object.keys(s.rates.labor) as (keyof typeof s.rates.labor)[]).map((k) => (
            <label className="f" key={k}>
              <span>{LABOR_LABEL[k] ?? k}</span>
              <input type="number" value={s.rates.labor[k]} onChange={(e) => setSettings({ rates: { ...s.rates, labor: { ...s.rates.labor, [k]: +e.target.value } } })} />
            </label>
          ))}
        </div>
        <p className="muted small">
          Manual trades are booked per man-hour: the GTAW root and any SMAW fill at the welder rates, grinding at the
          grinder rate, fit-up/handling at the fitter rate. A machine is never charged at these rates.
        </p>

        <h3 style={{ marginTop: 12 }}>Machine rates (BHD per machine hour)</h3>
        <div className="grid2">
          {(Object.keys(s.rates.machine) as (keyof typeof s.rates.machine)[]).map((k) => (
            <label className="f" key={k}>
              <span>{MACHINE_LABEL[k] ?? k}</span>
              <input type="number" step="0.1" value={s.rates.machine[k]} onChange={(e) => setSettings({ rates: { ...s.rates, machine: { ...s.rates.machine, [k]: +e.target.value } } })} />
            </label>
          ))}
        </div>
        <p className="muted small">
          Machine hours are booked as their own lines in the estimate: CNC plasma cutting, the SAW set (fill/cap on
          long seams), the bevelling machine, the plate rolls and crane time. Machine time is shown separately from
          manual man-hours and from outside services.
        </p>

        <hr className="sep" />
        <h3>Gemini AI</h3>
        <label className="f"><span>API key (stored locally in your browser only)</span>
          <input type="password" value={s.geminiKey} placeholder="AIza…" onChange={(e) => setSettings({ geminiKey: e.target.value })} />
        </label>
        <p className="muted small">Get a key at aistudio.google.com. For production, proxy calls through your backend.</p>
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="small muted">{equipment.length} tags stored in this browser ({(JSON.stringify(equipment).length / 1024).toFixed(0)} KB). Auto-saved on every change.</p>
        <p className="muted small">The export contains project data only — the Gemini API key and attached datasheet files stay in this browser and are never written to the file. Imported legacy (USD-base) files are converted to the BHD base automatically.</p>
        <div className="row">
          <button onClick={exportData}>Export project JSON</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Import project JSON
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
          <button className="danger" onClick={() => { if (confirm('Clear ALL project data?')) setState({ equipment: [], reviews: [], datasheets: [], selectedEquipId: null }); }}>Clear all data</button>
          <button onClick={() => setSettings(defaultSettings)}>Reset settings</button>
        </div>
        <hr className="sep" />
        <p className="muted small">
          Sanity check: 1 BHD = {s.fxRates[s.currency] ?? CURRENCIES[s.currency].rate} {s.currency} → example{' '}
          {money(1000, s)}
        </p>
      </div>

      <div className="card">
        <h3>Cloud backup (Firebase)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Save this project to your own Firebase project and pull it back on any device. Everything is written to
          Firestore through the browser; the Gemini key and attachment files are never uploaded (the same sanitised
          payload the JSON export writes).
        </p>

        {!hasCfg && (
          <label className="f">
            <span>Paste your firebaseConfig (from the Firebase console → Project settings → Your apps)</span>
            <textarea
              rows={3}
              placeholder={'const firebaseConfig = {\n  apiKey: "AIza…",\n  authDomain: "my-app.firebaseapp.com",\n  projectId: "my-app",\n};'}
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                const p = parseFirebaseConfig(e.target.value);
                setPastedOk(Boolean(p));
                if (p) setSettings({ firebaseConfig: p });
              }}
            />
          </label>
        )}
        {pastedOk && hasCfg && <p className="small">✅ Config detected — {cfg.projectId} ({cfg.authDomain})</p>}

        <div className="grid2">
          <label className="f"><span>API key (public identifier)</span>
            <input value={cfg.apiKey} placeholder="AIza…" onChange={(e) => setSettings({ firebaseConfig: { ...cfg, apiKey: e.target.value } })} />
          </label>
          <label className="f"><span>Auth domain</span>
            <input value={cfg.authDomain} placeholder="my-app.firebaseapp.com" onChange={(e) => setSettings({ firebaseConfig: { ...cfg, authDomain: e.target.value } })} />
          </label>
          <label className="f"><span>Project ID</span>
            <input value={cfg.projectId} placeholder="my-app" onChange={(e) => setSettings({ firebaseConfig: { ...cfg, projectId: e.target.value } })} />
          </label>
        </div>

        <div className="row" style={{ marginTop: 6 }}>
          <button className="primary" disabled={cloudBusy || !hasCfg} onClick={connect}>
            {cloudBusy ? '…' : 'Connect'}
          </button>
          <span className="small muted">Save, list and load your projects on <strong>My Projects</strong>.</span>
        </div>
        {cloudMsg && <div className={`finding ${cloudMsg.kind === 'ok' ? 'ok' : 'error'}`}>{cloudMsg.text}</div>}

        <hr className="sep" />
        <h3>API settings in the cloud</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Stores your Gemini API key and this Firebase config in one document under your account, so a new device
          can be set up with one press. They are <strong>never</strong> written into a project save or a JSON export
          — those stay key-free.
        </p>
        <div className="row">
          <button disabled={cloudBusy || !hasCfg} onClick={saveApi}>☁ Save API settings</button>
          <button disabled={cloudBusy || !hasCfg} onClick={loadApi}>☁ Load API settings</button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          New device: paste the Firebase config (it is public) → <strong>Connect</strong> → <strong>Load API
          settings</strong>, and the Gemini key comes with it.
        </p>

        <details style={{ marginTop: 8 }}>
          <summary className="small muted">Setup: two one-time steps in the Firebase console</summary>
          <ol className="small muted" style={{ paddingLeft: 18, marginTop: 6 }}>
            <li><strong>Authentication → Sign-in method → Anonymous</strong> — enable it (the app signs in without a password).</li>
            <li><strong>Firestore → Create database</strong>, then paste these rules so every user sees only their own saves:
              <pre className="code" style={{ marginTop: 6 }}>{CLOUD_RULES}</pre>
            </li>
          </ol>
          <p className="small muted">
            Already pasted these rules earlier? Re-paste them — they now also cover the API-settings document.
          </p>
          <p className="small muted">
            The config above is public (it ships in every Firebase web bundle); the rules are what keep the data private.
            Free tier: 1 GiB storage, 50k reads / 20k writes a day — far above what saves this project needs.
          </p>
        </details>
      </div>
    </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Man-hours considered by the estimate</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Every man-hour the estimate engine books and how its automatic hours are derived, with a manual input per
          item. Type a value to replace the automatic hours project-wide — the detailed estimate then shows a{' '}
          <em>manual manhour adjustment</em> line carrying the difference, and clearing the box returns to the engine
          basis. Inspection stage hours are budgeted separately on the Inspection &amp; ITP page; head-forming hours
          can also be overridden per tag in the equipment editor.
        </p>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr><th>Man-hour item</th><th>Resource</th><th>How the automatic hours are derived</th><th className="num">Auto h</th><th className="num">Manual h</th><th className="num">Applied h</th></tr>
            </thead>
            <tbody>
              {manhourMatrix().map(({ group, items }) => {
                const autoSum = items.reduce((t, b) => t + (est.manhours.find((m) => m.key === b.key)?.autoH ?? 0), 0);
                const appliedSum = items.reduce((t, b) => t + (est.manhours.find((m) => m.key === b.key)?.appliedH ?? 0), 0);
                const overriddenInGroup = items.filter((b) => s.manhourOverrides[b.key] != null).length;
                return (
                  <Fragment key={group}>
                    <tr>
                      <td colSpan={6} className="small" style={{ background: 'rgba(140,170,220,0.10)', fontWeight: 600, letterSpacing: '0.02em' }}>
                        {group}
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {' '}· {items.length} sub-{items.length === 1 ? 'activity' : 'activities'}
                        </span>
                      </td>
                    </tr>
                    {items.map((b) => {
                      const u = est.manhours.find((m) => m.key === b.key);
                      const autoH = u?.autoH ?? 0;
                      const appliedH = u?.appliedH ?? 0;
                      const ov = s.manhourOverrides[b.key];
                      const overridden = ov != null;
                      const clear = () => {
                        const next = { ...s.manhourOverrides };
                        delete next[b.key];
                        setSettings({ manhourOverrides: next });
                      };
                      return (
                        <tr key={b.key}>
                          <td className="small" style={{ paddingLeft: 18 }}>
                            {b.label}
                            {overridden && <span className="badge warn" style={{ marginLeft: 6 }}>manual</span>}
                          </td>
                          <td className="small">
                            {b.resource === 'machine' ? (
                              <span title="Machine time — charged at the machine rate, not a labor rate">
                                ⚙ machine · {b.machine}
                              </span>
                            ) : (
                              b.trade
                            )}
                          </td>
                          <td className="small muted">{b.basis}</td>
                          <td className="num calc" title="Engine auto hours for this project">{fmt(autoH, 1)}</td>
                          <td className="num">
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <input
                                type="number"
                                step={0.5}
                                min={0}
                                placeholder="auto"
                                style={{ width: 88 }}
                                value={ov ?? ''}
                                onChange={(e) => {
                                  const next = { ...s.manhourOverrides };
                                  if (e.target.value === '') delete next[b.key];
                                  else next[b.key] = +e.target.value;
                                  setSettings({ manhourOverrides: next });
                                }}
                              />
                              {overridden && (
                                <button className="ghost danger" title="Revert to engine auto hours" onClick={clear}>✕</button>
                              )}
                            </span>
                          </td>
                          <td className="num"><strong>{fmt(appliedH, 1)}</strong></td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={3} className="small muted" style={{ paddingLeft: 18, fontStyle: 'italic' }}>
                        Subtotal — {group}
                        {overriddenInGroup > 0 ? ` · ${overriddenInGroup} manual override${overriddenInGroup > 1 ? 's' : ''}` : ''}
                      </td>
                      <td className="num small muted">{fmt(autoSum, 1)}</td>
                      <td />
                      <td className="num small">{fmt(appliedSum, 1)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Total project man-hours</strong></td>
                <td className="num"><strong>{fmt(est.manhours.reduce((t, m) => t + m.autoH, 0), 1)}</strong></td>
                <td className="num small muted">{Object.keys(s.manhourOverrides).length} overridden</td>
                <td className="num calc"><strong>{fmt(est.manhours.reduce((t, m) => t + m.appliedH, 0), 1)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
