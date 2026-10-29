// Warning/error code catalog — every code emitted by the engine suite.
// A warning must match this registry: unknown codes fail tests, so a typo
// in a code string cannot slip through silently.
//
// Levels below mirror the emitting engine exactly (asme.ts, api650.ts,
// api661.ts, tema.ts, compute.ts). Keep this in sync when adding codes.

export type WarningLevel = 'info' | 'warning' | 'error';

export interface WarningSpec {
  level: WarningLevel;
  note: string;
}

/** All legal codes and their emitted severity. */
export const WARNING_CATALOG: Record<string, WarningSpec> = {
  // ASME VIII-1 vessel engine (asme.ts)
  'HD-01': { level: 'error', note: 'Selected head thickness below required (incl. CA)' },
  'HD-02': { level: 'error', note: 'Torispherical F&D knuckle radius < 6% ID (UG-32(d))' },
  'HD-03': { level: 'error', note: 'Torispherical D knuckle radius < 6% ID (UG-32(d))' },
  'SH-01': { level: 'error', note: 'Shell thickness below required (UG-27, incl. CA)' },
  'SH-02': { level: 'error', note: 'Non-positive corroded shell thickness' },
  'CN-01': { level: 'error', note: 'Cone thickness below required (UG-32(g))' },
  'NZ-04': { level: 'warning', note: 'Nozzle attached to a dished end that is flat, or outside the head depth' },
  'AC-01': { level: 'warning', note: 'Ladder passes through a platform deck — needs one run per level and a rail opening' },
  'AC-02': { level: 'warning', note: 'Unbroken ladder climb exceeds the rest-platform limit (OSHA 1910.23)' },
  'AC-03': { level: 'warning', note: 'Platform deck beam or deflection inadequate under the design live load' },
  'AC-04': { level: 'warning', note: 'Ladder clear width or rung pitch outside the usual range' },
  'AC-05': { level: 'warning', note: 'Cage / fall-arrest measure missing above the cage threshold' },
  'AC-06': { level: 'warning', note: 'Walkway narrower than the minimum clear width' },
  'AC-07': { level: 'warning', note: 'Two access decks occupy the same plan position at the same level' },
  'AC-08': { level: 'warning', note: 'Stair pitch or step rise outside the buildable range' },
  'CN-02': { level: 'warning', note: 'Cone included angle > 30° — knuckle/multi-cone advised' },
  'NZ-01': { level: 'error', note: 'Nozzle neck wall below UG-45/pressure requirement' },
  'NZ-02': { level: 'error', note: 'Nozzle reinforcement shortfall (UG-37)' },
  'NZ-03': { level: 'warning', note: 'Nozzle elevation outside the shell — checked against the nearest course' },
  'FL-01': { level: 'error', note: 'B16.5 flange rating below design pressure at temperature' },
  'FL-02': { level: 'info', note: 'Flange class over-sized (>50% margin) — consider lower class' },
  'FL-03': { level: 'info', note: 'Flange class > 600 rated conservatively from the Class 600 table — verify per B16.5' },
  'MT-01': { level: 'error', note: 'Design temperature above material recommended maximum' },
  'MT-02': { level: 'warning', note: 'MDMT below typical limit — impact testing per UG-84' },
  'EX-01': { level: 'error', note: 'External pressure exceeds UG-28 allowable' },
  'CL-01': { level: 'warning', note: 'PWHT/overlay sequencing or L-grade overlay (UW-40/RP0472)' },
  'CL-02': { level: 'error', note: 'Partial cladding selected with zero coverage length' },
  'CL-03': { level: 'info', note: 'Mechanical liner non-pressure-retaining' },
  'CL-04': { level: 'warning', note: 'Clad finished thickness below typical 2 mm barrier minimum' },
  'CL-05': { level: 'warning', note: 'Weld-overlay build-up indicated for furnace heat treatment — not selected' },
  'MW-01': { level: 'error', note: 'MAWP below design pressure — increase thickness' },
  'PW-01': { level: 'warning', note: 'PWHT required by UCS-56 but overridden off' },
  'GE-01': { level: 'warning', note: 'Vertical L/D > 15 — review wind/seismic analysis' },
  'GE-02': { level: 'warning', note: 'D/t > 200 — buckling & handling checks advised' },
  'AB-01': { level: 'warning', note: 'Anchor bolt area short for governing overturning moment' },
  'AB-02': { level: 'info', note: 'Anchor bolt spacing/count outside good-practice seating guidance' },
  'SD-01': { level: 'warning', note: 'Saddle horn compression over Zick allowable — add pad / increase angle' },
  'SD-02': { level: 'info', note: 'Saddle spacing exceeds 20R guidance' },
  'SD-03': { level: 'info', note: 'Saddle contact angle < 120° — below usual Zick/code minimum' },
  'SD-04': { level: 'warning', note: 'Saddle tangential shear over 0.8·S (Zick)' },
  'SD-05': { level: 'warning', note: 'Longitudinal stress over allowable at saddle (Zick)' },
  'SD-06': { level: 'info', note: 'High saddle horn utilisation — wear plate / stiffener ring advised' },
  'MD-01': { level: 'error', note: 'Cone transition missing between differing diameters' },
  'DBA-01': { level: 'error', note: 'VIII-2 Part 5 primary stress above the S allowable' },
  'DBA-02': { level: 'info', note: 'VIII-2 design-by-analysis screen basis and what is not evaluated' },
  'DBA-03': { level: 'info', note: 'Part 5 fatigue screening not performed (licensed criteria)' },
  'RG-01': { level: 'warning', note: 'Stiffening-ring inertia below the 49 CFR 179.400-9 requirement' },
  'RG-02': { level: 'info', note: 'Stiffening-ring required inertia reported (49 CFR 179.400-9)' },
  'RG-03': { level: 'info', note: 'External-pressure failure with no stiffening ring drawn' },
  // API 650 tanks (api650.ts)
  'T650-01': { level: 'info', note: 'D > 61 m — variable design point method applied (§5.6.4)' },
  'T650-02': { level: 'info', note: 'Wind girder recommended' },
  'T650-03': { level: 'info', note: 'Anchor bolt chairs advised (API 650 §5.11)' },
  'T650-04': { level: 'info', note: 'External floating roof — seals, stability & roof-drain advisory (API 650 §5.8.3)' },
  'T650-05': { level: 'info', note: 'Upper wind girder mandatory for external floating roof (API 650 §5.8.7)' },
  'T650-06': { level: 'info', note: 'Internal floating roof — vapor-space venting & guider advisory (API 650 §5.8.2)' },
  'T650-07': { level: 'warning', note: 'Design liquid level exceeds the shell height — courses sized on the liquid height' },
  'T650-08': { level: 'warning', note: 'Annular bottom plate below Table 5-1a requirement' },
  'T650-09': { level: 'info', note: 'Annular plate width ≥ 600 mm from shell advisory (§5.5.3)' },
  'T650-10': { level: 'warning', note: 'Bottom plate below the 6 mm corroded minimum (§5.5.1)' },
  'T650-11': { level: 'warning', note: 'VDP design-point iteration did not converge in 5 passes' },
  'T650-12': { level: 'warning', note: 'Annular ring width below the 600 mm §5.5.3 minimum' },
  'T650-13': { level: 'info', note: 'Stiffening rings / wind girders declared on the tag — treated as provided (§5.8.7)' },
  'T650-14': { level: 'warning', note: 'L/H above the §5.6.4 VDP applicability limit (1000/6) — elastic analysis governs' },
  'T650-15': { level: 'warning', note: 'Shell course grade not in the API 650 Table 5.2 stress table — sized with the tag material' },
  // Nozzle local loads — WRC 107 screening (wrc107.ts)
  'NL-01': { level: 'info', note: 'Nozzle local-load screening basis + utilisation (WRC 107 structure)' },
  'NL-02': { level: 'warning', note: 'Nozzle local-load screening utilisation over 1.5·S' },
  'NL-03': { level: 'info', note: 'Nozzle attachment ratio β beyond common WRC 107 chart range' },
  // API 661 fin-fans (api661.ts)
  'AF-01': { level: 'warning', note: 'Face velocity above 6 m/s — noise/erosion' },
  'AF-02': { level: 'info', note: 'Rows per bank outside common 6–9 practice' },
  'AF-03': { level: 'error', note: 'Thermal shortfall — available kW below duty' },
  'AF-04': { level: 'info', note: 'Confirm air ΔP with fan curve and vendor rating' },
  'AF-05': { level: 'warning', note: 'Fan covers < 40% of the bay face area (API 661 guidance)' },
  'AF-06': { level: 'warning', note: 'Fan motor rating below the required fan power' },
  // TEMA exchangers (tema.ts)
  'HX-01': { level: 'warning', note: 'Bundle-to-shell clearance below 10 mm' },
  'HX-02': { level: 'error', note: 'Thermal area shortfall (TEMA/required area not met)' },
  'HX-03': { level: 'warning', note: 'LMTD correction factor F < 0.75' },
  'HX-04': { level: 'info', note: 'Fixed tubesheet expansion joint / floating head advised' },
  'HX-05': { level: 'info', note: 'Pressure drops are guidance only — recheck with flow data' },
  'HX-08': { level: 'warning', note: 'Tubesheet cladding ≥ 50% of tubesheet thickness' },
  'HX-09': { level: 'info', note: 'Welded tube-to-tubesheet joints require PT/MT' },
  'HX-10': { level: 'warning', note: 'HX material is not a tube grade (form ≠ pipe) — re-select tube material' },
  'HX-11': { level: 'error', note: 'Temperature cross — LMTD correction factor F undefined for the arrangement' },
  'HX-12': { level: 'warning', note: 'Design U above the computed shell-side film coefficient (ESDU/Bell)' },
  'HX-13': { level: 'info', note: 'Shell-side flow data absent/incomplete — Bell–Delaware rating skipped' },
  'HX-14': { level: 'warning', note: 'Fluid-elastic instability ratio V/Vcr above 0.8 (HTRI guidance)' },
  'HX-15': { level: 'warning', note: 'Vortex shedding frequency within 10% of the tube natural frequency' },
  'HX-16': { level: 'warning', note: 'Shell acoustic mode within 20% of the vortex shedding frequency' },
  'HX-17': { level: 'info', note: 'Pitch/OD ratio outside the ESDU 73031 validity band' },
  'HX-18': { level: 'info', note: 'Bundle bypass fraction above 0.15 — seal strips advised' },
  // Dispatcher (compute.ts)
  'SYS': { level: 'error', note: 'Calculation exception captured by dispatcher' },
};

export interface CatalogCheck {
  ok: boolean;
  problems: string[];
}

/** Validate a warning list against the catalog. */
export function checkWarningCodes(warnings: { code: string; level: string; msg: string }[]): CatalogCheck {
  const problems: string[] = [];
  for (const w of warnings) {
    const spec = WARNING_CATALOG[w.code];
    if (!spec) {
      problems.push(`unknown code '${w.code}' — add it to WARNING_CATALOG`);
      continue;
    }
    if (spec.level !== w.level) {
      problems.push(`code '${w.code}' emitted as '${w.level}', catalog expects '${spec.level}'`);
    }
    if (!w.msg || !w.msg.trim()) problems.push(`code '${w.code}' has empty message`);
  }
  return { ok: problems.length === 0, problems };
}
