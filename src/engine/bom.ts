// BOM / MTO generation for all equipment types + plate procurement planning.
// Plate lines carry stock sizes/thicknesses so procurement reflects market availability.

import type { BOMItem, Equipment, EquipmentCalc } from './types';
import { getMat } from './materials';
import { pipeMassKgPerM, wallForBore, npsNumber, studCount, findPipe, flangeWeightKg } from './pipes';
import { choosePlate, nestParts, planPlate, PlateProcurementLine, PlateSize, DEFAULT_PLATE_STOCK, stockThickness } from './plates';
import { computeSupports, recommendStructure } from './supports';
import { sealMassKg } from './api650';

export interface ProcurementContext {
  stockPlates: PlateSize[];
  prices: Record<string, number>; // material key -> USD/kg
}

function studData(nps: string): { dia: number; len: number } {
  const n = npsNumber(nps);
  const dia = n <= 1 ? 16 : n <= 2 ? 20 : n <= 4 ? 24 : n <= 8 ? 27 : n <= 12 ? 30 : n <= 16 ? 33 : 36;
  const len = 40 + n * 4.5 + dia;
  return { dia, len };
}

export function nozzleBOMItems(equip: Equipment, calc: EquipmentCalc): BOMItem[] {
  const items: BOMItem[] = [];
  for (const nc of calc.nozzles) {
    const n = nc.spec;
    const pipeInfo = wallForBore(n.dn, n.schKey);
    const nps = pipeInfo?.pipe.nps ?? '2"';
    const mat = getMat(equip.materialKey);
    items.push({
      id: `${equip.id}-nzp-${n.id}`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Pipe',
      item: `Nozzle neck ${n.tag}`,
      spec: `${nps} Sch.${n.schKey}, L≈${(nc.pipeLenM * 1000).toFixed(0)} mm`,
      material: equip.materialKey,
      qty: 1,
      unit: 'ea',
      unitMassKg: nc.pipeKg,
      massKg: nc.pipeKg,
      note: n.service,
    });
    items.push({
      id: `${equip.id}-nzf-${n.id}`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Flange',
      item: `Flange ${n.tag}`,
      spec: `ASME B16.5 Cl.${n.flangeClass} RF WN ${nps}`,
      material: n.flangeMatKey,
      qty: 1,
      unit: 'ea',
      unitMassKg: nc.flangeKg,
      massKg: nc.flangeKg,
    });
    const stud = studData(nps);
    const cnt = studCount(npsNumber(nps));
    const studMass = (Math.PI / 4) * stud.dia * stud.dia * stud.len * 7.85e-6 * cnt;
    items.push({
      id: `${equip.id}-blt-${n.id}`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Bolting',
      item: `Stud bolts & nuts ${n.tag}`,
      spec: `${cnt} × M${stud.dia} × ${stud.len} (SA-193 B7 / SA-194 2H)`,
      material: 'SA-193-B7',
      qty: cnt,
      unit: 'ea',
      unitMassKg: studMass / cnt,
      massKg: studMass * 1.4, // + nuts
    });
    items.push({
      id: `${equip.id}-gsk-${n.id}`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Gasket',
      item: `Gasket ${n.tag}`,
      spec: `Spiral wound ${nps} Cl.${n.flangeClass} (304/Graphite)`,
      material: 'SPIRAL-304',
      qty: 1,
      unit: 'ea',
      unitMassKg: 0.6,
      massKg: 0.6,
    });
  }
  return items;
}

