// Geometry descriptors for the 3D viewer's non-vessel equipment.
//
// The viewer used to build every tag from `calc.sections`, which is the ASME
// pressure boundary: an API 650 tank came out as a bare cylinder with no roof
// or floor, and an API 661 air cooler came out as a 1.2 m shell because its
// "sections" are only the header shells. The two builders below turn the
// engine results into the parts that actually exist on site — stacked shell
// courses, a roof with the designed slope, an annular ring, wind girders, a
// spiral stair; or bays, finned bundles, headers, plenum and fans.
//
// Pure functions (no three.js), so every placement rule is unit-tested and the
// viewer, the part list and any future export all read one description.

import type { Equipment, EquipmentCalc } from './types';
import { fmt } from './units';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// API 650 storage tank
// ---------------------------------------------------------------------------

export interface TankCourseModel {
  /** index from the BOTTOM course (0) upward */
  index: number;
  /** absolute Y of the course bottom / top (mm, Y = 0 is grade) */
  y0: number;
  y1: number;
  heightMm: number;
  thicknessMm: number;
  material: string;
  /** max(tDesign, tTest) / tNominal — the colour datum in heatmap mode */
  utilization: number;
}

export interface TankModel {
  diameterMm: number;
  radiusMm: number;
  /** bottom plates (API 650 §5.5.1) */
  bottomPlateThkMm: number;
  /** annular ring included, and its width */
  annularRingMm: number;
  /** absolute Y of the shell bottom (top face of the bottom plate) */
  shellBaseY: number;
  courses: TankCourseModel[];
  /** absolute Y of the top of the last course */
  shellTopY: number;
  roof: {
    kind: 'cone' | 'dome' | 'none';
    /** plate thickness used for the deck */
    thicknessMm: number;
    /** rim (shell top) and apex elevations, mm */
    rimY: number;
    apexY: number;
    riseMm: number;
  };
  /** floating-roof deck elevation (internal / external floating roof), if any */
  floatingDeckY: number | null;
  /** design liquid level, filled surface (mm, absolute Y) */
  liquidY: number | null;
  /** level the fill comes from, above the shell bottom (mm) */
  levelMm: number;
  windGirdersY: number[];
  stair: { radiusMm: number; riseMm: number; stepAngleDeg: number; steps: number; topY: number } | null;
  /** overall model height including the roof rise */
  overallHeightMm: number;
}

/**
 * Tank geometry from the API 650 results: courses are stacked from the bottom
 * plate upward in engine order (course 0 = bottom), so the thickness bands the
 * viewer colours are the courses that were actually sized.
 */
