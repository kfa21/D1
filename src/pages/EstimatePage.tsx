// Estimate page — material, consumables, welding and man-hours with markups.

import { useMemo } from 'react';
import { useStore, money, setSettings } from '../store';
import { computeEquipment } from '../engine/compute';
import { estimateProject, EstimateLine, DEFAULT_RATES } from '../engine/estimate';
import { fmt } from '../engine/units';
import { downloadCSV } from '../cad';
import { printElementById } from '../print';
import type { ProcurementContext } from '../engine/bom';

export default function EstimatePage() {
  const equipment = useStore((s) => s.equipment);
  const settings = useStore((s) => s.settings);

  const ctx: ProcurementContext = useMemo(
    () => ({ stockPlates: settings.plateStock, prices: settings.rates.prices }),
    [settings.plateStock, settings.rates.prices]
  );

  const est = useMemo(() => {
    const entries = equipment.map((e) => ({ equip: e, calc: computeEquipment(e) }));
    return estimateProject(entries, settings.rates, ctx);
  }, [equipment, settings.rates, ctx]);

  const t = est.totals;

  const setRate = (path: string, v: number) => {
    const rates = JSON.parse(JSON.stringify(settings.rates)) as typeof DEFAULT_RATES;
    if (path.startsWith('labor.')) {
      (rates.labor as Record<string, number>)[path.slice(6)] = v;
    } else if (path.startsWith('prices.')) {
      rates.prices[path.slice(7)] = v;
    } else {
      (rates as unknown as Record<string, number>)[path] = v;
    }
    setSettings({ rates });
  };

  return (
    <div>
      <div id="estimate-print-root" style={{ display: 'none' }}>
        <h2>Cost estimate — {settings.projectName}</h2>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Material</th><th>Labor</th><th>Consumables</th><th>Services</th><th>Hours</th><th>Total</th></tr></thead>
          <tbody>{est.perTag.map((p) => <tr key={p.equipId}><td>{p.tag}</td><td>{money(p.materialUSD, settings)}</td><td>{money(p.laborUSD, settings)}</td><td>{money(p.consumableUSD, settings)}</td><td>{money(p.serviceUSD, settings)}</td><td>{fmt(p.shopHours, 0)}</td><td>{money(p.totalUSD, settings)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={6}>Grand total (incl. {settings.rates.overheadPct}% OH, {settings.rates.profitPct}% profit, {settings.rates.contingencyPct}% contingency)</td><td>{money(t.grandUSD, settings)}</td></tr></tfoot>
        </table>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={() => printElementById('estimate-print-root', 'Cost estimate')}>⎙ PDF — estimate</button>
        <div className="kpi"><span className="v">{money(t.materialUSD, settings)}</span><span className="l">Material</span></div>
        <div className="kpi"><span className="v">{money(t.laborUSD, settings)}</span><span className="l">Shop labor & welding</span></div>
        <div className="kpi"><span className="v">{money(t.consumableUSD, settings)}</span><span className="l">Consumables</span></div>
        <div className="kpi"><span className="v">{money(t.serviceUSD, settings)}</span><span className="l">NDT · PWHT · Hydro · Paint · Outside</span></div>
        <div className="kpi"><span className="v">{fmt(t.shopHours, 0)} h</span><span className="l">Shop hours</span></div>
        <div className="kpi" style={{ borderColor: 'var(--accent)' }}><span className="v">{money(t.grandUSD, settings)}</span><span className="l">Grand total (incl. markups)</span></div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3>Per-tag summary</h3>
          <table className="grid">
            <thead><tr><th>Tag</th><th className="num">Material</th><th className="num">Labor</th><th className="num">Consumables</th><th className="num">Services</th><th className="num">Hours</th><th className="num">Total</th></tr></thead>
            <tbody>
              {est.perTag.map((p) => (
                <tr key={p.equipId}>
                  <td className="mono">{p.tag}</td>
                  <td className="num">{money(p.materialUSD, settings)}</td>
                  <td className="num">{money(p.laborUSD, settings)}</td>
                  <td className="num">{money(p.consumableUSD, settings)}</td>
                  <td className="num">{money(p.serviceUSD, settings)}</td>
                  <td className="num">{fmt(p.shopHours, 0)}</td>
                  <td className="num calc"><strong>{money(p.totalUSD, settings)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ maxWidth: 320 }}>
          <h3>Markups (editable %)</h3>
          <div className="grid2">
            <label className="f"><span>Overhead %</span><input type="number" value={settings.rates.overheadPct} onChange={(e) => setRate('overheadPct', +e.target.value)} /></label>
            <label className="f"><span>Profit %</span><input type="number" value={settings.rates.profitPct} onChange={(e) => setRate('profitPct', +e.target.value)} /></label>
            <label className="f"><span>Contingency %</span><input type="number" value={settings.rates.contingencyPct} onChange={(e) => setRate('contingencyPct', +e.target.value)} /></label>
          </div>
          <hr className="sep" />
          <table className="grid">
            <tbody>
              <tr><td>Subtotal</td><td className="num">{money(t.subtotalUSD, settings)}</td></tr>
              <tr><td>+ Overhead</td><td className="num">{money(t.overheadUSD, settings)}</td></tr>
              <tr><td>+ Profit</td><td className="num">{money(t.profitUSD, settings)}</td></tr>
              <tr><td>+ Contingency</td><td className="num">{money(t.contingencyUSD, settings)}</td></tr>
              <tr><td><strong>Grand total</strong></td><td className="num calc"><strong>{money(t.grandUSD, settings)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Weld breakdown — shell & dish-end welding hours, weld metal, joint configuration, electrodes</h3>
        {est.perTag.map((p) => (
          <details key={p.equipId} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              <strong className="mono">{p.tag}</strong> — {p.name} · {p.welds.length} weld areas ·{' '}
              {fmt(p.welds.reduce((s, w) => s + w.hours, 0), 0)} h · {fmt(p.welds.reduce((s, w) => s + w.depositKg, 0), 0)} kg deposit
            </summary>
            <div className="tablewrap" style={{ marginTop: 6 }}>
              <table className="grid">                <thead><tr><th>Weld area</th><th className="num">Length (m)</th><th className="num">Hours (root · fill)</th><th className="num">Deposit (kg)</th><th>Joint configuration</th><th>Root process</th><th>Fill process</th><th>Electrode / filler</th></tr></thead>
                <tbody>
                  {p.welds.map((w, i) => (
                    <tr key={i}>
                      <td>{w.area}</td>
                      <td className="num">{fmt(w.lengthM, 1)}</td>
                      <td className="num calc" title={`root ${fmt(w.rootHours, 1)} h · fill/cap ${fmt(w.fillHours, 1)} h`}>{fmt(w.hours, 1)} <span className="muted small">({fmt(w.rootHours, 1)} · {fmt(w.fillHours, 1)})</span></td>
                      <td className="num">{fmt(w.depositKg, 1)}</td>
                      <td className="small" style={{ minWidth: 220 }}>{w.joint}</td>
                      <td className="small">{w.rootProcess}</td>
                      <td className="small">{w.fillProcess}</td>
                      <td className="small mono">{w.electrode}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="num"><strong>{fmt(p.welds.reduce((s, w) => s + w.lengthM, 0), 1)}</strong></td>
                    <td className="num"><strong>{fmt(p.welds.reduce((s, w) => s + w.hours, 0), 1)}</strong></td>
                    <td className="num"><strong>{fmt(p.welds.reduce((s, w) => s + w.depositKg, 0), 1)}</strong></td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        ))}
      </div>

      <div className="card">
        <h3>Detailed estimate lines</h3>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => downloadCSV('estimate.csv', [['Tag', 'Group', 'Activity', 'Qty', 'Unit', 'Rate BHD (base)', 'Amount BHD (base)'], ...est.lines.map((l: EstimateLine) => [l.tag, l.group, l.activity, fmt(l.qty, 2), l.unit, fmt(l.rateUSD, 2), fmt(l.amountUSD, 2)])])}>
            Export estimate CSV
          </button>
        </div>
        <div className="tablewrap" style={{ maxHeight: 520 }}>
          <table className="grid">
            <thead><tr><th>Tag</th><th>Group</th><th>Activity</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate ({settings.currency})</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {est.lines.map((l, i) => (
                <tr key={i}>
                  <td className="mono small">{l.tag}</td>
                  <td><span className="badge info">{l.group}</span></td>
                  <td className="small">{l.activity}</td>
                  <td className="num">{fmt(l.qty, 1)}</td>
                  <td>{l.unit}</td>
                  <td className="num">{money(l.rateUSD, settings)}</td>
                  <td className="num calc">{money(l.amountUSD, settings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          All rates are editable in Settings and stored in <strong>BHD (base currency)</strong> — material BHD/kg, labor BHD/h,
          consumables, PWHT cycle, RT/PaUT day rates and outsourced head-forming rate. Amounts convert to {settings.currency}{' '}
          at the Settings exchange rate. Fill passes use the SAW deposition model where eligible (ferritic vessel/column,
          t ≥ 10 mm); nozzle welds stay manual. Head forming is costed as an outside service with auto hours.
        </p>
      </div>
    </div>
  );
}