export function vesselPlateItems(equip: Equipment, calc: EquipmentCalc): { items: BOMItem[]; plateReqs: PlateRequestFull[] } {
  const items: BOMItem[] = [];
  const plateReqs: PlateRequestFull[] = [];
  const mat = getMat(equip.materialKey);
  const stockLen = 12000;
  const courseMaxH = 2000;

  for (const c of calc.sections) {
    const D = c.spec.dia;
    const t = c.tNominal;
    const circ = Math.PI * (D + t);
    const nCourses = Math.max(1, Math.ceil(c.spec.ttLength / courseMaxH));
    const courseH = c.spec.ttLength / nCourses;
    const strips = Math.max(1, Math.ceil(circ / stockLen));
    const stripL = circ / strips;
    for (let s = 0; s < strips; s++) {
      items.push({
        id: `${equip.id}-sh-${c.spec.id}-${s}`,
        equipId: equip.id,
        tag: equip.tag,
        category: 'Plate',
        item: `Shell strip Ø${D} (sec ${c.spec.id.slice(-2)})`,
        spec: `${courseH.toFixed(0)} × ${stripL.toFixed(0)} × ${t} mm`,
        material: equip.materialKey,
        qty: nCourses,
        unit: 'ea',
        massKg: nCourses * (courseH / 1000) * (stripL / 1000) * (t / 1000) * mat.density,
        plateReq: { w: courseH, l: stripL, thk: t },
      });
      plateReqs.push({
        equipId: equip.id,
        tag: equip.tag,
        partName: `Shell strip Ø${D}`,
        material: equip.materialKey,
        thk: t,
        w: courseH,
        l: stripL,
        count: nCourses,
      });
    }
    // Cone plates (developed)
    if (c.cone) {
      const devW = c.spec.ttLength * 0.4;
      const devL = Math.PI * c.spec.dia;
      plateReqs.push({
        equipId: equip.id,
        tag: equip.tag,
        partName: `Cone Ø${c.spec.dia}`,
        material: equip.materialKey,
        thk: c.cone.tNominal,
        w: devW,
        l: devL / 2,
        count: 2,
      });
      items.push({
        id: `${equip.id}-cn-${c.spec.id}`,
        equipId: equip.id,
        tag: equip.tag,
        category: 'Plate',
        item: `Cone transition Ø${c.spec.dia}`,
        spec: `${devW.toFixed(0)} × ${(devL / 2).toFixed(0)} × ${c.cone.tNominal} mm (2 segments)`,
        material: equip.materialKey,
        qty: 2,
        unit: 'ea',
        massKg: 2 * (devW / 1000) * (devL / 2 / 1000) * (c.cone.tNominal / 1000) * mat.density * 1.1,
        plateReq: { w: devW, l: devL / 2, thk: c.cone.tNominal },
      });
    }
    // Heads
    for (const [where, type, thkSel] of [
      ['top', c.spec.headTop, c.spec.headThkTop],
      ['bottom', c.spec.headBottom, c.spec.headThkBot],
    ] as const) {
      if (type === 'none') continue;
      const hc = where === 'top' ? c.headTop : c.headBot;
      if (!hc) continue;
      const tHead = thkSel > 0 ? thkSel : hc.tMinNominal;
      const blank = hc.blankDia;
      plateReqs.push({
        equipId: equip.id,
        tag: equip.tag,
        partName: `Head ${where} Ø${D} (${type})`,
        material: equip.materialKey,
        thk: tHead,
        w: blank,
        l: blank,
        count: 1,
      });
      items.push({
        id: `${equip.id}-hd-${where}-${c.spec.id}`,
        equipId: equip.id,
        tag: equip.tag,
        category: 'Plate',
        item: `Formed head ${where} Ø${D}`,
        spec: `${type} blank Ø${blank.toFixed(0)} × ${tHead.toFixed(1)} mm`,
        material: equip.materialKey,
        qty: 1,
        unit: 'ea',
        massKg: hc.surfaceArea * (tHead / 1000) * mat.density * 1.05,
        plateReq: { w: blank, l: blank, thk: tHead },
      });
    }
  }

  // Cladding / lining purchase line (priced at lining grade $/kg — see estimate engine)
  const clad = calc.clad;
  if (clad && clad.weightKg > 0) {
    const cladSpec = equip.clad!;
    const KIND_LABEL: Record<string, string> = {
      weldOverlay: 'Weld overlay',
      explosionBonded: 'Explosion-bonded clad plate',
      rollBonded: 'Roll-bonded clad plate',
      mechanicalLiner: 'Mechanical liner',
    };
    items.push({
      id: `${equip.id}-clad`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Plate',
      item: `${KIND_LABEL[cladSpec.kind]} ${clad.materialName}`,
      spec: `${cladSpec.thicknessMm} mm ${cladSpec.mode === 'full' ? 'full length' : `partial — ${cladSpec.partialLengthMm} mm from bottom`}`,
      material: clad.materialKey,
      qty: 1,
      unit: 'm²',
      massKg: clad.weightKg,
      note: cladSpec.kind === 'weldOverlay'
        ? 'Overlay consumable weight; base plate bought separately'
        : 'Composite clad plate premium — ordered with base plate dims',
    });
    // Composite clad plate ordering footprint for procurement (bonded types)
    if (cladSpec.kind === 'explosionBonded' || cladSpec.kind === 'rollBonded') {
      const sec0 = calc.sections[0];
      if (sec0) {
        plateReqs.push({
          equipId: equip.id,
          tag: equip.tag,
          partName: `Clad composite shell ${KIND_LABEL[cladSpec.kind]}`,
          material: clad.materialKey,
          thk: cladSpec.thicknessMm,
          w: sec0.spec.ttLength / Math.max(1, Math.ceil(sec0.spec.ttLength / 2000)),
          l: Math.PI * sec0.spec.dia,
          count: Math.max(1, Math.ceil(sec0.spec.ttLength / 2000)),
        });
      }
    }
  }
  return { items, plateReqs };
}

