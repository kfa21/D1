// Market plate stock, thickness availability and nesting/wastage planning.
// Stock sizes and thickness series are procurement catalogues — confirm
// availability with the supplier for the specific grade and certification.

export interface PlateSize {
  w: number; // mm
  l: number; // mm
  note?: string;
}

export const DEFAULT_PLATE_STOCK: PlateSize[] = [
  { w: 1000, l: 2000 },
  { w: 1250, l: 2500 },
  { w: 1500, l: 6000, note: 'common mill size' },
  { w: 1800, l: 6000 },
  { w: 2000, l: 6000, note: 'common industrial size' },
  { w: 2000, l: 8000 },
  { w: 2000, l: 12000, note: 'heavy plate — confirm logistics' },
  { w: 2500, l: 12000, note: 'heavy plate — confirm mill/transport' },
  { w: 3000, l: 12000, note: 'project-specific — mill confirmation' },
  { w: 2440, l: 6096, note: '8×20 ft (imperial)' },
  { w: 2440, l: 12192, note: '8×40 ft (imperial)' },
];

/** Standard available (stock) thicknesses mm */
export const MARKET_THICKNESS_MM = [
  6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100,
];

export interface ThicknessChoice {
  requested: number;
  chosen: number;
  isStandard: boolean;
  addedMm: number; // how much thickness the next stock size adds
  nextUp: number;
}

/** Map a code-required thickness to the nearest available stock thickness (never down). */
export function stockThickness(t: number, stock: number[] = MARKET_THICKNESS_MM): ThicknessChoice {
  const sorted = [...stock].sort((a, b) => a - b);
  const chosen = sorted.find((v) => v >= t - 1e-9) ?? sorted[sorted.length - 1];
  const isStandard = sorted.some((v) => Math.abs(v - t) < 1e-9);
  return {
    requested: t,
    chosen,
    isStandard,
    addedMm: chosen - t,
    nextUp: chosen,
  };
}

export interface PlateChoice {
  plate: PlateSize;
  orientationSwapped: boolean;
}

/** Smallest stock plate (by area) that can contain a part of w×l (rotation allowed). */
export function choosePlate(w: number, l: number, stock: PlateSize[] = DEFAULT_PLATE_STOCK): PlateChoice | null {
  let best: PlateChoice | null = null;
  let bestArea = Infinity;
  for (const p of stock) {
    for (const swapped of [false, true]) {
      const pw = swapped ? p.l : p.w;
      const pl = swapped ? p.w : p.l;
      if (pw + 1e-6 >= w && pl + 1e-6 >= l) {
        const area = p.w * p.l;
        if (area < bestArea) {
          bestArea = area;
          best = { plate: p, orientationSwapped: swapped };
        }
      }
    }
  }
  return best;
}

export interface NestResult {
  platesNeeded: number;
  partsPerPlate: number;
  usedArea: number; // m²
  plateArea: number; // m²
  wastagePct: number;
}

/** Rectangular packing estimate for identical parts on identical plates. */
export function nestParts(w: number, l: number, partCount: number, plate: PlateSize): NestResult {
  const options = [
    Math.floor(plate.w / w) * Math.floor(plate.l / l),
    Math.floor(plate.l / w) * Math.floor(plate.w / l),
  ];
  const per = Math.max(1, Math.max(options[0], options[1]));
  const platesNeeded = Math.ceil(partCount / per);
  const usedArea = partCount * ((w * l) / 1e6);
  const plateArea = platesNeeded * ((plate.w * plate.l) / 1e6);
  return {
    platesNeeded,
    partsPerPlate: per,
    usedArea,
    plateArea,
    wastagePct: plateArea > 0 ? Math.max(0, ((plateArea - usedArea) / plateArea) * 100) : 0,
  };
}

export interface PlateRequest {
  material: string;
  thk: number; // required thickness (with CA, nominal required)
  w: number; // part width (mm)
  l: number; // part length (mm)
  count: number;
}

export interface PlateProcurementLine {
  id: string;
  material: string;
  thkRequested: number;
  thkStock: number;
  thkIsStandard: boolean;
  thkAdded: number;
  partW: number;
  partL: number;
  partCount: number;
  plateW: number;
  plateL: number;
  platesNeeded: number;
  partsPerPlate: number;
  wastagePct: number;
  massKg: number;
  estimatedCostUSD: number;
  oversized: boolean;
  note: string;
}

export function planPlate(
  req: PlateRequest,
  stockPlates: PlateSize[],
  pricePerKg: number,
  id: string
): PlateProcurementLine {
  const thk = stockThickness(req.thk);
  const choice = choosePlate(req.w, req.l, stockPlates);
  if (!choice) {
    const largest = [...stockPlates].sort((a, b) => b.w * b.l - a.w * a.l)[0];
    return {
      id,
      material: req.material,
      thkRequested: req.thk,
      thkStock: thk.chosen,
      thkIsStandard: thk.isStandard,
      thkAdded: thk.addedMm,
      partW: req.w,
      partL: req.l,
      partCount: req.count,
      plateW: largest?.w ?? 3000,
      plateL: largest?.l ?? 12000,
      platesNeeded: 0,
      partsPerPlate: 0,
      wastagePct: 0,
      massKg: 0,
      estimatedCostUSD: 0,
      oversized: true,
      note: 'Part exceeds largest stock plate — segments with weld seams required or special mill order',
    };
  }
  const nest = nestParts(req.w, req.l, req.count, choice.plate);
  const massKg = nest.platesNeeded * (choice.plate.w / 1000) * (choice.plate.l / 1000) * (thk.chosen / 1000) * 7850;
  return {
    id,
    material: req.material,
    thkRequested: req.thk,
    thkStock: thk.chosen,
    thkIsStandard: thk.isStandard,
    thkAdded: thk.addedMm,
    partW: req.w,
    partL: req.l,
    partCount: req.count,
    plateW: choice.plate.w,
    plateL: choice.plate.l,
    platesNeeded: nest.platesNeeded,
    partsPerPlate: nest.partsPerPlate,
    wastagePct: nest.wastagePct,
    massKg,
    estimatedCostUSD: massKg * pricePerKg,
    oversized: false,
    note: thk.isStandard
      ? choice.plate.note ?? 'stock size'
      : `specified ${req.thk.toFixed(1)} mm → next stock ${thk.chosen} mm (+${thk.addedMm.toFixed(1)} mm)`,
  };
}
