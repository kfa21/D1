// TEMA (R.C.B) shell & tube exchanger engine — tube count, bundle layout,
// tubesheet thickness (TEMA RCB-7.131 / RCB-7.132), baffle geometry, thermal
// area with LMTD + correction factor, expansion joint advisory, weights, saddles.

import type { Equipment, EquipmentCalc, HXCalc, Warning } from './types';
import { allowableAt, getMat } from './materials';
import { computeVessel } from './asme';
import { mpaToPsi } from './units';

export const SHELL_ODS = [
  168.3, 219.1, 273.1, 323.9, 355.6, 406.4, 457, 508, 610, 711, 813, 914, 1016, 1118, 1219, 1422, 1626, 1829, 2032,
];

const in_ = (mm: number) => mm / 25.4;
const psi = (bar: number) => bar * 14.5037738;
const mm = (inch: number) => inch * 25.4;

/** Triangular/square pitch layout: bundle OD from tube count */
export function bundleOD(tubeCount: number, pitch: number, angle: number): number {
  const n = Math.max(1, tubeCount);
  if (angle === 90) {
    const side = pitch * Math.ceil(Math.sqrt(n));
    return side + pitch;
  }
  // triangular: n ≈ 0.9069 (D/p)² → iterate
  let lo = pitch,
    hi = pitch * 400;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const capacity = Math.floor(0.9069 * Math.pow(mid / pitch, 2));
    if (capacity < n) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Max tubes in a bundle OD */
export function maxTubes(bundleDia: number, pitch: number, angle: number): number {
  if (angle === 90) {
    const side = bundleDia - pitch;
    return Math.floor(side / pitch) * Math.floor(side / pitch);
  }
  return Math.max(1, Math.floor(0.9069 * Math.pow(bundleDia / pitch, 2)));
}

/**
 * LMTD + correction factor F for 1-2 (or n-pass) exchanger — Bowman 1-2 shell formula.
 * R = shell-side temperature drop / tube-side rise; P = tube-side rise / available drop.
 * Returns F = 0 when the arrangement has a temperature cross (F undefined) so the
 * caller raises an error instead of sizing on a wrong factor.
 */
export function lmtdCorrected(
  t1h: number, t2h: number, t1c: number, t2c: number, passes: number
): { lmtd: number; F: number } {
  const d1 = t1h - t1c;
  const d2 = t2h - t2c;
  let lmtd = 0;
  if (Math.abs(d1 - d2) < 1e-6) lmtd = d1;
  else if (d1 <= 0 || d2 <= 0) lmtd = Math.max(1, (d1 + d2) / 2); // flagged via F below
  else lmtd = (d1 - d2) / Math.log(d1 / d2);
  if (passes <= 1) return { lmtd, F: 1 };

  const R = (t1h - t2h) / Math.max(1e-6, t2c - t1c);
  const P = (t2c - t1c) / Math.max(1e-6, t1h - t1c);
  // Temperature cross / no driving force — F is not defined
  if (P <= 0 || R <= 0 || P >= 1 || R * P >= 1) return { lmtd, F: 0 };

  const sq = Math.sqrt(R * R + 1);
  let F: number;
  if (Math.abs(R - 1) < 1e-3) {
    // R → 1 limit (L'Hôpital on the general expression)
    F = (Math.SQRT2 * P) / ((1 - P) * Math.log((2 - P * (2 - Math.SQRT2)) / (2 - P * (2 + Math.SQRT2))));
  } else {
    const num = sq * Math.log((1 - P) / (1 - R * P));
    const den = (R - 1) * Math.log((2 - P * (R + 1 - sq)) / (2 - P * (R + 1 + sq)));
    F = num / den;
  }
  if (!isFinite(F) || F <= 0) F = 0;
  return { lmtd, F: Math.min(1, F) };
}

/** TEMA RCB-7.131 fixed tubesheet thickness (returns mm). S in MPa, P in bar. */
export function fixedTubeSheetThickness(
  gDiaMm: number, bMm: number, pBar: number, sMpa: number, fE: number, cMm: number
): number {
  const G = in_(gDiaMm);
  const G1 = in_(Math.max(10, gDiaMm - bMm));
  const P = psi(pBar); // bar → psi
  const S = mpaToPsi(sMpa); // MPa → psi (was psi(sMpa): bar→psi on an MPa value, 10× understress)
  const t = Math.sqrt((fE * P * G * G) / (16 * Math.max(1, S) * G1)) + in_(cMm);
  return mm(t);
}

/** TEMA RCB-7.132 removable tubesheet (blown/flanged head action). S in MPa, P in bar. */
export function removableTubeSheetThickness(dnMm: number, pBar: number, sMpa: number): number {
  const dN = in_(dnMm);
  const P = psi(pBar);
  const S = Math.min(mpaToPsi(sMpa), 12900); // MPa → psi, TEMA cap
  return mm(0.319 * dN * Math.sqrt(P / Math.max(1, S)));
}

export function computeHX(equip: Equipment): EquipmentCalc {
  const warnings: Warning[] = [];
  const hx = equip.hx!;
  const base = computeVessel(equip); // nozzle/flange checks via generic path
  warnings.push(...base.warnings.filter((w) => !w.code.startsWith('NZ') && w.code !== 'MW-01'));

  const Psh = hx.designPShell;
  const Tsh = hx.designTShell;
  const Ssh = allowableAt(hx.shellMatKey, Tsh);
  const Sto = allowableAt(hx.tubeMatKey, hx.designTTube);
  const Ptu = hx.designPTube;
  // All four material records are resolved exactly once: tubeMat is the PIPE-form tube grade
  // (SA-179, SA-213-T3/T7/T9, SA-780 …) — never a plate fallback; tsMat/shellMat/headMat are the
  // plate grades. Tube weight, allowable stress and density all read from tubeMat below.
  const tubeMat = getMat(hx.tubeMatKey);
  const tsMat = getMat(hx.tsMatKey);
  const shellMat = getMat(hx.shellMatKey);
  const headMat = getMat(hx.headMatKey);
  if (tubeMat.form !== 'pipe') {
    warnings.push({
      level: 'warning',
      code: 'HX-10',
      msg: `Tube material "${tubeMat.key}" is a ${tubeMat.form} entry — exchanger tubes require a tube-grade material (form 'pipe', e.g. SA-179, SA-213-T304). Re-select the tube material.`,
    });
  }

  const pTema = Math.max(Psh, Ptu);
  const tTema = Math.max(Tsh, hx.designTTube);
  const S_ts = allowableAt(hx.tsMatKey, tTema);

  const pitch = hx.pitch > 0 ? hx.pitch : hx.tubeOD * 1.25;
  const effLen = hx.tubeLength;

  // Thermal area & tube count
  const { lmtd, F } = lmtdCorrected(
    hx.tShellIn, hx.tShellOut, hx.tTubeIn, hx.tTubeOut, hx.passesTube
  );
  // F = 0 ⇔ temperature cross: F undefined, design infeasible as arranged
  const crossOK = F > 0;
  if (!crossOK) {
    warnings.push({
      level: 'error',
      code: 'HX-11',
      msg: `Temperature cross in the ${hx.passesTube === 1 ? '1-1' : `1-${hx.passesTube / 2}`} arrangement (R/P out of range) — LMTD correction F undefined; re-check temperatures or add shell passes`,
    });
  }
  const Fgeom = crossOK ? F : 1; // sizing fallback only; areaOK stays false on a cross
  const U = hx.uOverall > 0 ? hx.uOverall : 320;
  const Areq = (hx.dutyKW * 1000) / Math.max(1, U * Fgeom * lmtd);

  let n = hx.tubeCount;
  const perTubeArea = Math.PI * (hx.tubeOD / 1000) * (effLen / 1000);
  const nReq = Math.ceil(Areq / Math.max(1e-6, perTubeArea));

  // Auto shell OD: smallest shell whose 70% fill ≥ required tube count
  let shellOD = hx.shellDiaOD;
  if (shellOD <= 0) {
    for (const od of SHELL_ODS) {
      const shellID = od - 2 * (od > 600 ? 12 : od > 400 ? 10 : 8);
      const cap = maxTubes(shellID - 2 * pitch * 0.5, pitch, hx.layoutAngle);
      if (Math.floor(cap * 0.72) >= nReq) {
        shellOD = od;
        break;
      }
    }
    if (shellOD <= 0) shellOD = SHELL_ODS[SHELL_ODS.length - 1];
  }
  const wallSh = shellOD > 600 ? 14 : shellOD > 400 ? 12 : shellOD > 300 ? 10 : 8;
  const shellID = shellOD - 2 * wallSh;
  if (n <= 0) {
    const cap = maxTubes(shellID - 2 * pitch * 0.5, pitch, hx.layoutAngle);
    n = Math.max(1, Math.floor(Math.min(cap, Math.max(nReq, cap * 0.85))));
  }

  const bundleDia = bundleOD(n, pitch, hx.layoutAngle);
  const clearance = shellID - bundleDia;
  if (clearance < 10) {
    warnings.push({
      level: 'warning',
      code: 'HX-01',
      msg: `Bundle-shell clearance ${clearance.toFixed(0)} mm < 10 mm — increase shell OD or reduce tube count`,
    });
  }

  // TEMA minimum shell-wall advisory (RCB-7.21) and shell pressure thickness (UG-27)
  // t = P·R/(S − 0.6P) with P in MPa — the previous form multiplied by 10 instead of
  // dividing, overstating the required shell wall ten-fold.
  const Rsh = shellID / 2;
  const PmSh = Psh / 10; // bar → MPa
  const tShellReq = Psh > 0 ? (PmSh * Rsh) / Math.max(1, Ssh - 0.6 * PmSh) : 0;
  const tShellMin = Math.max(tShellReq + equip.corrosionAllowance, wallSh);
  const tShell = Math.max(wallSh, Math.ceil(tShellMin));

  // Tubesheet
  const isIntegral = ['BEM', 'AEM', 'NEN', 'BEU'].includes(hx.temaType);
  const fE = isIntegral ? 1.0 : 0.9;
  const gasketWidth = 16;
  const tFixed = fixedTubeSheetThickness(shellID, gasketWidth, pTema, S_ts, fE, equip.corrosionAllowance);
  const tRem = removableTubeSheetThickness(shellID, pTema, S_ts);
  const tsThk = Math.max(isIntegral ? tFixed : tRem, 25);

  // Tubesheet face cladding/overlay (corrosion barrier on both faces)
  const tsClad = hx.tubeSheetClad?.enabled && hx.tubeSheetClad.thicknessMm > 0 ? hx.tubeSheetClad : null;
  const tsCladMat = tsClad ? getMat(tsClad.materialKey) : null;
  const tsFaceAreaM2 = Math.PI / 4 * Math.pow(shellID / 1000, 2);
  const cladHoleFactor = Math.min(0.6, (n * Math.PI * Math.pow(hx.tubeOD + 1, 2)) / 4 / Math.max(1, (Math.PI / 4) * shellID * shellID));
  const tubeSheetCladKg = tsClad && tsCladMat
    ? 2 * tsFaceAreaM2 * (tsClad.thicknessMm / 1000) * tsCladMat.density * (1 - cladHoleFactor)
    : 0;
  if (tsClad && tsClad.thicknessMm >= tsThk * 0.5) {
    warnings.push({
      level: 'warning',
      code: 'HX-08',
      msg: `Tubesheet cladding ${tsClad.thicknessMm} mm is ≥ 50 % of tubesheet thickness (${tsThk} mm) — verify composite design and bonding (TEMA RC-2 / UG-34)`,
    });
  }

  // Tube-to-tubesheet joint
  const jointType = hx.tubeJointType ?? 'strengthWelded';
  const JOINT_LABEL: Record<string, string> = {
    expanded: 'Strength expanded (TEMA RC-3.26)',
    strengthWelded: 'Strength welded + tube expanded',
    sealWeldExpanded: 'Seal welded + strength expanded',
    fullyWelded: 'Fully welded (all positions, inner/outer)',
  };
  if (jointType !== 'expanded' && n > 0) {
    warnings.push({
      level: 'info',
      code: 'HX-09',
      msg: `${JOINT_LABEL[jointType]} — ${n} tube joints: plan MT/PT or He leak test of tube-to-tubesheet welds; UW-11 extent per service`,
    });
  }

  // Baffles
  const spacing = hx.baffleSpacing > 0 ? hx.baffleSpacing : Math.max(50, shellID * 0.2);
  const baffleCount = hx.baffleCount > 0 ? hx.baffleCount : Math.max(2, Math.floor(effLen / spacing) - 1);
  const baffledLen = effLen * 0.85;

  // Tube-side / shell-side ΔP guidance (flow data required for exact values)
  const rows = Math.max(1, Math.round(bundleDia / pitch / 2));
  const typicalTubeDP = 0.35; // bar guidance
  const typicalShellDP = 0.15 + rows * 0.03;

  // Expansion joint advisory (fixed TS + differential ΔT)
  const dTshell = (hx.tShellIn + hx.tShellOut) / 2;
  const dTtube = (hx.tTubeIn + hx.tTubeOut) / 2;
  const dL = (11.7e-6 * Math.abs(dTshell - dTtube) * effLen) / 1000 * 1000; // mm (steel α=11.7e-6)
  const expansionJointSuggested = isIntegral && dL > 3;

  // Weights (material records resolved once above: tubeMat/tsMat/shellMat/headMat)
  const tubeMassPerM =
    (Math.PI / 4) *
    (Math.pow(hx.tubeOD / 1000, 2) - Math.pow((hx.tubeOD - 2 * hx.tubeWall) / 1000, 2)) *
    tubeMat.density;
  const tubeWeight = n * tubeMassPerM * (effLen / 1000);
  const holeAreaFactor = Math.min(0.6, (n * Math.PI * Math.pow(hx.tubeOD + 1, 2)) / 4 / Math.max(1, (Math.PI / 4) * shellID * shellID));
  const tsWeight = 2 * ((Math.PI / 4) * Math.pow(shellID / 1000, 2) * (1 - holeAreaFactor) * (tsThk / 1000) * tsMat.density);
  const baffleWeight =
    baffleCount * (Math.PI / 4) * Math.pow(shellID / 1000, 2) * (1 - holeAreaFactor) * (6 / 1000) * 7850;
  const shellWeight = Math.PI * (shellOD / 1000) * (tShell / 1000) * ((effLen + 100) / 1000) * shellMat.density;
  // Heads: 2:1 SE per UG-32(e) — thickness from design P & head-material allowable;
  // weight = surface-area factor × D² × t. (Previously the head DEPTH was used as if
  // it were the plate thickness, overestimating each head several-fold.)
  const PmHead = pTema / 10; // MPa
  const Shead = allowableAt(hx.headMatKey, tTema);
  const tHeadReqMm = (PmHead * shellOD) / Math.max(1e-6, 2 * Shead - 0.2 * PmHead);
  const tHeadMm = Math.max(6, tHeadReqMm + equip.corrosionAllowance);
  const headWeight = 2 * 1.084 * Math.pow(shellOD / 1000, 2) * (tHeadMm / 1000) * headMat.density * 1.05;
  const bundleWeight = tubeWeight + tsWeight / 2 + tubeSheetCladKg / 2 + baffleWeight;

  // Saddles (TEMA: supports at 0.2 L from tangent)
  const saddleSpan = effLen * 0.6;
  const saddle = {
    reaction: 0,
    zickFc: 0,
    zickAllow: 0,
    maxSpan: 25 * (shellID / 2),
    ok: true,
  };

  const calc: HXCalc = {
    shellOD,
    shellID,
    tubeCountActual: n,
    bundleOD: bundleDia,
    tubeSheetThk: tsThk,
    tubeSheetCladKg,
    baffleCount,
    baffledLength: baffledLen,
    bundleWeightKg: bundleWeight,
    tubeWeightKg: tubeWeight,
    tubeSideDP: hx.tubeSideDP > 0 ? hx.tubeSideDP : typicalTubeDP,
    shellSideDP: typicalShellDP,
    tubeSideVelocity: 0,
    lmtd: lmtd * F,
    requiredArea: Areq,
    providedArea: n * perTubeArea,
    areaOK: crossOK && n * perTubeArea >= Areq,
    expansionJointSuggested,
    saddleSpan,
    weightOperatingKg: shellWeight + headWeight + tubeWeight + tsWeight + tubeSheetCladKg + baffleWeight + 600,
    nozzleOK: base.nozzles.every((nz) => nz.flangeClassOK),
  };

  if (!calc.areaOK) {
    warnings.push({
      level: 'error',
      code: 'HX-02',
      msg: `Provided area ${calc.providedArea.toFixed(1)} m² < required ${Areq.toFixed(1)} m² (U = ${U} W/m²K, F = ${F.toFixed(2)})`,
    });
  }
  if (crossOK && F < 0.75) {
    warnings.push({ level: 'warning', code: 'HX-03', msg: `LMTD correction factor F = ${F.toFixed(2)} < 0.75 — consider shell passes or temperature re-arrangement` });
  }
  if (base.nozzles.some((nz) => nz.spec.flangeClass > 600)) {
    warnings.push({
      level: 'info',
      code: 'FL-03',
      msg: 'Nozzle flange class above 600: B16.5 rating conservatively taken from the Class 600 table (high-class tables not held) — verify per B16.5',
    });
  }
  if (expansionJointSuggested) {
    warnings.push({ level: 'info', code: 'HX-04', msg: `Differential expansion ≈ ${dL.toFixed(1)} mm — expansion joint or floating head advised (fixed tubesheet)` });
  }
  warnings.push({ level: 'info', code: 'HX-05', msg: 'Pressure drops shown are typical guidance only — recheck with process flow data (TEMA RCB pressure-loss methods / Bell–Delaware)' });

  return {
    ...base,
    codeRef: 'TEMA R.C.B (tubesheet RCB-7.131/7.132, clearances, baffles) + ASME VIII-1 (UG-27 shell, UG-32 heads, UG-37 nozzles, UG-99 test)',
    hx: calc,
    mawpBar: Math.min(base.mawpBar, Psh, Ptu),
    mawpNote: `Shell ${Psh.toFixed(1)} bar @ ${Tsh} °C / Tube ${Ptu.toFixed(1)} bar @ ${hx.designTTube} °C; ${JOINT_LABEL[jointType]}${tsClad ? `; TS clad ${tsClad.materialKey} ${tsClad.thicknessMm} mm` : ''}; LMTD·F = ${(lmtd * F).toFixed(1)} °C, U = ${U} W/m²K`,
    weightDryKg: calc.weightOperatingKg * 0.92,
    weightHydroKg: calc.weightOperatingKg * 0.95 + tubeWeight * 0.2,
    weightOperatingKg: calc.weightOperatingKg,
    internalVolumeM3: (Math.PI / 4) * Math.pow(shellID / 1000, 2) * (effLen / 1000) * 0.7,
    paintAreaM2: Math.PI * (shellOD / 1000) * ((effLen + 400) / 1000),
    hydroTestBar: 1.3 * Math.min(Psh, Ptu) * 1.0,
    hydroTestBottomBar: 1.3 * Math.min(Psh, Ptu),
    membraneUtil: 1,
    saddle,
    warnings,
    materialName: shellMat.name,
    sAllow: Ssh,
  };
}
