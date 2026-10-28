// My Projects — save the current project under a name, list every saved project
// (browser + Firebase cloud) and retrieve any of them on demand.
//
// Loading a project replaces the active state through importProjectData — the
// same path Settings → Import uses — so legacy USD-base files still migrate and
// the sanitised payload means no Gemini key or attachment file is ever stored
// in a save.

import { useMemo, useState } from 'react';
import { useStore, setState, setSettings, exportProjectJson, importProjectData, defaultSettings } from '../store';
import {
  deleteLocalProject,
  listLocalProjects,
  loadLocalProject,
  localProjectsBytes,
  MAX_LOCAL_BYTES,
  readLocalPayload,
  saveLocalProject,
  type ProjectEntry,
} from '../projects';
import {
  CLOUD_RULES,
  cloudDelete,
  cloudList as fetchCloudList,
  cloudLoad,
  cloudSave,
  connectCloud,
  isConfigured,
} from '../cloud';
import { computeEquipment } from '../engine/compute';
import { fmt } from '../engine/units';

type RowSource = 'browser' | 'cloud';
interface Row {
  id: string;
  name: string;
  savedAtMs: number;
  bytes: number;
  tags: number;
  source: RowSource;
}

function ago(ms: number): string {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}

/** Ask the load target to confirm first — a load replaces unsaved edits. */
function confirmLoad(name: string): boolean {
  return confirm(
    `Load “${name}”?\n\nIt replaces the project open right now. Anything not saved since your last save would be lost — use “Save current” above first if in doubt.`
  );
}

