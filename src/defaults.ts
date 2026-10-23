// Default equipment factories + demo project seed data.

import type { Equipment, EquipType, NdtItemSpec } from './engine/types';
import { uid } from './engine/units';

/** Default NDT plan: category-driven RT + surface/UT basics. */
export function defaultNdtPlan(rtCategory: 'full' | 'spot' | 'none'): NdtItemSpec[] {
  return [
    { method: 'mt', enabled: true, timing: 'final', extent: 'spot', note: 'All pressure-boundary welds, after final weld' },
    { method: 'ut', enabled: true, timing: 'final', extent: 'sample', note: 'Nozzle/attachment weld UT per UW-11(b)' },
    {
      method: 'rt',
      enabled: rtCategory !== 'none',
      timing: 'afterPwht',
      extent: rtCategory === 'full' ? 'full' : 'spot',
      note: rtCategory === 'full' ? '100 % RT of main seams (UW-11(a))' : 'Spot RT per UW-11(a)',
    },
    { method: 'putTofd', enabled: false, timing: 'afterPwht', extent: 'full', note: 'PaUT/TOFD alternative — preferred for t > 50 mm' },
  ];
}

export function newEquipment(type: EquipType, srNo: number): Equipment {
  const base: Equipment = {
    id: uid('eq'),
    srNo,
    tag: '',
    name: '',
    equipType: type,
    orientation: type === 'hx' ? 'horizontal' : type === 'tank' ? 'vertical' : 'vertical',
    sections: [
      {
        id: uid('sec'),
        dia: type === 'tank' ? 6000 : 1200,
        ttLength: type === 'tank' ? 12000 : 3000,
        headTop: type === 'tank' || type === 'hx' || type === 'finfan' ? 'none' : 'ellip2',
        headBottom: type === 'tank' || type === 'finfan' ? 'none' : 'ellip2',
        shellThk: 0,
        headThkTop: 0,
        headThkBot: 0,
        coneAngleDeg: 0,
        coneThk: 0,
      },
    ],
    nozzles: [],
    internals: [],
    support:
      type === 'tank'
        ? { type: 'none', legCount: 0, saddleSpan: 0, saddleAngle: 120, skirtH: 0, legPlateThk: 0, baseRing: false, padeyes: false, guyLines: false }
        : type === 'hx' || type === 'finfan'
        ? { type: 'saddle', legCount: 2, saddleSpan: 2400, saddleAngle: 120, skirtH: 0, legPlateThk: 16, baseRing: false, padeyes: false, guyLines: false }
        : { type: 'legs', legCount: 4, saddleSpan: 0, saddleAngle: 120, skirtH: 1000, legPlateThk: 16, baseRing: true, padeyes: true, guyLines: false },
    materialKey: type === 'tank' ? 'SA-285-C' : 'SA-516-70',
    corrosionAllowance: 3,
    designPressure: type === 'tank' ? 1 : type === 'finfan' ? 25 : 16,
    designTemp: type === 'tank' ? 65 : 200,
    mdmt: -29,
    externalPressure: 0.1,
    rtCategory: 'spot',
    inspectionLevel: '3.1',
    clad: { mode: 'none', kind: 'weldOverlay', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 0, note: '' },
    ndtPlan: defaultNdtPlan('spot'),
    pwhtOverride: null,
    mwps: 0,
    testPressureFactor: 1.3,
    notes: '',
    ...(type === 'tank'
      ? {
          tank: {
            fluidName: 'Crude oil',
            specificGravity: 0.85,
            roofType: 'cone' as const,
            primarySeal: 'shoe' as const,
            secondarySeal: 'metal' as const,
            annularBottom: true,
            bottomThk: 0,
            roofThk: 6,
            windPressure: 1.2,
            seismic: false,
            shellAllowableOverride: 0,
            stiffenerRings: false,
            maxDesignLiquidLevel: 0,
          },
        }
      : {}),
    ...(type === 'hx'
      ? {
          hx: {
            temaType: 'BEM',
            tubeJointType: 'strengthWelded',
            tubeSheetClad: { enabled: false, materialKey: 'SA-240-316L', thicknessMm: 3 },
            shellFluid: 'Hot oil',
            tubeFluid: 'Cooling water',
            shellDiaOD: 0,
            tubeOD: 19,
            tubeWall: 1.65,
            tubeLength: 3000,
            tubeCount: 0,
            pitch: 25,
            layoutAngle: 30 as const,
            baffleType: 'segmental' as const,
            baffleCut: 25,
            baffleSpacing: 0,
            passesTube: 1 as const,
            shellMatKey: 'SA-516-70',
            tubeMatKey: 'SA-179',
            baffleMatKey: 'SA-516-70',
            headMatKey: 'SA-516-70',
            tsMatKey: 'SA-350-LF2',
            designPShell: 10,
            designTShell: 150,
            designPTube: 10,
            designTTube: 150,
            dutyKW: 1500,
            tShellIn: 60,
            tShellOut: 40,
            tTubeIn: 32,
            tTubeOut: 42,
            uOverall: 0,
            tubeSideDP: 0,
            baffleCount: 0,
          },
        }
      : {}),
    ...(type === 'finfan'
      ? {
          finfan: {
            arrangement: 'forced' as const,
            bays: 2,
            rows: 4,
            tubeLength: 9000,
            tubeOD: 25.4,
            tubeWall: 2.11,
            finOD: 57,
            finPitch: 10,
            finThk: 0.4,
            dutyKW: 8000,
            processInC: 120,
            processOutC: 65,
            airInC: 45,
            uAir: 0,
            airRiseC: 0,
            fanEfficiency: 0.65,
            plenumLossH2O: 0.75,
            tubeMatKey: 'SA-179',
            finMatKey: 'SA-240-304',
            headerThk: 16,
            tubeCount: 0,
          },
        }
      : {}),
  };
  return base;
}