export interface PlateRequestFull {
  equipId: string;
  tag: string;
  partName: string;
  material: string;
  thk: number;
  w: number;
  l: number;
  count: number;
}

/** Support steel per kind — single source of truth is the supports engine (calc.supports). */
export function supportItems(equip: Equipment, calc: EquipmentCalc): BOMItem[] {
  const sc = calc.supports ?? computeSupports(equip, calc);
  const items: BOMItem[] = sc.items.map((it) => ({
    id: `${equip.id}-sup-${it.kind}`,
    equipId: equip.id,
    tag: equip.tag,
    category: 'Structural' as const,
    item: it.label,
    spec: it.note,
    material: 'STRUCT-CS',
    qty: it.count,
    unit: 'ea' as const,
    unitMassKg: it.count > 0 ? it.weightKg / it.count : 0,
    massKg: it.weightKg,
  }));
  if (sc.anchorBolts) {
    const ab = sc.anchorBolts;
    const boltKg = Math.PI / 4 * ab.diaMm * ab.diaMm * ab.lengthMm * 7.85e-6 * 1.4; // + nuts
    items.push({
      id: `${equip.id}-sup-anchor`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Bolting',
      item: `Anchor bolts ${ab.count} × M${ab.diaMm}`,
      spec: `M${ab.diaMm} × ${ab.lengthMm} (SA-36 / SA-193 B7) with chairs`,
      material: 'SA-36',
      qty: ab.count,
      unit: 'ea',
      unitMassKg: boltKg,
      massKg: boltKg * ab.count,
    });
  }
  return items;
}

export function internalsItems(equip: Equipment, calc: EquipmentCalc): BOMItem[] {
  const items: BOMItem[] = [];
  const area = (Math.PI / 4) * Math.pow(((equip.sections[0]?.dia ?? 1000) - 150) / 1000, 2);
  for (const it of equip.internals) {
    const packing = it.kind === 'randomPacking' || it.kind === 'structuredPacking';
    const mass = packing ? it.count * it.kgPerM2 * (it.spacing / 1000 > 0 ? 1 : 1) * area : it.count * it.kgPerM2 * area;
    items.push({
      id: `${equip.id}-int-${it.id}`,
      equipId: equip.id,
      tag: equip.tag,
      category: 'Internals',
      item: internalsLabel(it.kind),
      spec: `${it.count} × ${it.spacing} mm spacing, ${getMat(it.materialKey).name}`,
      material: it.materialKey,
      qty: it.count,
      unit: 'ea',
      unitMassKg: area > 0 ? mass / Math.max(1, it.count) : 0,
      massKg: mass,
      note: it.note,
    });
  }
  return items;
}

