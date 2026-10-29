// Domain model for the static equipment design suite.
// Internal unit system: length mm, pressure bar(g), temperature °C, mass kg, stress MPa.

import type { StiffenerRingResult } from './rings';
import type { DesignMarginCalc } from './viii2';

export type EquipType = 'vessel' | 'column' | 'hx' | 'finfan' | 'tank';
export type HeadType = 'ellip2' | 'toriFD' | 'toriD' | 'hemi' | 'none';
export type Orientation = 'vertical' | 'horizontal';
export type InspectionLevel = '3.1' | '3.2';
export type RtCategory = 'full' | 'spot' | 'none';

/** Corrosion-resistant cladding / lining of the pressure shell (vessels & columns). */
export type CladMode = 'none' | 'full' | 'partial';
export type CladKind = 'weldOverlay' | 'explosionBonded' | 'rollBonded' | 'mechanicalLiner';

export interface CladSpec {
  mode: CladMode;
  kind: CladKind;
  /** Lining/cladding grade, e.g. 316L, 304L, 321, 347, 904L, 625, duplex */
  materialKey: string;
  /** Nominal cladding/lining thickness (mm) — for weld overlay this is the TOTAL of the layers */
  thicknessMm: number;
  /** Partial mode: covered length measured up from bottom datum (mm) */
  partialLengthMm: number;
  note: string;
  /**
   * Weld-overlay build-up. In practice an overlay is not one bead: a 309L/309Mo
   * stainless base run is deposited on the ferritic shell first, then the
   * corrosion-resistant finish layer of the specified grade. Each layer has its
   * own minimum thickness, its own consumable and its own overlay hours.
   * Absent => single-layer fallback using thicknessMm and materialKey.
   */
  overlay?: OverlaySpec;
}

/** Two-layer weld overlay (base run + finish layer). */
export interface OverlaySpec {
  /** base (buffer) run grade — 309L for a carbon/low-alloy shell, 309Mo for Cr-Mo */
  baseMatKey: string;
  /** base run thickness (mm), minimum 1.5 mm */
  baseThkMm: number;
  /** finish (corrosion-resistant) layer thickness (mm), minimum 1.5 mm */
  finishThkMm: number;
  /** furnace (post-overlay) heat treatment — suggested by the engine, selectable */
  furnaceHeating: boolean;
}

/** NDT methods — per-weld-method plan with timing and extent. */
export type NdtMethod = 'mt' | 'ut' | 'rt' | 'putTofd';
export type NdtTiming = 'during' | 'afterPwht' | 'final';
export type NdtExtent = 'full' | 'spot' | 'sample';

export interface NdtItemSpec {
  method: NdtMethod;
  enabled: boolean;
  /** during welding (interstage), after PWHT, or final before hydro */
  timing: NdtTiming;
  extent: NdtExtent;
  note: string;
}

/** Production phase during which an ITP stage is performed (checkbox multi-select). */
export type ItpStagePhase = 'receiving' | 'fabrication' | 'interstage' | 'afterPwht' | 'hydro' | 'final';

/** Per-tag ITP stage schedule — checked timing phases + duration with manual override. */
export interface ItpStageTiming {
  /** stable stage code (matches ITP activity rows) */
  code: string;
  /** checked phases when this stage is performed */
  phases: ItpStagePhase[];
  /** engine-estimated duration in hours (indicative) */
  durationH: number;
  /** manual duration override in hours; null = use engine estimate */
  durationOverrideH: number | null;
}

export interface SectionSpec {
  id: string;
  /** Inside diameter, new condition (mm) */
  dia: number;
  /** Cylinder length Tan-Tan (mm) */
  ttLength: number;
  headTop: HeadType;
  headBottom: HeadType;
  /** Selected nominal shell thickness (mm). 0 => auto pick from stock */
  shellThk: number;
  headThkTop: number;
  headThkBot: number;
  /** Included angle of the cone joining this section to the one below (deg) */
  coneAngleDeg: number;
  /** Cone wall thickness (mm), 0 => auto */
  coneThk: number;
}

export type NozzleKind = 'process' | 'vent' | 'drain' | 'instrument' | 'manway' | 'safety' | 'safetyRelief' | 'spare' | 'support';

