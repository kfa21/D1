// Click-to-fix registry: for every warning code the engine can emit, which
// editor tab hosts the field to correct, that field's id suffix and a concrete
// correction hint shown below the field (or inline in the warning list when the
// code has no single editable field).

export type FixTab = 'general' | 'sections' | 'nozzles' | 'internals' | 'type';

export interface FieldFix {
  /** editor tab that hosts the field; '' when the code has no field to jump to */
  tab: FixTab | '';
  /**
   * Input id suffix — the DOM id is `f-<equipId>-<field>`. Sections/nozzles use
   * `sec0-…`/`nz0-…` for the first row. Empty string = no direct input; the
   * suggestion then stays inline in the warning list.
   */
  field: string;
  /** concrete correction advice */
  suggest: string;
}

export const WARNING_FIX: Record<string, FieldFix> = {
  // ---- ASME VIII-1 vessel engine ----
  'HD-01': { tab: 'sections', field: 'sec0-headTop', suggest: 'The dish-end thickness follows the head form, diameter and design pressure. Pick a stronger head form (e.g. 2:1 ellipsoidal instead of flat/torispherical), lower the design pressure or reduce the design temperature margin, then re-check t req in the Sections table.' },
  'HD-02': { tab: 'sections', field: 'sec0-headTop', suggest: 'A torispherical F&D knuckle must be ≥ 6% of the inside diameter (UG-32(d)). Standard F&D proportions already satisfy this — if this fires, the head proportions were customised; reselect a standard Torispherical F&D head or switch to a 2:1 ellipsoidal head.' },
  'HD-03': { tab: 'sections', field: 'sec0-headTop', suggest: 'Torispherical D knuckle radius must be ≥ 6% of the inside diameter (UG-32(d)). Reselect a standard head type (D or 2:1 ellipsoidal) in the Sections table.' },
  'SH-01': { tab: 'sections', field: 'sec0-shellThk', suggest: 'Increase the Spec t shell in the Sections table (0 = auto). Required t already includes corrosion allowance, joint efficiency from the RT category and the UG-27 pressure term — the entered nominal must exceed it.' },
  'SH-02': { tab: 'general', field: 'corrosionAllowance', suggest: 'Nominal − corrosion allowance ≤ 0: either reduce the corrosion allowance (General tab) or enter a larger Spec t shell so the corroded wall stays positive.' },
  'CN-01': { tab: 'sections', field: 'sec0-coneThk', suggest: 'Increase the Spec t cone for that section (UG-32(g) cone thickness, incl. the transition moment term) or reduce the cone included angle.' },
  'CN-02': { tab: 'sections', field: 'sec0-coneAngleDeg', suggest: 'Included cone angle > 30°: reduce the angle, or introduce a knuckle/multi-cone transition between the two diameters.' },
  'MD-01': { tab: 'sections', field: 'sec0-dia', suggest: 'Two sections with different diameters need a cone between them: add a section (Sections → ＋) whose cone angle spans the transition, or make the diameters equal.' },
  'NZ-01': { tab: 'nozzles', field: 'nz0-dn', suggest: 'Nozzle neck wall below UG-45/pressure: select a heavier pipe schedule, a smaller bore, or add a reinforcing pad (Pad Ø / Pad t) on the Nozzles tab.' },
  'NZ-02': { tab: 'nozzles', field: 'nz0-padThk', suggest: 'Reinforcement shortfall (UG-37): increase Pad t / Pad Ø, reduce the bore, or use a heavier neck schedule until A prov ≥ A req (right-hand columns show both).' },
  'FL-01': { tab: 'nozzles', field: 'nz0-flangeClass', suggest: 'Flange rating below design pressure at temperature: raise the flange class on the Nozzles tab (Cl 150 → 300 → …) or lower the design pressure.' },
  'FL-02': { tab: 'nozzles', field: 'nz0-flangeClass', suggest: 'The selected class is more than 50% above the required rating — consider one class lower to save cost (advisory only).'},
  'FL-03': { tab: 'nozzles', field: 'nz0-flangeClass', suggest: 'Class > 600 is rated conservatively from the Class 600 table — verify the actual rating against the B16.5 table for this class and material group.' },
  'MT-01': { tab: 'general', field: 'materialKey', suggest: 'Design temperature above the material’s recommended maximum: select a material whose allowable-stress table covers this temperature (Materials & PWHT tab lists the ranges), or lower the design temperature.' },
  'MT-02': { tab: 'general', field: 'mdmt', suggest: 'MDMT is below the typical toughness threshold: set the MDMT to the real minimum metal temperature and confirm impact-testing requirements per UG-84 (or raise the MDMT if it was entered too low).' },
  'EX-01': { tab: 'general', field: 'externalPressure', suggest: 'External/vacuum pressure exceeds the UG-28 allowable for this shell: reduce the specified vacuum, increase the shell thickness, or add a stiffening ring (RG codes report the ring inertia required).' },
  'CL-01': { tab: 'general', field: 'cladMode', suggest: 'PWHT/overlay sequencing or an L-grade overlay needs review (UW-40 / RP0472): check the clad kind versus the PWHT setting on the General tab — weld-overlay on L-grade base, or PWHT after final overlay, is the usual correction.' },
  'CL-02': { tab: 'general', field: 'cladLength', suggest: 'Partial coverage selected with zero length: enter the covered length from the bottom (mm) in the Cladding block, or switch coverage to Full/None.' },
  'CL-03': { tab: 'general', field: 'cladMode', suggest: 'Mechanical liner is non-pressure-retaining — informational. Confirm the liner is intended as a corrosion barrier only (or switch coverage to weld overlay).' },
  'CL-04': { tab: 'general', field: 'cladThk', suggest: 'Overlay below the usual 2 mm corrosion-barrier minimum: increase the clad thickness, or accept a liner/overlay with a documented service justification.' },
  'MW-01': { tab: 'general', field: 'designPressure', suggest: 'MAWP has fallen below the design pressure: increase the shell/head/nozzle thickness until MAWP ≥ design P, or lower the design pressure (General tab).'},
  'PW-01': { tab: 'general', field: 'pwhtOverride', suggest: 'UCS-56 requires PWHT but it is waived on this tag: set PWHT back to Auto/Yes on the General tab, or keep the waiver only with a documented production trial (UCS-56 NOTE).'},
  'GE-01': { tab: 'sections', field: 'sec0-ttLength', suggest: 'Vertical L/D > 15: review the wind/seismic analysis — shorten the T-T length, increase the diameter, or confirm the design loads (Design Loads block) have been checked for this slenderness.' },
  'GE-02': { tab: 'sections', field: 'sec0-shellThk', suggest: 'D/t > 200: increase the shell thickness or review buckling/handling — thin shells need stiffening rings or a handling study before fabrication.' },
  'AB-01': { tab: 'type', field: 'supBaseRing', suggest: 'Anchor bolt area is short for the overturning moment: enable “Base ring + anchors” in Supports and/or increase the bolt size/count (the bolt KPI shows A req versus provided).' },
  'AB-02': { tab: 'type', field: 'supBaseRing', suggest: 'Bolt count/spacing is outside common seating guidance: adjust the anchor group — typically 4 bolts minimum at ~45° spacing on the base ring.' },
  'SD-01': { tab: 'type', field: 'supSaddleAngle', suggest: 'Zick horn compression over allowable: raise the saddle contact angle towards 120°, add a wear plate, or increase the saddle pad/shell thickness at the saddle.' },
  'SD-02': { tab: 'type', field: 'supSaddleSpan', suggest: 'Saddle spacing exceeds the 20R guidance: move the saddles closer together (reduce Saddle span) or accept with a documented Zick check at that spacing.' },
  'SD-03': { tab: 'type', field: 'supSaddleAngle', suggest: 'Saddle contact angle < 120°: set Saddle angle to 120° (the usual code minimum) unless the foundation requires less.' },
  'SD-04': { tab: 'type', field: 'supSaddleAngle', suggest: 'Tangential shear above 0.8·S (Zick): increase the saddle angle, add a saddle pad, or increase shell thickness at the saddle.' },
  'SD-05': { tab: 'type', field: 'supSaddleAngle', suggest: 'Longitudinal stress over the Zick allowable: add a saddle wear plate, increase the shell thickness, or reduce the saddle span.' },
  'SD-06': { tab: 'type', field: 'supSaddleAngle', suggest: 'High saddle horn utilisation (advisory): add a wear plate or a saddle stiffener ring before fabrication.' },
  'DBA-01': { tab: 'general', field: 'designPressure', suggest: 'VIII-2 Part 5 primary-stress screen above the S allowable: lower the design pressure or increase the governing thickness (the screen reports Pm/PL/PL+Pb against S = min(Su/2.4, Sy/1.5)).' },
  'DBA-02': { tab: '', field: '', suggest: 'Informational: this is the basis of the limited design-by-analysis screen (elastic stress, primary limits only). No field to change.' },
  'DBA-03': { tab: '', field: '', suggest: 'Informational: Part 5 fatigue screening is not evaluated (licensed fatigue criteria). No field to change.' },
  'RG-01': { tab: '', field: '', suggest: 'Stiffening-ring inertia below the 49 CFR 179.400-9 requirement: increase the flat-bar ring section (height² × width) until I ≥ the reported required value; ring inputs are not yet in the editor, so size the bar externally from the RG-02 number.' },
  'RG-02': { tab: '', field: '', suggest: 'Informational: reports the ring inertia the shell needs at this external pressure (I and I′ from 49 CFR 179.400-9). No field to change.' },
  'RG-03': { tab: '', field: '', suggest: 'The shell fails under external pressure and no stiffening ring is drawn: increase the shell thickness or add a stiffening ring sized to the RG-02 inertia requirement.' },
  // ---- API 650 tanks ----
  'T650-01': { tab: '', field: '', suggest: 'Informational: D > 61 m so the variable design-point method (§5.6.4) is applied to the shell courses. No field to change.' },
  'T650-02': { tab: '', field: '', suggest: 'A wind girder is recommended at this diameter/slenderness: add the girder to the tank structural scope (the engine does not model girder geometry).' },
  'T650-03': { tab: '', field: '', suggest: 'Anchor bolt chairs advised (API 650 §5.11): include them in the structural scope for seismic/floating-roof tanks.' },
  'T650-04': { tab: 'type', field: 'tankRoofType', suggest: 'External floating roof: check seal selection, stability and the roof drain on the Tank data tab (seals are costed as purchased items in the BOM).' },
  'T650-05': { tab: '', field: '', suggest: 'An external floating roof requires an upper wind girder (§5.8.7): include it in the structural scope.' },
  'T650-06': { tab: 'type', field: 'tankRoofType', suggest: 'Internal floating roof: verify vapor-space venting and guider arrangements (§5.8.2) — switch Roof type if a fixed roof with IFR deck is intended.' },
  'T650-08': { tab: 'type', field: 'tankBottomThk', suggest: 'Annular plate below Table 5-1a: raise the Bottom t input (annular thickness is derived from the table plus the selected width) or widen the annular ring.' },
  'T650-09': { tab: 'type', field: 'tankAnnularBottom', suggest: 'Annular plate width should be ≥ 600 mm from the shell (§5.5.3): enable the annular bottom plate on the Tank data tab.' },
  'T650-10': { tab: 'type', field: 'tankBottomThk', suggest: 'Bottom plate below the 6 mm corroded minimum (§5.5.1): enter a larger Bottom t (0 = auto already applies 6 mm + CA).' },
  'T650-11': { tab: '', field: '', suggest: 'The variable-design-point iteration did not converge in 5 passes (very large tank): treat the reported course stresses as indicative and verify by hand, or reduce the design liquid level.' },

  // ---- nozzle local loads (WRC 107) ----
  'NL-01': { tab: '', field: '', suggest: 'Informational: reports the nozzle local-load utilisation from the entered piping loads (WRC 107 structure). No field to change.' },
  'NL-02': { tab: 'nozzles', field: 'nz0-padThk', suggest: 'Local-load utilisation over 1.5·S: reduce the piping loads on the nozzle, add a reinforcement pad (Pad t / Pad Ø) or a heavier neck, or support the connected pipe close to the nozzle.' },
  'NL-03': { tab: '', field: '', suggest: 'The nozzle attachment ratio is beyond the common WRC 107 chart range — treat the number as screening only and confirm with WRC 537/107 or FEA for this geometry.' },

  // ---- API 661 fin-fans ----
  'AF-01': { tab: 'type', field: 'ffTubeCount', suggest: 'Face velocity above 6 m/s (noise/erosion): increase the face area — more tubes/rows or larger fin OD — or reduce the air flow.' },
  'AF-02': { tab: 'type', field: 'ffRows', suggest: 'Rows per bank outside the common 6–9 practice: set Rows deep inside that range (or justify the deviation in the design notes).' },
  'AF-03': { tab: 'type', field: 'ffDutyKW', suggest: 'Available kW below duty: add rows/finned length/fins, raise the air flow, or reduce the specified Duty.' },
  'AF-04': { tab: '', field: '', suggest: 'Confirm the air ΔP against the fan curve / vendor rating — the engine screens only. No field to change.' },

  // ---- TEMA exchangers ----
  'HX-01': { tab: 'type', field: 'hxShellDiaOD', suggest: 'Bundle-to-shell clearance below 10 mm: increase the Shell OD input (or let it auto-size) so the bundle clears the shell.' },
  'HX-02': { tab: 'type', field: 'hxTubeCount', suggest: 'Thermal area shortfall: raise the tube count / tube length, or reduce the specified duty until A avail ≥ A required.' },
  'HX-03': { tab: 'type', field: 'hxBaffleCut', suggest: 'LMTD correction factor F < 0.75: reduce the baffle cut, change tube passes, or move to 1 shell pass so the arrangement rates acceptably.' },
  'HX-04': { tab: '', field: '', suggest: 'A fixed tubesheet at this TEMA type needs an expansion joint or a floating head — change the TEMA type (BES/BEU) if that is intended.' },
  'HX-05': { tab: '', field: '', suggest: 'Pressure drops are guidance only: re-check with real flow data (Bell–Delaware inputs) before quoting ΔP. No field to change.' },
  'HX-08': { tab: 'type', field: 'hxTubeSheetClad', suggest: 'Tubesheet cladding should be ≥ 50% of the tubesheet thickness: increase the cladding thickness on the TEMA data tab.' },
  'HX-09': { tab: '', field: '', suggest: 'Welded tube-to-tubesheet joints require PT/MT (TEMA/UF-4) — add them to the ITP; no design field to change.' },
  'HX-10': { tab: 'type', field: 'hxTubeMatKey', suggest: 'The selected material is not a tube grade (form ≠ pipe): re-select a tube material (tube/pipe grades are listed in the dropdown).' },
  'HX-11': { tab: '', field: '', suggest: 'Temperature cross — F is undefined for this arrangement: re-check the process temperatures, or change shell/passes arrangement so the coldest tube side stays above the hottest shell side.' },
  'HX-12': { tab: 'type', field: 'hxUOverall', suggest: 'Specified design U is above the computed shell-side film coefficient: lower the Overall U input (or accept after a proper thermal re-rate with fouling allowance).' },
  'HX-13': { tab: 'type', field: 'shellFlow-massFlowKgS', suggest: 'Shell-side flow data absent — Bell–Delaware rating skipped: fill in the Shell-side flow block (mass flow, density, viscosity, cp, conductivity) to get a real ΔP and film coefficient.' },
  'HX-14': { tab: 'type', field: 'hxBaffleSpacing', suggest: 'Fluid-elastic instability ratio V/Vcr above 0.8: increase the baffle spacing, reduce the baffle cut, or add support plates to raise the tube natural frequency.' },
  'HX-15': { tab: 'type', field: 'hxBaffleSpacing', suggest: 'Vortex shedding is within 10% of the tube natural frequency: change the baffle spacing (shifts the unsupported span) to detune the frequency.' },
  'HX-16': { tab: 'type', field: 'hxBaffleSpacing', suggest: 'Shell acoustic mode within 20% of vortex shedding frequency: alter baffle spacing/cut or add acoustic baffles per HTRI guidance.' },
  'HX-17': { tab: 'type', field: 'hxPitch', suggest: 'Pitch/OD outside the ESDU 73031 validity band: set the pitch back inside the usual 1.25–1.5 × OD range for reliable tube-bundle results.' },
  'HX-18': { tab: 'type', field: 'hxBaffleSpacing', suggest: 'Bundle bypass fraction above 0.15: add seal strips or adjust baffle spacing so the annular gap is sealed.' },

  // ---- dispatcher ----
  'SYS': { tab: '', field: '', suggest: 'The calculation threw an exception for this tag — check the most recently changed inputs (design pressure/temperature, geometry, material) and report the tag if it persists.' },
};

/** Correction hint for a code (undefined when the code is unknown to the registry). */
export function fixFor(code: string): FieldFix | undefined {
  return WARNING_FIX[code];
}

/** DOM id of a fixable input for a tag. */
export function fieldId(equipId: string, field: string): string {
  return `f-${equipId}-${field}`;
}
