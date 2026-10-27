// Click-to-fix plumbing: a warning click anywhere in the app requests a jump
// to the offending input. App switches page, Register selects the tag and
// opens the right tab, DetailEditor focuses the field, and <FixNote/> renders
// the correction hint directly below that field.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { WARNING_CATALOG } from './engine/warnings';
import { fixFor, fieldId, WARNING_FIX, type FixTab } from './fixes';
import { useStore } from './store';
import { computeEquipment } from './engine/compute';
import { suggestedValue } from './fixValues';

export interface FixRequest {
  equipId: string;
  code: string;
  tab: FixTab;
  field: string;
  at: number;
}

/** requests older than this are ignored (user moved on without acting) */
const FRESH_MS = 5 * 60_000;

let current: FixRequest | null = null;
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

export function requestFix(r: Omit<FixRequest, 'at'> | null) {
  current = r ? { ...r, at: Date.now() } : null;
  emit();
}

/** Look a code up in the fix registry and request the jump (clears when unknown). */
export function requestFixFor(equipId: string, code: string) {
  const fx = fixFor(code);
  if (!fx || !fx.field || !fx.tab) {
    // no single input to jump to — the caller shows the hint inline in the list
    requestFix(null);
    return;
  }
  requestFix({ equipId, code, tab: fx.tab, field: fx.field });
}

export function getFix(): FixRequest | null {
  if (!current) return null;
  return Date.now() - current.at <= FRESH_MS ? current : null;
}

export function subscribeFix(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useFix(): FixRequest | null {
  return useSyncExternalStore(subscribeFix, getFix, getFix);
}

/** Scroll to and highlight a fix target; returns false when the input is not on screen. */
export function focusField(r: FixRequest): boolean {
  if (!r.field) return false;
  const el = document.getElementById(fieldId(r.equipId, r.field));
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  (el as HTMLElement).focus({ preventScroll: true });
  el.classList.add('field-focus');
  window.setTimeout(() => el.classList.remove('field-focus'), 3000);
  return true;
}

/**
 * Correction note rendered directly below the field it belongs to.
 *
 * Shows EVERY active warning whose registry entry targets this field (not only
 * after a click), each with the static correction hint, the engine's observed
 * message, and — when one is computable — a concrete CORRECT VALUE to enter
 * (see fixValues.suggestedValue). A click-to-fix from a warning list brings
 * that code's note to the top and focuses the field.
 */
export function FixNote({ equipId, field }: { equipId: string; field: string }) {
  const fix = useFix();
  const equip = useStore((s) => s.equipment.find((e) => e.id === equipId));
  const calc = useMemo(() => (equip ? computeEquipment(equip) : null), [equip]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  if (!equip || !calc || !field) return null;

  const clickedHere = fix?.equipId === equipId && fix.field === field;
  const active = calc.warnings
    .filter((w) => WARNING_FIX[w.code]?.field === field && !dismissed.includes(w.code))
    .sort((a, b) => (clickedHere && fix!.code === a.code ? -1 : clickedHere && fix!.code === b.code ? 1 : 0));
  if (active.length === 0) return null;

  return (
    <>
      {active.map((w) => {
        const fx = fixFor(w.code);
        if (!fx) return null;
        const level = WARNING_CATALOG[w.code]?.level ?? 'info';
        const sug = suggestedValue(w.code, equip, calc);
        return (
          <div key={w.code} className={`finding ${level} fix-note`} role="note">
            <div>
              <strong>{w.code}</strong> — how to correct: {fx.suggest}
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>
              Observed: {w.msg}
            </div>
            {sug && (
              <div style={{ marginTop: 2 }}>
                ✔ Correct value: <strong>{sug.value}</strong>
                <span className="small muted"> — {sug.basis}</span>
              </div>
            )}
            <button
              className="ghost"
              title="Dismiss suggestion"
              style={{ marginTop: 4 }}
              onClick={() => {
                setDismissed((d) => [...d, w.code]);
                if (fix?.code === w.code) requestFix(null);
              }}
            >
              ✕ Dismiss
            </button>
          </div>
        );
      })}
    </>
  );
}
