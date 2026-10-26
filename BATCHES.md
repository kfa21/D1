# Work batches — sequenced plan & resume instructions

This file is the single source of truth for incremental work on this project.
**A new chat resumes by reading this file, then `git log --oneline -10`.**

## Rules for every batch

1. One batch = one commit (or a few small commits), pushed to `main` before starting the next.
2. Every batch must leave the repo green: `npx tsc --noEmit` + `npx vitest run` + `npm run build`.
3. Mark the batch `[x]` here and append its commit hash in the same commit that finishes it.
4. New warning codes go in `src/engine/warnings.ts` (tests validate emitted codes against the catalog).
5. New formulas get a golden test in `src/engine/corrections.test.ts` pinned to a published/hand-calculated value.
6. Do not batch unrelated changes together — if a batch grows, split it.

## Status legend

`[ ]` pending · `[~]` in progress · `[x]` done

---

## Phase A — Engine correctness (high priority)

- [x] **B1** API 650 anchor bolts → shared elastic bolt-group engine (wind/seismic, spacing, allowable) — `85d17c2`
- [x] **B2** Bottom-plate 6 mm *corroded* rule (+ CA) and annular ring mass in tank weight — `e141903`
- [x] **B3** VDP convergence guard + per-course design point (x, method) surfaced in TankCalc/Reports — `305147a`
- [x] **B4** UI surfacing: annular readout, nozzle local loads in Reports, AiReview prompt, loads-grid layout — `d708e7c`
- [x] **B5** Code-split Viewer3D + three.js vendor chunk (clears >500 kB warning) — `364a3bb`
- [x] **B6** WRC screening: pressure membrane × shell shear interaction — `b1418b6`
- [x] **B7a** Shell-side rating + tube-vibration screening — ESDU 73031 ideal bank × Bell Jc/JL/JB/JR, Kern shell ΔP, fₙ/Connors/Strouhal/acoustic screen (`src/engine/shellside.ts`, warnings HX-12…HX-18) — `9aecbde`
- [x] **B7b** Full Delaware ΔP: ideal-bank j/f + ΔP correction charts — **closed as unimplementable**: licensed chart data and ht's knot-padding convention unrecoverable; Kern ΔP (B7a) ships as the documented ~2.9 % approximation — `340a915`
- [x] **B8** External-pressure stiffening-ring inertia (49 CFR 179.400-9: `W = 0.78√(Rt)`, `I`, `I′`, combined section) — `src/engine/rings.ts`, codes RG-01…03; saddle/Zick ring sizing still licensed (SD-06 stays advisory) — `340a915`

## Phase B — Features

- [x] **B9** PDF datasheet / BOQ + plate-procurement export (jsPDF, lazy 388 kB chunk) — `340a915`
- [x] **B10** Imperial unit mode — reporting only (engine stays SI; editor/entry untouched) — `340a915`
- [x] **B11** ASME VIII-2 Part 5 design-by-analysis screen — limited to plainly-sourced primary limits (S = min(Su/2.4, Sy/1.5)); fatigue screening deliberately not implemented — `340a915`

## Phase A2 — Action points requested in session (NDT / man-hours / click-to-fix)

- [x] **A1** Remove the per-weld "NDT plan (per weld method)" editor from the Register — the plan stays engine-derived and is read-only on Inspection & ITP — `fbfd9d9`
- [x] **A2** ITP stage phase boxes actually add/reduce hours: effective hours apportioned by ticked/default phases, per-row delta shown; default coverage still equals the engine hours exactly — `a2384ed`
- [x] **A3** Settings documents every man-hour considered (25 basis entries with derivations) and accepts a manual input per item; the difference is booked as an explicit `Manual manhour adjustment` line — `8330eb3`
- [x] **A4** Clickable errors/warnings — `fixes.ts` maps every catalog code to tab + field + correction hint; clicking jumps to the Register, selects the tag, opens the tab, focuses/pulses the field and shows the hint below it (no-field codes show the hint inline) — `bebfa1a`

## Phase A3 — 3D view correctness (requested in session)