export function tankModel(equip: Equipment, calc: EquipmentCalc): TankModel | null {
  const t = calc.tank;
  const tankSpec = equip.tank;
  if (!t || !tankSpec) return null;
  const diameterMm = calc.sections[0]?.spec.dia ?? equip.sections[0]?.dia ?? 0;
  if (!(diameterMm > 0)) return null;

  const radiusMm = diameterMm / 2;
  const bottomPlateThkMm = Math.max(6, t.bottomThk || 6);
  const shellBaseY = bottomPlateThkMm;

  let y = shellBaseY;
  const courses: TankCourseModel[] = t.shellCourses.map((c, i) => {
    const heightMm = Math.max(1, c.heightMm);
    const y0 = y;
    y += heightMm;
    const util = Math.min(1, Math.max(c.tDesign, c.tTest) / Math.max(0.1, c.tNominal));
    return {
      index: i,
      y0,
      y1: y,
      heightMm,
      thicknessMm: c.tNominal,
      material: c.material,
      utilization: util,
    };
  });
  const shellTopY = y;
  const shellH = shellTopY - shellBaseY;

  // Roof: a cone at the designed 1:N slope, a shallow spherical dome, or open
  // top for an external floating roof. An internal floating roof still sits
  // under a fixed (cone) roof, which is how it is built.
  const roofType = tankSpec.roofType;
  const fixedRoof = roofType === 'cone' || roofType === 'dome' || roofType === 'internalFloating';
  const slopeRun = t.roofSlopeRun > 0 ? t.roofSlopeRun : 16;
  const kind: TankModel['roof']['kind'] = !fixedRoof ? 'none' : roofType === 'dome' ? 'dome' : 'cone';
  const riseMm = kind === 'cone' ? radiusMm / slopeRun : kind === 'dome' ? radiusMm * 0.25 : 0;

  // Design liquid level (falls back to the shell height, as the engine does).
  const levelRaw = tankSpec.maxDesignLiquidLevel > 0 ? tankSpec.maxDesignLiquidLevel : shellH;
  const levelMm = clamp(levelRaw, 0, shellH);
  const liquidY = levelMm > 0 ? shellBaseY + levelMm : null;

  const floating = roofType === 'externalFloating' || roofType === 'internalFloating';
  const floatingDeckY = floating ? (liquidY ?? shellTopY - 500) : null;

  // Wind girders: the top girder plus intermediate ones on a tall shell.
  const windGirdersY: number[] = [];
  if (t.windGirderRequired || tankSpec.stiffenerRings || roofType === 'externalFloating') {
    const n = Math.max(1, Math.ceil(shellH / 6000));
    for (let i = 0; i < n; i++) {
      windGirdersY.push(clamp(shellTopY - 500 - i * (shellH / n), shellBaseY + 400, shellTopY - 250));
    }
  }

  const stair =
    shellH >= 4000
      ? {
          radiusMm: radiusMm + Math.max(600, radiusMm * 0.08),
          riseMm: 220,
          stepAngleDeg: 10,
          steps: Math.min(150, Math.ceil(shellH / 220)),
          topY: shellTopY,
        }
      : null;

  return {
    diameterMm,
    radiusMm,
    bottomPlateThkMm,
    annularRingMm: tankSpec.annularBottom ? Math.max(600, t.annularRingWidthMm || 600) : 0,
    shellBaseY,
    courses,
    shellTopY,
    roof: { kind, thicknessMm: Math.max(5, t.roofThk || 5), rimY: shellTopY, apexY: shellTopY + riseMm, riseMm },
    floatingDeckY,
    liquidY,
    levelMm,
    windGirdersY,
    stair,
    overallHeightMm: shellTopY + riseMm,
  };
}

// ---------------------------------------------------------------------------
// API 661 air-cooled heat exchanger
// ---------------------------------------------------------------------------

export interface FinFanModel {
  bays: number;
  rows: number;
  arrangement: 'induced' | 'forced' | 'vapor';
  /** finned tube length (mm) — the X extent of each bay */
  tubeLengthMm: number;
  /** row pitch across the air path (mm) */
  pitchMm: number;
  tubeODMm: number;
  finODMm: number;
  /** one row of fins, as drawn (depth across the air flow, mm) */
  bankDepthMm: number;
  /** height of the tube bank (rows × pitch), mm */
  bundleHeightMm: number;
  headerDiaMm: number;
  plenumHeightMm: number;
  legHeightMm: number;
  fanDiaMm: number;
  /** fan hub elevation (mm) — below the plenum when forced, above it when induced */
  fanY: number;
  plenumBottomY: number;
  plenumTopY: number;
  bundleBottomY: number;
  bundleTopY: number;
  /** Z centre of each bay (bays are side by side across the tube rows) */
  bayCentersZ: number[];
  bayDepthMm: number;
  /** total model depth in Z */
  totalDepthMm: number;
  overallHeightMm: number;
  tubesPerRow: number;
  tubeCount: number;
  /** engines report air flow and fan power — shown as labels on the model */
  airFlowCMH: number;
  fanKW: number;
}

