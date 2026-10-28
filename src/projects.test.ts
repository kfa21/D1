// My Projects — the named project library: save, list, retrieve, delete.
// localStorage is mocked because the suite runs on node.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listLocalProjects,
  saveLocalProject,
  loadLocalProject,
  deleteLocalProject,
  localProjectsBytes,
  readLocalPayload,
  MAX_LOCAL_BYTES,
} from './projects';
import { setState, setSettings, getStore, defaultSettings } from './store';

const KEY = 'static-equip-suite-projects-v1';

let store: Map<string, string>;
const g = globalThis as { localStorage?: unknown };
let original: unknown;

function mockStorage(failure?: Error) {
  store = new Map();
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (failure) throw failure;
      store.set(k, String(v));
    },
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  original = g.localStorage;
  mockStorage();
  setState({
    equipment: [],
    settings: { ...defaultSettings, projectName: 'Alpha Plant' },
    selectedEquipId: null,
    reviews: [],
    datasheets: [],
    staleDatasheets: [],
    _datasheetData: {},
  });
});

afterEach(() => {
  g.localStorage = original;
});

describe('saveLocalProject', () => {
  it('stores a named entry with name, tag count, size and timestamp', () => {
    const entry = saveLocalProject('Bahrain Unit 3', 4);
    const list = listLocalProjects();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: entry.id, name: 'Bahrain Unit 3', tags: 4 });
    expect(list[0].bytes).toBeGreaterThan(0);
    expect(list[0].savedAtMs).toBeGreaterThan(Date.now() - 5000);
    expect(localProjectsBytes()).toBe(list[0].bytes);
  });

  it('falls back to the project name when the save name is blank', () => {
    saveLocalProject('   ');
    expect(listLocalProjects()[0].name).toBe('Alpha Plant');
  });

  it('overwrites the save that shares its name instead of duplicating it', () => {
    saveLocalProject('Unit 3', 1);
    setSettings({ projectName: 'Renamed' });
    saveLocalProject('Unit 3', 2);
    const list = listLocalProjects();
    expect(list).toHaveLength(1);
    expect(list[0].tags).toBe(2);
    expect(readLocalPayload(list[0].id)).toContain('Renamed');
  });

  it('never writes the Gemini key into a save', () => {
    setSettings({ geminiKey: 'AIzaSySECRETVALUE123' });
    saveLocalProject('Secured', 0);
    expect(readLocalPayload(listLocalProjects()[0].id)).not.toContain('AIzaSySECRETVALUE123');
  });

  it('lists newest saves first', () => {
    const a = saveLocalProject('First', 0);
    const b = saveLocalProject('Second', 0);
    const ids = listLocalProjects().map((p) => p.id);
    expect(ids).toEqual([b.id, a.id]);
  });

  it('reports an out-of-storage failure as an actionable message', () => {
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    mockStorage(quota);
    expect(() => saveLocalProject('Anything', 1)).toThrow(/out of storage/i);
  });

  it('refuses a library that would exceed the browser allowance', () => {
    // one save claiming to be bigger than the whole allowance
    store.set(KEY, JSON.stringify([{ id: 'x', name: 'Huge', savedAtMs: 1, bytes: MAX_LOCAL_BYTES, tags: 1, payload: '{}' }]));
    setSettings({ projectName: 'Big' });
    expect(() => saveLocalProject('Big', 1)).toThrow(/Export a project file instead/);
  });
});

describe('loadLocalProject', () => {
  it('replaces the active project with the saved one', () => {
    saveLocalProject('Snapshot', 3);
    setSettings({ projectName: 'Edited afterwards' });
    setState({ equipment: [] });
    expect(getStore().settings.projectName).toBe('Edited afterwards');

    const entry = loadLocalProject(listLocalProjects()[0].id);
    expect(entry.name).toBe('Snapshot');
    expect(getStore().settings.projectName).toBe('Alpha Plant');
  });

  it('throws when the save is gone', () => {
    expect(() => loadLocalProject('missing')).toThrow(/no longer in this browser/);
  });
});

describe('deleteLocalProject', () => {
  it('removes the entry and its payload, keeping the others', () => {
    const keep = saveLocalProject('Keep', 1);
    const drop = saveLocalProject('Drop', 2);
    deleteLocalProject(drop.id);
    const list = listLocalProjects();
    expect(list.map((p) => p.id)).toEqual([keep.id]);
    expect(() => readLocalPayload(drop.id)).toThrow(/no longer/);
    expect(readLocalPayload(keep.id)).toContain('Alpha Plant');
  });

  it('clears the key entirely when the last save is deleted', () => {
    const only = saveLocalProject('Only', 1);
    deleteLocalProject(only.id);
    expect(store.has(KEY)).toBe(false);
    expect(listLocalProjects()).toEqual([]);
  });
});

describe('robustness', () => {
  it('returns an empty list when the stored JSON is corrupt', () => {
    store.set(KEY, 'not-json{');
    expect(listLocalProjects()).toEqual([]);
  });

  it('drops malformed entries rather than failing the whole list', () => {
    store.set(KEY, JSON.stringify([{ id: 'ok', name: 'Fine', savedAtMs: 5, bytes: 10, tags: 1 }, { nope: true }, null]));
    const list = listLocalProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Fine');
  });
});