function withDefaults(eq: Equipment, patch: Partial<Equipment>): Equipment {
  return { ...eq, ...patch };
}

export function demoProject(): Equipment[] {
  const v = withDefaults(newEquipment('vessel', 1), {
    tag: 'V-101',
    name: 'Separator Drum',
    orientation: 'horizontal',
    materialKey: 'SA-516-70',
    corrosionAllowance: 3,
    designPressure: 16,
    designTemp: 200,
    rtCategory: 'spot',
    clad: { mode: 'partial', kind: 'explosionBonded', materialKey: 'SA-240-316L', thicknessMm: 3, partialLengthMm: 2000, note: 'Wetted bottom half lined 316L' },
    support: { type: 'saddle', legCount: 2, saddleSpan: 2600, saddleAngle: 120, skirtH: 0, legPlateThk: 16 },
  });
  v.sections[0].dia = 1400;
  v.sections[0].ttLength = 4500;
  v.sections[0].headTop = 'toriFD';
  v.sections[0].headBottom = 'toriFD';
  v.nozzles = [
    {
      id: uid('nz'), tag: 'N1', service: 'Gas out', dn: 100, schKey: '40', sectionId: v.sections[0].id,
      elevation: 4200, azimuth: 0, kind: 'process', flangeClass: 300, flangeMatKey: 'SA-105',
      padDia: 0, padThk: 0, projOutside: 150,
    },
    {
      id: uid('nz'), tag: 'N2', service: 'Liquid out', dn: 150, schKey: '40', sectionId: v.sections[0].id,
      elevation: 300, azimuth: 180, kind: 'process', flangeClass: 300, flangeMatKey: 'SA-105',
      padDia: 320, padThk: 12, projOutside: 200,
    },
    {
      id: uid('nz'), tag: 'MW1', service: 'Manway', dn: 500, schKey: '40', sectionId: v.sections[0].id,
      elevation: 2250, azimuth: 90, kind: 'manway', flangeClass: 300, flangeMatKey: 'SA-105',
      padDia: 700, padThk: 20, projOutside: 300,
    },
  ];

  const c = withDefaults(newEquipment('column', 2), {
    tag: 'C-201',
    name: 'Amine Regenerator',
    orientation: 'vertical',
    materialKey: 'SA-516-70',
    designPressure: 3.5,
    designTemp: 150,
    rtCategory: 'full',
    inspectionLevel: '3.2',
  });
  c.ndtPlan = [
    { method: 'mt', enabled: true, timing: 'final', extent: 'full', note: 'All pressure welds' },
    { method: 'ut', enabled: true, timing: 'final', extent: 'sample', note: 'Nozzle UT per UW-11(b)' },
    { method: 'rt', enabled: true, timing: 'afterPwht', extent: 'full', note: '100 % RT (E=1.0)' },
    { method: 'putTofd', enabled: false, timing: 'afterPwht', extent: 'full', note: 'Alternative to RT — enable per client spec' },
  ];
  c.sections[0].dia = 1800;
  c.sections[0].ttLength = 18000;
  c.internals = [
    { id: uid('in'), kind: 'valveTray', count: 20, spacing: 600, bottomElevation: 3000, materialKey: 'SA-240-316L', kgPerM2: 65, note: 'Valve trays, 4-pass' },
    { id: uid('in'), kind: 'demister', count: 1, spacing: 150, bottomElevation: 16200, materialKey: 'SA-240-316L', kgPerM2: 12, note: 'Wire mesh demister' },
  ];

  const hx = withDefaults(newEquipment('hx', 3), {
    tag: 'E-301',
    name: 'Product Condenser',
    orientation: 'horizontal',
    designPressure: 0,
    designTemp: 0,
  });
  hx.hx!.designPShell = 12;
  hx.hx!.designPTube = 12;
  hx.hx!.tubeSheetClad = { enabled: true, materialKey: 'SA-240-316L', thicknessMm: 3 };
  hx.hx!.tubeJointType = 'sealWeldExpanded';

  const ff = withDefaults(newEquipment('finfan', 4), {
    tag: 'AC-401',
    name: 'Main Air Cooler',
    orientation: 'horizontal',
  });

  const tk = withDefaults(newEquipment('tank', 5), {
    tag: 'TK-501',
    name: 'Crude Oil Storage Tank',
    orientation: 'vertical',
    materialKey: 'SA-285-C',
  });
  tk.sections[0].dia = 12000;
  tk.sections[0].ttLength = 14000;

  return [v, c, hx, ff, tk];
}
