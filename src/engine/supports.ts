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
const H_PER_KG = { legs: 0.055, saddle: 0.05, skirt: 0.04, ring: 0.06, baseRing: 0.08, padeyes: 0.12, guylines: 0.09 };

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
  if (s.type === 'legs') {
    const n = Math.max(2, s.legCount || 4);
    const h = (s.skirtH > 0 ? s.skirtH : 800) / 1000; // m
    const t = Math.max(8, s.legPlateThk || 16); // mm
    const w = Math.min(400, Math.max(150, t * 10)); // post width ≈ PL section
    const postKg = h * (t / 1000) * (w / 1000) * KG_PER_M3;
    const gussetKg = 2 * 0.045 * t * (h * 0.55) * (KG_PER_M3 / 1000); // 2 gussets
    const baseKg = 0.25 * 0.25 * 0.02 * KG_PER_M3; // base plate
    const kgEach = postKg + gussetKg + baseKg;
    const weldLen = n * (2 * (t + w) / 1000 + 1.2); // post perimeter + gussets per leg
    items.push({
      kind: 'legs',
      label: `Support legs — ${n} × PL ${t} mm, ${Math.round(h * 1000)} mm high`,
      count: n,
      weightKg: kgEach * n,
      weldLenM: weldLen,
      hours: n * (1.2 + h * 1.5) + H('legs', kgEach * n),
      note: 'PL posts + gussets + base plates, anchor-bolted to foundation',
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
  if (s.padeyes) {
    const n = dryKg > 20000 ? 4 : 2;
    const kgEach = Math.max(25, Math.min(90, dryKg / 400));
    items.push({
      kind: 'padeyes',
      label: `Lifting lugs / padeyes — ${n} × ≈${kgEach.toFixed(0)} kg`,
      count: n,
      weightKg: kgEach * n,
      weldLenM: n * 1.8,
      hours: n * 2 + H('padeyes', kgEach * n),
      note: `Rated for dry lift ≈ ${(dryKg / 1000).toFixed(1)} t — verify lug weld & shell local stress (WRC 107/537)`,
    });
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