export function internalsLabel(kind: string): string {
  const map: Record<string, string> = {
    sieveTray: 'Sieve tray assembly',
    valveTray: 'Valve tray assembly',
    bubbleCapTray: 'Bubble-cap tray assembly',
    randomPacking: 'Random packing (bed)',
    structuredPacking: 'Structured packing module',
    demister: 'Demister pad',
    distributor: 'Liquid distributor',
    collector: 'Collector tray',
    chimneyTray: 'Chimney tray',
    supportRing: 'Internals support ring',
  };
  return map[kind] ?? kind;
}

export function hxPlateItems(equip: Equipment, calc: EquipmentCalc): { items: BOMItem[]; plateReqs: PlateRequestFull[] } {
  const items: BOMItem[] = [];
  const plateReqs: PlateRequestFull[] = [];
  const hx = equip.hx!;
  const c = calc.hx!;
  const mat = getMat(hx.shellMatKey);

  // Shell barrel
  const circ = Math.PI * c.shellOD;
  const stripH = equip.sections[0]?.ttLength ?? hx.tubeLength;
  plateReqs.push({
    equipId: equip.id, tag: equip.tag, partName: 'Shell barrel', material: hx.shellMatKey,
    thk: Math.max(8, 12), w: stripH, l: circ, count: 1,
  });
  items.push({
    id: `${equip.id}-hx-shell`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Shell barrel', spec: `${stripH.toFixed(0)} × ${circ.toFixed(0)} × ${Math.max(8, 12)} mm`,
    material: hx.shellMatKey, qty: 1, unit: 'ea',
    massKg: Math.PI * (c.shellOD / 1000) * 0.012 * ((stripH / 1000) + 0.1) * mat.density,
    plateReq: { w: stripH, l: circ, thk: 12 },
  });

  // Heads (channel & shell side ellipsoidal)
  const tHead = 16;
  const blank = 1.24 * c.shellID;
  plateReqs.push({ equipId: equip.id, tag: equip.tag, partName: 'Channel/head blank', material: hx.headMatKey, thk: tHead, w: blank, l: blank, count: 2 });
  items.push({
    id: `${equip.id}-hx-heads`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Ellipsoidal heads (2)', spec: `blank Ø${blank.toFixed(0)} × ${tHead} mm`,
    material: hx.headMatKey, qty: 2, unit: 'ea',
    massKg: 2 * 1.084 * Math.pow(c.shellID / 1000, 2) * (c.shellID / 4 / 1000) * getMat(hx.headMatKey).density * 1.05,
    plateReq: { w: blank, l: blank, thk: tHead },
  });

  // Tubes
  const tubeMat = getMat(hx.tubeMatKey);
  const tubeInfo = wallForBore(hx.tubeOD, '40');
  const tubePerM = pipeMassKgPerM(hx.tubeOD, hx.tubeWall, tubeMat.density);
  items.push({
    id: `${equip.id}-hx-tubes`, equipId: equip.id, tag: equip.tag, category: 'Pipe',
    item: 'Exchanger tubes', spec: `Ø${hx.tubeOD}×${hx.tubeWall} × ${hx.tubeLength} mm, ${c.tubeCountActual} pcs`,
    material: hx.tubeMatKey, qty: c.tubeCountActual, unit: 'ea',
    unitMassKg: tubePerM * (hx.tubeLength / 1000),
    massKg: c.tubeCountActual * tubePerM * (hx.tubeLength / 1000),
  });

  // Tubesheets
  plateReqs.push({ equipId: equip.id, tag: equip.tag, partName: 'Tubesheet', material: hx.tsMatKey, thk: c.tubeSheetThk, w: c.shellID + 60, l: c.shellID + 60, count: 2 });
  items.push({
    id: `${equip.id}-hx-ts`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Tubesheets (2)', spec: `Ø${(c.shellID + 60).toFixed(0)} × ${c.tubeSheetThk.toFixed(1)} mm`,
    material: hx.tsMatKey, qty: 2, unit: 'ea',
    massKg: 2 * (Math.PI / 4) * Math.pow((c.shellID + 60) / 1000, 2) * (c.tubeSheetThk / 1000) * getMat(hx.tsMatKey).density * 0.92,
    plateReq: { w: c.shellID + 60, l: c.shellID + 60, thk: c.tubeSheetThk },
  });

  // Tubesheet face cladding / overlay
  const tsCladSpec = hx.tubeSheetClad?.enabled ? hx.tubeSheetClad : null;
  if (tsCladSpec && c.tubeSheetCladKg > 0) {
    items.push({
      id: `${equip.id}-hx-tsclad`, equipId: equip.id, tag: equip.tag, category: 'Plate',
      item: `Tubesheet face overlay ${getMat(tsCladSpec.materialKey).name}`,
      spec: `${tsCladSpec.thicknessMm} mm, both faces`,
      material: tsCladSpec.materialKey, qty: 1, unit: 'm²',
      massKg: c.tubeSheetCladKg,
      note: 'Weld overlay/bonded barrier — overlay consumable weight',
    });
  }

  // Tube-to-tubesheet joint consumables
  const jointType = hx.tubeJointType ?? 'strengthWelded';
  if (jointType !== 'expanded' && c.tubeCountActual > 0) {
    const weldLenM = c.tubeCountActual * Math.PI * (hx.tubeOD / 1000) * (jointType === 'fullyWelded' ? 2 : 1);
    items.push({
      id: `${equip.id}-hx-joint`, equipId: equip.id, tag: equip.tag, category: 'Consumable',
      item: `Tube-to-tubesheet welds (${jointType})`,
      spec: `${c.tubeCountActual} joints × Ø${hx.tubeOD}`,
      material: hx.tubeMatKey, qty: weldLenM, unit: 'm',
      massKg: weldLenM * 0.15,
      note: 'Filler metal for tube joint welding',
    });
  }

  // Baffles
  plateReqs.push({ equipId: equip.id, tag: equip.tag, partName: 'Baffle plate', material: hx.baffleMatKey, thk: 6, w: c.shellID, l: c.shellID, count: c.baffleCount + 2 });
  items.push({
    id: `${equip.id}-hx-baf`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Baffles/sealing strips', spec: `Ø${c.shellID} × 6 mm, ${c.baffleCount} pcs + 2 support`,
    material: hx.baffleMatKey, qty: c.baffleCount + 2, unit: 'ea',
    unitMassKg: (Math.PI / 4) * Math.pow(c.shellID / 1000, 2) * 0.006 * 7850 * 0.85,
    massKg: (c.baffleCount + 2) * (Math.PI / 4) * Math.pow(c.shellID / 1000, 2) * 0.006 * 7850 * 0.85,
    plateReq: { w: c.shellID, l: c.shellID, thk: 6 },
  });
  return { items, plateReqs };
}