export interface NozzleSpec {
  id: string;
  tag: string;
  service: string;
  /** Bore (mm) — finished inside diameter */
  dn: number;
  /** pipe schedule key, see PIPE_SCHEDULES */
  schKey: string;
  sectionId: string;
  /**
   * Where the nozzle penetrates: the cylindrical shell (default) or one of the
   * dished ends. A head nozzle's elevation is measured along the axis from the
   * tangent line it leaves — UG-37 reinforcement is then checked against the head
   * thickness, not the shell course.
   */
  attach?: 'shell' | 'topHead' | 'bottomHead';
  /** Elevation of nozzle centre above vessel bottom datum (mm) */
  elevation: number;
  /** Azimuth, deg clockwise from north (viewed from top) */
  azimuth: number;
  kind: NozzleKind;
  flangeClass: 150 | 300 | 600 | 900 | 1500 | 2500;
  flangeMatKey: string;
  /** Reinforcement pad OD (mm), 0 => none */
  padDia: number;
  /**
   * Legacy pad thickness (mm). Kept so old projects load, but the engine no longer
   * reads it: ring thickness is DERIVED from the bore, neck schedule and shell /
   * head thickness (NozzleCalc.padThkUsed) — only the pad OD is an input.
   */
  padThk: number;
  /** Neck length from shell OD to flange face (mm) */
  projOutside: number;
  /** Optional external piping/attachment loads at the nozzle–shell junction for
   *  WRC 107 screening (kN / kN·m, nozzle local axes: fx axial along the nozzle
   *  centreline, fy/fz transverse shears, mx torsion about the axis, my/mz
   *  overturning moments). Absent/zero => no screening. */
  loads?: NozzleLoads;
}

export interface NozzleLoads {
  fx: number; // kN axial (along nozzle centreline)
  fy: number; // kN transverse shear
  fz: number; // kN transverse shear
  mx: number; // kN·m torsion about nozzle axis
  my: number; // kN·m overturning
  mz: number; // kN·m overturning
}

export type InternalsKind =
  | 'sieveTray'
  | 'valveTray'
  | 'bubbleCapTray'
  | 'randomPacking'
  | 'structuredPacking'
  | 'demister'
  | 'distributor'
  | 'collector'
  | 'chimneyTray'
  | 'supportRing';

export interface InternalsSpec {
  id: string;
  kind: InternalsKind;
  count: number;
  /** Tray/packing layer spacing (mm) */
  spacing: number;
  /** Elevation of lowest internals level above bottom datum (mm) */
  bottomElevation: number;
  materialKey: string;
  /** Extra allowance kg/m2 (deck furniture, downcomers etc.) */
  kgPerM2: number;
  note: string;
  /**
   * Does this shop supply the internals themselves? false = tray/bed SUPPORT
   * RINGS only: the rings are welded in (the hours are booked) but no tray,
   * packing or deck is bought or installed. Default (absent) = supplied.
   */
  supplied?: boolean;
  /**
   * Support-ring stock is the clad FINAL layer grade when the ring sits inside a
   * clad/overlay zone (an SS tray ring welded to a 316L overlay). Absent = derive
   * from the tag's clad specification.
   */
  ringMaterialKey?: string;
}

export type SupportType =
  | 'legs'
  | 'legsAngle'
  | 'legsBeam'
  | 'saddle'
  | 'skirt'
  | 'skirtCone'
  | 'angleSkirt'
  | 'bodyAngleSkirt'
  | 'ring'
  | 'none';

/** Lifting arrangement (lifting lugs, trunnions or a tailing lug). */
export type LiftingKind = 'lugs' | 'trunnion' | 'trunnionPair' | 'tailLug';

export interface LiftingSpec {
  enabled: boolean;
  kind: LiftingKind;
  /** number of lugs/trunnions; 0 = auto from the dry weight */
  count: number;
  /** lug/trunnion plate thickness (mm); 0 = auto from the lift load */
  plateThkMm: number;
  /** design lift factor on the dry weight (1.0 = dead weight, 1.5 = dynamic/tailing) */
  liftFactor: number;
  /** trunnion pipe bore (mm) for kind = trunnion; 0 = auto */
  trunnionBoreMm: number;
}

/** Transportation / shipping saddle for horizontal equipment (wood or fabricated steel). */
export interface TransportSaddleSpec {
  enabled: boolean;
  /** auto picks wood below ~8 t and metal above, unless overridden */
  kind: 'auto' | 'wood' | 'metal';
  /** number of saddles; 0 = auto (2 up to 12 m, 3 above) */
  count: number;
  /** include the transportation saddles as a priced line in the estimate */
  includeInPrice: boolean;
}

/** Design wind / seismic loads driving anchor-bolt overturning (vessels & columns).
 *  Wind is a flat design pressure on the projected area (common vessel-spec basis);
 *  seismic uses the ASCE 7 equivalent-lateral-force coefficients. Both are
 *  preliminary-aid inputs — verify against the governing ASCE/Jurisdiction edition. */
