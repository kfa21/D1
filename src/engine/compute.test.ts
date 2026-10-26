// E5 — computeEquipment is memoised: the engines are pure and Equipment
// objects are replaced (never mutated) on every edit, so identity is the key.

import { describe, it, expect } from 'vitest';
import { computeEquipment } from './compute';
import { demoProject } from '../defaults';

describe('computeEquipment memo', () => {
  it('returns the identical calc object for the same tag object', () => {
    const [eq] = demoProject();
    const a = computeEquipment(eq);
    const b = computeEquipment(eq);
    expect(b).toBe(a);
    // repeated calls from several loops in one render cost one lookup each
    expect(computeEquipment(eq)).toBe(a);
  });

  it('recomputes when the tag object is replaced (an edit creates a new object)', () => {
    const [eq] = demoProject();
    const before = computeEquipment(eq);
    const edited = { ...eq, designPressure: eq.designPressure + 1 };
    const after = computeEquipment(edited);
    expect(after).not.toBe(before);
    expect(after.mawpBar).not.toBe(before.mawpBar);
  });

  it('caches failure results too instead of rethrowing per call', () => {
    const broken = { id: 'x', tag: 'X', name: 'missing data', equipType: 'tank' } as never;
    const a = computeEquipment(broken);
    expect(a.warnings[0].level).toBe('error');
    expect(computeEquipment(broken)).toBe(a);
  });
});
