// Global app state — tiny external store with localStorage persistence.

import { useSyncExternalStore } from 'react';
import type { Equipment } from './engine/types';
import { DEFAULT_RATES, RateCard } from './engine/estimate';
import { CurrencyCode, CURRENCIES, RateTable } from './engine/currency';
import { DEFAULT_PLATE_STOCK, PlateSize } from './engine/plates';

export interface Settings {
  /** display currency (converts from base) */
  currency: CurrencyCode;
  /** base currency in which ALL pricing is stored (rate card, material prices, estimates) */
  rateBase: CurrencyCode;
  fxRates: RateTable;
  units: 'metric' | 'imperial';
  plateStock: PlateSize[];
  rates: RateCard;
  geminiKey: string;
  geminiModel: string;
  projectName: string;
  clientName: string;
  /** manual hours per man-hour basis key (Settings → man-hours table); absent = engine auto */
  manhourOverrides: Record<string, number>;
}

export interface ReviewNote {
  equipId: string;
  at: string;
  model: string;
  findings: string;
  raw?: string;
}

export interface DatasheetRef {
  equipId: string;
  name: string;
  mime: string;
  size: number;
}

export interface AppState {
  equipment: Equipment[];
  settings: Settings;
  selectedEquipId: string | null;
  reviews: ReviewNote[];
  datasheets: DatasheetRef[];
  /**
   * Attachment names whose file content is gone (payloads are memory-only, so
   * every ref that outlives a reload/import is stale). Shown as a re-attach hint.
   */
  staleDatasheets: DatasheetRef[];
  /** base64 payloads kept in memory only (too large for localStorage) */
  _datasheetData: Record<string, string>;
}

const KEY = 'static-equip-suite-v1';

/** USD→BHD legacy conversion factor for pre-BHD saved settings. */
const LEGACY_USD_TO_BHD = 0.376;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const PCT_KEYS = new Set(['overheadPct', 'profitPct', 'contingencyPct']);

/**
 * Migrate a settings object saved when USD was the base: scale every money
 * field (rate card scalars, labor rates, material price overrides, FX rates)
 * from USD to BHD. Percentage fields are untouched. New fields added since
 * the migration keep their BHD defaults via spread.
 */
function migrateToBhdBase(set: Partial<Settings>): Partial<Settings> {
  if (set.rateBase === 'BHD') {
    // even when already migrated, make sure newly added rate fields exist
    return { ...set, rates: { ...DEFAULT_RATES, ...(set.rates ?? {}) } };
  }
  const old = set.rates ?? ({} as Partial<typeof DEFAULT_RATES>);
  const rates: typeof DEFAULT_RATES = { ...DEFAULT_RATES, ...(old as object) } as typeof DEFAULT_RATES;
  for (const k of Object.keys(old) as (keyof typeof DEFAULT_RATES)[]) {
    if (k === 'labor' || k === 'prices') continue;
    const v = old[k];
    if (typeof v === 'number' && !PCT_KEYS.has(k)) (rates as unknown as Record<string, number>)[k] = round3(v * LEGACY_USD_TO_BHD);
  }
  const laborOld = (old as { labor?: Record<string, number> }).labor;
  if (laborOld) {
    const labor: Record<string, number> = {};
    for (const [k, v] of Object.entries(laborOld)) labor[k] = round3(v * LEGACY_USD_TO_BHD);
    rates.labor = { ...rates.labor, ...labor } as typeof rates.labor;
  }
  const pricesOld = (old as { prices?: Record<string, number> }).prices;
  if (pricesOld) {
    const prices: Record<string, number> = {};
    for (const [k, v] of Object.entries(pricesOld)) prices[k] = round3(v * LEGACY_USD_TO_BHD);
    rates.prices = prices;
  }
  let fx = set.fxRates ?? {};
  if (Object.keys(fx).length) {
    const next: RateTable = {};
    for (const [code, r] of Object.entries(fx)) {
      if (code === 'BHD') continue; // old BHD-per-USD entry is meaningless now
      if (typeof r === 'number') next[code as CurrencyCode] = round3(r / LEGACY_USD_TO_BHD);
    }
    fx = next;
  }
  return { ...set, rateBase: 'BHD', rates, fxRates: fx };
}

