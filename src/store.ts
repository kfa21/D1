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
};

let state: AppState = {
  equipment: [],
  settings: defaultSettings,
  selectedEquipId: null,
  reviews: [],
  datasheets: [],
  _datasheetData: {},
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...state,
        ...parsed,
        settings: migrateToBhdBase({ ...defaultSettings, ...(parsed.settings ?? {}) }) as Settings,
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
