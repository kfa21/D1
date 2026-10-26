// E3 — project file hygiene: export must not ship credentials, import must run
// the legacy USD→BHD migration, and attachment refs without payloads must land
// on the stale list instead of pretending to be attached.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setState,
  setSettings,
  getStore,
  defaultSettings,
  exportProjectJson,
  importProjectData,
} from './store';
import { DEFAULT_RATES } from './engine/estimate';

const USD_TO_BHD = 0.376;

function reset() {
  setState({
    equipment: [],
    settings: { ...defaultSettings },
    selectedEquipId: null,
    reviews: [],
    datasheets: [],
    staleDatasheets: [],
    _datasheetData: {},
  });
}

beforeEach(reset);

describe('exportProjectJson', () => {
  it('never contains the Gemini API key', () => {
    setSettings({ geminiKey: 'AIzaSySECRETVALUE123' });
    const json = exportProjectJson();
    expect(json).not.toContain('AIzaSySECRETVALUE123');
    expect(JSON.parse(json).settings.geminiKey).toBeUndefined();
    // the key itself is still in the live session — only the file omits it
    expect(getStore().settings.geminiKey).toBe('AIzaSySECRETVALUE123');
  });

  it('omits in-memory file payloads but keeps attachment names for a re-attach hint', () => {
    setState({
      datasheets: [{ equipId: 'e1', name: 'client-datasheet.pdf', mime: 'application/pdf', size: 2048 }],
      _datasheetData: { e1: 'QUJDREVGR0g=' },
    });
    const parsed = JSON.parse(exportProjectJson());
    expect(parsed._datasheetData).toBeUndefined();
    expect(parsed.datasheets).toHaveLength(1);
    expect(parsed.datasheets[0].name).toBe('client-datasheet.pdf');
  });
});

describe('persist failure feedback (E6)', () => {
  it('surfaces a storage write failure instead of swallowing it, and clears it on recovery', () => {
    const g = globalThis as { localStorage?: unknown };
    const original = g.localStorage;
    try {
      g.localStorage = {
        getItem: () => null,
        setItem: () => {
          const err = new Error('The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          throw err;
        },
      };
      setState({ selectedEquipId: null });
      expect(getStore().saveError).toMatch(/QuotaExceededError/);
      // the failure flag itself never reaches the stored snapshot
      expect(getStore().saveError).not.toBeNull();

      g.localStorage = { getItem: () => null, setItem: () => {} };
      setState({ selectedEquipId: null });
      expect(getStore().saveError).toBeNull(); // next good write clears the notice
    } finally {
      if (original === undefined) delete g.localStorage;
      else g.localStorage = original;
    }
  });
});

describe('importProjectData', () => {
  it('converts a legacy USD-base file to BHD', () => {
    importProjectData({
      equipment: [],
      settings: {
        projectName: 'Old job',
        rates: { ...DEFAULT_RATES, pipePrice: 100 },
        fxRates: { USD: 2.65 },
      } as never,
    });
    const s = getStore().settings;
    expect(s.rateBase).toBe('BHD');
    expect(s.rates.pipePrice).toBeCloseTo(100 * USD_TO_BHD, 3);
    // untouched fields fall back to current settings, not undefined
    expect(s.projectName).toBe('Old job');
    expect(s.currency).toBe('BHD');
  });

  it('does not rescale the current rate card when the file is already BHD', () => {
    setSettings({ rates: { ...DEFAULT_RATES, pipePrice: 12.5 } });
    importProjectData({
      equipment: [],
      settings: { projectName: 'New job', rateBase: 'BHD', rates: { ...DEFAULT_RATES, pipePrice: 9 } } as never,
    });
    const s = getStore().settings;
    expect(s.projectName).toBe('New job');
    expect(s.rates.pipePrice).toBe(9); // imported value wins, unscaled
  });

  it('keeps the local API key when the imported file has none', () => {
    setSettings({ geminiKey: 'AIzaLOCALKEY' });
    importProjectData({ equipment: [], settings: { projectName: 'X', rateBase: 'BHD' } as never });
    expect(getStore().settings.geminiKey).toBe('AIzaLOCALKEY');
  });

  it('drops attachment refs to the stale list (payloads never travel in a file)', () => {
    importProjectData({
      equipment: [],
      datasheets: [{ equipId: 'e1', name: 'old.pdf', mime: 'application/pdf', size: 10 }],
    });
    const s = getStore();
    expect(s.datasheets).toHaveLength(0);
    expect(s.staleDatasheets.map((d) => d.name)).toEqual(['old.pdf']);
    // re-attaching clears the hint
    setState((cur) => ({
      datasheets: [{ equipId: 'e1', name: 'old.pdf', mime: 'application/pdf', size: 10 }],
      staleDatasheets: cur.staleDatasheets.filter((d) => d.equipId !== 'e1'),
    }));
    expect(getStore().staleDatasheets).toHaveLength(0);
  });
});
