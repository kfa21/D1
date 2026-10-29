// Support engineering: every support type gets its own weight / weld-length /
// man-hour calculation so each can be costed separately in the estimate and BOM.
// Also produces the structural-steelwork recommendation (skid, portal, pedestal,
// platform) for any tag — costed only when the user selects it.
// Norms are indicative shop-estimating starting points; all rates in Settings.

import type {
  Equipment,
  EquipmentCalc,
  StructureMember,
  StructureRecommendation,
  SupportCalc,
  SupportItemCalc,
} from './types';

const KG_PER_M3 = 7850;

/** Fabrication hours per kg of support steel (fit-up, welding, dressing) — indicative. */
const H_PER_KG = {
  legs: 0.055,
  legsAngle: 0.062,
  legsBeam: 0.05,
  saddle: 0.05,
  skirt: 0.04,
  skirtCone: 0.045,
  angleSkirt: 0.07,
  bodyAngleSkirt: 0.075,
  ring: 0.06,
  baseRing: 0.08,
  padeyes: 0.12,
  lifting: 0.11,
  transport: 0.05,
  guylines: 0.09,
};

/** Section masses used by the angle / beam support variants (kg/m). */
const ANGLE_KG_PER_M = { 50: 4.5, 75: 9.0, 100: 15.0, 120: 21.7 } as const;

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Compute every active support kind separately. `calc` must carry the dry weight
 * (used for anchor-bolt sizing and lifting-lug check).
 */
