// Central compute dispatcher — routes each equipment type to its engine.

import type { Equipment, EquipmentCalc } from './types';
import { computeVessel } from './asme';
import { computeTank } from './api650';
import { computeHX } from './tema';
import { computeFinFan } from './api661';
import { computeSupports } from './supports';
import { accessCheck } from './accessCheck';

/**
 * Memo for the (pure) compute dispatch: an Equipment object is only ever
 * replaced, never mutated in place, and the engines read nothing outside the
 * tag itself — so object identity is a sound cache key. Without this every
 * page re-ran each tag's full engine several times per render.
 */
const cache = new WeakMap<Equipment, EquipmentCalc>();

export function computeEquipment(equip: Equipment): EquipmentCalc {
  const hit = cache.get(equip);
  if (hit) return hit;
  const calc = computeUncached(equip);
  cache.set(equip, calc);
  return calc;
}

function computeUncached(equip: Equipment): EquipmentCalc {
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
    // …and the access steelwork is checked, not just drawn: ladder runs vs deck
    // levels, unbroken climb, platform beam/deflection, stair pitch, walkways
    try {
      calc.access = accessCheck(equip, calc);
      calc.warnings.push(...calc.access.warnings);
    } catch {
      // access checks must never take down the pressure-boundary calculation
    }
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
