// Currency support — base currency is BHD (Bahraini Dinar); rates are editable in Settings.
// rate = units of currency per 1 BHD. BHD itself is always 1.

export type CurrencyCode =
  | 'USD' | 'BHD' | 'EUR' | 'INR' | 'GBP' | 'JPY' | 'AED' | 'SAR' | 'KWD' | 'QAR' | 'OMR' | 'CNY' | 'AUD' | 'CAD' | 'CHF' | 'SGD';

/** Base currency of all stored pricing (rate card, material prices, estimates). */
export const BASE_CURRENCY: CurrencyCode = 'BHD';

export const CURRENCIES: Record<CurrencyCode, { name: string; symbol: string; rate: number; decimals: number }> = {
  BHD: { name: 'Bahraini Dinar', symbol: 'BD', rate: 1, decimals: 3 },
  USD: { name: 'US Dollar', symbol: '$', rate: 2.65, decimals: 2 },
  EUR: { name: 'Euro', symbol: '€', rate: 2.45, decimals: 2 },
  INR: { name: 'Indian Rupee', symbol: '₹', rate: 223.5, decimals: 0 },
  GBP: { name: 'British Pound', symbol: '£', rate: 2.07, decimals: 2 },
  JPY: { name: 'Japanese Yen', symbol: '¥', rate: 404, decimals: 0 },
  AED: { name: 'UAE Dirham', symbol: 'د.إ', rate: 9.76, decimals: 2 },
  SAR: { name: 'Saudi Riyal', symbol: '﷼', rate: 9.97, decimals: 2 },
  KWD: { name: 'Kuwaiti Dinar', symbol: 'KD', rate: 0.817, decimals: 3 },
  QAR: { name: 'Qatari Riyal', symbol: 'QR', rate: 9.68, decimals: 2 },
  OMR: { name: 'Omani Rial', symbol: 'OMR', rate: 1.023, decimals: 3 },
  CNY: { name: 'Chinese Yuan', symbol: '¥', rate: 19.15, decimals: 2 },
  AUD: { name: 'Australian Dollar', symbol: 'A$', rate: 4.04, decimals: 2 },
  CAD: { name: 'Canadian Dollar', symbol: 'C$', rate: 3.64, decimals: 2 },
  CHF: { name: 'Swiss Franc', symbol: 'CHF', rate: 2.34, decimals: 2 },
  SGD: { name: 'Singapore Dollar', symbol: 'S$', rate: 3.56, decimals: 2 },
};

export type RateTable = Partial<Record<CurrencyCode, number>>;

/** Convert an amount from the base currency (BHD) into `code`. */
export function convertFromBase(amountBase: number, code: CurrencyCode, rates?: RateTable): number {
  const rate = rates?.[code] ?? CURRENCIES[code].rate;
  return amountBase * rate;
}

/** @deprecated use convertFromBase — base currency is now BHD. */
export const convertFromUSD = convertFromBase;

/** Format a base-currency (BHD) amount for display in `code`. */
export function formatMoney(amountBase: number, code: CurrencyCode, rates?: RateTable): string {
  const cur = CURRENCIES[code];
  const v = convertFromBase(amountBase, code, rates);
  return `${cur.symbol} ${v.toLocaleString('en-US', { maximumFractionDigits: cur.decimals, minimumFractionDigits: 0 })}`;
}