export function finFanItems(equip: Equipment, calc: EquipmentCalc): BOMItem[] {
  const items: BOMItem[] = [];
  const ff = equip.finfan!;
  const c = calc.finfan!;
  const tubePerM = pipeMassKgPerM(ff.tubeOD, ff.tubeWall, getMat(ff.tubeMatKey).density);
  items.push({
    id: `${equip.id}-ff-tubes`, equipId: equip.id, tag: equip.tag, category: 'Pipe',
    item: 'Finned tubes', spec: `Ø${ff.tubeOD}×${ff.tubeWall} L=${ff.tubeLength}, ${ff.finPitch} fpi fins, ${c.tubeCountActual} pcs`,
    material: ff.tubeMatKey, qty: c.tubeCountActual, unit: 'ea',
    unitMassKg: tubePerM * (ff.tubeLength / 1000),
    massKg: c.tubeCountActual * tubePerM * (ff.tubeLength / 1000),
  });
  items.push({
    id: `${equip.id}-ff-fins`, equipId: equip.id, tag: equip.tag, category: 'Other',
    item: 'Fin strip', spec: `Ø${ff.finOD} × ${ff.finThk} mm @ ${ff.finPitch} fpi`,
    material: ff.finMatKey, qty: 1, unit: 'm',
    massKg: (c.finnedAreaM2 * (ff.finThk / 1000) * 1200),
    note: `~${c.finnedAreaM2.toFixed(0)} m² finned area`,
  });
  items.push({
    id: `${equip.id}-ff-header`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Header boxes & tubesheet strips', spec: `PL ${ff.headerThk} mm, ${ff.bays} bay(s)`,
    material: equip.materialKey, qty: ff.bays, unit: 'ea',
    unitMassKg: ff.bays > 0 ? (0.09 * c.weightBundleKg) / ff.bays : 0,
    massKg: 0.09 * c.weightBundleKg,
    plateReq: { w: ff.tubeLength + 200, l: Math.max(800, c.bundleWidth / ff.bays), thk: ff.headerThk },
  });
  items.push({
    id: `${equip.id}-ff-struct`, equipId: equip.id, tag: equip.tag, category: 'Structural',
    item: 'Bay structure, plenum, louvers & handrails', spec: 'SMLS/structural sections',
    material: 'STRUCT-CS', qty: ff.bays, unit: 'ea',
    unitMassKg: 0.06 * c.weightOperatingKg,
    massKg: 0.06 * c.weightOperatingKg * ff.bays,
  });
  items.push({
    id: `${equip.id}-ff-fan`, equipId: equip.id, tag: equip.tag, category: 'Other',
    item: `Fans & motors (${ff.bays})`, spec: `Axial fan, ≈${c.fanKW.toFixed(1)} kW each, ${ff.arrangement}`,
    material: 'EQUIP', qty: ff.bays, unit: 'ea', unitMassKg: 180, massKg: 180 * ff.bays,
  });
  return items;
}