export interface DesignLoads {
  /** flat design wind pressure on projected area (kPa); 0 => default 0.75 kPa */
  windPressureKpa: number;
  /** seismic site spectral acceleration Sds (g); 0 => no seismic considered */
  sds: number;
  /** ASCE 7 response modification factor R (typical vessel/support ~ 3.0) */
  seismicR: number;
  /** ASCE 7 seismic importance factor Ie (1.0 / 1.25 / 1.5) */
  seismicIe: number;
}

export interface SupportSpec {
  /** primary support type */
  type: SupportType;
  legCount: number;
  saddleSpan: number;
  saddleAngle: number; // deg
  skirtH: number;
  legPlateThk: number;
  /** base ring + anchor bolt group (skirt/legs/ring-mounted vessels) */
  baseRing?: boolean;
  /** lifting lugs / padeyes on shell (legacy switch — see lifting for the detailed spec) */
  padeyes?: boolean;
  /** guy-wire derrick for tall verticals (L/D > 4) */
  guyLines?: boolean;
  /** detailed lifting arrangement (lugs, trunnions, tailing lug) */
  lifting?: LiftingSpec;
  /** transportation saddles for horizontal equipment */
  transportSaddle?: TransportSaddleSpec;
}

/** Per-kind support item calculation (each support type costed separately). */
export interface SupportItemCalc {
  kind:
    | 'legs'
    | 'legsAngle'
    | 'legsBeam'
    | 'saddle'
    | 'skirt'
    | 'skirtCone'
    | 'angleSkirt'
    | 'bodyAngleSkirt'
    | 'ring'
    | 'baseRing'
    | 'padeyes'
    | 'lifting'
    | 'transport'
    | 'guylines';
  label: string;
  count: number;
  weightKg: number;
  /** attachment / fabrication weld length (m) */
  weldLenM: number;
  /** fabrication + welding hours */
  hours: number;
  note: string;
}

export interface SupportCalc {
  items: SupportItemCalc[];
  totalWeightKg: number;
  totalHours: number;
  /** anchor bolt group for the primary support / base ring */
  anchorBolts: { count: number; diaMm: number; lengthMm: number } | null;
}

export type TankRoofType = 'cone' | 'dome' | 'internalFloating' | 'externalFloating';
export type TankSealPrimary = 'none' | 'shoe' | 'fabric' | 'liquidMounted' | 'doubleContact';
export type TankSealSecondary = 'none' | 'metal' | 'fabric' | 'panCover';

export interface TankSpec {
  fluidName: string;
  specificGravity: number;
  roofType: TankRoofType;
  annularBottom: boolean;
  bottomThk: number; // mm
  roofThk: number; // mm
  windPressure: number; // kPa
  seismic: boolean;
  shellAllowableOverride: number; // MPa, 0 = use API table
  stiffenerRings: boolean;
  /** cone-roof plate slope expressed as 1:N rise:run (API 650 standard slope is 1:16) */
  roofSlope?: '1:16' | '1:20' | 'custom';
  /** run N when roofSlope === 'custom' (rise 1 : N) */
  roofSlopeCustom?: number;
  /** annular bottom-plate width measured from the shell, mm (§5.5.3 minimum 600) */
  annularRingWidthMm?: number;
  maxDesignLiquidLevel: number; // mm, 0 = use TT height
  /** primary seal (internal / external floating roof) — API 650 §5.8.3 */
  primarySeal?: TankSealPrimary;
  /** secondary seal (external floating roof) */
  secondarySeal?: TankSealSecondary;
  /**
   * Per-course shell plate grade (F4) — API 650 allows a different grade per
   * course. Index = course counted from the BOTTOM (0 = bottom course); an
   * empty/absent entry means that course inherits the tag's materialKey.
   */
  courseGrades?: string[];
  /** hydrotest medium density, kg/m³ (default 997 = water at ~25 °C) */
  hydroTestDensity?: number;
}

/** Optional structural steelwork around the equipment (skid, portal, pedestal…). */
export interface StructureSpec {
  enabled: boolean;
  kind: 'skid' | 'portal' | 'pedestal' | 'platform';
}

export interface StructureMember {
  label: string;
  section: string;
  count: number;
  lengthM: number;
  kgPerM: number;
  kg: number;
}

/** Structure calculation recommendation for a tag (costed when selected). */
export interface StructureRecommendation {
  kind: StructureSpec['kind'];
  basis: string;
  members: StructureMember[];
  weightKg: number;
  /** shop fabrication hours when enabled */
  hours: number;
  enabled: boolean;
}