- [x] **A5** Single source of truth for view geometry — `src/engine/layout3d.ts` (pure, unit-tested): body stack from the section list (bottom head → courses → cones → top head), head depths matching `asme.ts`, datum, total length, nozzle lookup with clamping + cone interpolation, saddle stations, per-orientation radial direction. Fixes: cones always widened upward, the bottom head was drawn a head-depth below the shell, `totalLen` omitted the cone the renderer drew, out-of-range nozzle elevations jumped to the bottom course, horizontal azimuth 0° pointed at the floor — `59ff5cf`
- [x] **A6** Supports placed where they attach — saddles symmetric about the **shell** centre (not the bottom-head tip) at the local course radius; legs/skirt hang below the datum to grade; lifting lugs follow the surface (on a drum: on the crown, spread along the axis); guy lines attach to the shell and to the deadman at grade — `82334bd`
- [x] **A7** CAD export parity — OBJ and DXF build from the same layout: OBJ gains the bottom head and the cone transitions (multi-dia was loose floating cylinders) and uses the engine head depths; DXF draws full 180° head arcs, closes diameter steps with the cone flanks, and measures nozzle elevations from the bottom tangent like the viewer — `9e67b13`

## Phase A4 — Estimate for management (requested in session)

- [x] **A8** Estimate screen presentation + interactivity — `src/engine/estimateSummary.ts` (pure: cost groups, four-bucket split, markup ladder, top drivers, unit metrics; closure-tested against the real estimate) drives a document header, unit-ratio KPI row, stacked cost-structure bar, per-category table, markup build-up, sortable per-tag table with share bars, top-cost-drivers panel, "basis of estimate" rate-card reference, and a detail table with search/tag/group filters plus collapsible group-by buckets — `734635f`
- [x] **A9** Cost-estimate PDF (jsPDF, on demand) — summary, cost structure, category, build-up, per-tag, drivers, rate-card basis, every detail line with repeating headers, caveat and sign-off block; built and asserted in `pdfexport.test.ts` — `8fd3997`
- [x] **A10** Titled spreadsheet exports — `exportSheet()` (title block → headings → data → totals → notes, RFC-4180 quoting, `sheetMeta()` context) applied to all seven CSV exports: estimate, BOM, plate procurement, optimized procurement, calculation data, ITP and stage schedule — `4d63664`

## Phase C — Known code-review defects (fix before/with the batch noted)

- [ ] **C1** Non-annular bottom plates: confirm the 6 mm floor is applied as `6 + CA` (corroded) and not nominal — *verify B2 landed correctly; fix if not.*
- [ ] **C2** Tank weights: `annularThk` reflected in `bottomWeight`; roof-slope constants (`1.055`, `1.05`, `0.6`) documented or replaced with named, sourced values.
- [ ] **C3** VDP fixed 5-pass loop: warn when a course does not converge (only reported, not yet warned).
- [ ] **C4** WRC screening: resolve nozzle loads into the shell frame via nozzle azimuth; add shell-side interaction of shear + pressure as a single utilisation (partially done in B6).
- [ ] **C5** `hasLoad` / `toSI` exported but untested — add unit tests or un-export.
- [ ] **C6** T650-07 numbering gap in the warning catalog — renumber or fill.
- [ ] **C7** Loads grid `repeat(6, 1fr)` cramped on narrow screens — responsive layout.
- [ ] **C8** No UI/component tests (engine-only coverage).

## Phase D — Explicitly deferred (blocked / research)

- [ ] **D1** Full curve-based WRC 107/537 shell stresses — **blocked**: response curves are licensed bulletin data. Acceptable workaround: user-pasted coefficient tables as inputs.
- [ ] **D2** API 650 VDP `L/H` applicability check — mixed-unit form unverified.
- [ ] **D3** Verify VDP upper-course `x` equations and annular `+CA` treatment against a licensed API 650 edition.
- [ ] **D4** K₂/K₃ saddle coefficients published only at 120°/150° — currently interpolated; document or replace.

## Phase E — Code-review scan findings (fix first — E1/E2 change numbers)