export function finFanModel(equip: Equipment, calc: EquipmentCalc): FinFanModel | null {
  const ff = equip.finfan;
  const ffc = calc.finfan;
  if (!ff || !ffc) return null;

  const bays = Math.max(1, Math.round(ff.bays || 1));
  const rows = Math.max(3, Math.round(ff.rows || 4));
  const tubeLengthMm = Math.max(1000, ff.tubeLength);
  const pitchMm = Math.max(60, ff.tubeOD * 2.2);
  const finODMm = Math.max(ff.tubeOD, ff.finOD);
  const bundleHeightMm = rows * Math.max(pitchMm, finODMm + 12);
  const headerDiaMm = clamp(rows * pitchMm * 0.5, 300, 1800);
  const fanDiaMm = ffc.fanDiaMm > 0 ? ffc.fanDiaMm : clamp(bundleHeightMm * 2.5, 1200, 6000);
  const bankDepthMm = clamp(fanDiaMm * 1.15, bundleHeightMm, 6000);
  const bayDepthMm = bankDepthMm + 500;
  const bayGapMm = 600;
  const bayCentersZ = Array.from({ length: bays }, (_, i) => (i - (bays - 1) / 2) * (bayDepthMm + bayGapMm));
  const plenumHeightMm = clamp(tubeLengthMm * 0.18, 900, 2600);
  const legHeightMm = 1800;

  const induced = ff.arrangement !== 'forced';
  const plenumBottomY = induced ? legHeightMm + bundleHeightMm : legHeightMm;
  const plenumTopY = plenumBottomY + plenumHeightMm;
  const bundleBottomY = induced ? legHeightMm : plenumTopY;
  const bundleTopY = bundleBottomY + bundleHeightMm;
  const fanY = induced ? plenumTopY + fanDiaMm * 0.12 + 250 : Math.max(400, legHeightMm - 700);

  return {
    bays,
    rows,
    arrangement: ff.arrangement,
    tubeLengthMm,
    pitchMm,
    tubeODMm: ff.tubeOD,
    finODMm,
    bankDepthMm,
    bundleHeightMm,
    headerDiaMm,
    plenumHeightMm,
    legHeightMm,
    fanDiaMm,
    fanY,
    plenumBottomY,
    plenumTopY,
    bundleBottomY,
    bundleTopY,
    bayCentersZ,
    bayDepthMm,
    totalDepthMm: bays * bayDepthMm + (bays - 1) * bayGapMm,
    overallHeightMm: (induced ? plenumTopY + fanDiaMm * 0.24 + 500 : bundleTopY + 300),
    tubesPerRow: ffc.tubesPerRow,
    tubeCount: ffc.tubeCountActual,
    airFlowCMH: ffc.airFlowCMH,
    fanKW: ffc.fanKW,
  };
}

// ---------------------------------------------------------------------------
// Part list shown beside the model
// ---------------------------------------------------------------------------

export interface PartRow {
  label: string;
  value: string;
  note?: string;
  tone?: 'ok' | 'warn' | 'err';
}

export interface ModelSummary {
  title: string;
  subtitle: string;
  rows: PartRow[];
}

const toneOf = (util: number): PartRow['tone'] => (util > 1 ? 'err' : util > 0.9 ? 'warn' : 'ok');

/**
 * Human-readable model breakdown. This is deliberately built from the same
 * numbers the viewer draws, so the panel can never disagree with the picture
 * (it previously showed only diameter × length, which is meaningless for a
 * tank or an air cooler).
 */
