// Materials suggestion by service + PWHT procedures per tag.

import { useMemo } from 'react';
import { useStore, setState } from '../store';
import { MATERIALS, SERVICE_SUGGESTIONS, allowableAt, getMat } from '../engine/materials';
import { pwhtAdvice, consumablesFor } from '../engine/pwht';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';

export default function MaterialsPwht() {
  const equipment = useStore((s) => s.equipment);

  const rows = useMemo(
    () =>
      equipment.map((e) => {
        const calc = computeEquipment(e);
        const maxT = Math.max(...e.sections.map((s) => s.shellThk || 0), ...e.sections.map((s) => s.headThkTop || 0), 12);
        const advice = pwhtAdvice(e.materialKey, calc.sections[0]?.tNominal ?? maxT, e.mdmt, e.pwhtOverride);
        return { e, calc, advice, consumables: consumablesFor(e.materialKey) };
      }),
    [equipment]
  );

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Material suggestions by service</h3>
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Service</th><th>Recommended materials</th><th>Notes</th></tr></thead>
            <tbody>
              {SERVICE_SUGGESTIONS.map((s) => (
                <tr key={s.service}>
                  <td>{s.service}</td>
                  <td>{s.keys.map((k) => getMat(k)?.name ?? k).join(', ')}</td>
                  <td className="small muted">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Allowable stresses are indicative summaries of ASME II-D — verify against the licensed current edition before stamping.
        </p>
      </div>

      <div className="tablewrap" style={{ marginBottom: 14 }}>
        <table className="grid">
          <thead>
            <tr><th>Tag</th><th>Material</th><th>P-No.</th><th className="num">S @ design T (MPa)</th><th className="num">Max t (mm)</th><th>PWHT required</th><th>Basis</th></tr>
          </thead>
          <tbody>
            {rows.map(({ e, calc, advice }) => (
              <tr key={e.id}>
                <td className="mono">{e.tag}</td>
                <td>
                  <select value={e.materialKey} onChange={(ev) => setState((s) => ({ equipment: s.equipment.map((x) => (x.id === e.id ? { ...x, materialKey: ev.target.value } : x)) }))}>
                    {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                  </select>
                </td>
                <td className="mono small">{getMat(e.materialKey).pno}</td>
                <td className="num calc">{fmt(allowableAt(e.materialKey, e.designTemp), 1)}</td>
                <td className="num">{fmt(calc.sections[0]?.tNominal ?? 0, 1)}</td>
                <td>
                  <span className={`badge ${advice.required ? 'warn' : 'ok'}`}>{advice.required ? 'YES' : 'No'}</span>{' '}
                  <span className="muted small">(override:</span>
                  <select
                    value={e.pwhtOverride === null ? 'auto' : e.pwhtOverride ? 'yes' : 'no'}
                    onChange={(ev) => setState((s) => ({ equipment: s.equipment.map((x) => (x.id === e.id ? { ...x, pwhtOverride: ev.target.value === 'auto' ? null : ev.target.value === 'yes' } : x)) }))}
                    style={{ marginLeft: 4 }}
                  >
                    <option value="auto">auto</option><option value="yes">force</option><option value="no">waive</option>
                  </select>
                  <span className="muted small">)</span>
                </td>
                <td className="small muted">{advice.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <div className="card muted">No equipment tags yet.</div>}

      <div className="row">
        {rows.map(({ e, advice, consumables }) => (
          <div className="card" key={e.id} style={{ minWidth: 420 }}>
            <h3>{e.tag} — {getMat(e.materialKey).name} {advice.required ? '· PWHT procedure' : '· no PWHT'}</h3>
            <pre className="code">{advice.procedure}</pre>
            <p className="small"><strong>Preheat:</strong> {advice.preheat}</p>
            <p className="small">
              <strong>Fillers:</strong> {advice.fillers.join(' · ')}
              <br />
              <span className="muted">SMAW {consumables.smaw} · GTAW {consumables.gtaw} · FCAW {consumables.fcaw}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
