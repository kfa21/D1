// ITP stage schedule — each inspection stage carries checked production-phase
// timing and an indicative duration derived from weld length, NDT extent and
// PWHT requirement. Durations are planning estimates for man-hour budgeting;
// override per tag where the shop's own norms govern.

import type { Equipment, EquipmentCalc, ItpStagePhase, ItpStageTiming } from './types';

export const ITP_PHASE_LABELS: Record<ItpStagePhase, string> = {
  receiving: 'Receiving',
  fabrication: 'Fabrication',
  interstage: 'Interstage (welding)',
  afterPwht: 'After PWHT',
  hydro: 'Hydrotest',
  final: 'Final',
};

interface StageModel {
  code: string;
  name: string;
  phases: ItpStagePhase[];
  /** indicative hours for this tag */
  hours: (e: Equipment, calc: EquipmentCalc) => number;
}

/** NDT productivity — hours per metre of weld at 100% extent (indicative). */
const NDT_H_PER_M: Record<string, number> = { mt: 0.05, ut: 0.08, rt: 0.15, putTofd: 0.1 };
const EXTENT_FACTOR = { full: 1, spot: 0.3, sample: 0.15 } as const;

const STAGE_MODELS: StageModel[] = [
  { code: 'MAT-RECV', name: 'Material receiving — MTR verification, PMI, marking', phases: ['receiving'], hours: () => 4 },
  { code: 'TRACE', name: 'Plate identification & traceability', phases: ['receiving', 'fabrication'], hours: () => 2 },
  { code: 'FORM', name: 'Forming & shape check (heads, shells)', phases: ['fabrication'], hours: (e) => 2 + e.sections.filter((s) => s.headTop !== 'none' || s.headBottom !== 'none').length },
  { code: 'FITUP', name: 'Fit-up & tack inspection before welding', phases: ['interstage'], hours: (_e, calc) => calc.weldLengthM * 0.1 },
  { code: 'WPS', name: 'Welding procedure / welder qualification', phases: ['fabrication'], hours: () => 2 },
  { code: 'NDT-MT', name: 'MT/DP surface inspection', phases: ['interstage', 'final'], hours: (e, calc) => ndtHours(e, calc, 'mt') },
  { code: 'NDT-UT', name: 'Conventional UT', phases: ['interstage', 'afterPwht'], hours: (e, calc) => ndtHours(e, calc, 'ut') },
  { code: 'NDT-RT', name: 'Conventional RT (film)', phases: ['afterPwht', 'final'], hours: (e, calc) => ndtHours(e, calc, 'rt') },
  { code: 'NDT-PUT', name: 'PaUT/TOFD', phases: ['interstage', 'afterPwht'], hours: (e, calc) => ndtHours(e, calc, 'putTofd') },
  { code: 'RT-CAT', name: 'Radiography category review (E basis)', phases: ['interstage'], hours: () => 1 },
  { code: 'PWHT', name: 'PWHT chart & calibration review', phases: ['afterPwht'], hours: (e, calc) => (calc.pwht.required ? 2.5 : 0.5) },
  { code: 'FINAL-NDE', name: 'Final dimensional & NDE report review', phases: ['final'], hours: () => 2 },
  { code: 'HYDRO', name: 'Hydrostatic test (1.3×MAWP)', phases: ['hydro'], hours: () => 4 },
  { code: 'NAMEPLATE', name: 'Nameplate / U-1 form verification', phases: ['final'], hours: () => 1 },
];

function ndtHours(e: Equipment, calc: EquipmentCalc, method: string): number {
  const item = e.ndtPlan?.find((p) => p.method === method);
  if (!item || !item.enabled) return 0;
  const rate = NDT_H_PER_M[method] ?? 0.1;
  return calc.weldLengthM * rate * EXTENT_FACTOR[item.extent];
}

/** Default stage schedule for a tag (engine estimates). */
export function defaultItpStages(e: Equipment, calc: EquipmentCalc): ItpStageTiming[] {
  return STAGE_MODELS.map((m) => ({
    code: m.code,
    phases: [...m.phases],
    durationH: Math.round(m.hours(e, calc) * 10) / 10,
    durationOverrideH: null,
  }));
}

/** Merge saved per-tag overrides into the current engine defaults (new stages appear, removed ones drop). */
export function mergeItpStages(defaults: ItpStageTiming[], saved: ItpStageTiming[] | undefined): ItpStageTiming[] {
  if (!saved || saved.length === 0) return defaults;
  const byCode = new Map(saved.map((s) => [s.code, s]));
  return defaults.map((d) => {
    const s = byCode.get(d.code);
    return s ? { ...d, phases: s.phases, durationOverrideH: s.durationOverrideH } : d;
  });
}

/** Quick-pick hours offered in the stage timing selector (shown when a phase box is ticked). */
export const ITP_HOUR_PRESETS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 40];

/**
 * Effective duration: an unchecked stage (no production-phase boxes ticked) is not performed
 * and contributes 0 h; otherwise the manual override wins over the engine estimate.
 */
export function effectiveDurationH(s: ItpStageTiming): number {
  if (!s.phases || s.phases.length === 0) return 0;
  return s.durationOverrideH !== null && s.durationOverrideH >= 0 ? s.durationOverrideH : s.durationH;
}

/** Total effective inspection hours for a tag. */
export function itpTotalHours(stages: ItpStageTiming[]): number {
  return stages.reduce((sum, s) => sum + effectiveDurationH(s), 0);
}

/** Stage name by code (for tables/exports). */
export function itpStageName(code: string): string {
  return STAGE_MODELS.find((m) => m.code === code)?.name ?? code;
}
