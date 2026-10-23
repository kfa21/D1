// PWHT advisory per ASME VIII-1 UCS-56 (indicative), preheat guidance and
// matching consumables. Generates a shop-usable procedure outline.

import type { PwhtAdvice } from './types';
import { getMat } from './materials';

export function pwhtAdvice(
  matKey: string,
  maxThickness: number,
  mdmt: number,
  override: boolean | null
): PwhtAdvice {
  const m = getMat(matKey);
  let required = false;
  let basis = '';

  if (m.group === 'CS' || m.group === 'LTCS') {
    required = maxThickness > m.pwhtThresholdMm || mdmt < -29;
    basis = `UCS-56 / Fig. UCS-66 curve B: t = ${maxThickness.toFixed(1)} mm vs threshold ${m.pwhtThresholdMm} mm; MDMT ${mdmt} °C`;
  } else if (m.group === 'CrMo') {
    required = maxThickness > m.pwhtThresholdMm;
    basis = `UCS-56 Table UCS-56-4 for P-No.${m.pno}: PWHT above ~${m.pwhtThresholdMm} mm`;
  } else {
    required = false;
    basis = `${m.group}: no mandatory PWHT — ${m.pwhtNote}`;
  }

  if (override !== null) required = override;

  let tempRange = '600–650 °C (P-No.1) — hold ±15 °C';
  if (m.group === 'LTCS') tempRange = '600–640 °C (impact-tested plates: follow MDMT-specific range)';
  if (m.group === 'CrMo') tempRange = m.pno === 5 ? '690–730 °C (2.25Cr-1Mo)' : '700–760 °C (1.25Cr-0.5Mo)';
  if (m.group.startsWith('SS')) tempRange = 'N/A — solution anneal 1010–1120 °C only if sensitised';
  if (m.group === 'Duplex' || m.group === 'SuperDuplex') tempRange = 'N/A — no field PWHT (solution annealed product)';

  const hold = `≥ 1 h per 25 mm of thicker section, minimum 15 min at temperature`;

  const procedure = required
    ? `PWHT PROCEDURE (${m.name})
1. PWHT after all structural welds & NDT of welds requiring examination; hydrostatic test after PWHT.
2. Heating rate: ≤ 220 °C/h (400 °F/h) until 315 °C; below 315 °C heating may be faster if uniform.
3. Hold temperature: ${tempRange}. Thermocouples on shell (min. 2 per 3 m of length) + gradient ≤ 50 °C.
4. Soak: ${hold}.
5. Cooling rate: ≤ 220 °C/h down to 315 °C, then still-air cooling; gradients ≤ 50 °C.
6. Hardenable materials (P-No.4/5/7/8) require controlled preheat — see procedure WPS-PWHT-01.
7. Records: time/temperature chart per vessel, calibrated instruments (±10 °C), traceable to tag.`
    : `No PWHT required for ${m.name} at t = ${maxThickness.toFixed(1)} mm, MDMT ${mdmt} °C.
${m.pwhtNote}`;

  let preheat = 'None required for t ≤ 20 mm when ambient ≥ 0 °C (UW-28 / P-No.1 Gr.1,2)';
  if (m.group === 'CrMo') preheat = 'Preheat 150–200 °C (P-No.4/5), interpass ≤ 315 °C, controlled cooling';
  if (m.group === 'Duplex' || m.group === 'SuperDuplex')
    preheat = 'Preheat ≤ 100 °C; heat input 0.5–2.5 kJ/mm (2507: 0.5–2.0), interpass ≤ 150 °C, fast stringer beads, purge backing';
  if (m.group.startsWith('SS')) preheat = 'Not required; clean interpasses, avoid CS contamination, ferrite check on 304/316 welds (5–15 FN)';
  if (m.group === 'LTCS') preheat = 'Preheat 100–150 °C for t > 25 mm; impact-tested consumables; control interpass ≤ 250 °C';

  return { required, basis, preheat, procedure, fillers: m.fillers };
}

export function consumablesFor(matKey: string): { smaw: string; gtaw: string; fcaw: string } {
  const m = getMat(matKey);
  const list = m.fillers;
  return {
    smaw: list.find((f) => f.startsWith('E')) ?? list[list.length - 1],
    gtaw: list.find((f) => f.startsWith('ER')) ?? list[0],
    fcaw: list.find((f) => f.includes('flux')) ?? '—',
  };
}
