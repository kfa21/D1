// API 661 air-cooled heat exchanger engine — bay/bundle geometry, finned area,
// air flow, air-side ΔP, fan brake power (BHP = Q·ΔP/(6356·η)), thermal check.
// Preliminary sizing aid; final rating per vendor/API 661 purchaser supplement.

import type { Equipment, EquipmentCalc, FinFanCalc, Warning } from './types';
import { getMat } from './materials';
import { computeVessel } from './asme';

const FT3_PER_M3 = 35.3147;
const G_PER_KG = 2.20462;

/** Air density at the site (ISA standard atmosphere, troposphere 0–11 km):
 *  ρ = 1.225·(1 − 2.25577e-5·h)^4.25587 kg/m³. Sea level = 1.225, 1000 m ≈ 1.112,
 *  2000 m ≈ 1.007 — replaces the old hard-coded 1.2 kg/m³. */
export function siteAirDensity(elevationM: number): number {
  const h = Math.min(11000, Math.max(0, Number.isFinite(elevationM) ? elevationM : 0));
  return 1.225 * Math.pow(1 - 2.25577e-5 * h, 4.25587);
}

export function computeFinFan(equip: Equipment): EquipmentCalc {
  const ff = equip.finfan!;
  const warnings: Warning[] = [];
  const base = computeVessel(equip);
  warnings.push(...base.warnings.filter((w) => w.code.startsWith('FL') || w.code.startsWith('MT')));

  const L = ff.tubeLength; // mm effective finned length
  const pitchT = Math.max(50, ff.tubeOD * 2.5); // transverse pitch (mm)
  const pitchL = Math.max(60, ff.tubeOD * 2.2); // longitudinal pitch

  // Tubes per row per bay, rows
  const tubesPerRowPerBay = Math.max(1, Math.floor(L / pitchT));
  const rows = Math.max(3, ff.rows);

  let tubesPerBay = tubesPerRowPerBay * rows;
  if (ff.tubeCount > 0) tubesPerBay = Math.max(rows, Math.round(ff.tubeCount / Math.max(1, ff.bays)));
  const tubeCount = tubesPerBay * ff.bays;

  // Geometry
  // Envelope across the bays: each bay spans the finned length + 200 mm of header
  const bundleWidth = ff.bays * (L + 200);
  const faceAreaPerBay = (L / 1000) * ((rows * pitchL) / 1000);
  const faceArea = faceAreaPerBay * ff.bays;

  // Finned area per tube (ring/L-foot fins)
  const finPitch_m = ff.finPitch * 39.371; // fins per metre
  const ringAreaPerM =
    (Math.PI / 4) * (Math.pow(ff.finOD / 1000, 2) - Math.pow(ff.tubeOD / 1000, 2)) * finPitch_m;
  const basePerM = Math.PI * (ff.tubeOD / 1000) * (1 - finPitch_m * (ff.finThk / 1000));
  const areaPerTube = (L / 1000) * (ringAreaPerM + Math.max(0, basePerM));
  const finnedArea = areaPerTube * tubeCount;

  // Thermal
  const dTlm =
    Math.abs(ff.processOutC - ff.processInC) < 1e-3
      ? 1
      : (() => {
          const airOut = ff.airInC + (ff.airRiseC > 0 ? ff.airRiseC : 15);
          const a = ff.processInC - airOut;
          const b = ff.processOutC - ff.airInC;
          if (a <= 0 || b <= 0) return Math.max(5, (a + b) / 2);
          return (a - b) / Math.log(a / b);
        })();
  const U = ff.uAir > 0 ? ff.uAir : 55; // W/m²K on external finned area (incl. fouling)
  const areaAvail = U * finnedArea * Math.abs(dTlm) / 1000; // kW
  const thermalOK = areaAvail >= ff.dutyKW;
  const airRise = ff.airRiseC > 0 ? ff.airRiseC : 15;

  // Air flow from duty: m_air = Q/(cp·ΔT); volume flow at the site density (ISA)
  const rho = siteAirDensity(ff.siteElevationM ?? 0);
  const cpAir = 1.006; // kJ/kg·K
  const mAirKgS = (ff.dutyKW * 1000) / (cpAir * Math.max(5, airRise));
  const airVolM3s = mAirKgS / rho; // kg/s → m³/s
  const airFlowCMH = airVolM3s * 3600;

  // Air velocity & ΔP (the row correlation is referenced to 1.2 kg/m³ air)
  const faceVel = airVolM3s / Math.max(0.1, faceArea); // m/s
  const rowsFactor = 0.12; // in H2O per row at 4 m/s baseline
  const bundleH2O = rows * rowsFactor * Math.pow(faceVel / 4, 1.6) * (rho / 1.2);
  const plenum = ff.plenumLossH2O > 0 ? ff.plenumLossH2O : 0.5;
  const airDPH2O = bundleH2O + plenum;

  // Fan power: BHP = Q(cfm)·ΔP(in H2O)/(6356·η)
  const qCfm = airVolM3s * 2118.88;
  const eta = ff.fanEfficiency > 0 && ff.fanEfficiency <= 1 ? ff.fanEfficiency : 0.65;
  const fanBHP = (qCfm * airDPH2O) / (6356 * eta);
  const fanKW = fanBHP * 0.7457;

  // Fan coverage ≥ 40% of the face area of the BAY the fan serves (API 661
  // guidance): auto-size when no fan diameter is entered, otherwise check the
  // entered one. Coverage and diameter are reported on the calc.
  const fanAreaMin = 0.4 * faceAreaPerBay;
  const autoFanDia = 1000 * Math.sqrt((4 * fanAreaMin) / Math.PI); // mm (area in m²)
  const fanDia = ff.fanDiaMm && ff.fanDiaMm > 0 ? ff.fanDiaMm : autoFanDia;
  const fanArea = (Math.PI / 4) * Math.pow(fanDia / 1000, 2);
  const fanCoveragePct = faceAreaPerBay > 0 ? (fanArea / faceAreaPerBay) * 100 : 0;

  if (faceVel > 6) {
    warnings.push({ level: 'warning', code: 'AF-01', msg: `Face velocity ${faceVel.toFixed(1)} m/s > 6 m/s — noise/erosion; increase face area` });
  }
  if (rows < 6 || rows > 9) {
    warnings.push({ level: 'info', code: 'AF-02', msg: `Rows = ${rows}; common API 661 practice is 6–9 rows per bank` });
  }
  if (!thermalOK) {
    warnings.push({ level: 'error', code: 'AF-03', msg: `Thermal shortfall: ${areaAvail.toFixed(0)} kW available < ${ff.dutyKW} kW duty (U = ${U} W/m²K)` });
  }
  warnings.push({ level: 'info', code: 'AF-04', msg: 'Confirm air ΔP with fan curve and fin/tube vendor rating (API 661 §7/§8)' });
  if (fanCoveragePct < 40 - 1e-9) {
    warnings.push({
      level: 'warning',
      code: 'AF-05',
      msg: `Fan Ø${fanDia.toFixed(0)} mm covers ${fanCoveragePct.toFixed(0)}% of the bay face area — below the 40% API 661 guidance; enlarge the fan Ø or reduce the face area`,
    });
  }
  const baysN = Math.max(1, ff.bays);
  const fanKwPerFan = fanKW / baysN;
  if (ff.motorKw && ff.motorKw > 0 && ff.motorKw < fanKwPerFan) {
    warnings.push({
      level: 'warning',
      code: 'AF-06',
      msg: `Fan motor ${ff.motorKw} kW < required ${fanKwPerFan.toFixed(1)} kW per fan (${fanKW.toFixed(1)} kW across ${baysN} bay${baysN === 1 ? '' : 's'}) — select a larger motor`,
    });
  }

  // Weights
  const tubeMassPerM =
    (Math.PI / 4) *
    (Math.pow(ff.tubeOD / 1000, 2) - Math.pow((ff.tubeOD - 2 * ff.tubeWall) / 1000, 2)) *
    getMat(ff.tubeMatKey).density;
  const tubeWeight = tubeCount * tubeMassPerM * (L / 1000);
  const finStripVolPerTube =
    (Math.PI / 4) * (Math.pow(ff.finOD / 1000, 2) - Math.pow(ff.tubeOD / 1000, 2)) * (ff.finThk / 1000) * finPitch_m * (L / 1000);
  const finWeight = tubeCount * finStripVolPerTube * getMat(ff.finMatKey).density;
  const headerVolumePerBay =
    2 * (Math.PI / 4) * Math.pow(ff.tubeOD / 1000, 2) * tubeCount * 0.15;
  const headerWeight = ff.bays * 2 * (L / 1000) * 0.5 * (ff.headerThk / 1000) * 7850 * 1.2;
  const structure = 0.08 * (tubeWeight + finWeight) + 400 * ff.bays;
  const weightBundle = tubeWeight + finWeight + headerWeight;
  const weightOperating = weightBundle + structure + ff.bays * 120; // fan+motor est.

  const calc: FinFanCalc = {
    tubesPerRow: tubesPerRowPerBay,
    tubeCountActual: tubeCount,
    bundleWidth,
    faceAreaM2: faceArea,
    finnedAreaM2: finnedArea,
    airFlowCMH,
    airDPH2O,
    fanBHP,
    fanKW,
    airTempRise: airRise,
    thermalOK,
    weightBundleKg: weightBundle,
    weightOperatingKg: weightOperating, // already includes structure — was double-counted
    rowsOK: rows >= 6 && rows <= 9,
    airDensity: rho,
    fanDiaMm: fanDia,
    fanCoveragePct,
    faceVelMs: faceVel,
    thermalMarginPct: ff.dutyKW > 0 ? (areaAvail / ff.dutyKW - 1) * 100 : 0,
  };

  return {
    ...base,
    codeRef: 'API 661 air-cooled heat exchangers (bay/bundle layout, fan coverage ≥40%, air-side ΔP) + ASME VIII-1 for pressure parts',
    finfan: calc,
    mawpBar: base.mawpBar,
    mawpNote: `Bundle/headers per API 661; finned area ${finnedArea.toFixed(0)} m², air ${airFlowCMH.toFixed(0)} m³/h, ΔP ${airDPH2O.toFixed(2)} in H₂O, fan ${fanKW.toFixed(1)} kW`,
    weightDryKg: weightOperating,
    weightHydroKg: weightOperating,
    weightOperatingKg: weightOperating,
    internalVolumeM3: ff.bays * (Math.PI / 4) * Math.pow(ff.tubeOD / 1000, 2) * (L / 1000) * tubesPerBay,
    paintAreaM2: structure / 45, // m² estimate for painting
    hydroTestBar: 1.3 * (equip.designPressure || 5),
    hydroTestBottomBar: 1.3 * (equip.designPressure || 5),
    membraneUtil: 1,
    warnings,
    materialName: getMat(ff.tubeMatKey).name,
    sAllow: 138,
  };
}