/**
 * Shell-side process data for the Bell–Delaware rating and tube-vibration
 * screening. Everything is optional so saved projects stay loadable; when it
 * is absent the engine skips the shell-side calculation and says so.
 * Units follow the internal convention: kg/s, kg/m³, cP, kJ/kg·K, W/m·K.
 */
export interface ShellSideFlow {
  /** Shell-side mass flow (kg/s) */
  massFlowKgS: number;
  /** Shell-fluid density at bulk temperature (kg/m³) */
  densityKgM3: number;
  /** Shell-fluid dynamic viscosity at bulk temperature (cP) */
  viscCp: number;
  /** Shell-fluid specific heat (kJ/kg·K) */
  cpKjKgK: number;
  /** Shell-fluid thermal conductivity (W/m·K) */
  condWmK: number;
  /** Viscosity at wall temperature (cP, 0 => = bulk) */
  viscWallCp?: number;
  /** Speed of sound in the shell fluid (m/s, 0 => acoustic screening skipped) */
  soundSpeedMs?: number;
  /** Connors fluid-elastic instability constant (0 => 3.3, conservative screen) */
  connorsK?: number;
  /** Logarithmic decrement of the tube span (0 => 0.1) */
  logDecrement?: number;
  /** Strouhal number for vortex shedding (0 => 0.2, isolated-cylinder value) */
  strouhal?: number;
  /** Added-mass coefficient for the shell fluid (0 => 1.0) */
  addedMassCoef?: number;
  /** Tube Young's modulus (GPa, 0 => 193, typical steel) */
  youngGPa?: number;
}

export interface HXSpec {
  temaType: string;
  /** Tube-to-tubesheet joint: expanded, strength welded, seal welded + expanded, fully welded */
  tubeJointType?: 'expanded' | 'strengthWelded' | 'sealWeldExpanded' | 'fullyWelded';
  /** Tubesheet face cladding/overlay (bonded, integral or weld overlay) */
  tubeSheetClad?: { enabled: boolean; materialKey: string; thicknessMm: number };
  shellFluid: string;
  tubeFluid: string;
  /** 0 => auto-size from tube count */
  shellDiaOD: number;
  tubeOD: number;
  tubeWall: number;
  tubeLength: number; // mm between tubesheets
  tubeCount: number; // 0 => auto fill ~70% of shell
  pitch: number; // mm
  layoutAngle: 30 | 45 | 60 | 90;
  baffleType: 'segmental' | 'doubleSeg' | 'noTubeInWindow' | 'orifice' | 'single';
  baffleCut: number; // % of shell ID
  baffleSpacing: number; // mm, 0 => auto (20% of shell ID)
  passesTube: 1 | 2 | 4 | 6 | 8;
  shellMatKey: string;
  tubeMatKey: string;
  baffleMatKey: string;
  headMatKey: string;
  tsMatKey: string;
  designPShell: number; // bar g
  designTShell: number; // °C
  designPTube: number;
  designTTube: number;
  dutyKW: number;
  tShellIn: number;
  tShellOut: number;
  tTubeIn: number;
  tTubeOut: number;
  /** Overall U (W/m²K) incl. fouling allowance; 0 => default guess by service class */
  uOverall: number;
  tubeSideDP: number; // bar (0 => typical guidance only)
  baffleCount: number; // 0 => auto
  /** Shell-side process data — drives the Bell–Delaware rating + vibration screen */
  shellFlow?: ShellSideFlow;
}

export interface FinFanSpec {
  arrangement: 'induced' | 'forced' | 'vapor';
  bays: number;
  rows: number;
  tubeLength: number; // mm effective finned length
  tubeOD: number;
  tubeWall: number;
  finOD: number;
  finPitch: number; // fins per inch
  finThk: number; // mm
  dutyKW: number;
  processInC: number;
  processOutC: number;
  airInC: number;
  /** Overall U on external finned area (W/m²K), 0 => default guess */
  uAir: number;
  /** Allowed air temperature rise (°C), 0 => default 15 */
  airRiseC: number;
  fanEfficiency: number; // 0..1
  plenumLossH2O: number; // in. H2O
  tubeMatKey: string;
  finMatKey: string;
  headerThk: number;
  tubeCount: number; // 0 => auto
  /** site elevation for the air density (m; absent/0 = sea level, ISA 1.225 kg/m³) */
  siteElevationM?: number;
  /** fin form — recorded on the datasheet/BOM; the thermal rating still runs on
   *  the entered/auto overall U (a fin-efficiency re-rate is not implemented) */
  finType?: 'lFooted' | 'serrated' | 'gFooted' | 'integral';
  /** fan diameter (mm; absent/0 = auto-size to ≥40 % of the bundle face area) */
  fanDiaMm?: number;
  /** fan motor rating at the shaft (kW; absent/0 = no motor specified) */
  motorKw?: number;
}