export function computeSupports(equip: Equipment, calc: EquipmentCalc): SupportCalc {
  const s = equip.support ?? { type: 'none' as const, legCount: 0, saddleSpan: 0, saddleAngle: 120, skirtH: 0, legPlateThk: 0 };
  const items: SupportItemCalc[] = [];
  const Dmm = equip.sections[0]?.dia ?? 1000;
  const Dm = Dmm / 1000;
  const dryKg = Math.max(1, calc.weightDryKg);
  const H = (k: SupportItemCalc['kind'], kg: number) => kg * H_PER_KG[k];

  // ---- primary support ----
  let anchorCount = 0;
  if (s.type === 'legs' || s.type === 'legsAngle' || s.type === 'legsBeam') {
    const n = Math.max(2, s.legCount || 4);
    const h = (s.skirtH > 0 ? s.skirtH : 800) / 1000; // m
    const t = Math.max(8, s.legPlateThk || 16); // mm
    const baseKg = 0.25 * 0.25 * 0.02 * KG_PER_M3; // base plate
    let kgEach: number;
    let weldLen: number;
    let label: string;
    let note: string;
    if (s.type === 'legsAngle') {
      // angle-section legs: two rolled angles back-to-back per leg (L 75×75×8 ≈ 9 kg/m)
      const angle = t >= 12 ? 100 : 75;
      const kgPerM = ANGLE_KG_PER_M[angle as 75 | 100];
      kgEach = h * 2 * kgPerM + baseKg + 2 * 0.02 * h * KG_PER_M3 * 0.3; // + gussets
      weldLen = n * (4 * 0.2 + 1.0);
      label = `Support legs — ${n} × 2 off L ${angle}×${angle}×${Math.round(angle / 10)} angle, ${Math.round(h * 1000)} mm high`;
      note = 'Back-to-back angle legs with base plates and gussets — lighter than plate posts at short heights';
    } else if (s.type === 'legsBeam') {
      // rolled/formed beam leg (HEA 100 ≈ 16.7 kg/m) sized from the leg load
      const kgPerM = clampNum(12 + dryKg / 2500, 14, 80);
      kgEach = h * kgPerM + baseKg + 0.02 * h * KG_PER_M3 * 0.4;
      weldLen = n * (1.6 + 1.2);
      label = `Support legs — ${n} × rolled beam ≈${kgPerM.toFixed(1)} kg/m, ${Math.round(h * 1000)} mm high`;
      note = 'Rolled-section legs with cap/base plates and stiffeners — use for heavy vessels or tall leg stands';
    } else {
      const w = Math.min(400, Math.max(150, t * 10)); // post width ≈ PL section
      const postKg = h * (t / 1000) * (w / 1000) * KG_PER_M3;
      const gussetKg = 2 * 0.045 * t * (h * 0.55) * (KG_PER_M3 / 1000); // 2 gussets
      kgEach = postKg + gussetKg + baseKg;
      weldLen = n * (2 * (t + w) / 1000 + 1.2); // post perimeter + gussets per leg
      label = `Support legs — ${n} × PL ${t} mm, ${Math.round(h * 1000)} mm high`;
      note = 'PL posts + gussets + base plates, anchor-bolted to foundation';
    }
    items.push({
      kind: s.type,
      label,
      count: n,
      weightKg: kgEach * n,
      weldLenM: weldLen,
      hours: n * (1.2 + h * 1.5) + H(s.type, kgEach * n),
      note,
    });
    anchorCount = n * 4;
  } else if (s.type === 'saddle') {
    const n = Math.max(2, Math.min(4, s.legCount || 2));
    const angle = Math.max(90, Math.min(150, s.saddleAngle || 120));
    const arcM = (angle / 360) * Math.PI * Dm; // contact arc per saddle
    const webH = Dm * 0.6; // m
    const kgEach = 45 + 55 * Dm + 18 * webH * webH; // top plate + webs + stiffeners + base
    const weldLen = n * (2 * arcM + 4 * webH + 1.0);
    items.push({
      kind: 'saddle',
      label: `Saddle supports — ${n} × ${angle}° saddle, span ${(s.saddleSpan / 1000 || Dm * 2.4).toFixed(2)} m`,
      count: n,
      weightKg: kgEach * n,
      weldLenM: weldLen,
      hours: n * (2 + Dm * 1.8) + H('saddle', kgEach * n),
      note: 'Curved top plate + radial webs + base plate; Zick check in code section',
    });
    anchorCount = n * 4;
  } else if (s.type === 'skirt') {
    const h = (s.skirtH > 0 ? s.skirtH : 1500) / 1000;
    const t = 12; // typical skirt plate
    const kg = Math.PI * Dm * h * (t / 1000) * KG_PER_M3 * 1.18; // + base ring & vents
    const circWeld = Math.PI * Dm;
    items.push({
      kind: 'skirt',
      label: `Skirt support — Ø${Dmm} × ${Math.round(h * 1000)} mm, PL ${t}`,
      count: 1,
      weightKg: kg,
      weldLenM: circWeld * 1.6,
      hours: 4 + circWeld * 4.5 + H('skirt', kg),
      note: 'Cylindrical skirt, full-pen circ weld to shell, base ring + access/vapour vents',
    });
    anchorCount = Math.max(8, Math.round(Dm * 6));
  } else if (s.type === 'skirtCone') {
    // Conical skirt: lower diameter from the base-ring geometry, plate thickness 12 mm,
    // sloped at up to 30° so the base is wider than the shell.
    const h = (s.skirtH > 0 ? s.skirtH : 1500) / 1000;
    const t = 12;
    const Dbase = Dm + 2 * Math.min(h, 1.2);
    const slant = Math.sqrt(h * h + ((Dbase - Dm) / 2) * ((Dbase - Dm) / 2));
    const kg = Math.PI * ((Dm + Dbase) / 2) * slant * (t / 1000) * KG_PER_M3 * 1.18;
    const circWeld = Math.PI * Dm;
    items.push({
      kind: 'skirtCone',
      label: `Conical skirt — Ø${Dmm} → Ø${Math.round(Dbase * 1000)} × ${Math.round(h * 1000)} mm, PL ${t}`,
      count: 1,
      weightKg: kg,
      weldLenM: circWeld * 1.8,
      hours: 5 + circWeld * 5 + H('skirtCone', kg),
      note: 'Conical skirt (max 30° from vertical), full-pen top weld, base ring + access opening',
    });
    anchorCount = Math.max(8, Math.round(Dbase * 6));
  } else if (s.type === 'angleSkirt' || s.type === 'bodyAngleSkirt') {
    // Angle skirt: a ring of rolled angle segments. "body" means the angle is welded
    // straight to the shell with gussets (short support), the plain angle skirt is
    // carried on its own ring so it can take the full vessel load.
    const isBody = s.type === 'bodyAngleSkirt';
    const ringH = (s.skirtH > 0 ? s.skirtH : isBody ? 400 : 600) / 1000;
    const leg = ringH >= 0.5 ? 100 : isBody ? 50 : 75;
    const kgPerM = ANGLE_KG_PER_M[leg as 50 | 75 | 100];
    const nSeg = Math.max(4, Math.round((Math.PI * Dm) / 1.5));
    const gussetKg = isBody ? nSeg * 0.4 : nSeg * 0.8;
    const kg = Math.PI * (Dm + 0.1) * kgPerM + gussetKg;
    const circWeld = Math.PI * Dm;
    items.push({
      kind: s.type,
      label: `${isBody ? 'Body angle skirt' : 'Angle skirt'} — L ${leg}×${leg}×${Math.round(leg / 9)}, ${nSeg} segments, ${Math.round(ringH * 1000)} mm`,
      count: nSeg,
      weightKg: kg,
      weldLenM: circWeld * (isBody ? 1.2 : 1.6),
      hours: nSeg * 1.2 + H(s.type, kg),
      note: isBody
        ? 'Angle welded directly to the shell with gussets — light support for small vessels, not a load-bearing skirt'
        : 'Rolled angle ring welded full-pen to the shell, gusseted, on a base ring or foundation blocks',
    });
    anchorCount = isBody ? 0 : Math.max(8, Math.round(Dm * 6));
  } else if (s.type === 'ring') {
    const kg = Math.PI * Dm * 0.35 * 0.012 * KG_PER_M3 * 1.2;
    items.push({
      kind: 'ring',
      label: `Base ring — Ø${Dmm} channel/PL ring`,
      count: 1,
      weightKg: kg,
      weldLenM: Math.PI * Dm,
      hours: 3 + H('ring', kg),
      note: 'Ring plate/channel base for vessel sitting on foundation blocks',
    });
    anchorCount = Math.max(8, Math.round(Dm * 6));
  }

  // ---- optional / auxiliary supports (each calculated separately) ----
  if (s.baseRing) {
    const kg = Math.PI * Dm * 0.3 * 0.014 * KG_PER_M3 * 1.15;
    items.push({
      kind: 'baseRing',
      label: `Base ring + anchor bolt chairs (Ø${Dmm})`,
      count: 1,
      weightKg: kg + anchorCount * 8,
      weldLenM: Math.PI * Dm,
      hours: 3 + anchorCount * 0.25,
      note: 'Base ring with levelling plates and welded anchor chairs',
    });
  }
  // ---- Lifting arrangement: lugs, trunnions or a tailing lug ------------------
  // Sizing basis: the lug/trunnion carries dry weight × the lift factor over n
  // pick points. Plate thickness comes from a pin-bearing check (bearing stress
  // ≤ 0.45·Sy of the lug plate), which is what actually sets lug thickness in
  // practice; the reported utilisation is that bearing ratio. The weld and the
  // shell local stress still need the WRC 107/537 review noted in the row.
  const lift = s.lifting;
  const liftOn = lift ? lift.enabled : !!s.padeyes;
  if (liftOn) {
    const kind = lift?.kind ?? 'lugs';
    const factor = lift?.liftFactor && lift.liftFactor > 0 ? lift.liftFactor : 1;
    const liftKg = dryKg * factor;
    const nDefault =
      kind === 'tailLug' ? 1 : kind === 'trunnionPair' ? 2 : liftKg > 20000 ? 4 : 2;
    const n = Math.max(1, lift?.count || nDefault);
    const perLug = liftKg / n;
    const tAuto = clampNum(12 + 0.35 * Math.sqrt(perLug), 12, 60);
    const t = lift?.plateThkMm && lift.plateThkMm > 0 ? lift.plateThkMm : Math.ceil(tAuto);
    const holeD = Math.max(30, Math.round(t * 1.2));
    const bearingMPa = (perLug * 9.81 * 1.5) / Math.max(1, holeD * t);
    const allowBearMPa = 0.45 * 250; // 0.45·Sy of a 250 MPa lug plate, indicative
    const util = bearingMPa / allowBearMPa;
    let kgEach: number;
    let weldLen: number;
    let label: string;
    if (kind === 'trunnion' || kind === 'trunnionPair') {
      // trunnion = pipe stub through a pad; bore chosen from the pin diameter
      const bore = lift?.trunnionBoreMm && lift.trunnionBoreMm > 0 ? lift.trunnionBoreMm : holeD;
      const od = bore + 2 * Math.max(8, t / 2);
      const kgPerM = Math.PI * (od / 1000) * (Math.max(8, t / 2) / 1000) * KG_PER_M3;
      kgEach = kgPerM * 0.6 + 0.04 * t * t * 0.6; // stub + pad/gusset
      weldLen = 2 * Math.PI * (od / 1000) * 1.6;
      label = `Lifting trunnions — ${n} × Ø${bore} bore, ${Math.max(8, Math.round(t / 2))} mm wall (${kind === 'trunnionPair' ? 'pair, horizontal vessel' : 'radial'})`;
    } else {
      // lug plate: 2 plates of 2.5t width, t thick, plus 30 % stiffener/gusset
      kgEach = 0.04 * t * t * 1.3;
      weldLen = 2 * (2.5 * t / 1000) * 2 + 1.2; // both sides of the plate + stiffener
      label =
        kind === 'tailLug'
          ? `Tailing lug — 1 × PL ${t} mm (tail end during erection)`
          : `Lifting lugs — ${n} × PL ${t} mm, Ø${holeD} pin hole`;
    }
    items.push({
      kind: 'lifting',
      label,
      count: n,
      weightKg: kgEach * n,
      weldLenM: weldLen * n,
      hours: n * 2.2 + H('lifting', kgEach * n),
      note: `Lift weight ${(liftKg / 1000).toFixed(1)} t (×${factor.toFixed(2)} factor) over ${n} point${n > 1 ? 's' : ''} — bearing ${bearingMPa.toFixed(0)} / ${allowBearMPa} MPa (${(util * 100).toFixed(0)} %); verify lug weld & shell local stress (WRC 107/537)`,
    });
  }

  // ---- Transportation saddles (horizontal equipment) -------------------------
  // Shipping saddles are separate from the design saddles: they only carry the
  // vessel on the truck/sea fastening and are usually timber cribbing on small
  // drums and a fabricated steel frame on heavy ones.
  const ts = s.transportSaddle;
  if (ts?.enabled) {
    const lenM = equip.sections.reduce((sum, x) => sum + x.ttLength, 0) / 1000;
    const n = Math.max(2, ts.count || (lenM > 12 ? 3 : 2));
    const tsKind = ts.kind === 'auto' ? (dryKg > 8000 ? 'metal' : 'wood') : ts.kind;
    if (tsKind === 'wood') {
      // hardwood crib: 2 sleepers 200×200 under each saddle + wedges/chocks
      const sleeperM = Math.max(1.0, Dm * 1.3);
      const kgEach = 2 * 0.2 * 0.2 * sleeperM * 700 * 1.15; // hardwood 700 kg/m³ + chocks
      items.push({
        kind: 'transport',
        label: `Transportation saddles — ${n} × timber crib (200×200 hardwood, ${(sleeperM).toFixed(2)} m)`,
        count: n,
        weightKg: kgEach * n,
        weldLenM: 0,
        hours: n * 1.5,
        note: `Shipping support for ${(dryKg / 1000).toFixed(1)} t — timber cribbing with chocks and lashings; no welding${ts.includeInPrice ? ', priced in the estimate' : ', not priced'}`,
      });
    } else {
      const kgEach = (45 + 55 * Dm) * 0.7; // lighter than a design saddle (no wear plate)
      items.push({
        kind: 'transport',
        label: `Transportation saddles — ${n} × steel shipping saddle (Ø${Dmm})`,
        count: n,
        weightKg: kgEach * n,
        weldLenM: n * (2 * (Dm * 0.6) + 1.0),
        hours: n * 2 + H('transport', kgEach * n),
        note: `Fabricated shipping saddles for ${(dryKg / 1000).toFixed(1)} t — bolted/lashed to the transport frame${ts.includeInPrice ? ', priced in the estimate' : ', not priced'}`,
      });
    }
  }
  if (s.guyLines) {
    const n = 4;
    const kgEach = 90; // shackles, wire, turnbuckle, deadman plate
    items.push({
      kind: 'guylines',
      label: `Guy-wire derrick — ${n} guys with deadmen`,
      count: n,
      weightKg: kgEach * n,
      weldLenM: 0,
      hours: n * 5 + H('guylines', kgEach * n),
      note: 'Erection guys for tall verticals — remove after grouting/erection',
    });
  }

  const totalWeightKg = items.reduce((sum, i) => sum + i.weightKg, 0);
  const totalHours = items.reduce((sum, i) => sum + i.hours, 0);
  return {
    items,
    totalWeightKg,
    totalHours,
    anchorBolts:
      anchorCount > 0
        ? { count: anchorCount, diaMm: dryKg > 40000 ? 36 : 30, lengthMm: 600 }
        : null,
  };
}