export function tankItems(equip: Equipment, calc: EquipmentCalc): { items: BOMItem[]; plateReqs: PlateRequestFull[] } {
  const items: BOMItem[] = [];
  const plateReqs: PlateRequestFull[] = [];
  const t = calc.tank!;
  const tank = equip.tank!;
  const Dm = equip.sections[0].dia / 1000;
  const circ = Math.PI * equip.sections[0].dia;

  for (const course of t.shellCourses) {
    const n = Math.max(1, Math.ceil(circ / 6000));
    plateReqs.push({
      equipId: equip.id, tag: equip.tag, partName: `Shell course ${course.courseNo}`,
      material: equip.materialKey, thk: course.tNominal,
      w: course.heightMm, l: circ / n, count: n,
    });
    items.push({
      id: `${equip.id}-tk-c${course.courseNo}`, equipId: equip.id, tag: equip.tag, category: 'Plate',
      item: `Shell course ${course.courseNo}`, spec: `${course.heightMm.toFixed(0)} × ${(circ / n).toFixed(0)} × ${course.tNominal.toFixed(1)} mm`,
      material: equip.materialKey, qty: n, unit: 'ea',
      massKg: n * (course.heightMm / 1000) * (circ / n / 1000) * (course.tNominal / 1000) * 7850,
      plateReq: { w: course.heightMm, l: circ / n, thk: course.tNominal },
    });
  }
  // Bottom / annular
  const bottomArea = (Math.PI / 4) * Dm * Dm;
  const plateCount = Math.ceil((bottomArea * 1.05) / (1.5 * 6));
  plateReqs.push({ equipId: equip.id, tag: equip.tag, partName: 'Tank bottom plates', material: equip.materialKey, thk: t.bottomThk, w: 1500, l: 6000, count: plateCount });
  items.push({
    id: `${equip.id}-tk-bot`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: 'Bottom plates', spec: `1500 × 6000 × ${t.bottomThk} mm${tank.annularBottom ? ', annular ring PL' + t.annularThk : ''}`,
    material: equip.materialKey, qty: plateCount, unit: 'ea',
    massKg: t.bottomWeightKg, plateReq: { w: 1500, l: 6000, thk: t.bottomThk },
  });
  // Roof (fixed roof plates, or floating-roof deck + pontoons for EFR/IFR)
  const seals = sealMassKg(Dm, tank);
  const roofSteelKg = Math.max(0, t.roofWeightKg - (seals.primary + seals.secondary));
  const roofPlates = Math.ceil((bottomArea * 1.25) / (1.5 * 6));
  plateReqs.push({ equipId: equip.id, tag: equip.tag, partName: 'Roof plates', material: equip.materialKey, thk: t.roofThk, w: 1500, l: 6000, count: roofPlates });
  items.push({
    id: `${equip.id}-tk-roof`, equipId: equip.id, tag: equip.tag, category: 'Plate',
    item: tank.roofType === 'externalFloating' ? 'External floating roof deck + pontoon ring' : tank.roofType === 'internalFloating' ? 'Internal floating roof deck + supports' : `${tank.roofType} roof plates`,
    spec: `1500 × 6000 × ${t.roofThk} mm${tank.roofType === 'externalFloating' ? ', pontoon buoyancy ring' : ''}`,
    material: equip.materialKey, qty: roofPlates, unit: 'ea',
    massKg: roofSteelKg, plateReq: { w: 1500, l: 6000, thk: t.roofThk },
  });
  // Floating-roof seal assemblies (API 650 §5.8.3) — purchased items
  if (seals.primary > 0) {
    const PRIM_LABEL: Record<string, string> = { shoe: 'shoe-mounted primary seal', fabric: 'fabric primary seal', liquidMounted: 'liquid-mounted primary seal', doubleContact: 'double-contacting shoe primary seal', none: 'none' };
    items.push({
      id: `${equip.id}-tk-seal1`, equipId: equip.id, tag: equip.tag, category: 'Other',
      item: `Primary seal assembly (${PRIM_LABEL[tank.primarySeal ?? 'shoe']})`,
      spec: `${(Math.PI * Dm).toFixed(0)} m seal run, wiper pans + fittings`,
      material: 'EQUIP', qty: 1, unit: 'ea',
      unitMassKg: seals.primary, massKg: seals.primary,
      note: 'Floating-roof primary seal — vendor assembly',
    });
  }
  if (seals.secondary > 0) {
    const SEC_LABEL: Record<string, string> = { metal: 'metal-type secondary seal', fabric: 'fabric secondary seal', panCover: 'pan-cover secondary seal', none: 'none' };
    items.push({
      id: `${equip.id}-tk-seal2`, equipId: equip.id, tag: equip.tag, category: 'Other',
      item: `Secondary seal assembly (${SEC_LABEL[tank.secondarySeal ?? 'metal']})`,
      spec: `${(Math.PI * Dm).toFixed(0)} m seal run with counterweight arms`,
      material: 'EQUIP', qty: 1, unit: 'ea',
      unitMassKg: seals.secondary, massKg: seals.secondary,
      note: 'Floating-roof secondary seal — vendor assembly',
    });
  }
  // Ladder/platform steel + anchors
  items.push({
    id: `${equip.id}-tk-lad`, equipId: equip.id, tag: equip.tag, category: 'Structural',
    item: 'Ladder, platforms & wind girder steel', spec: 'SMLS/angle/handrail',
    material: 'STRUCT-CS', qty: 1, unit: 'm',
    massKg: (equip.sections[0].ttLength / 1000) * 22 + Dm * 45,
  });  // Anchor group from the shared bolt-group sizing when available (count matches
  // the calc); fall back to the old spacing heuristic for standalone BOM runs.
  const boltCount = calc.bolts?.count ?? Math.max(8, Math.round(Dm * 6));
  items.push({
    id: `${equip.id}-tk-anc`, equipId: equip.id, tag: equip.tag, category: 'Bolting',
    item: 'Anchor bolts & chairs', spec: `${boltCount} × M24 (SA-36/SA-193) with chairs`,
    material: 'SA-36', qty: boltCount, unit: 'ea', unitMassKg: 3, massKg: boltCount * 3,
  });
  return { items, plateReqs };
}