/** Flat-bar external-pressure stiffening ring drawn on the vessel. */
export interface StiffenerRingSpec {
  enabled: boolean;
  /** Web depth measured radially (mm, 0 = no section drawn yet) */
  webDepthMm: number;
  /** Web thickness (mm) */
  webThkMm: number;
  /** Number of rings between the lines of support (0 = one ring at mid-span) */
  count: number;
}

export interface Equipment {
  id: string;
  srNo: number;
  tag: string;
  name: string;
  equipType: EquipType;
  orientation: Orientation;
  sections: SectionSpec[];
  nozzles: NozzleSpec[];
  internals: InternalsSpec[];
  support: SupportSpec;
  materialKey: string;
  corrosionAllowance: number; // mm
  designPressure: number; // bar g
  designTemp: number; // °C
  mdmt: number; // °C (minimum design metal temperature)
  /** Design external/vacuum pressure (bar), e.g. 0.1 for full vacuum check */
  externalPressure: number;
  rtCategory: RtCategory;
  inspectionLevel: InspectionLevel;
  /** Cladding/lining of shell & heads (vessels & columns). Optional for legacy saved projects. */
  clad?: CladSpec;
  /** Per-method NDT plan (DP/MT, UT, conventional RT, PaUT/TOFD). */
  ndtPlan?: NdtItemSpec[];
  /** ITP stage timing schedule (phases + durations). Optional for legacy projects. */
  itpStages?: ItpStageTiming[];
  /** force PWHT on/off; null = auto per UCS-56 */
  pwhtOverride: boolean | null;
  /** Fill process for shell/head seams: auto = SAW when eligible (ferritic vessel/column, t ≥ 10 mm), else SMAW. */
  weldProcess?: 'auto' | 'saw' | 'smaw';
  /** Outsourced dish-end forming: manual hours override (null/undefined = auto estimate). */
  formingHoursOverride?: number | null;
  /** Outsourced dish-end forming rate override (BHD/h); null/undefined = Settings rate. */
  formingRateOverride?: number | null;
  /** structural steelwork recommendation (skid/portal/pedestal/platform) — costed when enabled */
  structure?: StructureSpec;
  /** design wind/seismic loads for anchor-bolt overturning (vessels & columns) */
  designLoads?: DesignLoads;
  /** External-pressure (vacuum) stiffening ring — flat bar welded radially to the shell */
  ring?: StiffenerRingSpec;
  /** ASME VIII-2 Part 5 design-by-analysis (design margin) screen */
  designByAnalysis?: boolean;
  /** Desired MAWP (bar g); 0 => equal to design pressure */
  mwps: number;
  testPressureFactor: number; // default 1.3 (UG-99)
  notes: string;
  tank?: TankSpec;
  hx?: HXSpec;
  finfan?: FinFanSpec;
}

export type WarnLevel = 'error' | 'warning' | 'info';
export interface Warning {
  level: WarnLevel;
  code: string;
  msg: string;
}

export interface HeadCalc {
  type: HeadType;
  /** Inside crown radius (mm) */
  crownR: number;
  /** Inside knuckle radius (mm) */
  knuckleR: number;
  /** Depth inside (mm) */
  depth: number;
  /** Required pressure thickness without CA (mm) */
  tReq: number;
  /** Minimum nominal to order incl. CA (mm) */
  tMinNominal: number;
  mawp: number; // bar, corroded
  utilization: number;
  blankDia: number; // mm
  surfaceArea: number; // m2 (one head)
}

export interface ExternalPressureCalc {
  L: number; // distance between lines of support (mm)
  Do: number;
  t: number; // corroded
  DoOverT: number;
  A: number;
  B: number; // psi (chart factor)
  pAllowBar: number; // allowable external pressure, bar
  ok: boolean;
  approximated: boolean;
  note: string;
}

export interface SectionCalc {
  spec: SectionSpec;
  /** corroded inside radius (mm) */
  Rc: number;
  tReqHoop: number;
  tReqLong: number;
  tReqExternal: number;
  tReq: number; // governing pressure thickness (no CA)
  tMinNominal: number; // tReq + CA (min order thickness)
  tNominal: number; // selected/ordered (mm)
  tCorroded: number; // tNominal - CA
  mawpHoop: number;
  mawpLong: number;
  utilization: number; // max of hoop/long/external
  governing: string;
  headTop?: HeadCalc;
  headBot?: HeadCalc;
  cone?: { tReq: number; tMinNominal: number; tNominal: number; theta: number; mawp: number; D1: number; D2: number };
  external?: ExternalPressureCalc;
  weightShellKg: number;
}