- [x] **E1** Nozzle shell-course correctness — `sectionId` is hard-set to `sections[0].id` on creation (`Register.tsx` addNozzle) with **no editor field**, so every nozzle reinforces against the bottom course (`asme.ts` nozzle map) while the viewer places it by elevation. Derive the section from elevation (pure helper over `SectionCalc` bounds, mirroring `layout3d.locateNozzle`), add a "Shell course" select to the nozzle table as an explicit override, and fix `dupRow` to keep an old→new section-id map instead of collapsing all copied nozzles to `sections[0]`. Golden test: a nozzle on a thinner upper course checks against that course's t. Keep the smallest-diameter fallback only for genuinely orphaned legacy data (warn code).
- [ ] **E2** Tank design loads are unreachable — the Design Loads block (Sds / R / Ie) renders only for vertical vessels & columns, yet `api650.ts` reads `equip.designLoads.sds/R/Ie` for tank anchor bolts, so tanks always fall back to defaults. Show the block for tanks, and resolve the duplicated wind input: tanks use `tank.windPressure` (girder + anchors), vessels use `designLoads.windPressureKpa` — one field or a labelled "same as above" link.
- [ ] **E3** Project file hygiene — `exportData` currently ships `geminiKey` in the JSON (strip it, or warn first); `importData` bypasses `migrateToBhdBase` for legacy USD exports; stale `datasheets` refs survive reload while their payloads are memory-only, so AiReview shows "Attached …" and silently omits the file — drop refs on load with a "re-attach" hint.
- [ ] **E4** Deploy gating — `deploy-pages.yml` runs on every `main` push with only `npm run build`; tests never gate the deploy (README claims a green build does). Add `npm test` to the build job or trigger via `workflow_run` on green CI; also de-duplicate CI on `push` + `pull_request` for same-repo PRs.
- [ ] **E5** Compute cache — memo `computeEquipment` in a `WeakMap<Equipment, EquipmentCalc>` (pure function) and delete the redundant calls: Reports re-runs every non-selected tag 3× per render, Inspection recomputes all tags twice inside render despite its `summary` memo, `SupportEditor` recomputes per keystroke.
- [ ] **E6** Store feedback — `persist()` swallows `localStorage` quota errors (silent data loss): surface a persistent "project not saved" notice; split the status strip so errors aren't counted inside the "Warnings" chip.
- [ ] **E7** Dependency & lint hygiene — jspdf 3.x → 4.x (1 critical advisory, breaking API; touches `pdfexport.ts` + tests) and the dev-only tinypool/vitest advisories; ESLint flat config wired into CI (tsc strict alone is the only lint today).

## Phase F — Tank & fin-fan data entry (requested in session)

- [ ] **F1** Fin-fan datasheet fields — `FinFanSpec.airRiseC` exists but has **no editor field** (silently defaults to 15 °C). Add: air temperature rise / air outlet, site design data (elevation → air density replacing the hard-coded 1.2 kg/m³, relative humidity), fin type (L-footed / serrated / G-footed / integral) feeding fin efficiency in the area model, explicit fouling factor (U is currently "0 = auto 55" with fouling folded in), and a fan block (fan diameter or auto-size with the ≥40 % coverage readout, drive type, motor rating). New fields need `warnings.ts` codes + `fixes.ts` targets + golden tests per the batch rules.
- [ ] **F2** Fin-fan live readouts in the editor — surface face velocity, air flow (CMH), finned area, actual tube count, fan BHP/kW and thermal margin (today they surface only in `mawpNote` on Reports), reusing the engine's discarded `fanDia` / `plenumDia` / `fanAreaMin`; remove the unused `d1` "placeholder" in `api661.ts` LMTD and tidy the uncertain `bundleWidth` comment.
- [ ] **F3** Tank roof/bottom fields — roof slope selector (1:16 / 1:20 / custom) replacing the hard-coded `roofSlope = 1.055`, named and sourced dome factor (retires **C2**), annular ring width field (default 600 mm per §5.5.3, currently a literal), and decide `stiffenerRings` — it's in `TankSpec` + defaults but has no UI and no engine read: wire it to the §5.8.7 girder advisory or delete it.
- [ ] **F4** *(optional, larger — split if started)* per-course shell plate grade for tanks (API 650 allows different grades per course; engine, BOM and Reports all assume one `materialKey`) + hydrotest medium density (hard-coded 997 kg/m³).