/** Full BOM for one equipment tag */
export function generateBOM(equip: Equipment, calc: EquipmentCalc): { items: BOMItem[]; plateReqs: PlateRequestFull[] } {
  const items: BOMItem[] = [];
  let plateReqs: PlateRequestFull[] = [];

  if (equip.equipType === 'hx') {
    const r = hxPlateItems(equip, calc);
    items.push(...r.items);
    plateReqs = r.plateReqs;
  } else if (equip.equipType === 'tank') {
    const r = tankItems(equip, calc);
    items.push(...r.items);
    plateReqs = r.plateReqs;
  } else {
    const r = vesselPlateItems(equip, calc);
    items.push(...r.items);
    plateReqs = r.plateReqs;
  }
  if (equip.equipType === 'finfan') items.push(...finFanItems(equip, calc));

  items.push(...nozzleBOMItems(equip, calc));
  items.push(...supportItems(equip, calc));
  if (equip.structure?.enabled) {
    const rec = recommendStructure(equip, calc);
    items.push({
      id: `${equip.id}-struct`, equipId: equip.id, tag: equip.tag, category: 'Structural',
      item: `Structural steelwork — ${rec.kind} frame`,
      spec: rec.members.map((m) => `${m.count}× ${m.section} ${m.label}`).join('; '),
      material: 'STRUCT-CS', qty: 1, unit: 'ea',
      unitMassKg: rec.weightKg, massKg: rec.weightKg,
      note: rec.basis,
    });
  }
  if (equip.equipType === 'column' || equip.internals.length) items.push(...internalsItems(equip, calc));

  // Manway item if present
  for (const nc of calc.nozzles.filter((n) => n.spec.kind === 'manway')) {
    items.push({
      id: `${equip.id}-mw-${nc.spec.id}`, equipId: equip.id, tag: equip.tag, category: 'Other',
      item: `Manway assembly ${nc.spec.tag}`, spec: `Ø${nc.spec.dn} closed cover, cl.${nc.spec.flangeClass}`,
      material: nc.spec.flangeMatKey, qty: 1, unit: 'ea',
      unitMassKg: 40 + nc.spec.dn * 0.25, massKg: 40 + nc.spec.dn * 0.25,
    });
  }

  return { items, plateReqs };
}