export interface NozzleCalc {
  spec: NozzleSpec;
  /** resolved shell course (SectionSpec.id) the nozzle reinforces — derived from
   *  its elevation against the body layout, NOT from the stored spec.sectionId */
  sectionId: string;
  dn: number; // corroded opening dia
  wall: number; // nominal neck wall
  wallCorroded: number;
  trn: number; // nozzle pressure thickness required
  ug45min: number; // UG-45(b)(3) minimum
  neckOK: boolean;
  Areq: number;
  A1: number;
  A2: number;
  A3: number;
  Aweld: number;
  Aprov: number;
  shortfall: number;
  reinforceOK: boolean;
  /** pad thickness the current pad OD needs to close the UG-37 shortfall (mm, 0 when not needed) */
  padThkAuto: number;
  /** pad thickness the check actually ran with (the derived padThkAuto, rounded up to 0.5 mm) */
  padThkUsed: number;
  /** pad OD the check actually saw (mm, 0 = no pad) */
  padDiaUsed: number;
  /** reinforcement the pad supplies at padThkUsed (mm²) */
  padArea: number;
  /** recommended pad OD for the neck/wall (2× the bore, min bore + 100 mm) — the value to type */
  padDiaSuggested: number;
  flangeRating: number; // bar at design T
  flangeClassOK: boolean;
  /** local-load screening (WRC 107 structure) — present when nozzle.loads set */
  load?: NozzleLoadCalc;
  pipeLenM: number;
  pipeKg: number;
  flangeKg: number;
}

/** Nozzle local-load screening result. Structure per WRC 107 (2002 update):
 *  the exact bulletin shell-shear equations plus nominal thin-wall nozzle-neck
 *  stresses; the Kellogg equivalent pressure feeds the flange rating check.
 *  The full curve-based WRC 107/537 shell membrane/bending stresses are
 *  licensed bulletin data and are NOT reproduced here. */
export interface NozzleLoadCalc {
  /** WRC four-load set at the junction: P axial (N), V1/V2 transverse shears (N),
   *  Mt torsion (N·mm), Mo1/Mo2 overturning (N·mm) — nozzle local axes */
  P: number;
  V1: number;
  V2: number;
  Mt: number;
  Mo1: number;
  Mo2: number;
  /** attachment outside radius (pad OD/2 when padded), shell mean radius, corroded shell wall (mm) */
  r0Mm: number;
  RmMm: number;
  tShellMm: number;
  /** WRC cylindrical-shell parameters: gamma = Rm/T, beta = 0.875·r0/Rm */
  gamma: number;
  beta: number;
  /** exact WRC 107 shell shear at a round attachment: V/(π·r0·T) + Mt/(2π·r0²·T) (MPa) */
  shellShearMPa: number;
  /** shell hoop membrane from design pressure at the junction (MPa) */
  shellPressureMPa: number;
  /** combined shell screening stress, biaxial P membrane + WRC shear (von Mises, MPa) */
  shellVmMPa: number;
  /** nominal nozzle-neck stresses (MPa) */
  neckAxialMPa: number;
  neckBendMPa: number;
  neckTorsionMPa: number;
  neckShearMPa: number;
  neckVonMisesMPa: number;
  /** Kellogg equivalent pressure from the external loads (bar) */
  equivPressureBar: number;
  /** screening utilisation vs 1.5·S (typical local-load criterion) */
  util: number;
  allowMPa: number;
  ok: boolean;
}

export interface BoltCalc {
  count: number;
  boltCircle: number;
  areaEach: number; // mm2
  totalArea: number;
  reqArea: number;
  utilization: number;
  ok: boolean;
  // governing overturning load case (wind vs seismic) — additive detail
  governing: 'wind' | 'seismic';
  /** governing overturning moment about the base (kN·m) */
  overturnMomentKNm: number;
  windMomentKNm: number;
  seismicMomentKNm: number;
  /** max tension in the most-tensioned bolt (elastic bolt-group, kN) */
  boltTensionKN: number;
  /** max bolt tensile stress (MPa) */
  boltStressMPa: number;
  /** bolt allowable working stress at temperature (MPa, indicative) */
  boltAllowMPa: number;
  /** circumferential bolt spacing (mm) and good-practice advisory */
  spacingMm: number;
  spacingOK: boolean;
  note: string;
}

