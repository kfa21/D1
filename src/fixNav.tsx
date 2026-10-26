// Click-to-fix plumbing: a warning click anywhere in the app requests a jump
// to the offending input. App switches page, Register selects the tag and
// opens the right tab, DetailEditor focuses the field, and <FixNote/> renders
// the correction hint directly below that field.

import { useSyncExternalStore } from 'react';
import { WARNING_CATALOG } from './engine/warnings';
import { fixFor, fieldId, type FixTab } from './fixes';

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

/** Correction hint that renders directly below the field it belongs to. */
export function FixNote({ equipId, field }: { equipId: string; field: string }) {
  const fix = useFix();
  if (!fix || fix.equipId !== equipId || !field || fix.field !== field) return null;
  const fx = fixFor(fix.code);
  if (!fx) return null;
  const level = WARNING_CATALOG[fix.code]?.level ?? 'info';
  return (
    <div className={`finding ${level} fix-note`} role="note">
      <div>
        <strong>{fix.code}</strong> — how to correct: {fx.suggest}
      </div>
      <button
        className="ghost"
        title="Dismiss suggestion"
        style={{ marginTop: 4 }}
        onClick={() => requestFix(null)}
      >
        ✕ Dismiss
      </button>
    </div>
  );
}