**Suggested order:** E1 → E2 → F1 → F2 → E3 → E4 → E5 → F3 → E6 → E7; F4 only on request. E1/E2 and F1/F3 change calculated results — land their golden tests before UI polish.

---

## B7 research notes (Bell–Delaware) — used in B7a, source material for B7b

Verified and safe to implement:

- **Ideal-bank heat transfer**: ESDU 73031 correlation — `j = a·Re^m`, constants by Re band and in-line/staggered layout, `Pr^0.34`, row correction. Sources: `ht.readthedocs.io/en/release/ht.conv_tube_bank.html`.
- **Bell correction factors**: `J_l` (baffle leakage), `J_b` (bundle bypass, fit form), `J_c` (window/planar factor), `J_r` (row correction), `J_s` (foil/seed). Sources: `myengineeringtools.com/Thermodynamics/Shell_Tube_Bell_Delaware_Correction_Coeff.html`.
- **Crossflow area / ΔP**: `A_CT` (crossflow area at the tube bundle), `N_CT` (crossflow rows), `N_OF` (tube rows per window), shell-side ΔP = `(N_b+1)·ΔP_cross + N_b·ΔP_window`. Source: `myengineeringtools.com/Thermodynamics/Shell_Tube_Pressure_Drop_Shell_Side.html`.
- **Tube-vibration screening**: fluid-elastic instability ratio, natural frequency, vortex shedding and acoustic flutter checks.

**Honesty constraint**: the original 1963/64 Bell–Delaware ideal-bank `j`/`f` charts are *not* reproduced. Ship it as **"ESDU ideal bank + Bell–Delaware correction structure"** and label it that way in the code, in `README.md`, and in the on-screen caveat.

Code landing zone: `src/engine/shellside.ts` (called from `computeHX` in `tema.ts`); `tema.ts` holds the geometry.

### What B7a actually shipped (so B7b does not redo it)

- **Heat transfer**: `esduNusselt()` — ESDU 73031 (a/m tables, Pr^0.34, F2 row table,
  F1 wall correction (Pr/Prw)^0.26), × `bellJC` (HEDH fit 0.55+0.72·Fc), `bellJL`
  (HEDH fit), `bellJB` (HEDH fit, no seal strips credited ⇒ conservative),
  `bellJR` (20 < Re < 100 band), Js = 1. Golden-tested against ht's published
  worked example: Nu(Re=1.32e4, Pr=0.71, 8 rows) = 98.2563319140594.
- **ΔP**: Kern equivalent-diameter method using `kernFriction()` — the Kern chart
  digitised as a cubic B-spline by `ht` (MIT, Caleb Bell), de Boor ported.
  **Known deviation:** reproduces ht's own worked example to ~2.9 % (19 521 vs
  18 981 Pa) because the knot-padding convention of `implementation_optimize_tck`
  could not be recovered; the chart itself is read to ±10 %. B7b should settle this
  (either recover the convention from ht's source, or licence the Delaware charts).
- **Vibration**: pinned-pinned `fn = (π/2L²)·√(EI/μeff)` with added mass
  `C_a·ρ·πD²/4`; Connors `Vcr = K·fn·√(μeff·δ/ρ)`, K = 3.3, δ = 0.1, St = 0.2
  (all three overridable in `ShellSideFlow`); Strouhal shedding; half-wave
  acoustic mode across the shell diameter. Screens: V/Vcr > 0.8 (HTRI guidance),
  shedding within 10 % of fn, acoustic mode within 20 % of shedding.
- **Not implemented on purpose**: seal-strip credit, Delaware ΔP correction
  factors, tube-side fluid mass in μeff, a liquid crossflow velocity cap (no
  verified public source for one — do not invent one in B7b).

---

## Resume procedure for a new chat

```bash
cd D1
git log --oneline -10      # what is done
grep -n "^- \[ \]\|^- \[~\]" BATCHES.md   # what is next
npx tsc --noEmit && npx vitest run        # confirm green before editing
```

Start with the first unchecked batch in Phase E (E1 first — it changes calculated numbers),
then Phase F for the requested tank/fin-fan data entry, then the cheap Phase C items.