export interface SaddleCalc {
  reaction: number; // kN per saddle
  /** Zick circumferential compressive stress at the saddle horn (S3, MPa) */
  zickFc: number;
  /** horn allowable = 1.25 × shell tension allowable (MPa, Zick) */
  zickAllow: number;
  /** membrane (direct) component of the horn stress (MPa) */
  hornMembraneMPa: number;
  /** local circumferential bending component at the horn (MPa) */
  hornBendingMPa: number;
  /** assumed saddle contact width b0 (mm) */
  saddleWidthMm: number;
  /** Zick horn coefficient K3 for the saddle angle */
  k3: number;
  /** max tensile longitudinal stress at saddle (pressure + bending, MPa) */
  longStressMPa: number;
  /** compressive fibre at saddle top (bending − pressure, MPa) — buckling review */
  longCompMPa: number;
  /** longitudinal allowable (material S, indicative) */
  longAllowMPa: number;
  /** Zick tangential shear stress at saddle (MPa) */
  shearMPa: number;
  /** shear allowable = 0.8 × tension allowable (Zick) */
  shearAllowMPa: number;
  /** Zick shear coefficient K2 for the saddle angle */
  k2: number;
  /** horn utilisation zickFc/zickAllow — drives the wear-plate advisory */
  hornUtil: number;
  maxSpan: number; // mm guidance (20R)
  ok: boolean; // all three Zick checks (horn, shear, longitudinal) pass
  note: string;
}

export interface PwhtAdvice {
  required: boolean;
  basis: string;
  preheat: string;
  procedure: string;
  fillers: string[];
}

export interface TankCalc {
  /** shell sizing method actually applied (§5.6.3 one-foot vs §5.6.4 VDP) */
  shellMethod?: 'oneFoot' | 'vdp';
  shellCourses: {
    courseNo: number;
    heightMm: number;
    /** liquid head above the course BOTTOM (m) — the design datum for the
     *  one-foot (0.3 m above bottom) and variable-design-point evaluations */
    designHeadM: number;
    /** stress evaluation point above the course bottom (mm): 300 for the
     *  one-foot method, x for VDP upper courses; undefined for the VDP bottom
     *  course (dedicated first-course equation) */
    designPointMm?: number;
    tDesign: number;
    tTest: number;
    tMinCode: number;
    tNominal: number;
    material: string;
  }[];
  bottomThk: number;
  annularThk: number;
  /** annular ring width actually used in the bottom weight, mm */
  annularRingWidthMm: number;
  roofThk: number;
  /** cone-roof slope run N (plate slope 1:N) used for the deck area factor */
  roofSlopeRun: number;
  shellWeightKg: number;
  bottomWeightKg: number;
  roofWeightKg: number;
  /** floating-roof seal assembly mass (kg) — primary + secondary, 0 for fixed roofs */
  sealWeightKg: number;
  windGirderRequired: boolean;
  /** shell compressive stress from wind overturning moment (MPa) */
  windGirderStressMPa: number;
  anchorBoltAreaMm2: number;
  volumeM3: number;
  hydroWaterKg: number;
  testPressureBar: number;
}

/** Tube-vibration screening result (per unsupported span between baffles). */
export interface TubeVibCalc {
  /** Unsupported span, baffle spacing (m) */
  spanM: number;
  /** Tube first natural frequency, pinned-pinned with added mass (Hz) */
  naturalHz: number;
  /** Maximum shell crossflow velocity (m/s) */
  velocityMs: number;
  /** Connors critical velocity (m/s) */
  criticalMs: number;
  /** V/Vcr fluid-elastic instability ratio (screen limit 0.8) */
  feiRatio: number;
  /** Vortex shedding frequency (Hz) */
  shedHz: number;
  /** Shedding / natural frequency ratio */
  shedRatio: number;
  /** Acoustic mode frequency (Hz), null when no speed of sound supplied */
  acousticHz: number | null;
  /** Acoustic Mach number, null when no speed of sound supplied */
  mach: number | null;
}

/** Shell-side Bell–Delaware rating + Kern ΔP + vibration screening. */
export interface ShellSideCalc {
  reynolds: number;
  prandtl: number;
  /** Crossflow velocity at bundle face (m/s) */
  crossVelocityMs: number;
  /** Maximum velocity through the tube gap (m/s) */
  maxVelocityMs: number;
  /** Ideal-bank (ESDU 73031) film coefficient (W/m²K) */
  hIdeal: number;
  /** Bell-corrected shell-side film coefficient (W/m²K) */
  hShell: number;
  /** Bell correction factors */
  jC: number;
  jL: number;
  jB: number;
  jR: number;
  /** Shell-side bundle ΔP (bar, Kern equivalent-diameter method) */
  dPBar: number;
  /** Bundle bypass flow fraction (shell-to-bundle gap / crossflow area) */
  bypassFraction: number;
  /** Ligament (crossflow tube fraction) correction input */
  crossflowTubes: number;
  vibration: TubeVibCalc | null;
}

