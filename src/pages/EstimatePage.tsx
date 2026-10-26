// Estimate page — management-facing cost view.
//
// Top-down: headline KPIs → cost structure and markup ladder → per-tag and
// per-category breakdowns → the rate-card basis behind every number → weld
// breakdown → filterable line detail. Every figure comes from
// `summarizeEstimate()`, so the screen, the printout and the PDF agree.

import { Fragment, useMemo, useState } from 'react';
import { useStore, money, setSettings } from '../store';
import { computeEquipment } from '../engine/compute';
import { estimateProject, EstimateLine, DEFAULT_RATES, type TagEstimate } from '../engine/estimate';
import { summarizeEstimate, type EstimateGroup } from '../engine/estimateSummary';
import { fmt } from '../engine/units';
import { exportSheet, sheetMeta } from '../cad';
import { printElementById } from '../print';
import { exportEstimatePdf } from '../pdfexport';
import { CURRENCIES } from '../engine/currency';
import type { ProcurementContext } from '../engine/bom';

/** direct-cost buckets, in stacked-bar order */
const SPLIT_COLORS = ['#1F5FBF', '#12855C', '#A66A00', '#6B4C9A'];

const LABOR_LABELS: Record<string, string> = {
  fitter: 'Fitter',
  welder: 'Welder',
  helper: 'Helper',
  qc: 'QC / inspection',
  engineer: 'Design engineer',
  pwht: 'PWHT operator',
  painter: 'Painter',
};

const GROUP_LABELS: Record<string, string> = {
  Material: 'Material',
  Welding: 'Welding',
  'Shop labor': 'Shop labor (fit-up, rolling, assembly, mech.)',
  Consumables: 'Consumables',
  NDT: 'NDT',
  PWHT: 'PWHT',
  'Hydro & test': 'Hydrostatic test',
  Painting: 'Painting',
  'Outside services': 'Outside services',
  'Engineering/QA': 'Engineering & QA',
};

type SortKey = 'tag' | 'material' | 'labor' | 'consumable' | 'services' | 'hours' | 'total';