export function viewerSummary(equip: Equipment, calc: EquipmentCalc): ModelSummary {
  const rows: PartRow[] = [];
  const nozzles = calc.nozzles;
  const failedNozzles = nozzles.filter((n) => !n.reinforceOK).length;

  if (equip.equipType === 'tank') {
    const tm = tankModel(equip, calc);
    const t = calc.tank;
    if (tm && t) {
      t.shellCourses.forEach((c, i) => {
        const util = Math.max(c.tDesign, c.tTest) / Math.max(0.1, c.tNominal);
        rows.push({
          label: `Shell course ${i + 1}${i === 0 ? ' (bottom)' : ''}`,
          value: `t ${c.tNominal.toFixed(1)} mm · ${c.material}`,
          note: `head ${c.designHeadM.toFixed(2)} m · util ${(Math.min(1, util) * 100).toFixed(0)}%${
            c.tNominal > 0 ? ` · ${((Math.max(c.tDesign, c.tTest) / c.tNominal) * 100).toFixed(0)}% of plate` : ''
          }`,
          tone: toneOf(util),
        });
      });
      rows.push({
        label: 'Bottom',
        value: `${t.bottomThk.toFixed(1)} mm plate${tm.annularRingMm > 0 ? ` · ${tm.annularRingMm} mm annular ring @ ${t.annularThk.toFixed(1)} mm` : ''}`,
        note: `API 650 §5.5 · floor Ø${fmt(tm.diameterMm, 0)} mm`,
      });
      rows.push({
        label: 'Roof',
        value:
          tm.roof.kind === 'none'
            ? 'Open top (external floating roof)'
            : `${tm.roof.kind === 'dome' ? 'Dome' : 'Cone'} roof · rise ${Math.round(tm.roof.riseMm)} mm · ${tm.roof.thicknessMm.toFixed(1)} mm`,
        note:
          equip.tank?.roofType === 'internalFloating'
            ? 'Internal floating roof with primary seal under the fixed roof'
            : `slope 1:${t.roofSlopeRun} · ${fmt(calc.internalVolumeM3, 0)} m³ working volume`,
      });
      if (tm.liquidY !== null) {
        rows.push({
          label: 'Design liquid level',
          value: `${fmt(tm.levelMm, 0)} mm above the shell bottom`,
          note: `${equip.tank?.fluidName || 'product'} · SG ${equip.tank?.specificGravity ?? 1} · hydrotest ${t.hydroWaterKg > 0 ? `${fmt(t.hydroWaterKg / 1000, 1)} t water` : '—'}`,
        });
      }
      rows.push({
        label: 'Wind girders',
        value: tm.windGirdersY.length ? `${tm.windGirdersY.length} girder${tm.windGirdersY.length === 1 ? '' : 's'}` : 'Not required',
        note: `shell compressive stress ${t.windGirderStressMPa.toFixed(1)} MPa`,
        tone: t.windGirderRequired && !equip.tank?.stiffenerRings ? 'warn' : 'ok',
      });
    }
    rows.push({
      label: 'Nozzles / manways',
      value: `${nozzles.length}${nozzles.length ? ` · ${failedNozzles} need attention` : ''}`,
      note: nozzles.length ? nozzles.map((n) => `${n.spec.tag} Ø${n.spec.dn}`).join(' · ') : 'None entered',
      tone: failedNozzles ? 'err' : 'ok',
    });
    return {
      title: `${equip.tag || 'Tank'} — API 650 storage tank`,
      subtitle: `Ø${fmt(tm?.diameterMm ?? 0, 0)} mm × ${fmt((tm?.shellTopY ?? 0) - (tm?.shellBaseY ?? 0), 0)} mm shell · ${calc.tank?.shellMethod === 'vdp' ? 'variable design point' : 'one-foot'} method`,
      rows,
    };
  }

  if (equip.equipType === 'finfan') {
    const fm = finFanModel(equip, calc);
    const f = calc.finfan;
    if (fm && f) {
      rows.push({
        label: 'Bundle',
        value: `${fm.bays} bay${fm.bays === 1 ? '' : 's'} × ${fm.rows} rows · ${fmt(fm.tubeLengthMm, 0)} mm finned length`,
        note: `${fmt(f.tubeCountActual, 0)} tubes · ${fmt(f.finnedAreaM2, 0)} m² finned area · ${fmt(f.faceAreaM2, 1)} m² face`,
      });
      rows.push({
        label: 'Fan',
        value: `Ø${fmt(fm.fanDiaMm, 0)} mm × ${fm.bays} · ${f.fanKW.toFixed(1)} kW shaft`,
        note: `${f.fanCoveragePct.toFixed(0)}% of the bay face (API 661 wants ≥ 40%)`,
        tone: f.fanCoveragePct < 40 - 1e-9 ? 'warn' : 'ok',
      });
      rows.push({
        label: 'Air side',
        value: `${fmt(f.airFlowCMH, 0)} m³/h · ${f.faceVelMs.toFixed(1)} m/s face velocity`,
        note: `ΔP ${f.airDPH2O.toFixed(2)} in H₂O · ρ ${f.airDensity.toFixed(3)} kg/m³ · rise ${f.airTempRise} °C`,
        tone: f.faceVelMs > 6 ? 'warn' : 'ok',
      });
      rows.push({
        label: 'Thermal',
        value: f.thermalOK ? `Duty met (margin ${f.thermalMarginPct.toFixed(0)}%)` : 'Shortfall — see AF-03',
        note: `${fmt(equip.finfan?.dutyKW ?? 0, 0)} kW duty · ${equip.finfan?.processInC ?? 0} → ${equip.finfan?.processOutC ?? 0} °C`,
        tone: f.thermalOK ? 'ok' : 'err',
      });
      rows.push({
        label: 'Weight',
        value: `${fmt(f.weightOperatingKg, 0)} kg operating`,
        note: `bundle ${fmt(f.weightBundleKg, 0)} kg · arrangement ${fm.arrangement}`,
      });
    }
    return {
      title: `${equip.tag || 'Air cooler'} — API 661 air cooler`,
      subtitle: `${fm?.bays ?? 0} bay · ${fm?.rows ?? 0} rows · Ø${fmt(fm?.fanDiaMm ?? 0, 0)} mm fans`,
      rows,
    };
  }

  // Vessels, columns and shell-and-tube exchangers share the ASME boundary.
  calc.sections.forEach((sc, i) => {
    const cone = sc.cone ? ` + Ø${fmt(sc.cone.D2, 0)} cone` : '';
    rows.push({
      label: `Shell course ${i + 1}${cone}`,
      value: `Ø${fmt(sc.spec.dia, 0)} × ${fmt(sc.spec.ttLength, 0)} mm · t ${sc.tNominal.toFixed(1)} mm`,
      note: `${sc.governing} governs · util ${(sc.utilization * 100).toFixed(0)}%`,
      tone: toneOf(sc.utilization),
    });
  });
  const headRow = (name: string, h?: { type: string; tNominal?: number; tMinNominal?: number }) => {
    if (!h || h.type === 'none') return;
    const t = (h.tNominal ?? h.tMinNominal ?? 0) as number;
    const label = h.type === 'ellip2' ? '2:1 ellipsoidal' : h.type === 'hemi' ? 'hemispherical' : 'torispherical';
    rows.push({ label: name, value: `${label} · t ${t.toFixed(1)} mm` });
  };
  const first = calc.sections[0];
  const last = calc.sections[calc.sections.length - 1];
  headRow('Bottom head', first?.headBot);
  headRow('Top head', last?.headTop);
  if (calc.supports?.items.length) {
    rows.push({
      label: 'Supports',
      value: calc.supports.items.map((it) => `${it.label} × ${it.count}`).join(' · '),
      note: `${fmt(calc.supports.totalWeightKg, 0)} kg · ${fmt(calc.supports.totalHours, 0)} h`,
    });
  }
  if (equip.internals.length) {
    rows.push({
      label: 'Internals',
      value: `${equip.internals.reduce((n, i) => n + i.count, 0)} item${equip.internals.reduce((n, i) => n + i.count, 0) === 1 ? '' : 's'}`,
      note: equip.internals.map((i) => `${i.count} × ${i.kind.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(' · '),
    });
  }
  if (calc.hx) {
    rows.push({
      label: 'Tubes',
      value: `${fmt(calc.hx.tubeCountActual, 0)} × Ø${equip.hx?.tubeOD ?? 0} × ${equip.hx?.tubeWall ?? 0} mm`,
      note: `${calc.hx.baffleCount} baffles · TEMA ${equip.hx?.temaType ?? '—'} · ${fmt(equip.hx?.dutyKW ?? 0, 0)} kW`,
    });
  }
  rows.push({
    label: 'Nozzles',
    value: `${nozzles.length}${nozzles.length ? ` · ${failedNozzles} failing reinforcement` : ''}`,
    note: nozzles.length ? nozzles.map((n) => `${n.spec.tag} Ø${n.spec.dn}`).join(' · ') : 'None entered',
    tone: failedNozzles ? 'err' : 'ok',
  });

  const words = equip.equipType === 'column' ? 'column' : equip.equipType === 'hx' ? 'shell & tube exchanger' : 'pressure vessel';
  return {
    title: `${equip.tag || 'Vessel'} — ${words}`,
    subtitle: `${equip.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'} · MAWP ${fmt(calc.mawpBar, 2)} bar g · dry ${fmt(calc.weightDryKg, 0)} kg`,
    rows,
  };
}