export interface HXCalc {
  shellOD: number;
  shellID: number;
  tubeCountActual: number;
  bundleOD: number;
  tubeSheetThk: number;
  /** Tubesheet face cladding weight (kg, both faces) */
  tubeSheetCladKg: number;
  baffleCount: number;
  baffledLength: number;
  bundleWeightKg: number;
  tubeWeightKg: number;
  tubeSideDP: number; // bar
  shellSideDP: number; // bar
  tubeSideVelocity: number;
  lmtd: number;
  requiredArea: number;
  providedArea: number;
  areaOK: boolean;
  expansionJointSuggested: boolean;
  saddleSpan: number;
  weightOperatingKg: number;
  nozzleOK: boolean;
  /** Present when shell-side flow data was supplied */
  shellSide?: ShellSideCalc;
}

export interface FinFanCalc {
  tubesPerRow: number;
  tubeCountActual: number;
  bundleWidth: number;
  faceAreaM2: number;
  finnedAreaM2: number;
  airFlowCMH: number;
  airDPH2O: number; // total incl plenum
  fanBHP: number;
  fanKW: number;
  airTempRise: number;
  thermalOK: boolean;
  weightBundleKg: number;
  weightOperatingKg: number;
  rowsOK: boolean;
  /** air density at the site elevation (kg/m³, ISA) */
  airDensity: number;
  /** fan diameter used (mm) — the entered one, or the auto ≥40 % coverage size */
  fanDiaMm: number;
  /** fan plan area / bundle face area */
  fanCoveragePct: number;
  /** air face velocity across the bundle (m/s) */
  faceVelMs: number;
  /** (available kW / duty − 1) × 100 — negative means the AF-03 shortfall */
  thermalMarginPct: number;
}

export interface BOMItem {
  id: string;
  equipId: string;
  tag: string;
  category: 'Plate' | 'Pipe' | 'Fitting' | 'Flange' | 'Bolting' | 'Gasket' | 'Internals' | 'Structural' | 'Consumable' | 'Service' | 'Other';
  item: string;
  spec: string;
  material: string;
  qty: number;
  unit: 'kg' | 'ea' | 'm' | 'm²' | 'L';
  unitMassKg?: number;
  massKg: number;
  plateReq?: { w: number; l: number; thk: number }; // for plate nesting
  note?: string;
}

export interface EquipmentCalc {
  equip: Equipment;
  codeRef: string;
  /** access steelwork checks (ladders/platforms/stairs) — computed, not stored on the tag */
  access?: import('./accessCheck').AccessCheckResult;
  /** External-pressure stiffening-ring check, when the vessel sees vacuum/external pressure */
  ring?: StiffenerRingResult;
  /** VIII-2 Part 5 primary-stress screen, when design-by-analysis is selected */
  designMargin?: DesignMarginCalc;
  mawpBar: number;
  mawpNote: string;
  /** Cladding/lining summary (vessels & columns) */
  clad?: {
    weightKg: number;
    areaM2: number;
    materialKey: string;
    materialName: string;
    coverageLengthMm: number;
    /** weld-overlay layer split (base run + finish layer); absent for bonded/liner clad */
    overlay?: {
      baseMatKey: string;
      baseMatName: string;
      baseThkMm: number;
      finishThkMm: number;
      baseWeightKg: number;
      finishWeightKg: number;
      totalThkMm: number;
      /** furnace (post-overlay) heat treatment suggested by the engine */
      furnaceSuggested: boolean;
      basis: string;
    };
  };
  sections: SectionCalc[];
  nozzles: NozzleCalc[];
  hydroTestBar: number; // at top of vessel
  hydroTestBottomBar: number; // incl. static head
  weightDryKg: number;
  weightHydroKg: number;
  weightOperatingKg: number;
  internalVolumeM3: number;
  paintAreaM2: number;
  weldLengthM: number;
  membraneUtil: number; // governing internal-pressure utilization (for stress view)
  weldEfficiency: number;
  pwht: PwhtAdvice;
  warnings: Warning[];
  bolts?: BoltCalc;
  saddle?: SaddleCalc;
  /** per-kind support breakdown (legs/saddles/skirt/ring/base ring/padeyes/guylines) */
  supports?: SupportCalc;
  tank?: TankCalc;
  hx?: HXCalc;
  finfan?: FinFanCalc;
  materialName: string;
  sAllow: number; // MPa at design temp
}
