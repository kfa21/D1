# Ramsis StaticSuite

**Static equipment design & estimation suite** — pressure vessels, columns, shell & tube exchangers, air-cooled heat exchangers and storage tanks, engineered in the browser against **ASME VIII Div. 1**, **API 650**, **API 661** and **TEMA R.C.B**.

[![CI](https://github.com/kfa21/D1/actions/workflows/ci.yml/badge.svg)](https://github.com/kfa21/D1/actions/workflows/ci.yml)

▶ **Run it:** [GitHub Pages](https://kfa21.github.io/D1/) · everything runs client-side, no server or login required.

---

## What it does

| Equipment | Design code engine | Highlights |
|---|---|---|
| **Vessels & columns** | ASME VIII-1 — UG-16/27/28/32/37/45/47/99, UCS-56, UW-12 | Shell & head thickness, MAWP, external pressure (UG-28), nozzle reinforcement (UG-37), UG-45 neck minimums, anchor bolts, PWHT advisories, clad/lining, hydrotest |
| **Storage tanks** | API 650 | One-foot method shell courses, minimums, cone/dome & floating roofs with seals, wind-girder advisory, anchor chairs |
| **Shell & tube exchangers** | TEMA RCB + ASME | Tube count & bundle layout, tubesheet thickness (RCB-7.131/7.132), LMTD + 1-2 correction factor, expansion-joint advisory, tube-to-tubesheet joints, tubesheet cladding, **shell-side Bell–Delaware rating (ESDU ideal bank × Jc/JL/JB/JR), Kern shell ΔP and tube-vibration screening (fₙ, Connors, Strouhal, acoustics)** |
| **Air coolers** | API 661 + ASME | Bay/bundle geometry, finned area, air flow & ΔP, fan BHP, thermal duty check |

Beyond sizing, every tag flows through a full **fabrication & cost model**:

- **Management cost estimate** — headline KPIs and unit ratios (cost per kg of steel, per weld metre, hours per tag), a cost-structure bar with per-category shares, markup build-up, sortable per-tag breakdown with share bars, top cost drivers and a "basis of estimate" card quoting the rate card in force; exportable as a **PDF report** and as titled spreadsheets
- **BOM / MTO** with market plate sizes, plate nesting and a procurement optimizer (cross-tag part merging, thickness harmonisation, wastage reporting)
- **Man-hour estimation** with structured weld breakdowns — SAW vs SMAW fill models, GTAW roots, fit-up, rolling, forming, supports, NDT, PWHT, hydro, painting. Settings documents every man-hour considered (how its auto hours are derived) with a manual input per item.
- **NDT planning** (MT/PT, UT, RT, PaUT/TOFD) derived from RT category, thickness and clad, plus ITP stage scheduling where ticking a phase box adds that stage's hours and unticking removes them
- **PWHT / preheat advisories** per UCS-56 with consumable selection
- **B16.5 flange rating checks** (Class 150/300/600 group tables) at design temperature
- **3D viewer** built from the design results, one geometry source shared with the OBJ/DXF exports. Every equipment family has its own model: **vessels/columns** (multi-diameter courses joined by their cones, heads, skirts/legs/saddles/rings, nozzle by elevation & azimuth, trays/packing), **API 650 tanks** (floor + annular ring, each shell course at its calculated plate thickness, cone or dome roof at the entered 1:N slope, internal/external floating deck, wind girders, spiral stair, shell nozzles) and **API 661 air coolers** (bays of finned tube rows, headers, plenum, legs, spinning fans). Stress-utilization heatmap, material and wireframe modes, **cutaway** through the pressure boundary to reveal internals and product fill, part tags and engineering dimensions, iso/front/side/top presets, hover-to-identify on every part, PNG snapshot, and a live part list that quotes the same numbers the engine calculated. Every family also gets its **access and support steelwork**: caged ladders with safety cages and standoff guide rails (stair towers above a 12 m climb), spiral stairs and roof walkway/rail on tanks, grating platforms with top rail + mid rail + toe board at every manway and at both air-cooler header ends, fan guards, inter-bay walkways, leg bracing and the selected skid/portal/pedestal frame — with an indicative access-steel mass in the panel
- **printable reports**, **project settings** (currency, rates, plate stock, units)
- **Gemini AI design review** (bring your own API key) against the engine's own warning catalog
- **Clickable errors & warnings** — click a finding anywhere (Register, Reports, Inspection) to jump straight to the field that needs correcting, with the correction hint shown below that field
- Everything persisted in the browser (localStorage), with **project export/import**

## Quick start

```bash
npm ci          # install (Node 20+)
npm run dev     # dev server at http://localhost:3000
npm run build   # typecheck + production build to dist/
npm run preview # serve the production build
npm test        # vitest — engine + golden-value regression suites
```

## Architecture

```
src/
├── engine/            # pure-TS calculation core (no React, fully unit-tested)
│   ├── asme.ts        # ASME VIII-1 vessels/columns
│   ├── api650.ts      # API 650 tanks
│   ├── api661.ts      # API 661 air coolers
│   ├── tema.ts        # TEMA shell & tube exchangers
│   ├── materials.ts   # material DB: S(T) tables, P-No., PWHT rules, fillers
│   ├── flange.ts      # B16.5 pressure-temperature ratings
│   ├── bom.ts / plates.ts / optimize.ts   # BOM, plate nesting, procurement
│   ├── estimate.ts / estimateSummary.ts   # cost & man-hour engine + roll-ups
│   ├── pwht.ts / ndt.ts / itp.ts / supports.ts / layout3d.ts
│   ├── model3d.ts     # 3D descriptors for tanks & air coolers + the part list
│   ├── warnings.ts    # warning-code catalog (registry-validated)
│   └── *.test.ts      # 283 tests incl. hand-calculated golden values
├── pages/             # Register, BomPage, EstimatePage, Inspection, Reports, Viewer3D, Settings, AiReview
├── store.ts           # tiny external store + localStorage persistence
└── App.tsx            # shell & navigation
```

**Design principles**

1. **Internal unit system** — mm, bar(g), °C, kg, MPa; conversions at the edges only.
2. **Every warning is registered** — emitted codes are validated against `warnings.ts` in tests, so a typo or new unregistered code fails CI, and `fixes.ts` gives each code a target field plus correction hint (also test-validated).
3. **Golden-value tests** — corrected code formulas are pinned to hand/chart-calculated values (Bowman F, TEMA tubesheets, UG-28 factors, UG-47 anchors…) so regressions can't reintroduce wrong numbers.
4. **CI on every push** — typecheck + full test suite ([.github/workflows/ci.yml](.github/workflows/ci.yml)); GitHub Pages deploys only from a green build ([deploy-pages.yml](.github/workflows/deploy-pages.yml)).

## Deployment

- **GitHub Pages** — automatic on push to `main` (static `dist/`, relative asset base, fully client-side).
- **Freebuff Sites** — the same source also deploys as a Cloudflare Worker site from a Freebuff project.

## Roadmap

- Full curve-based WRC 107/537 shell local stresses (the **screening** is implemented — WRC 107 shell-shear equations, nominal neck stresses, Kellogg equivalent pressure into the flange check; the response curves/precision equations are licensed bulletin data)
- Saddle-stiffener **ring inertia** requirement (the Zick horn, shear and longitudinal cases plus a wear-plate advisory are implemented)
- Shell-side rating is **ESDU 73031 ideal bank + the Bell–Delaware correction structure**, and ΔP is **Kern's equivalent-diameter method** — the Delaware ideal-bank j/f charts and the Delaware ΔP correction charts are licensed/hand-read data and are deliberately not reproduced. Extend to the full Delaware j/f + ΔP charts if you can licence them.
- PDF datasheet/BOQ export, imperial unit mode, ASME VIII-2 Part 5 toggle

> The nozzle-reinforcement (UG-37/UG-45), saddle (Zick horn/shear/longitudinal), anchor-bolt (wind/seismic), nozzle local-load (WRC 107 screening at 1.5·S) and API 650 (variable design point §5.6.4, annular plates Table 5-1a) checks are **preliminary** engineering estimates built on published formulas with interpolated/tabulated coefficients. They are indicative starting points — verify the full method against the licensed code edition (ASME VIII-1/VIII-2 Annex G, ASCE 7, API 650 with addenda) before fabrication.

---

> ⚠️ **Disclaimer** — this is a *preliminary engineering aid*. Allowable stresses, code tables and productivity norms are indicative summaries. All results must be verified by a qualified engineer against the licensed, current code editions before use in stamped designs, procurement or fabrication.
