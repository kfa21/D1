// BOM / MTO / plate procurement plan with market stock sizes, wastage and cost.

import { useMemo, useState } from 'react';
import { useStore, money } from '../store';
import { computeEquipment } from '../engine/compute';
import { generateBOM, buildProcurement, ProcurementContext } from '../engine/bom';
import { optimizeProcurement } from '../engine/optimize';
import { estimateProject } from '../engine/estimate';
import { fmt } from '../engine/units';
import { downloadCSV } from '../cad';
import { printElementById } from '../print';
import { getMat } from '../engine/materials';
import type { BOMItem } from '../engine/types';
import type { PlateProcurementLine } from '../engine/plates';

export default function BomPage() {
  const equipment = useStore((s) => s.equipment);
  const settings = useStore((s) => s.settings);
  const [view, setView] = useState<'bom' | 'procurement' | 'optimized'>('bom');

  const ctx: ProcurementContext = useMemo(
    () => ({ stockPlates: settings.plateStock, prices: settings.rates.prices }),
    [settings.plateStock, settings.rates.prices]
  );

  const data = useMemo(() => {
    const entries = equipment.map((e) => ({ equip: e, calc: computeEquipment(e) }));
    const allItems: BOMItem[] = [];
    const allReqs = [] as Parameters<typeof buildProcurement>[0];
    for (const en of entries) {
      const { items, plateReqs } = generateBOM(en.equip, en.calc);
      allItems.push(...items);
      allReqs.push(...plateReqs);
    }
    const proc = buildProcurement(allReqs, ctx);
    const opt = optimizeProcurement(allReqs, ctx);
    const est = estimateProject(entries, settings.rates, ctx);
    return { entries, items: allItems, proc, opt, est };
  }, [equipment, ctx, settings.rates]);

  const totalMass = data.items.reduce((s, i) => s + i.massKg, 0);
  const plateCost = data.proc.lines.reduce((s, l) => s + l.estimatedCostUSD, 0);
  const avgWaste =
    data.proc.lines.length > 0
      ? data.proc.lines.reduce((s, l) => s + l.wastagePct, 0) / data.proc.lines.length
      : 0;

  if (equipment.length === 0) return <div className="card">Create equipment tags in the Register first.</div>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="kpi"><span className="v">{data.items.length}</span><span className="l">BOM lines</span></div>
        <div className="kpi"><span className="v">{fmt(totalMass / 1000, 1)} t</span><span className="l">Total mass</span></div>
        <div className="kpi"><span className="v">{money(plateCost, settings)}</span><span className="l">Plate procurement</span></div>
        <div className="kpi"><span className="v">{fmt(avgWaste, 1)}%</span><span className="l">Avg plate wastage</span></div>
      </div>

      <div className="tabs">
        <button className={view === 'bom' ? 'active' : ''} onClick={() => setView('bom')}>Detailed BOM / MTO</button>
        <button className={view === 'procurement' ? 'active' : ''} onClick={() => setView('procurement')}>Plate Procurement Plan</button>
        <button className={view === 'optimized' ? 'active' : ''} onClick={() => setView('optimized')}>
          ⬡ Optimized Procurement{data.opt.suggestions.length > 0 ? ` (${data.opt.suggestions.length})` : ''}
        </button>
      </div>

      <div id="bom-print-root" style={{ display: 'none' }}>
        <h2>BOM / MTO — {settings.projectName}</h2>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Category</th><th>Item</th><th>Spec</th><th>Material</th><th>Qty</th><th>Unit</th><th>Mass kg</th></tr></thead>
          <tbody>{data.items.map((it) => <tr key={it.id}><td>{it.tag}</td><td>{it.category}</td><td>{it.item}</td><td>{it.spec}</td><td>{getMat(it.material)?.name ?? it.material}</td><td>{fmt(it.qty, 1)}</td><td>{it.unit}</td><td>{fmt(it.massKg, 1)}</td></tr>)}</tbody>
        </table>
        <h2>Plate procurement plan</h2>
        <table className="grid">
          <thead><tr><th>Part</th><th>Material</th><th>Req t</th><th>Stock t</th><th>Part W×L</th><th>Parts</th><th>Plate W×L</th><th>Plates</th><th>Wastage %</th><th>Mass kg</th><th>Cost</th></tr></thead>
          <tbody>{data.proc.lines.map((l) => <tr key={l.id}><td>{l.id.split('|')[0]}</td><td>{getMat(l.material)?.name ?? l.material}</td><td>{fmt(l.thkRequested, 1)}</td><td>{l.thkStock}</td><td>{l.partW}×{l.partL}</td><td>{l.partCount}</td><td>{l.plateW}×{l.plateL}</td><td>{l.platesNeeded}</td><td>{fmt(l.wastagePct, 1)}</td><td>{fmt(l.massKg, 0)}</td><td>{money(l.estimatedCostUSD, settings)}</td></tr>)}</tbody>
        </table>
      </div>

      {view === 'bom' && (
        <>
          <div style={{ marginBottom: 8 }}>
            <button className="primary" onClick={() => printElementById('bom-print-root', 'BOM and procurement')}>⎙ PDF — BOM & procurement</button>{' '}
            <button onClick={() => downloadCSV('bom.csv', [['Tag', 'Category', 'Item', 'Spec', 'Material', 'Qty', 'Unit', 'Unit kg', 'Mass kg'], ...data.items.map((i) => [i.tag, i.category, i.item, i.spec, getMat(i.material).name, i.qty, i.unit, i.unitMassKg ?? '', fmt(i.massKg, 1)])])}>
              Export BOM CSV
            </button>
          </div>
          <div className="tablewrap" style={{ maxHeight: 620 }}>
            <table className="grid">
              <thead>
                <tr><th>Tag</th><th>Category</th><th>Item</th><th>Spec</th><th>Material</th><th className="num">Qty</th><th>Unit</th><th className="num">Mass (kg)</th><th>Note</th></tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td className="mono small">{it.tag}</td>
                    <td><span className={`badge ${it.category === 'Plate' ? 'info' : 'ok'}`}>{it.category}</span></td>
                    <td>{it.item}</td>
                    <td className="small muted">{it.spec}</td>
                    <td className="small">{getMat(it.material)?.name ?? it.material}</td>
                    <td className="num">{fmt(it.qty, 1)}</td>
                    <td>{it.unit}</td>
                    <td className="num">{fmt(it.massKg, 1)}</td>
                    <td className="small muted">{it.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'procurement' && (
        <>
          <div style={{ marginBottom: 8 }}>
            <button onClick={() => downloadCSV('plate_procurement.csv', [['Tag/part', 'Material', 'Req t (mm)', 'Stock t (mm)', 'Added (mm)', 'Part W×L (mm)', 'Parts', 'Plate W×L (mm)', 'Plates', 'Wastage %', 'Mass kg', 'Est. cost BHD (base)'], ...data.proc.lines.map((l: PlateProcurementLine) => [l.id, getMat(l.material).name, fmt(l.thkRequested, 1), l.thkStock, fmt(l.thkAdded, 1), `${l.partW}×${l.partL}`, l.partCount, `${l.plateW}×${l.plateL}`, l.platesNeeded, fmt(l.wastagePct, 1), fmt(l.massKg, 0), fmt(l.estimatedCostUSD, 0)])])}>
              Export procurement CSV
            </button>
            <span className="muted small" style={{ marginLeft: 10 }}>
              Thicknesses snap up to market stock sizes; parts are nested onto standard plate dimensions with wastage computed.
            </span>
          </div>
          <div className="tablewrap" style={{ maxHeight: 620 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Tag / part</th><th>Material</th><th className="num">Req t</th><th className="num">Stock t</th>
                  <th className="num">Part W×L</th><th className="num">Parts</th><th className="num">Plate W×L</th>
                  <th className="num">Plates</th><th className="num">Wastage %</th><th className="num">Mass (kg)</th><th className="num">Est. cost</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.proc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="small mono">{l.id.split('|')[0]}{l.id.includes('|') ? ` · ${l.id.split('|').slice(4).join('|')}` : ''}</td>
                    <td className="small">{getMat(l.material)?.name ?? l.material}</td>
                    <td className="num calc">{fmt(l.thkRequested, 1)}</td>
                    <td className="num calc">{l.thkStock}{!l.thkIsStandard && <span className="badge warn" style={{ marginLeft: 4 }}>+{fmt(l.thkAdded, 1)}</span>}</td>
                    <td className="num">{l.partW} × {l.partL}</td>
                    <td className="num">{l.partCount}</td>
                    <td className="num">{l.plateW} × {l.plateL}</td>
                    <td className="num">{l.oversized ? <span className="badge err">mill order</span> : l.platesNeeded}</td>
                    <td className={`num ${l.wastagePct > 35 ? 'warn' : ''}`}>{fmt(l.wastagePct, 1)}</td>
                    <td className="num">{fmt(l.massKg, 0)}</td>
                    <td className="num">{money(l.estimatedCostUSD, settings)}</td>
                    <td className="small muted">{l.note}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} className="num"><strong>Plate procurement total</strong></td>
                  <td className="num"><strong>{fmt(data.proc.lines.reduce((s, l) => s + l.massKg, 0) / 1000, 2)} t</strong></td>
                  <td className="num"><strong>{money(plateCost, settings)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Stock sizes: {settings.plateStock.map((p) => `${p.w}×${p.l}`).join(' · ')} mm — editable in Settings.
          </p>
        </>
      )}

      {view === 'optimized' && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="kpi green"><span className="v">{data.opt.totals.baselinePlates - data.opt.totals.plates >= 0 ? `−${data.opt.totals.baselinePlates - data.opt.totals.plates}` : data.opt.totals.plates - data.opt.totals.baselinePlates}</span><span className="l">Plates saved (baseline {data.opt.totals.baselinePlates} → {data.opt.totals.plates})</span></div>
            <div className="kpi green"><span className="v">{money(Math.max(0, data.opt.totals.baselineCostUSD - data.opt.totals.costUSD), settings)}</span><span className="l">Est. material saving</span></div>
            <div className="kpi"><span className="v">{fmt(data.opt.totals.wastagePct, 1)}%</span><span className="l">Avg wastage (was {fmt(data.opt.totals.baselineWastagePct, 1)}%)</span></div>
            <div className="kpi"><span className="v">{data.proc.lines.length} → {data.opt.lines.length}</span><span className="l">Procurement lines</span></div>
            <div className="kpi"><span className="v">{money(data.opt.totals.costUSD, settings)}</span><span className="l">Optimized plate cost</span></div>
          </div>

          <div id="opt-print-root" style={{ display: 'none' }}>
            <h2>Optimized plate procurement — {settings.projectName}</h2>
            <table className="grid">
              <thead><tr><th>Material</th><th>Req/Stock t</th><th>Part W×L</th><th>Parts</th><th>Tags</th><th>Plate W×L</th><th>Plates</th><th>Wastage %</th><th>Mass kg</th><th>Cost</th></tr></thead>
              <tbody>{data.opt.lines.map((l) => <tr key={l.id}><td>{getMat(l.material)?.name ?? l.material}</td><td>{fmt(l.thkRequested, 1)}/{l.thkStock}</td><td>{l.partW}×{l.partL}</td><td>{l.partCount}</td><td>{l.mergedFromTags.join(', ')}</td><td>{l.plateW}×{l.plateL}</td><td>{l.platesNeeded}</td><td>{fmt(l.wastagePct, 1)}</td><td>{fmt(l.massKg, 0)}</td><td>{money(l.estimatedCostUSD, settings)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={6}>Optimized total ({data.opt.totals.plates} plates vs {data.opt.totals.baselinePlates} baseline)</td><td>{data.opt.totals.plates}</td><td>{fmt(data.opt.totals.wastagePct, 1)}</td><td>{fmt(data.opt.totals.massKg / 1000, 2)} t</td><td>{money(data.opt.totals.costUSD, settings)}</td></tr></tfoot>
            </table>
          </div>

          {data.opt.suggestions.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3>💡 Suggestions — {data.opt.suggestions.length} optimization opportunity found</h3>
              {data.opt.suggestions.map((s, i) => (
                <div key={i} className={`suggestion ${s.kind === 'warning' ? 'warn' : ''}`}>
                  <span className="s-title">{s.title}</span>
                  {s.savingUSD !== undefined && s.savingUSD > 0 && <span className="badge ok" style={{ marginLeft: 8 }}>save {money(s.savingUSD, settings)}</span>}
                  {s.savingKg !== undefined && s.savingKg > 0 && <span className="badge info" style={{ marginLeft: 4 }}>{fmt(s.savingKg / 1000, 2)} t</span>}
                  <div className="small">{s.detail}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 8 }} className="no-print">
            <button className="primary" onClick={() => printElementById('opt-print-root', 'Optimized procurement')}>⎙ PDF — optimized plan</button>{' '}
            <button onClick={() => downloadCSV('optimized_procurement.csv', [['Material', 'Req t', 'Stock t', 'Part W×L', 'Parts', 'Tags', 'Plate W×L', 'Plates', 'Baseline plates', 'Wastage %', 'Mass kg', 'Cost BHD (base)'], ...data.opt.lines.map((l) => [getMat(l.material)?.name ?? l.material, fmt(l.thkRequested, 1), l.thkStock, `${l.partW}×${l.partL}`, l.partCount, l.mergedFromTags.join(' '), `${l.plateW}×${l.plateL}`, l.platesNeeded, l.baselinePlates, fmt(l.wastagePct, 1), fmt(l.massKg, 0), fmt(l.estimatedCostUSD, 0)])])}>Export optimized CSV</button>
          </div>

          <div className="tablewrap" style={{ maxHeight: 620 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Material</th><th className="num">Req t</th><th className="num">Stock t</th><th className="num">Part W×L</th>
                  <th className="num">Parts</th><th>Covered tags</th><th className="num">Plate W×L</th><th className="num">Plates</th>
                  <th className="num">Baseline</th><th className="num">Saved</th><th className="num">Wastage %</th><th className="num">Mass (kg)</th><th className="num">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {data.opt.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="small">{getMat(l.material)?.name ?? l.material}</td>
                    <td className="num calc">{fmt(l.thkRequested, 1)}</td>
                    <td className="num calc">{l.thkStock}{!l.thkIsStandard && <span className="badge warn" style={{ marginLeft: 4 }}>+{fmt(l.thkAdded, 1)}</span>}</td>
                    <td className="num">{l.partW} × {l.partL}</td>
                    <td className="num">{l.partCount}</td>
                    <td className="small">{l.mergedFromTags.join(', ')}</td>
                    <td className="num">{l.plateW} × {l.plateL}</td>
                    <td className="num">{l.oversized ? <span className="badge err">mill order</span> : l.platesNeeded}</td>
                    <td className="num muted">{l.baselinePlates}</td>
                    <td className="num">{l.platesSaved > 0 ? <span className="badge ok">−{l.platesSaved}</span> : <span className="muted">—</span>}</td>
                    <td className={`num ${l.wastagePct > 35 ? 'warn' : ''}`}>{fmt(l.wastagePct, 1)}</td>
                    <td className="num">{fmt(l.massKg, 0)}</td>
                    <td className="num">{money(l.estimatedCostUSD, settings)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="num"><strong>Optimized total ({data.opt.lines.length} lines vs {data.proc.lines.length} naive)</strong></td>
                  <td className="num"><strong>{data.opt.totals.plates}</strong></td>
                  <td className="num"><strong>{data.opt.totals.baselinePlates}</strong></td>
                  <td className="num"><strong className="ok">{Math.max(0, data.opt.totals.baselinePlates - data.opt.totals.plates)}</strong></td>
                  <td></td>
                  <td className="num"><strong>{fmt(data.opt.totals.massKg / 1000, 2)} t</strong></td>
                  <td className="num"><strong>{money(data.opt.totals.costUSD, settings)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Optimization pools identical parts across all tags, re-picks the stock plate that minimizes purchased steel for the pooled load,
            and flags adjacent stock thicknesses worth harmonizing. Thickness changes marked ⚠ require engineering re-check before ordering.
          </p>
        </>
      )}
    </div>
  );
}
