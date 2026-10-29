// Per-equipment-type field scope.
//
// The register used to show one generic form to every tag, so a storage tank was
// asked for an ASME UCS-56 PWHT decision and a fin-fan for a shell course layout.
// This module is the single list of what is actually relevant for each equipment
// type; the UI reads it and hides everything else, so a designer only ever sees
// inputs that their code (ASME VIII-1, TEMA, API 650, API 661) actually uses.

import type { EquipType } from './types';

/** General-tab inputs, keyed so the UI can test each one. */
export type GeneralField =
  | 'material'
  | 'corrosionAllowance'
  | 'designPressure'
  | 'designTemp'
  | 'mdmt'
  | 'externalPressure'
  | 'rtCategory'
  | 'inspectionLevel'
  | 'pwht'
  | 'testPressureFactor'
  | 'notes';

export type DetailTab = 'general' | 'sections' | 'nozzles' | 'internals' | 'type';

export interface TypeScope {
  /** general-tab inputs that apply to this equipment type */
  general: Record<GeneralField, boolean>;
  /** detail tabs offered (the type-specific tab is always last) */
  tabs: DetailTab[];
  /** tangential sections + cones (a fin-fan has headers, not a shell) */
  sections: boolean;
  /** trays, packing, demisters, support rings */
  internals: boolean;
  /** cladding / weld-overlay block */
  cladding: boolean;
  /** wind / seismic anchor-bolt block */
  designLoads: boolean;
  /** preferred-NDT-method advisory */
  ndtMethod: boolean;
  /** WRC 107 local-load screening at the nozzle junction */
  localLoads: boolean;
  /** UG-37 reinforcing-pad input */
  pad: boolean;
  /** UG-37 / UG-45 reinforcement columns (A_req / A_prov / neck t) */
  reinforcement: boolean;
  /** label of the type-specific tab */
  typeTabLabel: string;
}

const ALL_GENERAL: Record<GeneralField, boolean> = {
  material: true,
  corrosionAllowance: true,
  designPressure: true,
  designTemp: true,
  mdmt: true,
  externalPressure: true,
  rtCategory: true,
  inspectionLevel: true,
  pwht: true,
  testPressureFactor: true,
  notes: true,
};

/**
 * What each equipment type really needs. Anything set to false is not read by that
 * type's engine — showing it only invites a wrong entry.
 */
export const TYPE_SCOPE: Record<EquipType, TypeScope> = {
  // ASME VIII-1 pressure vessel: the full Div. 1 input set
  vessel: {
    general: { ...ALL_GENERAL },
    tabs: ['general', 'sections', 'nozzles', 'internals', 'type'],
    sections: true,
    internals: true,
    cladding: true,
    designLoads: true,
    ndtMethod: true,
    localLoads: true,
    pad: true,
    reinforcement: true,
    typeTabLabel: 'Supports & code',
  },
  // a column is a vessel with internals and a taller support arrangement
  column: {
    general: { ...ALL_GENERAL },
    tabs: ['general', 'sections', 'nozzles', 'internals', 'type'],
    sections: true,
    internals: true,
    cladding: true,
    designLoads: true,
    ndtMethod: true,
    localLoads: true,
    pad: true,
    reinforcement: true,
    typeTabLabel: 'Supports & code',
  },
  // TEMA exchanger: the shell/channel are VIII-1 parts, the bundle is TEMA. The
  // cladding block is replaced by the tubesheet-face overlay on the TEMA tab, and
  // trays/packing do not exist inside a bundle.
  hx: {
    general: { ...ALL_GENERAL },
    tabs: ['general', 'sections', 'nozzles', 'type'],
    sections: true,
    internals: false,
    cladding: false,
    designLoads: false,
    ndtMethod: true,
    localLoads: true,
    pad: true,
    reinforcement: true,
    typeTabLabel: 'TEMA data',
  },
  // API 650: shell thickness comes from the liquid head, no UCS-56 PWHT, no
  // UW-11 radiography category, no UG-99 test factor and no vacuum design.
  tank: {
    general: {
      ...ALL_GENERAL,
      mdmt: false,
      externalPressure: false,
      rtCategory: false,
      inspectionLevel: false,
      pwht: false,
      testPressureFactor: false,
    },
    tabs: ['general', 'sections', 'nozzles', 'type'],
    sections: true,
    internals: false,
    cladding: false,
    designLoads: true,
    ndtMethod: false,
    localLoads: false,
    pad: true,
    reinforcement: true,
    typeTabLabel: 'Tank data',
  },
  // API 661 air cooler: a bundle and a fan, no shell courses, no internals and no
  // vessel test/PWHT decisions — the headers are rated on the tube design data.
  finfan: {
    general: {
      ...ALL_GENERAL,
      corrosionAllowance: false,
      mdmt: false,
      externalPressure: false,
      rtCategory: false,
      inspectionLevel: false,
      pwht: false,
      testPressureFactor: false,
    },
    tabs: ['general', 'nozzles', 'type'],
    sections: false,
    internals: false,
    cladding: false,
    designLoads: false,
    ndtMethod: false,
    localLoads: false,
    pad: false,
    reinforcement: false,
    typeTabLabel: 'Fin-fan data',
  },
};

export function scopeFor(type: EquipType): TypeScope {
  return TYPE_SCOPE[type] ?? TYPE_SCOPE.vessel;
}

/** Is this general-tab field relevant for the tag? */
export function fieldApplies(type: EquipType, field: GeneralField): boolean {
  return scopeFor(type).general[field] !== false;
}
