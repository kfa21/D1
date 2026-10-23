// Central compute dispatcher — routes each equipment type to its engine.

import type { Equipment, EquipmentCalc } from './types';
import { computeVessel } from './asme';
import { computeTank } from './api650';
import { computeHX } from './tema';
import { computeFinFan } from './api661';
import { computeSupports } from './supports';

export function computeEquipment(equip: Equipment): EquipmentCalc {
  try {
    let calc: EquipmentCalc;
    switch (equip.equipType) {
      case 'tank':
        calc = equip.tank ? computeTank(equip) : broken(equip, 'Tank data missing');
        break;
      case 'hx':
        calc = equip.hx ? computeHX(equip) : broken(equip, 'HX data missing');
        break;
      case 'finfan':
        calc = equip.finfan ? computeFinFan(equip) : broken(equip, 'Fin-fan data missing');
        break;
      default:
        calc = computeVessel(equip);
    }
    // every tag gets its per-kind support breakdown (legs/saddles/skirt/ring/…)
    calc.supports = computeSupports(equip, calc);
    return calc;
  } catch (e) {
    return broken(equip, e instanceof Error ? e.message : String(e));
  }
}

function broken(equip: Equipment, msg: string): EquipmentCalc {
  return {
    equip,
    codeRef: '—',
    mawpBar: 0,
    mawpNote: 'Calculation error',
    sections: [],
    nozzles: [],
    hydroTestBar: 0,
    hydroTestBottomBar: 0,
    weightDryKg: 0,
    weightHydroKg: 0,
    weightOperatingKg: 0,
    internalVolumeM3: 0,
    paintAreaM2: 0,
    weldLengthM: 0,
    membraneUtil: 0,
    weldEfficiency: 1,
    pwht: { required: false, basis: msg, preheat: '—', procedure: '—', fillers: [] },
    warnings: [{ level: 'error', code: 'SYS', msg }],
    materialName: '—',
    sAllow: 0,
  };
}
