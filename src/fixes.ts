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
  'NZ-04': { tab: 'nozzles', field: 'nz0-attach', suggest: 'A nozzle attached to a dished end needs that end to exist and the elevation to lie inside the dish: set the Top/Bottom head to a dished type on the Sections tab, and keep the elevation between 0 (tangent) and the head depth. A nozzle on the crown itself is not permitted — move it inward or attach it to the shell.' },
  // ---- access and structural steelwork ----
  'AC-01': { tab: '', field: '', suggest: 'A ladder cannot cross a platform deck: split the climb into one run per platform level, arrive at the deck\'s outer edge, and leave a clear opening (≈700 mm) in the outer rail with a gate post. The access column should also keep one azimuth so every deck is entered from the same side.' },
  'AC-02': { tab: '', field: '', suggest: 'Break the climb with an intermediate platform (or switch to a stair tower) so no single ladder run exceeds 9000 mm — OSHA 1910.23 requires a rest platform at that interval.' },
  'AC-03': { tab: '', field: '', suggest: 'The deck beam span is too long for the standard HEA 140 under 4.5 kN/m² + 1.5 kN: shorten the span with a bracket or stanchion at mid-span, hang the deck from the shell, or specify a deeper beam. Check the panel\'s beam utilisation and required section modulus.' },
  'AC-04': { tab: '', field: '', suggest: 'Set the ladder clear width to at least 400 mm (460 mm is standard) and the rung pitch to 250–300 mm.' },
  'AC-05': { tab: '', field: '', suggest: 'Above 2200 mm of climb add either a safety cage or a guided-rail fall-arrest system; the descriptor now emits the cage from that height automatically.' },
  'AC-06': { tab: '', field: '', suggest: 'Widen the walkway to at least 600 mm clear (900 mm is the usual platform width) so it can be walked with tools.' },
  'AC-07': { tab: '', field: '', suggest: 'Two decks at the same elevation overlap: move the landing clear of the walkway end (it should start where the walkway ends) or merge them into one deck.' },
  'AC-08': { tab: '', field: '', suggest: 'Keep the stair pitch between 30° and 38° with a 175 mm rise / 250 mm going; adjust the flight count or the landing heights.' },
  'CN-01': { tab: 'sections', field: 'sec0-coneThk', suggest: 'Increase the Spec t cone for that section (UG-32(g) cone thickness, incl. the transition moment term) or reduce the cone included angle.' },
  'CN-02': { tab: 'sections', field: 'sec0-coneAngleDeg', suggest: 'Included cone angle > 30°: reduce the angle, or introduce a knuckle/multi-cone transition between the two diameters.' },
  'MD-01': { tab: 'sections', field: 'sec0-dia', suggest: 'Two sections with different diameters need a cone between them: add a section (Sections → ＋) whose cone angle spans the transition, or make the diameters equal.' },
  'NZ-01': { tab: 'nozzles', field: 'nz0-dn', suggest: 'Nozzle neck wall below UG-45/pressure: select a heavier pipe schedule, a smaller bore, or add a reinforcing pad (Pad Ø / Pad t) on the Nozzles tab.' },
  'NZ-02': { tab: 'nozzles', field: 'nz0-padDia', suggest: 'Reinforcement shortfall (UG-37): increase Pad Ø (its thickness follows), reduce the bore, or use a heavier neck schedule until A prov ≥ A req (right-hand columns show both). On a self-reinforced (SRN) neck there is no pad — thicken the neck to the value shown above it instead.' },
  'NZ-06': { tab: 'nozzles', field: 'nz0-neckThk', suggest: 'A self-reinforced (SRN) neck has to close UG-37 on its own: enter a neck wall at least as thick as the value shown (thicker forging), or switch the nozzle Type to “Set-on + RF pad” and let the ring carry the reinforcement.' },
  'NZ-05': { tab: 'nozzles', field: 'nz0-style', suggest: 'A reinforcing pad is not modelled on a self-reinforced (SRN) neck: clear the pad Ø, or switch the nozzle Type back to “Set-on + RF pad” if a ring is intended.' },
  'NZ-03': { tab: 'nozzles', field: 'nz0-elevation', suggest: 'The nozzle elevation lies outside the shell, so the check ran against the nearest course instead of the right one: set Elev (mm) to a height between 0 and the T-T length, measured from the bottom tangent (the Course column shows which shell course the elevation selects).' },
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
  'CL-05': { tab: 'general', field: 'cladFurnace', suggest: 'This overlay build-up / shell thickness / base metal is normally furnace heat treated: tick “Furnace heating” in the weld-overlay block so the cycle is costed (post-overlay PWHT per UCS-56 / WRC guidance), or record why local preheat is sufficient.' },
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
  'T650-07': { tab: 'type', field: 'tankMaxDesignLiquidLevel', suggest: 'The design liquid level is above the shell: API 650 sizes the courses on the liquid height, so this over-sizes the shell and overstates the volume. Set Max liquid level (mm, 0 = TT) on the Tank data tab to ≤ the tank T-T length (enter 0 to use the shell height).', },
  'T650-08': { tab: 'type', field: 'tankBottomThk', suggest: 'Annular plate below Table 5-1a: raise the Bottom t input (annular thickness is derived from the table plus the selected width) or widen the annular ring.' },
  'T650-09': { tab: 'type', field: 'tankAnnularBottom', suggest: 'Annular plate width should be ≥ 600 mm from the shell (§5.5.3): enable the annular bottom plate on the Tank data tab.' },
  'T650-10': { tab: 'type', field: 'tankBottomThk', suggest: 'Bottom plate below the 6 mm corroded minimum (§5.5.1): enter a larger Bottom t (0 = auto already applies 6 mm + CA).' },
  'T650-11': { tab: '', field: '', suggest: 'The variable-design-point iteration did not converge in 5 passes (very large tank): treat the reported course stresses as indicative and verify by hand, or reduce the design liquid level.' },
  'T650-12': { tab: 'type', field: 'tankAnnularRingWidth', suggest: 'API 650 §5.5.3 needs the annular ring at least 600 mm wide from the shell before the first lap joint: raise the Annular ring width field on the Tank data tab to ≥ 600 mm (the ring mass and Table 5-1a area follow that width), or turn the annular bottom plate off if the bottom is uniform.' },
  'T650-13': { tab: 'type', field: 'tankStiffenerRings', suggest: 'Informational: the tag declares stiffening rings / wind girders, so the girder check is satisfied by provision rather than by calculation — include the top and intermediate girders in the structural scope per API 650 §5.8.7 and untick the box if they are not being provided.' },
  'T650-14': { tab: '', field: '', suggest: 'L/H is above the §5.6.4 applicability limit (1000/6): the variable design point method no longer applies and API 650 routes the shell to elastic analysis — commission that analysis for this tank, or re-check the bottom-course thickness and liquid height that entered the ratio (the engine does not run elastic analysis).' },
  'T650-15': { tab: '', field: '', suggest: 'A shell course grade is not in the API 650 Table 5.2 stress table, so that course fell back to the tag material: re-select the course grade on the Tank data tab from the listed grades (SA-285-C / SA-516-60 / SA-516-70) or clear it to inherit the tag material.' },
  'T650-16': { tab: '', field: '', suggest: 'Informational: each course was ordered in the next ASTM A6/A20 rolled-plate size above its code thickness — the course table on the Tank data tab shows required vs plate thickness. No field to change; nothing is rounded down.' },
  'T650-17': { tab: '', field: '', suggest: 'A course needs more than the 120 mm stocked plate series: plan a special mill order (or split the shell into more courses to reduce the bottom-course head), and confirm the rolling/heat-treatment capability with the mill before pricing.' },

  // ---- nozzle local loads (WRC 107) ----
  'NL-01': { tab: '', field: '', suggest: 'Informational: reports the nozzle local-load utilisation from the entered piping loads (WRC 107 structure). No field to change.' },
  'NL-02': { tab: 'nozzles', field: 'nz0-padDia', suggest: 'Local-load utilisation over 1.5·S: reduce the piping loads on the nozzle, add a reinforcement pad (set the RF pad Ø — its thickness follows automatically) or a heavier neck, or support the connected pipe close to the nozzle.' },
  'NL-03': { tab: '', field: '', suggest: 'The nozzle attachment ratio is beyond the common WRC 107 chart range — treat the number as screening only and confirm with WRC 537/107 or FEA for this geometry.' },

  // ---- API 661 fin-fans ----
  'AF-01': { tab: 'type', field: 'ffTubeCount', suggest: 'Face velocity above 6 m/s (noise/erosion): increase the face area — more tubes/rows or larger fin OD — or reduce the air flow.' },
  'AF-02': { tab: 'type', field: 'ffRows', suggest: 'Rows per bank outside the common 6–9 practice: set Rows deep inside that range (or justify the deviation in the design notes).' },
  'AF-03': { tab: 'type', field: 'ffDutyKW', suggest: 'Available kW below duty: add rows/finned length/fins, raise the air flow, or reduce the specified Duty.' },
  'AF-04': { tab: '', field: '', suggest: 'Confirm the air ΔP against the fan curve / vendor rating — the engine screens only. No field to change.' },
  'AF-05': { tab: 'type', field: 'ffFanDia', suggest: 'Fan area below 40% of the bay face area (API 661): increase the Fan Ø input (0 = auto sizes it to exactly 40%), or reduce the face area by shortening the finned length / rows.' },
  'AF-06': { tab: 'type', field: 'ffMotorKw', suggest: 'Motor rating below the required fan power: raise Motor (kW) above the fan shaft power shown in the Fin-fan block (total kW ÷ bays), or reduce the air flow / ΔP.' },

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
