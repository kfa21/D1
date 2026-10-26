// Settings — project info, units, currency & FX, plate stock, rate card, Gemini key, data backup.

import { useMemo } from 'react';
import { useStore, setSettings, setState, money, defaultSettings, exportProjectJson, importProjectData } from '../store';
import { CURRENCIES, CurrencyCode } from '../engine/currency';
import type { PlateSize } from '../engine/plates';
import { MATERIALS } from '../engine/materials';
import { estimateProject, MANHOUR_BASIS } from '../engine/estimate';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';

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
        <h3 style={{ marginTop: 12 }}>Labor rates (BHD/h)</h3>
        <div className="grid2">
          {(Object.keys(s.rates.labor) as (keyof typeof s.rates.labor)[]).map((k) => (
            <label className="f" key={k}>
              <span>{k}</span>
              <input type="number" value={s.rates.labor[k]} onChange={(e) => setSettings({ rates: { ...s.rates, labor: { ...s.rates.labor, [k]: +e.target.value } } })} />
            </label>
          ))}
        </div>

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
              <tr><th>Man-hour item</th><th>Trade</th><th>How the automatic hours are derived</th><th className="num">Auto h</th><th className="num">Manual h</th><th className="num">Applied h</th></tr>
            </thead>
            <tbody>
              {MANHOUR_BASIS.map((b) => {
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
                    <td className="small">
                      {b.label}
                      {overridden && <span className="badge warn" style={{ marginLeft: 6 }}>manual</span>}
                    </td>
                    <td className="small">{b.trade}</td>
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
