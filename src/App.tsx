import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore, setSettings } from './store';
import { subscribeFix, getFix } from './fixNav';
import { CURRENCIES } from './engine/currency';
import { computeEquipment } from './engine/compute';
import Register from './pages/Register';
// 3D viewer pulls in three.js (~600 kB) — load it only when the page opens so
// the initial bundle stays small
const Viewer3D = lazy(() => import('./pages/Viewer3D'));
import AiReview from './pages/AiReview';
import BomPage from './pages/BomPage';
import Inspection from './pages/Inspection';
import MaterialsPwht from './pages/MaterialsPwht';
import EstimatePage from './pages/EstimatePage';
import Reports from './pages/Reports';
import SettingsPage from './pages/SettingsPage';

export type PageKey =
  | 'register' | 'viewer' | 'ai' | 'bom' | 'inspection' | 'materials' | 'estimate' | 'reports' | 'settings';

const NAV: { key?: PageKey; label?: string; icon?: string; group?: string }[] = [
  { key: 'register', label: 'Equipment Register', icon: '▦' },
  { key: 'viewer', label: '3D Viewer & Stress', icon: '◈' },
  { key: 'ai', label: 'Gemini Code Review', icon: '✦' },
  { group: 'Deliverables' },
  { key: 'bom', label: 'BOM / MTO / Procurement', icon: '☰' },
  { key: 'inspection', label: 'Inspection & ITP', icon: '◎' },
  { key: 'materials', label: 'Materials & PWHT', icon: '⚙' },
  { key: 'estimate', label: 'Estimate', icon: '＄' },
  { key: 'reports', label: 'Reports & CAD Export', icon: '⎙' },
  { group: 'Project' },
  { key: 'settings', label: 'Settings', icon: '募' },
];

export default function App() {
  const [page, setPage] = useState<PageKey>('register');
  const settings = useStore((s) => s.settings);
  const equipment = useStore((s) => s.equipment);
  const saveError = useStore((s) => s.saveError);
  const equipCount = equipment.length;

  // Project status strip (PV Elite-style code summary), live over every tag.
  // Errors and warnings are counted separately — the old code folded errors
  // into the "Warnings" chip and counted them twice.
  const status = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let passing = 0;
    for (const e of equipment) {
      const calc = computeEquipment(e);
      const err = calc.warnings.filter((x) => x.level === 'error').length;
      const wrn = calc.warnings.filter((x) => x.level === 'warning').length;
      errors += err;
      warns += wrn;
      if (err === 0 && wrn === 0) passing++;
    }
    return { errors, warns, passing };
  }, [equipment]);

  // click-to-fix from any warning list opens the Register, where the tag and
  // field are selected and focused
  useEffect(() => subscribeFix(() => {
    if (getFix()) setPage('register');
  }), []);

  const statusDot = status.errors > 0 ? 'err' : status.warns > 0 ? 'warn' : 'ok';
  const statusText = status.errors > 0
    ? `${status.errors} code error${status.errors === 1 ? '' : 's'} — review required`
    : status.warns > 0
      ? `Design OK · ${status.warns} advisories`
      : 'All checks passed';

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <img
            src="ramsis-logo.png"
            alt="Ramsis Engineering"
            onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h1>RAMSIS ENGINEERING</h1>
          <div className="sub">StaticSuite · ASME VIII · API 650/661 · TEMA</div>
        </div>
        <nav className="nav">
          {NAV.map((n, i) =>
            n.group !== undefined ? (
              <div className="section-label" key={`g${i}`}>{n.group}</div>
            ) : (
              <button key={n.key} className={page === n.key ? 'active' : ''} onClick={() => n.key && setPage(n.key)}>
                <span aria-hidden>{n.icon}</span> {n.label}
              </button>
            )
          )}
        </nav>
        <div className="footer">
          {settings.projectName}
          <br />
          {equipCount} tags · {settings.currency} · {settings.units}
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <h2>{NAV.find((n) => n.key === page)?.label}</h2>
          <span className="badge info">{settings.units === 'metric' ? 'mm · bar · °C' : 'in · psi · °F'}</span>
          <div className="spacer" />
          <label className="small muted">Currency</label>
          <select
            value={settings.currency}
            onChange={(e) => setSettings({ currency: e.target.value as never })}
            style={{ width: 120 }}
          >
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>
                {code} ({c.symbol})
              </option>
            ))}
          </select>
        </div>
        {saveError && (
          <div className="finding error" style={{ margin: '8px 12px 0' }}>
            ⚠ <strong>Project not saved to this browser</strong> — the storage write failed ({saveError}). Your latest
            changes exist only in this tab: free up space or export a backup from Settings → Data, then make any change
            to retry the save.
          </div>
        )}
        <div className="statusstrip">
          <span className="chip"><span className={`dot ${statusDot}`} /> {statusText}</span>
          <span className="chip">Tags: <strong>{equipCount}</strong></span>
          <span className="chip">Passing: <strong>{status.passing}/{equipCount}</strong></span>
          <span className="chip">Errors: <strong>{status.errors}</strong></span>
          <span className="chip">Warnings: <strong>{status.warns}</strong></span>
          <span className="chip">Client: <strong>{settings.clientName || '—'}</strong></span>
          <span className="chip">Currency: <strong>{settings.currency}</strong></span>
        </div>
        <div className="content">
          {page === 'register' && <Register />}
          {page === 'viewer' && (
            <Suspense fallback={<p className="muted small">Loading 3D viewer…</p>}>
              <Viewer3D />
            </Suspense>
          )}
          {page === 'ai' && <AiReview />}
          {page === 'bom' && <BomPage />}
          {page === 'inspection' && <Inspection />}
          {page === 'materials' && <MaterialsPwht />}
          {page === 'estimate' && <EstimatePage />}
          {page === 'reports' && <Reports />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </div>
    </>
  );
}