/** Build procurement lines from all plate requests */
export function buildProcurement(
  reqs: PlateRequestFull[],
  ctx: ProcurementContext
): { lines: PlateProcurementLine[]; byTag: Record<string, PlateProcurementLine[]> } {
  const lines: PlateProcurementLine[] = [];
  const byTag: Record<string, PlateProcurementLine[]> = {};
  // group identical part requests
  const groups = new Map<string, PlateRequestFull & { count: number }>();
  for (const r of reqs) {
    const key = `${r.tag}|${r.material}|${r.thk.toFixed(1)}|${Math.round(r.w)}|${Math.round(r.l)}|${r.partName}`;
    const existing = groups.get(key);
    if (existing) existing.count += r.count;
    else groups.set(key, { ...r });
  }
  for (const [key, g] of groups) {
    const price = ctx.prices[g.material] ?? getMat(g.material)?.pricePerKg ?? 0.41;
    const line = planPlate(
      { material: g.material, thk: g.thk, w: g.w, l: g.l, count: g.count },
      ctx.stockPlates,
      price,
      key
    );
    (line as any).partName = g.partName;
    lines.push(line);
    if (!byTag[g.tag]) byTag[g.tag] = [];
    byTag[g.tag].push(line);
  }
  return { lines, byTag };
}