export const defaultSettings: Settings = {
  currency: 'BHD',
  rateBase: 'BHD',
  fxRates: {},
  units: 'metric',
  plateStock: DEFAULT_PLATE_STOCK,
  rates: DEFAULT_RATES,
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  projectName: 'New Project',
  clientName: '',
  manhourOverrides: {},
};

let state: AppState = {
  equipment: [],
  settings: defaultSettings,
  selectedEquipId: null,
  reviews: [],
  datasheets: [],
  staleDatasheets: [],
  _datasheetData: {},
};

/** merge stale attachment lists, newest first, without duplicates */
function mergeStale(...lists: DatasheetRef[][]): DatasheetRef[] {
  const out: DatasheetRef[] = [];
  for (const list of lists) {
    for (const d of list) {
      if (!out.some((x) => x.equipId === d.equipId && x.name === d.name)) out.push(d);
    }
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...state,
        ...parsed,
        settings: migrateToBhdBase({ ...defaultSettings, ...(parsed.settings ?? {}) }) as Settings,
        // file payloads live only in memory: every saved ref is stale after a reload
        datasheets: [],
        staleDatasheets: mergeStale(parsed.staleDatasheets ?? [], parsed.datasheets ?? []),
        _datasheetData: {},
      };
    }
  } catch {
    /* corrupted storage — start fresh */
  }
}
load();

const listeners = new Set<() => void>();

function persist() {
  try {
    const { _datasheetData, ...rest } = state;
    void _datasheetData;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* quota — ignore */
  }
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  persist();
  listeners.forEach((l) => l());
}

export function setSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

/**
 * Project file for download — excludes the Gemini API key (never ship a
 * credential in a file that may be shared) and the in-memory file payloads
 * (attachment names are kept so an import can prompt for a re-attach).
 */
export function exportProjectJson(): string {
  const { _datasheetData, ...rest } = state;
  void _datasheetData;
  const { geminiKey, ...settings } = rest.settings;
  void geminiKey;
  return JSON.stringify({ ...rest, settings }, null, 2);
}

/** Restore a project file: legacy USD exports are migrated to the BHD base
 *  (the old importer skipped this) and attachment payloads are dropped to the
 *  stale list because they are never saved in the file. */
/**
 * Settings from an imported file, with legacy USD-base files converted to BHD
 * (the old importer skipped migrateToBhdBase entirely). Migration runs on the
 * incoming values alone so the current project's BHD rates are never scaled;
 * the imported file then wins for every field it actually contains.
 */
function migrateImportedSettings(incoming: Partial<Settings>): Partial<Settings> {
  const hasRates = incoming.rates != null;
  const hasFx = incoming.fxRates != null;
  // a file from before the BHD base has no rateBase at all → it is a USD file
  const usdBase = 'rateBase' in incoming ? incoming.rateBase !== 'BHD' : Object.keys(incoming).length > 0;
  if (!usdBase) {
    const out: Partial<Settings> = { ...incoming };
    if (hasRates) out.rates = { ...DEFAULT_RATES, ...incoming.rates };
    return out;
  }
  const m = migrateToBhdBase({
    ...incoming,
    rateBase: 'USD',
    rates: incoming.rates ?? ({} as RateCard),
    fxRates: incoming.fxRates ?? {},
  });
  const out: Partial<Settings> = { ...incoming, rateBase: 'BHD' };
  if (hasRates) out.rates = m.rates;
  if (hasFx) out.fxRates = m.fxRates;
  return out;
}

export function importProjectData(parsed: Partial<AppState>) {
  setState({
    equipment: parsed.equipment ?? [],
    settings: { ...state.settings, ...migrateImportedSettings(parsed.settings ?? {}) } as Settings,
    reviews: parsed.reviews ?? [],
    datasheets: [],
    staleDatasheets: mergeStale(state.staleDatasheets, parsed.datasheets ?? []),
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state)
  );
}

export function getStore() {
  return state;
}

/** Format a base-currency (BHD) amount for display in the selected currency. */
export function money(base: number, s: Settings = state.settings) {
  const cur = CURRENCIES[s.currency];
  const rate = s.fxRates[s.currency] ?? cur.rate; // display units per 1 BHD
  const v = base * rate;
  return `${cur.symbol} ${v.toLocaleString('en-US', { maximumFractionDigits: cur.decimals, minimumFractionDigits: 0 })}`;
}