function download(name: string, payload: string) {
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w.-]+/g, '_') || 'project'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MyProjects() {
  const projectName = useStore((x) => x.settings.projectName);
  const equipment = useStore((x) => x.equipment);
  const cfg = useStore((x) => x.settings.firebaseConfig);
  const hasCfg = isConfigured(cfg);

  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [cloudUid, setCloudUid] = useState('');

  const tagCount = equipment.length;
  const bytesUsed = localProjectsBytes();

  const announce = (kind: 'ok' | 'err' | 'info', text: string) => setMsg({ kind, text });

  /** Browser library is always local and instant; the cloud half is optional. */
  const refresh = async (withCloud: boolean, onDone?: () => void) => {
    setBusy(true);
    const local: Row[] = listLocalProjects().map((p) => ({ ...p, source: 'browser' as const }));
    if (!withCloud || !hasCfg) {
      setRows(local);
      setBusy(false);
      onDone?.();
      return;
    }
    try {
      const uid = await connectCloud(cfg);
      setCloudUid(uid);
      const cloud: Row[] = (await fetchCloudList()).map((c) => ({ ...c, source: 'cloud' as const }));
      setRows([...local, ...cloud]);
    } catch (e) {
      // a cloud failure must not hide the projects saved in this browser
      setRows(local);
      announce('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  const stats = useMemo(() => {
    const e = equipment[0];
    if (!e) return null;
    const calc = computeEquipment(e);
    return { mawp: calc.mawpBar, kg: calc.weightDryKg };
  }, [equipment]);

  const saveHere = () => {
    try {
      const entry = saveLocalProject(name || projectName, tagCount);
      setName('');
      announce(
        'ok',
        `Saved “${entry.name}” in this browser — ${entry.tags} tag(s), ${(entry.bytes / 1024).toFixed(0)} KB.`
      );
      void refresh(false);
    } catch (e) {
      announce('err', e instanceof Error ? e.message : String(e));
    }
  };

  const saveCloud = async () => {
    setBusy(true);
    try {
      await connectCloud(cfg);
      const payload = exportProjectJson();
      await cloudSave({ name: name || projectName || 'Untitled project', payload, tags: tagCount });
      setName('');
      announce('ok', 'Saved to the cloud — available on any device signed in to this Firebase project.');
      await refresh(true);
    } catch (e) {
      announce('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadRow = async (r: Row) => {
    if (!confirmLoad(r.name)) return;
    setBusy(true);
    try {
      const payload = r.source === 'browser' ? readLocalPayload(r.id) : await cloudLoad(r.id);
      importProjectData(JSON.parse(payload) as Parameters<typeof importProjectData>[0]);
      announce('ok', `Loaded “${r.name}” — ${r.tags} tag(s).`);
    } catch (e) {
      announce('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRow = async (r: Row) => {
    if (!confirm(`Delete “${r.name}” from ${r.source === 'browser' ? 'this browser' : 'the cloud'}?`)) return;
    setBusy(true);
    try {
      if (r.source === 'browser') deleteLocalProject(r.id);
      else {
        await connectCloud(cfg);
        await cloudDelete(r.id);
      }
      announce('ok', `Deleted “${r.name}”.`);
      await refresh(r.source === 'cloud');
    } catch (e) {
      announce('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncToCloud = async (source: Row) => {
    setBusy(true);
    try {
      await connectCloud(cfg);
      const payload = readLocalPayload(source.id);
      await cloudSave({ name: source.name, payload, tags: source.tags });
      announce('ok', `Copied “${source.name}” to the cloud.`);
      await refresh(true);
    } catch (e) {
      announce('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toFile = (r: Row) => {
    if (r.source === 'browser') {
      try {
        download(r.name, readLocalPayload(r.id));
      } catch (e) {
        announce('err', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        download(r.name, await cloudLoad(r.id));
      } catch (e) {
        announce('err', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const browserRows = rows.filter((r) => r.source === 'browser');
  const cloudRows = rows.filter((r) => r.source === 'cloud');
  const pct = Math.min(100, Math.round((bytesUsed / MAX_LOCAL_BYTES) * 100));

  return (
    <div>
      <div className="card">
        <h3>Save current project</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          A save is a named, restorable copy of everything on this project: {tagCount} tag(s), settings, rates and
          estimates. Saving overwrites a save with the same name; nothing else is touched. The Gemini key and attached
          datasheet files are never written into a save.
        </p>
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <label className="f" style={{ flex: 1, minWidth: 220 }}>
            <span>Save name</span>
            <input
              value={name}
              placeholder={projectName || 'Untitled project'}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveHere()}
            />
          </label>
          <button className="primary" disabled={busy} onClick={saveHere}>
            💾 Save in this browser
          </button>
          <button disabled={busy || !hasCfg} onClick={saveCloud} title={hasCfg ? 'Push to Firebase' : 'Connect Firebase in Settings → Cloud first'}>
            ☁ Save to cloud
          </button>
        </div>

        <div className="row small muted" style={{ gap: 10, marginTop: 6 }}>
          <span>
            Browser storage: <strong>{(bytesUsed / 1024).toFixed(0)} KB</strong> of {(MAX_LOCAL_BYTES / 1e6).toFixed(0)}{' '}
            MB ({pct}%)
          </span>
          <span>·</span>
          <span>
            Current project: <strong>{tagCount}</strong> tag(s)
            {stats ? ` · MAWP ${fmt(stats.mawp, 1)} bar · dry weight ${fmt(stats.kg, 0)} kg` : ''}
          </span>
        </div>

        {!hasCfg && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Cloud saves are off until a Firebase config is added in <strong>Settings → Cloud backup</strong>. Everything
            else on this page works without it.
          </p>
        )}
        {msg && <div className={`finding ${msg.kind === 'err' ? 'error' : 'ok'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Saved projects ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="muted small" style={{ marginTop: 0 }}>
            Nothing saved yet. Use <strong>Save current project</strong> above and it will be listed here, ready to
            retrieve at any time.
          </p>
        ) : (
          <>
            {browserRows.length > 0 && (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th className="num">Tags</th>
                    <th className="num">Size</th>
                    <th>Saved</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {browserRows.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{r.name}</td>
                      <td className="num small">{r.tags}</td>
                      <td className="num small">{(r.bytes / 1024).toFixed(0)} KB</td>
                      <td className="small muted" title={new Date(r.savedAtMs).toLocaleString()}>{ago(r.savedAtMs)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        <button className="ghost" disabled={busy} onClick={() => void loadRow(r)}>Load</button>{' '}
                        <button className="ghost" disabled={busy} onClick={() => void toFile(r)}>⬇ File</button>{' '}
                        <button className="ghost" title="Copy this save to the cloud" disabled={busy || !hasCfg} onClick={() => void syncToCloud(r)}>☁</button>{' '}
                        <button className="ghost danger" disabled={busy} onClick={() => void deleteRow(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {cloudRows.length > 0 && (
              <>
                <p className="small muted" style={{ marginBottom: 4 }}>
                  ☁ Cloud — reachable from any device after <strong>Connect</strong> on this page.
                </p>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th className="num">Tags</th>
                      <th className="num">Size</th>
                      <th>Saved</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudRows.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{r.name}</td>
                        <td className="num small">{r.tags}</td>
                        <td className="num small">{(r.bytes / 1024).toFixed(0)} KB</td>
                        <td className="small muted" title={new Date(r.savedAtMs).toLocaleString()}>{ago(r.savedAtMs)}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <button className="ghost" disabled={busy} onClick={() => void loadRow(r)}>Load</button>{' '}
                          <button className="ghost" disabled={busy} onClick={() => void toFile(r)}>⬇ File</button>{' '}
                          <button className="ghost danger" disabled={busy} onClick={() => void deleteRow(r)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <button
            disabled={busy}
            onClick={() => {
              if (!hasCfg) {
                refresh(false);
                announce('info', 'Showing projects saved in this browser (no cloud connection configured).');
              } else {
                void refresh(true, () => announce('ok', 'List refreshed.'));
              }
            }}
          >
            ↻ Refresh list
          </button>
          {cloudUid && <span className="small muted">Signed in as {cloudUid}</span>}
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          <strong>Retrieve:</strong> press <em>Load</em> on any row to replace the open project with that save — the
          same path as importing a file, so older saves migrate automatically. <strong>⬇ File</strong> downloads a save
          as JSON for moving between machines or archiving.
        </p>
      </div>

      {!hasCfg && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Cloud setup (optional)</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Saves in this browser are tied to this device. To retrieve them anywhere, connect a free Firebase project —
            the config and the two one-time console steps (Anonymous sign-in, Firestore rules) live in{' '}
            <strong>Settings → Cloud backup</strong>. The rules below are what keep other users out of your saves:
          </p>
          <details>
            <summary className="small muted">Firestore security rules</summary>
            <pre className="code" style={{ marginTop: 6 }}>{CLOUD_RULES}</pre>
          </details>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Start a new project</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Clears the working copy in this tab (tags, reviews and datasheets) and returns settings to their defaults.
          Saves listed above are untouched — reload any of them afterwards.
        </p>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!confirm('Start a new project? The current working copy in this tab is cleared (saved projects are kept).')) return;
            setState({ equipment: [], reviews: [], datasheets: [], staleDatasheets: [], _datasheetData: {}, selectedEquipId: null });
            setSettings({ ...defaultSettings, projectName: 'Untitled project' });
            announce('ok', 'New blank project started. Your saves are still listed above.');
          }}
        >
          ＋ New blank project
        </button>
      </div>
    </div>
  );
}
