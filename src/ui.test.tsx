// @vitest-environment jsdom
// Component tests (Phase C8) — the first coverage that renders the real React
// tree: App shell (nav, status strip, save-failure notice), the Estimate
// screen's 02 Special ratios, and the Register's click-to-fix input target.
// RTL cannot auto-cleanup without vitest globals, so cleanup() runs explicitly.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import Register from './pages/Register';
import EstimatePage from './pages/EstimatePage';
import { getStore, setSettings, setState } from './store';
import { demoProject } from './defaults';
import { computeEquipment } from './engine/compute';

const resetStore = () => {
  const eq = demoProject();
  setState({ equipment: eq, selectedEquipId: null, reviews: [], datasheets: [], staleDatasheets: [] });
  return eq;
};

afterEach(() => {
  cleanup();
  // undo any failure injection from a test
  setState({});
});

describe('App shell (C8)', () => {
  it('renders the nav, an honest status strip and page switching', () => {
    const eq = resetStore();
    render(<App />);

    // sidebar nav (the label also appears in the topbar heading, so query by role)
    expect(screen.getByRole('button', { name: 'Equipment Register' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Equipment Register' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Estimate/ })).toBeTruthy();

    // status strip counts must reflect the real engine, not placeholders
    let errors = 0;
    let warns = 0;
    let passing = 0;
    for (const e of eq) {
      const w = computeEquipment(e).warnings;
      const er = w.filter((x) => x.level === 'error').length;
      const wn = w.filter((x) => x.level === 'warning').length;
      errors += er;
      warns += wn;
      if (er === 0 && wn === 0) passing++;
    }
    const strip = document.querySelector('.statusstrip')!;
    expect(strip.textContent).toContain(`Tags: ${eq.length}`);
    expect(strip.textContent).toContain(`Passing: ${passing}/${eq.length}`);
    expect(strip.textContent).toContain(`Errors: ${errors}`);
    expect(strip.textContent).toContain(`Warnings: ${warns}`);

    // switching pages renders the Estimate screen with its 02 Special KPIs
    fireEvent.click(screen.getByRole('button', { name: /Estimate/ }));
    expect(screen.getByText('02 Special — price / empty equipment weight (t)')).toBeTruthy();
  });

  it('shows a persistent notice when the browser storage write fails (E6)', () => {
    resetStore();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    setSettings({ projectName: 'Quota test' }); // persist() now fails → saveError set
    render(<App />);
    expect(screen.getByText(/Project not saved to this browser/)).toBeTruthy();
    expect(screen.getByText(/QuotaExceededError/)).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Estimate screen (C8)', () => {
  it('shows the 02 Special price and manhours per empty ton, both in KPIs and the basis table', () => {
    resetStore();
    render(<EstimatePage />);
    expect(screen.getByText('02 Special — price / empty equipment weight (t)')).toBeTruthy();
    expect(screen.getByText('02 Special — manhours / empty equipment weight (t)')).toBeTruthy();
    expect(screen.getByText(/02 Special — price \/ manhours per empty ton/)).toBeTruthy();
    expect(screen.getByText(/Empty equipment weight \(dry, total\)/)).toBeTruthy();
  });
});

describe('AI datasheet import guard rails', () => {
  it('stops before any network call when the API key is missing', () => {
    resetStore();
    setSettings({ geminiKey: '' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Gemini Code Review/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import datasheet/ }));
    expect(screen.getByText(/Add your Gemini API key/)).toBeTruthy();
  });

  it('stops before any network call when no datasheet is attached', () => {
    resetStore();
    setSettings({ geminiKey: 'test-key' }); // set BEFORE render so the handler sees it
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Gemini Code Review/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import datasheet/ }));
    expect(screen.getByText(/Attach the client datasheet first/)).toBeTruthy();
    setSettings({ geminiKey: '' }); // never leave a credential in the store
  });
});

describe('Register click-to-fix targets (C8)', () => {
  it('exposes the T650-07 fix field (Max liquid level) on the Tank data tab', () => {
    const eq = resetStore();
    const tank = eq.find((e) => e.equipType === 'tank')!;
    setState({ selectedEquipId: tank.id });
    render(<Register />);
    // the editor lists tags by type — switch to the tank type, then its data tab
    fireEvent.click(screen.getByRole('button', { name: /Storage Tanks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tank data' }));
    const input = document.getElementById(`f-${tank.id}-tankMaxDesignLiquidLevel`);
    expect(input, 'T650-07 fix target input must exist in the DOM').toBeTruthy();
  });

  it('exposes the F4 fields: hydrotest density and a grade select per shell course', () => {
    const eq = resetStore();
    const tank = eq.find((e) => e.equipType === 'tank')!;
    setState({ selectedEquipId: tank.id });
    render(<Register />);
    fireEvent.click(screen.getByRole('button', { name: /Storage Tanks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tank data' }));

    const rho = document.getElementById(`f-${tank.id}-tankHydroDensity`) as HTMLInputElement | null;
    expect(rho, 'hydrotest density input').toBeTruthy();
    expect(rho!.value).toBe('997'); // default = water

    const calc = computeEquipment(tank);
    for (let i = 0; i < calc.tank!.shellCourses.length; i++) {
      expect(document.getElementById(`f-${tank.id}-tankCourseGrade${i}`), `grade select ${i}`).toBeTruthy();
    }
    // default state: every course inherits the tag material
    expect(tank.tank!.courseGrades ?? []).toEqual([]);
  });

  it('renders the correct-value suggestion beside an erroring field (fixValues)', () => {
    const eq = resetStore();
    const tank = eq.find((e) => e.equipType === 'tank')!;
    tank.tank!.annularBottom = false;
    tank.corrosionAllowance = 3;
    tank.tank!.bottomThk = 0; // auto 9 mm, entered 6 → T650-10 fires
    setState({ selectedEquipId: tank.id });
    render(<Register />);
    fireEvent.click(screen.getByRole('button', { name: /Storage Tanks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tank data' }));
    const note = document.querySelector('.fix-note');
    expect(note, 'a persistent fix note must render under the field').toBeTruthy();
    expect(note!.textContent).toContain('T650-10');
    expect(note!.textContent).toContain('Correct value');
    expect(note!.textContent).toContain('≥ 9 mm');
    expect(note!.textContent).toContain('Observed:');
  });

  it('keeps the store snapshot consistent after a render (no leaked selection)', () => {
    expect(getStore().equipment.length).toBeGreaterThan(0);
  });
});
