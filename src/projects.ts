// Named project library in this browser — the offline half of "My Projects".
//
// Cloud saves live in cloud.ts (Firebase). Both expose the same ProjectEntry
// shape so the My Projects page can render the two sources with one renderer.
// A save writes the same sanitised payload as the JSON export: the Gemini key
// and attachment files are never stored in a project entry.

import { exportProjectJson, getStore, importProjectData } from './store';
import { uid } from './engine/units';

export interface ProjectEntry {
  id: string;
  name: string;
  savedAtMs: number;
  bytes: number;
  tags: number;
}

const KEY = 'static-equip-suite-projects-v1';

/** localStorage is roughly 5 MB per origin — leave room for the active project. */
export const MAX_LOCAL_BYTES = 4_000_000;

/** Read the library. A corrupted entry list is dropped, never thrown. */
export function listLocalProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is ProjectEntry => Boolean(e) && typeof (e as ProjectEntry).id === 'string')
      .map((e) => ({
        id: e.id,
        name: typeof e.name === 'string' && e.name ? e.name : 'Untitled',
        savedAtMs: typeof e.savedAtMs === 'number' ? e.savedAtMs : 0,
        bytes: typeof e.bytes === 'number' ? e.bytes : 0,
        tags: typeof e.tags === 'number' ? e.tags : 0,
      }))
      .sort((a, b) => b.savedAtMs - a.savedAtMs);
  } catch {
    return [];
  }
}

function writeLibrary(list: ProjectEntry[], payloads?: Record<string, string>): void {
  // Entry metadata and payloads are kept in one record so a save, a load and a
  // delete can never leave a payload behind without its entry.
  const record = list.map((e) => ({ ...e, payload: payloads?.[e.id] ?? readPayloadOnly(e.id) }));
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch (e) {
    // a quota failure must never look like a successful save — enrich the
    // original error so its stack and cause chain survive
    const err = e instanceof Error ? e : new Error(String(e));
    err.message =
      err.name === 'QuotaExceededError'
        ? 'This browser is out of storage — delete an old project below, then save again.'
        : `Could not write to this browser: ${err.message}`;
    throw err;
  }
}

function readPayloadOnly(id: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return undefined;
    const hit = (parsed as { id?: string; payload?: string }[]).find((p) => p?.id === id);
    return typeof hit?.payload === 'string' ? hit.payload : undefined;
  } catch {
    return undefined;
  }
}

/** Total bytes held by named saves — shown so the quota is visible before it bites. */
export function localProjectsBytes(): number {
  return listLocalProjects().reduce((t, p) => t + p.bytes, 0);
}

/**
 * Save the current project under a name. Saving under an existing name
 * overwrites that save (it is the same project), otherwise a new entry is
 * created. Returns the resulting entry.
 */
export function saveLocalProject(name: string, tags = 0): ProjectEntry {
  const trimmed = name.trim() || getStore().settings.projectName.trim() || 'Untitled project';
  const payload = exportProjectJson();
  const bytes = new TextEncoder().encode(payload).length;
  const list = listLocalProjects();
  const existing = list.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const others = existing ? list.filter((p) => p.id !== existing.id) : list;
  const total = others.reduce((t, p) => t + p.bytes, 0) + bytes;
  if (total > MAX_LOCAL_BYTES) {
    throw new Error(
      `Saving would hold ${(total / 1e6).toFixed(1)} MB in this browser (limit ${(MAX_LOCAL_BYTES / 1e6).toFixed(0)} MB). Export a project file instead, or delete an old save.`
    );
  }
  const entry: ProjectEntry = {
    id: existing?.id ?? uid('prj'),
    name: trimmed,
    savedAtMs: Date.now(),
    bytes,
    tags,
  };
  const payloads: Record<string, string> = {};
  for (const p of list) {
    const kept = readPayloadOnly(p.id);
    if (kept !== undefined) payloads[p.id] = kept;
  }
  payloads[entry.id] = payload;
  writeLibrary([entry, ...others], payloads);
  return entry;
}

/** The stored JSON of a save — used by load and by file export. */
export function readLocalPayload(id: string): string {
  const payload = readPayloadOnly(id);
  if (payload === undefined) throw new Error('That project is no longer in this browser.');
  return payload;
}

/** Replace the active project with a saved one. */
export function loadLocalProject(id: string): ProjectEntry {
  const entry = listLocalProjects().find((p) => p.id === id);
  if (!entry) throw new Error('That project is no longer in this browser.');
  const payload = readLocalPayload(id);
  importProjectData(JSON.parse(payload) as Parameters<typeof importProjectData>[0]);
  return entry;
}

export function deleteLocalProject(id: string): void {
  const list = listLocalProjects().filter((p) => p.id !== id);
  if (list.length === 0) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing left to clear */
    }
    return;
  }
  const payloads: Record<string, string> = {};
  for (const p of list) {
    const kept = readPayloadOnly(p.id);
    if (kept !== undefined) payloads[p.id] = kept;
  }
  writeLibrary(list, payloads);
}
