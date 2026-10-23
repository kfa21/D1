// NDT method guidance — conventional RT (Sec. V Art. 2, UW-51) vs PaUT/TOFD
// (Sec. V Art. 4/18 with acceptance per App. 26/44 or VIII-2 App. 12).
// Indicative engineering guidance; the client specification always governs.

export interface NdtSuggestion {
  preferred: 'rt' | 'putTofd';
  reason: string;
}

export function suggestNdtMethod(shellThkMm: number, orientation: 'vertical' | 'horizontal', hasClad: boolean): NdtSuggestion {
  if (shellThkMm >= 50) {
    return {
      preferred: 'putTofd',
      reason: `Shell t = ${shellThkMm.toFixed(0)} mm ≥ 50 mm — PaUT/TOFD preferred: single-pass full-volume digital record, no film/source handling, avoids multi-exposure RT geometry; acceptance via ASME VIII-2 App. 12 / Sec. V App. 26 basis`,
    };
  }
  if (shellThkMm >= 38) {
    return {
      preferred: 'putTofd',
      reason: `Shell t = ${shellThkMm.toFixed(0)} mm ≥ 38 mm — PaUT/TOFD gives full-thickness coverage in one pass; conventional RT needs multiple exposures and longer hold-up`,
    };
  }
  if (hasClad) {
    return {
      preferred: 'rt',
      reason: 'Clad/lined vessel — conventional RT unaffected by overlay metallurgy and anisotropy; PaUT needs calibration on clad-specific reference blocks if used',
    };
  }
  if (orientation === 'vertical' && shellThkMm < 25) {
    return {
      preferred: 'rt',
      reason: `Shell t = ${shellThkMm.toFixed(0)} mm — conventional RT (UW-51) is the code-simplest and lowest-cost option for thin sections; both methods acceptable if client requires digital records`,
    };
  }
  return {
    preferred: 'rt',
    reason: `Shell t = ${shellThkMm.toFixed(0)} mm < 38 mm — conventional RT (Sec. V Art. 2, UW-51 acceptance) is simplest and lowest cost; PaUT/TOFD acceptable alternative where client spec mandates digital volumetric records`,
  };
}

/** Human labels for the NDT methods used in plans. */
export const NDT_METHOD_LABELS: Record<string, string> = {
  mt: 'MT/DP (magnetic / dye penetrant)',
  ut: 'Conventional UT (pulse-echo)',
  rt: 'Conventional RT (film)',
  putTofd: 'PaUT/TOFD (phased array + TOFD)',
};

export const NDT_TIMING_LABELS: Record<string, string> = {
  during: 'Interstage — during welding',
  afterPwht: 'After PWHT',
  final: 'Final — before hydrotest',
};