export default function EstimatePage() {
  const equipment = useStore((s) => s.equipment);
  const settings = useStore((s) => s.settings);

  const ctx: ProcurementContext = useMemo(
    () => ({ stockPlates: settings.plateStock, prices: settings.rates.prices }),
    [settings.plateStock, settings.rates.prices]
  );

  // one compute pass feeds both the estimate and the physical metrics
  const entries = useMemo(() => equipment.map((e) => ({ equip: e, calc: computeEquipment(e) })), [equipment]);
  const est = useMemo(
    () => estimateProject(entries, settings.rates, ctx, settings.manhourOverrides),
    [entries, settings.rates, ctx, settings.manhourOverrides]
  );
  const phys = useMemo(
    () => ({
      dryKg: entries.reduce((s, e) => s + e.calc.weightDryKg, 0),
      weldM: entries.reduce((s, e) => s + e.calc.weldLengthM, 0),
    }),
    [entries]
  );
  const summary = useMemo(
    () => summarizeEstimate(est, phys, { markups: settings.rates, topN: 8 }),
    [est, phys, settings.rates]
  );

  const t = est.totals;
  const m = summary.metrics;

  // ---- table interaction ----
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'total', dir: -1 });
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<'none' | 'group' | 'tag'>('group');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const value = (p: TagEstimate, k: SortKey): number | string =>
    k === 'tag' ? p.tag || p.name
      : k === 'material' ? p.materialUSD
      : k === 'labor' ? p.laborUSD
      : k === 'consumable' ? p.consumableUSD
      : k === 'services' ? p.serviceUSD
      : k === 'hours' ? p.shopHours
      : p.totalUSD;

  const sortedTags = [...est.perTag].sort((a, b) => {
    const av = value(a, sort.key);
    const bv = value(b, sort.key);
    if (typeof av === 'string' || typeof bv === 'string') return sort.dir * String(av).localeCompare(String(bv));
    return sort.dir * (av - bv);
  });
  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }));
  const th = (key: SortKey, label: string, numeric = false) => (
    <th
      className={`sortable ${sort.key === key ? (sort.dir === 1 ? 'asc' : 'desc') : ''} ${numeric ? 'num' : ''}`}
      onClick={() => toggleSort(key)}
      title="Click to sort"
    >
      {label}
    </th>
  );

  const tagSum = est.perTag.reduce((s, p) => s + p.totalUSD, 0);
  const shareOf = (v: number) => (tagSum > 0 ? (v / tagSum) * 100 : 0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      est.lines.filter(
        (l) =>
          (tagFilter === 'all' || l.tag === tagFilter) &&
          (groupFilter === 'all' || l.group === groupFilter) &&
          (q === '' || `${l.tag} ${l.group} ${l.activity} ${l.unit}`.toLowerCase().includes(q))
      ),
    [est.lines, tagFilter, groupFilter, q]
  );
  const filteredAmount = filtered.reduce((s, l) => s + l.amountUSD, 0);
  const filteredHours = filtered.filter((l) => l.unit === 'h').reduce((s, l) => s + l.qty, 0);
  const buckets = useMemo(() => {
    if (groupBy === 'none') return [];
    const map = new Map<string, EstimateLine[]>();
    for (const l of filtered) {
      const k = groupBy === 'group' ? l.group : l.tag || '—';
      const arr = map.get(k) ?? [];
      arr.push(l);
      map.set(k, arr);
    }
    return [...map.entries()]
      .map(([key, lines]) => ({ key, lines, amount: lines.reduce((s, l) => s + l.amountUSD, 0) }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, groupBy]);

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

  const lineRow = (l: EstimateLine, bucket: string, i: number) => (
    <tr key={`${bucket}#${i}`}>
      <td className="mono small">{l.tag}</td>
      <td><span className="badge info">{l.group}</span></td>
      <td className="small">{l.activity}</td>
      <td className="num">{fmt(l.qty, 1)}</td>
      <td>{l.unit}</td>
      <td className="num">{money(l.rateUSD, settings)}</td>
      <td className="num calc">{money(l.amountUSD, settings)}</td>
    </tr>
  );

  const exportXlsx = () =>
    exportSheet({
      filename: 'estimate',
      title: `COST ESTIMATE — detail lines (${est.lines.length})`,
      meta: sheetMeta(
        settings,
        `${est.perTag.length} tags · ${fmt(t.shopHours, 0)} shop hours · rates in ${settings.rateBase}`
      ),
      columns: ['Tag', 'Group', 'Activity', 'Qty', 'Unit', `Rate (${settings.rateBase})`, `Amount (${settings.rateBase})`],
      rows: est.lines.map((l: EstimateLine) => [
        l.tag,
        l.group,
        l.activity,
        fmt(l.qty, 2),
        l.unit,
        fmt(l.rateUSD, 2),
        fmt(l.amountUSD, 2),
      ]),
      totals: ['', '', 'Direct cost subtotal (before markups)', '', '', '', fmt(t.subtotalUSD, 2)],
      notes: [
        `Grand total incl. ${settings.rates.overheadPct}% overhead, ${settings.rates.profitPct}% profit and ${settings.rates.contingencyPct}% contingency: ${fmt(t.grandUSD, 2)} ${settings.rateBase}`,
        `Base currency ${settings.rateBase}; the app converts to ${settings.currency} at the Settings exchange rate.`,
        'Indicative budgetary estimate — verify rates before order.',
      ],
    });

  return (
    <div>
      {/* hidden print target — screen print and the browser's Save-as-PDF */}
      <div id="estimate-print-root" style={{ display: 'none' }}>
        <div className="print-head">
          <img src="ramsis-logo.png" alt="Ramsis Engineering" />
          <div>
            <h2 style={{ margin: 0 }}>COST ESTIMATE</h2>
            <div className="small">{settings.projectName} · Client: {settings.clientName || '—'} · Rev 0 · {new Date().toLocaleDateString()}</div>
          </div>
        </div>
        <table className="grid">
          <thead><tr><th>Tags</th><th>Lines</th><th>Material</th><th>Labor</th><th>Consumables</th><th>Services</th><th>Hours</th><th>Grand total</th></tr></thead>
          <tbody><tr>
            <td>{est.perTag.length}</td><td>{est.lines.length}</td>
            <td>{money(t.materialUSD, settings)}</td><td>{money(t.laborUSD, settings)}</td>
            <td>{money(t.consumableUSD, settings)}</td><td>{money(t.serviceUSD, settings)}</td>
            <td>{fmt(t.shopHours, 0)}</td><td><strong>{money(t.grandUSD, settings)}</strong></td>
          </tr></tbody>
        </table>
        <h3>Cost structure (share of direct cost)</h3>
        <table className="grid">
          <thead><tr><th>Category</th><th>Amount</th><th>Share</th></tr></thead>
          <tbody>{summary.split.map((x) => <tr key={x.key}><td>{x.label}</td><td className="num">{money(x.amountUSD, settings)}</td><td className="num">{fmt(x.pct, 1)}%</td></tr>)}</tbody>
        </table>
        <h3>Cost by category</h3>
        <table className="grid">
          <thead><tr><th>Category</th><th>Lines</th><th>Hours</th><th>Amount</th><th>Share</th></tr></thead>
          <tbody>{summary.groups.map((g) => <tr key={g.group}><td>{GROUP_LABELS[g.group] ?? g.group}</td><td>{g.lines}</td><td>{fmt(g.hours, 0)}</td><td className="num">{money(g.amountUSD, settings)}</td><td className="num">{fmt(g.pct, 1)}%</td></tr>)}</tbody>
        </table>
        <h3>Per-tag summary</h3>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Material</th><th>Labor</th><th>Consumables</th><th>Services</th><th>Hours</th><th>Total</th></tr></thead>
          <tbody>{est.perTag.map((p) => <tr key={p.equipId}><td>{p.tag || p.name}</td><td>{money(p.materialUSD, settings)}</td><td>{money(p.laborUSD, settings)}</td><td>{money(p.consumableUSD, settings)}</td><td>{money(p.serviceUSD, settings)}</td><td>{fmt(p.shopHours, 0)}</td><td>{money(p.totalUSD, settings)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={6}>Grand total (incl. {settings.rates.overheadPct}% OH, {settings.rates.profitPct}% profit, {settings.rates.contingencyPct}% contingency)</td><td>{money(t.grandUSD, settings)}</td></tr></tfoot>
        </table>
        <h3>Detailed estimate lines</h3>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Group</th><th>Activity</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>{est.lines.map((l, i) => lineRow(l, 'print', i))}</tbody>
        </table>
      </div>

      {/* document header */}
      <div className="esthead">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <img
            src="ramsis-logo.png"
            alt="Ramsis Engineering"
            style={{ height: 46, display: 'block' }}
            onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <h2 style={{ margin: 0 }}>COST ESTIMATE</h2>
            <div className="muted small">{settings.projectName} · Client: {settings.clientName || '—'}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }} className="small">
          <div><strong>{est.perTag.length}</strong> tags · <strong>{est.lines.length}</strong> estimate lines · {fmt(phys.weldM, 0)} m weld</div>
          <div className="muted">Rev 0 · {new Date().toLocaleDateString()} · base {settings.rateBase} → shown in {settings.currency}</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={() => printElementById('estimate-print-root', 'Cost estimate')}>⎙ PDF — estimate</button>
        <button
          onClick={() =>
            void exportEstimatePdf({
              meta: { projectName: settings.projectName, clientName: settings.clientName, units: settings.units },
              currency: settings.currency,
              base: settings.rateBase,
              result: est,
              summary,
              formatCost: (v) => money(v, settings),
              rates: settings.rates,
            })
          }
        >
          ⤓ Estimate PDF (file)
        </button>
        <button onClick={exportXlsx}>⤓ Export estimate (.xlsx)</button>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="kpi"><span className="v">{money(t.materialUSD, settings)}</span><span className="l">Material</span></div>
        <div className="kpi"><span className="v">{money(t.laborUSD, settings)}</span><span className="l">Shop labor & welding</span></div>
        <div className="kpi"><span className="v">{money(t.consumableUSD, settings)}</span><span className="l">Consumables</span></div>
        <div className="kpi"><span className="v">{money(t.serviceUSD, settings)}</span><span className="l">NDT · PWHT · Hydro · Paint · Outside</span></div>
        <div className="kpi"><span className="v">{fmt(t.shopHours, 0)} h</span><span className="l">Shop hours</span></div>
        <div className="kpi" style={{ borderColor: 'var(--accent)' }}><span className="v">{money(t.grandUSD, settings)}</span><span className="l">Grand total (incl. markups)</span></div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="kpi"><span className="v">{money(t.subtotalUSD, settings)}</span><span className="l">Direct cost (before markups)</span></div>
        <div className="kpi"><span className="v">{money(m.costPerKgUSD, settings)}/kg</span><span className="l">Per kg dry steel ({fmt(m.dryKg / 1000, 2)} t)</span></div>
        <div className="kpi"><span className="v">{money(m.costPerWeldMUSD, settings)}/m</span><span className="l">Per metre of weld ({fmt(m.weldM, 0)} m)</span></div>
        <div className="kpi"><span className="v">{fmt(m.hoursPerWeldM, 1)} h/m</span><span className="l">Shop hours per weld metre</span></div>
        <div className="kpi"><span className="v">{fmt(m.hoursPerTag, 0)} h</span><span className="l">Average hours per tag</span></div>
        <div className="kpi"><span className="v">{money(m.costPerTagUSD, settings)}</span><span className="l">Average cost per tag</span></div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3>Cost structure <span className="badge info">share of direct cost</span></h3>
          <div className="stackbar">
            {summary.split.map((x, i) => (
              <i key={x.key} style={{ width: `${x.pct}%`, background: SPLIT_COLORS[i] }} title={`${x.label} — ${fmt(x.pct, 1)}%`} />
            ))}
          </div>
          <div className="stacklegend">
            {summary.split.map((x, i) => (
              <span key={x.key}>
                <span className="sw" style={{ background: SPLIT_COLORS[i] }} />
                <strong>{x.label}</strong> — {money(x.amountUSD, settings)} <span className="muted">({fmt(x.pct, 1)}%)</span>
              </span>
            ))}
          </div>
          <hr className="sep" />
          <table className="grid">
            <thead><tr><th>Cost by category</th><th className="num">Lines</th><th className="num">Hours</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
            <tbody>
              {summary.groups.map((g) => (
                <tr key={g.group}>
                  <td>{GROUP_LABELS[g.group] ?? g.group}</td>
                  <td className="num">{g.lines}</td>
                  <td className="num">{g.hours > 0 ? fmt(g.hours, 0) : '—'}</td>
                  <td className="num calc">{money(g.amountUSD, settings)}</td>
                  <td className="num">
                    <span className="sharebar" style={{ width: Math.max(2, g.pct) * 1.4 }} /> {fmt(g.pct, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}><strong>Direct cost</strong></td><td className="num"><strong>{money(t.subtotalUSD, settings)}</strong></td><td className="num"><strong>100%</strong></td></tr></tfoot>
          </table>
        </div>

        <div className="card" style={{ maxWidth: 380 }}>
          <h3>Markups (editable %)</h3>
          <div className="grid2">
            <label className="f"><span>Overhead %</span><input type="number" value={settings.rates.overheadPct} onChange={(e) => setRate('overheadPct', +e.target.value)} /></label>
            <label className="f"><span>Profit %</span><input type="number" value={settings.rates.profitPct} onChange={(e) => setRate('profitPct', +e.target.value)} /></label>
            <label className="f"><span>Contingency %</span><input type="number" value={settings.rates.contingencyPct} onChange={(e) => setRate('contingencyPct', +e.target.value)} /></label>
          </div>
          <hr className="sep" />
          <table className="grid">
            <thead><tr><th>Build-up to grand total</th><th className="num">Amount</th><th className="num">% of total</th></tr></thead>
            <tbody>
              {summary.ladder.map((step) => (
                <tr key={step.label}>
                  <td>{step.label}{step.ratePct != null ? <span className="muted small"> ({step.ratePct}%)</span> : null}</td>
                  <td className="num">{money(step.amountUSD, settings)}</td>
                  <td className="num">{fmt(step.pctOfGrand, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3>Per-tag summary <span className="muted small">— click a column heading to sort</span></h3>
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  {th('tag', 'Tag')}
                  {th('material', 'Material', true)}
                  {th('labor', 'Labor', true)}
                  {th('consumable', 'Consumables', true)}
                  {th('services', 'Services', true)}
                  {th('hours', 'Hours', true)}
                  {th('total', 'Total', true)}
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {sortedTags.map((p) => (
                  <tr key={p.equipId}>
                    <td className="mono">{p.tag || p.name}</td>
                    <td className="num">{money(p.materialUSD, settings)}</td>
                    <td className="num">{money(p.laborUSD, settings)}</td>
                    <td className="num">{money(p.consumableUSD, settings)}</td>
                    <td className="num">{money(p.serviceUSD, settings)}</td>
                    <td className="num">{fmt(p.shopHours, 0)}</td>
                    <td className="num calc"><strong>{money(p.totalUSD, settings)}</strong></td>
                    <td className="num">
                      <span className="sharebar" style={{ width: Math.max(2, shareOf(p.totalUSD)) * 1.4 }} /> {fmt(shareOf(p.totalUSD), 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>All tags</strong></td>
                  <td className="num"><strong>{money(t.materialUSD, settings)}</strong></td>
                  <td className="num"><strong>{money(t.laborUSD, settings)}</strong></td>
                  <td className="num"><strong>{money(t.consumableUSD, settings)}</strong></td>
                  <td className="num"><strong>{money(t.serviceUSD, settings)}</strong></td>
                  <td className="num"><strong>{fmt(t.shopHours, 0)}</strong></td>
                  <td className="num"><strong>{money(tagSum, settings)}</strong></td>
                  <td className="num"><strong>100%</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Tag totals cover material, shop labor, consumables and services; project-level engineering &amp; QA and the
            markups are added on top (see the build-up on the right).
          </p>
        </div>

        <div className="card" style={{ maxWidth: 440 }}>
          <h3>Top cost drivers</h3>
          {summary.topDrivers.length === 0 && <p className="muted small">No estimate lines yet.</p>}
          {summary.topDrivers.map((l, i) => (
            <div key={`${l.tag}-${i}`} className="driver">
              <div className="driver-top">
                <span><span className="badge info">{l.group}</span> <strong className="mono small">{l.tag}</strong></span>
                <span className="num calc">{money(l.amountUSD, settings)}</span>
              </div>
              <div className="driver-bar"><i style={{ width: `${summary.groups.length ? Math.min(100, (l.amountUSD / Math.max(1, summary.topDrivers[0].amountUSD)) * 100) : 0}%` }} /></div>
              <div className="muted small">{l.activity}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Basis of estimate — rate card in force <span className="muted small">— all rates editable in Settings</span></h3>
        <div className="refgrid">
          <table className="grid">
            <thead><tr><th colSpan={2}>Shop labor ({settings.rateBase}/h)</th></tr></thead>
            <tbody>
              {Object.entries(settings.rates.labor).map(([k, v]) => (
                <tr key={k}><td>{LABOR_LABELS[k] ?? k}</td><td className="num calc">{fmt(v, 2)}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="grid">
            <thead><tr><th colSpan={2}>Services &amp; tests ({settings.rateBase})</th></tr></thead>
            <tbody>
              <tr><td>PWHT cycle (furnace/rig)</td><td className="num calc">{fmt(settings.rates.pwhtCycleUSD, 0)}</td></tr>
              <tr><td>Conventional RT crew / day</td><td className="num calc">{fmt(settings.rates.rtDayUSD, 0)}</td></tr>
              <tr><td>PaUT/TOFD crew / day</td><td className="num calc">{fmt(settings.rates.putTofdDayUSD, 0)}</td></tr>
              <tr><td>Head forming (outside) / h</td><td className="num calc">{fmt(settings.rates.formingRate, 0)}</td></tr>
              <tr><td>Paint &amp; consumables / m²</td><td className="num calc">{fmt(settings.rates.paintUSDperM2, 2)}</td></tr>
              <tr><td>Test water / m³</td><td className="num calc">{fmt(settings.rates.hydroUSDperM3, 3)}</td></tr>
            </tbody>
          </table>
          <table className="grid">
            <thead><tr><th colSpan={2}>Consumables &amp; stock ({settings.rateBase})</th></tr></thead>
            <tbody>
              <tr><td>SMAW electrode / kg</td><td className="num calc">{fmt(settings.rates.electrodePrice, 2)}</td></tr>
              <tr><td>SAW wire / kg</td><td className="num calc">{fmt(settings.rates.wirePrice, 2)}</td></tr>
              <tr><td>SAW flux / kg</td><td className="num calc">{fmt(settings.rates.sawFluxPrice, 2)}</td></tr>
              <tr><td>Grinding discs / ea</td><td className="num calc">{fmt(settings.rates.discPrice, 2)}</td></tr>
              <tr><td>Gas cylinder</td><td className="num calc">{fmt(settings.rates.gasCylPrice, 2)}</td></tr>
              <tr><td>Gasket / kg · bolting / kg</td><td className="num calc">{fmt(settings.rates.gasketPrice, 2)} · {fmt(settings.rates.boltPrice, 2)}</td></tr>
              <tr><td>Material prices in force</td><td className="num">{Object.keys(settings.rates.prices).length} override(s)</td></tr>
            </tbody>
          </table>
          <table className="grid">
            <thead><tr><th colSpan={2}>Commercial &amp; physical reference</th></tr></thead>
            <tbody>
              <tr><td>Base → display currency</td><td className="num">{settings.rateBase} → {settings.currency} @ {fmt(settings.fxRates[settings.currency] ?? CURRENCIES[settings.currency].rate, 3)}</td></tr>
              <tr><td>Markups OH / profit / contingency</td><td className="num">{settings.rates.overheadPct}% · {settings.rates.profitPct}% · {settings.rates.contingencyPct}%</td></tr>
              <tr><td>Tags · estimate lines</td><td className="num">{m.tags} · {m.lineCount}</td></tr>
              <tr><td>Dry weight · weld length</td><td className="num">{fmt(m.dryKg / 1000, 2)} t · {fmt(m.weldM, 0)} m</td></tr>
              <tr><td>Shop hours (incl. eng/QA %)</td><td className="num">{fmt(m.shopHours, 0)} h</td></tr>
              <tr><td>Cost per kg / per weld m</td><td className="num">{money(m.costPerKgUSD, settings)} · {money(m.costPerWeldMUSD, settings)}</td></tr>
              <tr><td>Plate stock sizes</td><td className="num">{settings.plateStock.length} sizes</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Rates are stored in <strong>{settings.rateBase}</strong> (base currency) and shown in <strong>{settings.currency}</strong>.
          Welding hours follow the SAW deposition model where the joint is SAW-eligible (ferritic vessel/column, t ≥ 10 mm);
          nozzle and support welds stay manual. Head forming is billed as an outside service. Every line in the detail below
          carries its own quantity, unit and rate, so any figure can be traced back to the rate that produced it.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Weld breakdown — shell &amp; dish-end welding hours, weld metal, joint configuration, electrodes</h3>
        {est.perTag.map((p) => (
          <details key={p.equipId} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              <strong className="mono">{p.tag || p.name}</strong> — {p.name} · {p.welds.length} weld areas ·{' '}
              {fmt(p.welds.reduce((s, w) => s + w.hours, 0), 0)} h · {fmt(p.welds.reduce((s, w) => s + w.depositKg, 0), 0)} kg deposit
            </summary>
            <div className="tablewrap" style={{ marginTop: 6 }}>
              <table className="grid">
                <thead><tr><th>Weld area</th><th className="num">Length (m)</th><th className="num">Hours (root · fill)</th><th className="num">Deposit (kg)</th><th>Joint configuration</th><th>Root process</th><th>Fill process</th><th>Electrode / filler</th></tr></thead>
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
        <h3>Detailed estimate lines <span className="muted small">— {filtered.length} of {est.lines.length} lines</span></h3>
        <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tag, activity or group…"
            style={{ minWidth: 240 }}
          />
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="all">All tags</option>
            {est.perTag.map((p) => <option key={p.equipId} value={p.tag || p.name}>{p.tag || p.name}</option>)}
          </select>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">All groups</option>
            {summary.groups.map((g) => <option key={g.group} value={g.group}>{GROUP_LABELS[g.group] ?? g.group}</option>)}
          </select>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'none' | 'group' | 'tag')}>
            <option value="group">Group by category</option>
            <option value="tag">Group by tag</option>
            <option value="none">Flat list</option>
          </select>
          <button onClick={exportXlsx}>Export estimate (.xlsx)</button>
          <div className="spacer" style={{ flex: 1 }} />
          <span className="kpi"><span className="v">{money(filteredAmount, settings)}</span><span className="l">Filtered amount</span></span>
          <span className="kpi"><span className="v">{fmt(filteredHours, 0)} h</span><span className="l">Filtered hours</span></span>
        </div>

        {groupBy === 'none' ? (
          <div className="tablewrap" style={{ maxHeight: 520 }}>
            <table className="grid">
              <thead><tr><th>Tag</th><th>Group</th><th>Activity</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate ({settings.currency})</th><th className="num">Amount</th></tr></thead>
              <tbody>{filtered.map((l, i) => lineRow(l, 'flat', i))}</tbody>
              <tfoot><tr><td colSpan={6}><strong>Filtered total ({filtered.length} lines)</strong></td><td className="num"><strong>{money(filteredAmount, settings)}</strong></td></tr></tfoot>
            </table>
          </div>
        ) : (
          <div className="tablewrap" style={{ maxHeight: 520 }}>
            <table className="grid">
              <thead><tr><th>Tag</th><th>Group</th><th>Activity</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate ({settings.currency})</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {buckets.map((b) => {
                  const open = !collapsed[b.key];
                  const share = filteredAmount > 0 ? (b.amount / filteredAmount) * 100 : 0;
                  return (
                    <Fragment key={b.key}>
                      <tr
                        className="bucket"
                        title={open ? 'Click to collapse' : 'Click to expand'}
                        onClick={() => setCollapsed((c) => ({ ...c, [b.key]: !c[b.key] }))}
                      >
                        <td colSpan={6}>
                          <span className="muted">{open ? '▾' : '▸'}</span>{' '}
                          <strong>{groupBy === 'group' ? (GROUP_LABELS[b.key] ?? b.key) : b.key}</strong>{' '}
                          <span className="muted small">— {b.lines.length} line{b.lines.length === 1 ? '' : 's'} · {fmt(share, 1)}% of the filtered total</span>
                        </td>
                        <td className="num calc"><strong>{money(b.amount, settings)}</strong></td>
                      </tr>
                      {open && b.lines.map((l, i) => lineRow(l, b.key, i))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={6}><strong>Filtered total ({filtered.length} lines)</strong></td><td className="num"><strong>{money(filteredAmount, settings)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          All rates are editable in Settings and stored in <strong>{settings.rateBase} (base currency)</strong> — material per kg,
          labor per hour, consumables, PWHT cycle, RT/PaUT day rates and the outsourced head-forming rate. Amounts convert to{' '}
          {settings.currency} at the Settings exchange rate. Manual man-hour overrides appear as an explicit
          &ldquo;Manual manhour adjustment&rdquo; line so the automatic basis stays visible.
        </p>
      </div>
    </div>
  );
}