/** Recommended structural steelwork per tag — selectable, costed only when enabled. */
export function recommendStructure(equip: Equipment, calc: EquipmentCalc): StructureRecommendation {
  const tt = equip.sections.reduce((s, x) => s + x.ttLength, 0) / 1000; // m
  const Dm = (equip.sections[0]?.dia ?? 1000) / 1000;
  const dryT = calc.weightDryKg / 1000;
  const members: StructureMember[] = [];
  const beam = (label: string, section: string, count: number, lengthM: number, kgPerM: number) => {
    members.push({ label, section, count, lengthM, kgPerM, kg: count * lengthM * kgPerM });
  };

  let kind: StructureRecommendation['kind'];
  let basis: string;
  if (equip.orientation === 'horizontal' && equip.equipType !== 'finfan') {
    kind = 'skid';
    const len = tt + 1.2;
    beam('Main skid beams', 'IPE 300', 2, len, 42);
    beam('Cross members', 'IPE 160', Math.max(3, Math.round(len / 2.5)), Dm + 0.8, 15.1);
    beam('Side rails', 'UPN 140', 2, len, 12.3);
    basis = `Horizontal equipment (T-T ${tt.toFixed(1)} m) on a transport/erection skid frame — keeps saddle supports aligned and allows bolting to civil foundation pads.`;
  } else if (equip.equipType === 'hx' || equip.equipType === 'finfan') {
    kind = 'platform';
    beam('Platform deck frame', 'HEA 140', 2, Dm + 1.6, 21.5);
    beam('Platform grating support', 'L 60×6', 6, Dm + 1.2, 5.4);
    beam('Access stair stringers', 'UPN 120', 2, 3.5, 8.8);
    basis = 'Operating platform & access stair for tube-bundle/air-side maintenance (two-level access recommended for fin-fan bays).';
  } else if (tt / Math.max(0.5, Dm) > 4 || dryT > 30) {
    kind = 'portal';
    beam('Portal columns', 'HEB 240', 4, tt * 0.35 + 1, 71.5);
    beam('Portal rafters', 'IPE 240', 4, Dm + 1.4, 30.6);
    beam('Bracing', 'L 75×8', 8, Math.sqrt(tt * 0.35 * (tt * 0.35) + (Dm + 1.4) * (Dm + 1.4)), 9.0);
    basis = `Tall vertical (L/D = ${(tt / Math.max(0.5, Dm)).toFixed(1)}, dry ${dryT.toFixed(1)} t) — maintenance access frame + wind/erector steel around the vessel.`;
  } else {
    kind = 'pedestal';
    beam('Pedestal top base plate', 'PL 25', 1, Math.max(1.2, Dm * 0.9), 196);
    beam('Pedestal reinforcement cage equiv.', 'L 75×8', 8, 2.0, 9.0);
    basis = `Vertical vessel on ${equip.support?.type ?? 'foundation'} — concrete pedestal with steel base plate, levelling nuts and grout; civil concrete outside shop scope.`;
  }

  const weightKg = members.reduce((s, m) => s + m.kg, 0);
  const hours = weightKg * 0.06 + members.length * 1.5;
  return { kind, basis, members, weightKg, hours, enabled: equip.structure?.enabled ?? false };
}
