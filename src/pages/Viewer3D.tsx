// Interactive 3D visualization of the selected tag.
//
// Three model families are built from the engine results, all on one scale:
//   • pressure vessels / columns / exchangers — bottom head → courses → cones →
//     top head, with supports, nozzles, trays/packing and the tube bundle
//   • API 650 tanks — floor + annular ring, stacked shell courses with weld
//     bands, the designed cone/dome roof, floating deck, wind girders, spiral
//     stair and shell nozzles
//   • API 661 air coolers — bays of finned bundles, headers, plenum, legs and
//     spinning fans
//
// Everything else is presentation: utilization heatmap (per course), cutaway
// clipping through the pressure boundary, part labels, dimensions, hover
// part identification, a PNG snapshot and a live part list beside the model.

import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore, setState } from '../store';
import { computeEquipment } from '../engine/compute';
import type { Equipment, EquipmentCalc, NozzleCalc, SectionCalc } from '../engine/types';
import { fmt } from '../engine/units';
import { exportOBJ } from '../cad';
import { buildBodyLayout, locateNozzle, radialDirection, radiusAtY, saddleStations } from '../engine/layout3d';
import { finFanModel, tankModel, viewerSummary, type FinFanModel, type TankModel } from '../engine/model3d';
import {
  ACCESS,
  accessModel,
  sectionsFor,
  supportHeightMm,
  type AccessBar,
  type AccessFrame,
  type AccessGuard,
  type AccessLadder,
  type AccessPlatform,
  type AccessStair,
  type AccessWalkway,
} from '../engine/structure3d';

type Mode = 'heatmap' | 'material' | 'wireframe';
type ViewPreset = 'iso' | 'front' | 'side' | 'top';

const UP_Y = new THREE.Vector3(0, 1, 0);

function utilColor(u: number): THREE.Color {
  // green (low util) -> amber -> red (near/over limit)
  const t = Math.min(1, Math.max(0, u));
  const c = new THREE.Color();
  if (t < 0.5) c.lerpColors(new THREE.Color('#35c46f'), new THREE.Color('#e8b23c'), t / 0.5);
  else c.lerpColors(new THREE.Color('#e8b23c'), new THREE.Color('#e85c5c'), (t - 0.5) / 0.5);
  return c;
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

interface BuildOpts {
  mode: Mode;
  showNozzles: boolean;
  showLabels: boolean;
  showDims: boolean;
  cutaway: boolean;
  showInternals: boolean;
  showLiquid: boolean;
  clip?: THREE.Plane[];
  /** model meshes only — the camera is framed on this group, not the labels */
  model: THREE.Group;
  /** labels + dimension lines, framed separately so text never skews the fit */
  ann: THREE.Group;
  labels: { sprite: THREE.Sprite; aspect: number }[];
  spin: THREE.Object3D[];
}

function part<T extends THREE.Object3D>(obj: T, label: string, detail = ''): T {
  obj.userData.partLabel = label;
  obj.userData.partDetail = detail;
  return obj;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

const LABEL_FONT = '600 44px Inter, system-ui, -apple-system, Segoe UI, sans-serif';

/** Canvas-texture sprite label; `onTop` keeps it readable through geometry. */
function makeLabel(text: string, tone: 'plain' | 'ok' | 'err' | 'accent' = 'plain', onTop = false): { sprite: THREE.Sprite; aspect: number } | null {
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) return null;
  probe.font = LABEL_FONT;
  const w = Math.ceil(probe.measureText(text).width) + 40;
  const h = 44 + 30;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) return null;
  const bg =
    tone === 'err' ? 'rgba(126,36,36,0.94)' :
    tone === 'ok' ? 'rgba(24,78,52,0.94)' :
    tone === 'accent' ? 'rgba(38,52,98,0.94)' :
    'rgba(13,19,27,0.9)';
  c.fillStyle = bg;
  roundRect(c, 2, 2, w - 4, h - 4, 14);
  c.fill();
  c.strokeStyle = 'rgba(220,235,255,0.22)';
  c.lineWidth = 2;
  c.stroke();
  c.font = LABEL_FONT;
  c.fillStyle = '#e9eff7';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: !onTop, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  return { sprite, aspect: w / h };
}

function addLabel(o: BuildOpts, text: string, pos: THREE.Vector3, tone: 'plain' | 'ok' | 'err' | 'accent' = 'plain', onTop = false) {
  if (!o.showLabels) return;
  const l = makeLabel(text, tone, onTop);
  if (!l) return;
  l.sprite.position.copy(pos);
  l.sprite.renderOrder = onTop ? 10 : 6;
  o.ann.add(l.sprite);
  o.labels.push(l);
}

function surfaceMat(o: BuildOpts, util: number, base: number, clip = true): THREE.Material {
  if (o.mode === 'wireframe') {
    return new THREE.MeshBasicMaterial({ color: base, wireframe: true, transparent: true, opacity: 0.55 });
  }
  const color = o.mode === 'material' ? base : utilColor(util).getHex();
  return new THREE.MeshStandardMaterial({
    color,
    metalness: o.mode === 'material' ? 0.55 : 0.35,
    roughness: 0.45,
    side: THREE.DoubleSide,
    clippingPlanes: clip ? o.clip : undefined,
  });
}

function steelMat(o: BuildOpts, color = 0x556275, rough = 0.72, clip = false): THREE.Material {
  if (o.mode === 'wireframe') {
    return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.4 });
  }
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.45,
    roughness: rough,
    side: THREE.DoubleSide,
    clippingPlanes: clip ? o.clip : undefined,
  });
}

/** Translucent steel for plenum walls and shells you should see through. */
function glassMat(o: BuildOpts, color = 0x6b7f99, opacity = 0.28): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.3,
    roughness: 0.35,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    clippingPlanes: o.clip,
  });
}

function lineMat(color = 0x93a7bf, opacity = 0.85): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}

/** Engineering dimension: extension lines, dimension line and a centred label. */
function dimension(
  o: BuildOpts,
  from: THREE.Vector3,
  to: THREE.Vector3,
  offset: THREE.Vector3,
  text: string
) {
  const a = from.clone().add(offset);
  const b = to.clone().add(offset);
  const mat = lineMat();
  const geo = new THREE.BufferGeometry().setFromPoints([a, b, from, a, to, b]);
  const line = new THREE.LineSegments(geo, mat);
  line.renderOrder = 7;
  o.ann.add(line);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  addLabel(o, text, mid, 'plain', true);
}

/** Hemisphere cap of the given rim radius and rise (used for dome roofs). */
function domeGeometry(R: number, rise: number, seg = 72): THREE.BufferGeometry {
  if (!(rise > 0)) return new THREE.SphereGeometry(R, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const Rs = (R * R + rise * rise) / (2 * rise);
  const alpha = Math.asin(Math.min(1, R / Rs));
  const geo = new THREE.SphereGeometry(Rs, seg, 24, 0, Math.PI * 2, 0, alpha);
  geo.translate(0, -(Rs * Math.cos(alpha)), 0); // rim on y = 0, apex at y = rise
  return geo;
}

// ---------------------------------------------------------------------------
// Nozzles (shared by every model family)
// ---------------------------------------------------------------------------

function addNozzle(
  o: BuildOpts,
  n: NozzleCalc,
  surface: THREE.Vector3,
  dir: THREE.Vector3
) {
  const dn = n.spec.dn;
  const wall = n.wall ?? 8;
  const outer = dn + 2 * wall;
  const len = Math.max(60, n.spec.projOutside);
  const unit = dir.clone().normalize();
  const heat = o.mode === 'heatmap';
  const neckMat = heat
    ? new THREE.MeshStandardMaterial({ color: n.reinforceOK ? 0x3fa9f5 : 0xe85c5c, roughness: 0.4, metalness: 0.6, clippingPlanes: o.clip })
    : surfaceMat(o, 0.4, 0x93a6bd);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(outer / 2, outer / 2, len, 24), neckMat);
  neck.quaternion.setFromUnitVectors(UP_Y, unit);
  neck.position.copy(surface).addScaledVector(unit, len / 2);
  part(neck, `Nozzle ${n.spec.tag}`, `Ø${dn} mm · ${n.spec.service || n.spec.kind}${n.reinforceOK ? '' : ' · reinforcement insufficient'}`);
  o.model.add(neck);

  if (n.spec.padDia > 0 && n.spec.padThk > 0) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(n.spec.padDia / 2, n.spec.padDia / 2, n.spec.padThk + 2, 32), steelMat(o, 0x71809a, 0.6, true));
    pad.quaternion.setFromUnitVectors(UP_Y, unit);
    pad.position.copy(surface).addScaledVector(unit, n.spec.padThk / 2);
    part(pad, `Reinforcement pad ${n.spec.tag}`, `Ø${n.spec.padDia} × ${n.spec.padThk} mm`);
    o.model.add(pad);
  }

  // blind flange face — a manway reads as a cover, not an open pipe
  const isManway = n.spec.kind === 'manway';
  const fd = outer / 2 + dn / 3;
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(fd, fd, isManway ? 46 : 28, 28),
    new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.35, metalness: 0.7, clippingPlanes: o.clip })
  );
  flange.quaternion.setFromUnitVectors(UP_Y, unit);
  flange.position.copy(surface).addScaledVector(unit, len + (isManway ? 23 : 14));
  part(flange, `${isManway ? 'Manway cover' : 'Flange'} ${n.spec.tag}`, `${n.spec.flangeClass}# · Ø${dn} mm`);
  o.model.add(flange);

  addLabel(
    o,
    `${n.spec.tag} · Ø${dn}`,
    surface.clone().addScaledVector(unit, len + fd + 140),
    n.reinforceOK ? 'plain' : 'err'
  );
}

// ---------------------------------------------------------------------------
// Vessels, columns and shell-and-tube exchangers
// ---------------------------------------------------------------------------

function buildVessel(g: THREE.Group, equip: Equipment, calc: EquipmentCalc, o: BuildOpts) {
  const vertical = equip.orientation !== 'horizontal';
  const sections: SectionCalc[] = calc.sections.length
    ? calc.sections
    : equip.sections.map((sp) => ({ spec: sp, utilization: 0, tNominal: 0 }) as SectionCalc);
  if (!sections.length) return;

  const layout = buildBodyLayout(sections);
  const totalLen = layout.totalLen;

  const headGeo = (type: string, R: number, d: number) => {
    if (type === 'hemi') return new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    if (type === 'ellip2') {
      const geo = new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.scale(1, 0.5, 1);
      return geo;
    }
    if (type === 'toriFD' || type === 'toriD') {
      // Torispherical head: crown + knuckle (ASME)
      const D = 2 * R;
      const L = type === 'toriFD' ? D : D; // crown radius
      const r = type === 'toriFD' ? 0.06 * D : 0.17 * D; // knuckle radius
      const points: THREE.Vector2[] = [];
      // Build profile from outside to center? Or build as lathe
      // Start at shell junction (R, 0) going up along knuckle
      const steps = 40;
      // Knuckle: arc centered at (R-r, r)
      for (let i = 0; i <= steps / 2; i++) {
        const angle = Math.PI / 2 - (i / (steps / 2)) * Math.acos(1 - Math.min(1, r / Math.max(1e-6, r))); // approximate
        const a = Math.PI / 2 * (i / (steps / 2));
        const x = (R - r) + r * Math.sin(a);
        const y = r - r * Math.cos(a);
        if (x >= 0) points.push(new THREE.Vector2(x, y));
      }
      // Crown: arc centered on axis
      const rc = Math.sqrt((L - r) ** 2 - (R - r) ** 2);
      const yc = r + rc;
      for (let i = 1; i <= steps / 2; i++) {
        const a = Math.acos((R - r) / (L - r)) + (i / (steps / 2)) * (Math.PI / 2 - Math.acos((R - r) / (L - r)));
        const x = (L - r) * Math.sin(a);
        const y = yc - (L - r) * Math.cos(a);
        if (x >= 0 && y > 0) points.push(new THREE.Vector2(x, y));
      }
      // If points don't look right, fall back to sphere cap scaled to depth
      if (points.length < 5) {
        const alpha = Math.acos(Math.max(-1, Math.min(1, 1 - d / Math.max(1, R))));
        return new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, alpha);
      }
      const geo = new THREE.LatheGeometry(points, 64);
      return geo;
    }
    const alpha = Math.acos(Math.max(-1, Math.min(1, 1 - d / Math.max(1, R))));
    return new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, alpha);
  };

  // ---------- pressure boundary: bottom head → sections → cones → top head ----------
  if (layout.bottomDepth > 0 && sections[0]) {
    const first = sections[0];
    const R = first.spec.dia / 2;
    const head = new THREE.Mesh(headGeo(first.headBot!.type, R, layout.bottomDepth), surfaceMat(o, first.headBot!.utilization ?? 0, 0x9fb2c8));
    head.rotation.x = Math.PI; // flip the cap: apex points down
    head.position.y = layout.bottomDepth; // rim lands exactly on the shell start
    part(head, 'Bottom head', `${first.headBot!.type} · t ${(first.headBot!.tMinNominal ?? 0).toFixed(1)} mm`);
    o.model.add(head);
  }
  layout.segments.forEach((seg) => {
    const sc = sections[seg.sectionIndex];
    const h = seg.y1 - seg.y0;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(seg.r1, seg.r0, h, 72, 1, false),
      surfaceMat(o, sc?.utilization ?? 0, seg.kind === 'cone' ? 0x8397ad : 0x9fb2c8)
    );
    mesh.position.y = (seg.y0 + seg.y1) / 2;
    part(
      mesh,
      seg.kind === 'cone' ? `Cone (course ${seg.sectionIndex + 1})` : `Shell course ${seg.sectionIndex + 1}`,
      `Ø${fmt(seg.r0 * 2, 0)}${seg.r0 !== seg.r1 ? ` → Ø${fmt(seg.r1 * 2, 0)}` : ''} × ${fmt(h, 0)} mm · t ${(sc?.tNominal ?? 0).toFixed(1)} mm`
    );
    o.model.add(mesh);
    if (seg.kind === 'shell' && seg.y1 < layout.stackTop - 1) {
      // circumferential weld band at the course joint
      const band = new THREE.Mesh(new THREE.TorusGeometry(seg.r1 + 2, 7, 8, 72), steelMat(o, 0x2b3546));
      band.rotation.x = Math.PI / 2;
      band.position.y = seg.y1;
      o.model.add(band);
    }
  });
  const last = sections[sections.length - 1];
  const ht = last?.headTop;
  if (ht && ht.type !== 'none' && last) {
    const R = last.spec.dia / 2;
    const head = new THREE.Mesh(headGeo(ht.type, R, layout.topHeadDepth), surfaceMat(o, ht.utilization ?? 0, 0x9fb2c8));
    head.position.y = layout.stackTop;
    part(head, 'Top head', `${ht.type} · t ${(ht.tMinNominal ?? 0).toFixed(1)} mm`);
    o.model.add(head);
  }

  // ---------- internals (trays, packing, demister) ----------
  if (o.showInternals && equip.internals.length) {
    const internals = new THREE.Group();
    for (const spec of equip.internals) {
      const layers = Math.min(60, Math.max(1, spec.count || 1));
      const spacing = spec.spacing > 0 ? spec.spacing : 300;
      const isPacking = spec.kind === 'randomPacking' || spec.kind === 'structuredPacking';
      if (isPacking) {
        const bedH = Math.max(200, layers * spacing);
        const y0 = layout.bottomDepth + spec.bottomElevation;
        const y1 = Math.min(layout.stackTop, y0 + bedH);
        const r = Math.max(50, radiusAtY(layout, (y0 + y1) / 2) - 40);
        const bed = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, Math.max(50, y1 - y0), 48, 1, true),
          glassMat(o, 0x7d9d8a, 0.35)
        );
        bed.position.y = (y0 + y1) / 2;
        part(bed, 'Packing bed', `${spec.kind} · ${Math.round(y1 - y0)} mm deep`);
        internals.add(bed);
        continue;
      }
      for (let i = 0; i < layers; i++) {
        const y = layout.bottomDepth + spec.bottomElevation + i * spacing;
        if (y <= layout.bottomDepth || y >= layout.stackTop) continue;
        const r = Math.max(40, radiusAtY(layout, y) - 40);
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 22, 48), steelMat(o, 0x8b9bb0, 0.6));
        deck.position.y = y;
        internals.add(deck);
        const dc = new THREE.Mesh(new THREE.BoxGeometry(Math.min(500, r * 0.8), Math.max(60, spacing * 0.6), 26), steelMat(o, 0x74849a, 0.6));
        dc.position.set(r * 0.45, y + spacing * 0.3, 0);
        internals.add(dc);
      }
    }
    internals.userData.partLabel = 'Internals';
    o.model.add(internals);
  }

  // ---------- exchanger bundle (visible through the cutaway / wireframe) ----------
  if (calc.hx && equip.hx) {
    const specs = equip.hx;
    const R = (calc.sections[0]?.spec.dia ?? 1000) / 2;
    const bundleR = Math.max(100, (calc.hx.bundleOD || R * 1.6) / 2);
    const l0 = layout.bottomDepth + 150;
    const l1 = layout.stackTop - 150;
    const tubeLen = Math.max(100, l1 - l0);
    const nTubes = Math.min(420, Math.max(12, Math.round(calc.hx.tubeCountActual || 60)));
    const tubeGeo = new THREE.CylinderGeometry(specs.tubeOD / 2, specs.tubeOD / 2, tubeLen, 8);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xb9c6d6, metalness: 0.6, roughness: 0.4 });
    const inst = new THREE.InstancedMesh(tubeGeo, tubeMat, nTubes);
    const m = new THREE.Matrix4();
    for (let i = 0; i < nTubes; i++) {
      const rr = Math.min(bundleR, Math.sqrt((i + 0.5) / nTubes) * bundleR);
      const ang = i * 2.399963; // golden angle — even fill without a pattern
      m.makeTranslation(Math.cos(ang) * rr, (l0 + l1) / 2, Math.sin(ang) * rr);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    part(inst, 'Tube bundle', `${calc.hx.tubeCountActual} tubes × Ø${specs.tubeOD} × ${specs.tubeWall} mm`);
    o.model.add(inst);

    const baffles = Math.min(40, Math.max(1, calc.hx.baffleCount || Math.round(tubeLen / Math.max(200, specs.baffleSpacing || 400))));
    const cut = Math.min(45, Math.max(10, specs.baffleCut || 25)) / 100;
    for (let i = 0; i < baffles; i++) {
      const y = l0 + ((i + 0.5) / baffles) * tubeLen;
      const seg = i % 2 === 0 ? 0 : Math.PI;
      const baffle = new THREE.Mesh(
        new THREE.CylinderGeometry(bundleR + 20, bundleR + 20, 8, 40, 1, false, seg, Math.PI * 2 * (1 - cut)),
        steelMat(o, 0x66788f, 0.65)
      );
      baffle.position.y = y;
      part(baffle, `Baffle ${i + 1}`, `${(cut * 100).toFixed(0)}% cut · ${specs.baffleType || 'segmental'}`);
      o.model.add(baffle);
    }
    // tubesheets at both ends of the bundle
    for (const y of [l0 - 40, l1 + 40]) {
      const ts = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.98, Math.max(20, calc.hx.tubeSheetThk || 40), 48), steelMat(o, 0x707f93, 0.6));
      ts.position.y = y;
      part(ts, 'Tubesheet', `t ${(calc.hx.tubeSheetThk || 0).toFixed(1)} mm`);
      o.model.add(ts);
    }
  }

  // ---------- supports ----------
  const s = equip.support;
  const R0 = layout.segments[0]?.r0 ?? (equip.sections[0]?.dia ?? 1000) / 2;
  const supportH =
    vertical && (s.type === 'legs' || s.type === 'skirt')
      ? s.skirtH > 0
        ? s.skirtH
        : s.type === 'legs'
          ? 800
          : 1500
      : 0;
  const gradeY = layout.bottomDepth - supportH;

  if (s.type === 'legs' && vertical) {
    const n = Math.max(2, s.legCount || 4);
    const h = supportH;
    const t = Math.max(8, s.legPlateThk || 16);
    const w = Math.min(400, Math.max(150, t * 10));
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + Math.PI / n;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), steelMat(o, 0x556275));
      leg.rotation.y = az;
      leg.position.set(Math.sin(az) * (R0 + t / 2), gradeY + h / 2, Math.cos(az) * (R0 + t / 2));
      part(leg, 'Support leg', `${n} legs · ${Math.round(h)} mm high`);
      o.model.add(leg);
      const bp = new THREE.Mesh(new THREE.BoxGeometry(w + 90, 20, w + 90), steelMat(o, 0x46526b));
      bp.rotation.y = az;
      bp.position.set(leg.position.x, gradeY + 10, leg.position.z);
      o.model.add(bp);
    }
  } else if (s.type === 'skirt' && vertical) {
    const h = supportH;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 1.001, R0 * 1.001, h, 64, 1, false), steelMat(o, 0x4d5a70));
    skirt.position.y = layout.bottomDepth - h / 2; // top of skirt meets the shell bottom
    part(skirt, 'Skirt', `Ø${fmt(R0 * 2, 0)} × ${Math.round(h)} mm`);
    o.model.add(skirt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.06, 30, 12, 64), steelMat(o, 0x46526b));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = gradeY + 20;
    part(ring, 'Base ring', 'Anchor bolts + base ring');
    o.model.add(ring);
  } else if (s.type === 'ring' && vertical) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.05, 45, 12, 64), steelMat(o, 0x556275));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = layout.bottomDepth;
    part(ring, 'Support ring', 'On a structural ring / steelwork');
    o.model.add(ring);
  } else if (s.type === 'saddle' && !vertical) {
    const a = ((s.saddleAngle || 120) * Math.PI) / 180;
    const { stations } = saddleStations(layout, s.saddleSpan);
    for (const st of stations) {
      const R = st.r;
      const width = Math.max(300, R * 0.5);
      const arc = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 1.01, R * 1.01, width, 48, 1, true, 2 * Math.PI - a / 2, a),
        steelMat(o, 0x556275)
      );
      // built in the local frame: +Y is the vessel axis, local +Z the ground
      arc.position.set(0, st.y, 0);
      part(arc, 'Saddle', `${s.saddleAngle || 120}° · span ${Math.round(spanOf(stations))} mm`);
      o.model.add(arc);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2 * R * Math.sin(a / 2) + 60, width, 40), steelMat(o, 0x46526b));
      base.position.set(0, st.y, R * 1.01 + 20);
      o.model.add(base);
    }
  }
  if (s.padeyes) {
    const nLug = calc.weightDryKg > 20000 ? 4 : 2;
    for (let i = 0; i < nLug; i++) {
      const station = vertical ? totalLen * 0.78 : totalLen * (0.25 + (0.5 * i) / Math.max(1, nLug - 1));
      const az = vertical ? Math.PI / 2 + (i / Math.max(1, nLug)) * Math.PI * 2 : 0;
      const [ux, , uz] = radialDirection(az, vertical);
      const r = radiusAtY(layout, station);
      const lug = new THREE.Mesh(new THREE.BoxGeometry(60, 260, 24), steelMat(o, 0x6c7a92));
      lug.position.set(ux * (r + 12), station, uz * (r + 12));
      lug.quaternion.setFromUnitVectors(UP_Y, new THREE.Vector3(ux, 0, uz));
      part(lug, 'Lifting lug', 'Padeye for erection');
      o.model.add(lug);
    }
  }
  if (s.guyLines && vertical) {
    const topY = totalLen * 0.85;
    const deadR = R0 * 4;
    const shellT = calc.sections[0]?.tNominal ?? 10;
    const unterR = Math.max(8, shellT * 2);
    const rTop = radiusAtY(layout, topY);
    for (const off of [0, Math.PI]) {
      const dx = Math.sin(off) * deadR;
      const dz = Math.cos(off) * deadR;
      const sx = Math.sin(off) * rTop;
      const sz = Math.cos(off) * rTop;
      const dir = new THREE.Vector3(dx - sx, gradeY - topY, dz - sz);
      const lenGuy = dir.length();
      const guy = new THREE.Mesh(new THREE.CylinderGeometry(unterR, unterR, lenGuy, 8), steelMat(o, 0x8b94a6));
      guy.position.set((sx + dx) / 2, (topY + gradeY) / 2, (sz + dz) / 2);
      guy.quaternion.setFromUnitVectors(UP_Y, dir.normalize());
      part(guy, 'Guy wire', 'Derrick / guyed support');
      o.model.add(guy);
      const dm = new THREE.Mesh(new THREE.BoxGeometry(600, 40, 260), steelMat(o, 0x46526b));
      dm.position.set(dx, gradeY + 20, dz);
      o.model.add(dm);
    }
  }

  // ---------- nozzles ----------
  if (o.showNozzles) {
    for (const n of calc.nozzles) {
      const place = locateNozzle(layout, n.spec.elevation);
      if (!place) continue;
      const [dxv, , dzv] = radialDirection(n.spec.azimuth, vertical);
      const dir = new THREE.Vector3(dxv, 0, dzv);
      const surface = new THREE.Vector3(dxv * place.r, place.y, dzv * place.r);
      addNozzle(o, n, surface, dir);
    }
  }

  // ---------- annotations ----------
  const Rmax = Math.max(...layout.segments.map((sg) => Math.max(sg.r0, sg.r1)), R0);
  // lay the whole assembly (model + annotations) down after it is built, so the
  // nozzle tags and dimensions rotate with the geometry instead of floating
  if (!vertical) g.rotation.x = Math.PI / 2;
  const annR = Rmax;
  if (o.showDims) {
    if (vertical) {
      dimension(o, new THREE.Vector3(-annR, gradeY, 0), new THREE.Vector3(-annR, layout.totalLen, 0), new THREE.Vector3(-annR * 0.55, 0, 0), `T/T ${fmt(layout.totalLen - layout.bottomDepth, 0)} mm`);
      dimension(o, new THREE.Vector3(-annR, layout.bottomDepth, 0), new THREE.Vector3(annR, layout.bottomDepth, 0), new THREE.Vector3(0, -annR * 0.6, 0), `Ø${fmt(Rmax * 2, 0)} mm`);
    } else {
      dimension(o, new THREE.Vector3(0, -annR * 0.2, 0), new THREE.Vector3(0, layout.totalLen, 0), new THREE.Vector3(annR * 1.15, 0, 0), `L ${fmt(layout.totalLen, 0)} mm`);
      dimension(o, new THREE.Vector3(-annR, layout.bottomDepth, 0), new THREE.Vector3(annR, layout.bottomDepth, 0), new THREE.Vector3(0, -annR * 0.5, 0), `Ø${fmt(Rmax * 2, 0)} mm`);
    }
  }
}

function spanOf(stations: { y: number }[]): number {
  if (stations.length < 2) return 0;
  return Math.abs(stations[stations.length - 1].y - stations[0].y);
}

// ---------------------------------------------------------------------------
// API 650 tank
// ---------------------------------------------------------------------------

function buildTank(g: THREE.Group, equip: Equipment, calc: EquipmentCalc, tm: TankModel, o: BuildOpts) {
  const R = tm.radiusMm;

  // floor: bottom plates, then the annular ring laid over the outer band
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, tm.bottomPlateThkMm, 96),
    steelMat(o, 0x4a5568, 0.75, true)
  );
  plate.position.y = tm.bottomPlateThkMm / 2;
  part(plate, 'Bottom plate', `${tm.bottomPlateThkMm.toFixed(1)} mm · API 650 §5.5.1`);
  o.model.add(plate);

  if (tm.annularRingMm > 0) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0, R - tm.annularRingMm), R, 96, 1),
      new THREE.MeshStandardMaterial({ color: 0x39485c, metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = tm.bottomPlateThkMm + 1.5;
    part(ring, 'Annular bottom ring', `${tm.annularRingMm} mm wide · Table 5-1a`);
    o.model.add(ring);
  }

  // stacked shell courses, thickness-coloured, with a weld band at each joint
  tm.courses.forEach((c) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, c.heightMm, 96, 1, true),
      surfaceMat(o, c.utilization, 0x9fb2c8)
    );
    mesh.position.y = (c.y0 + c.y1) / 2;
    part(
      mesh,
      `Shell course ${c.index + 1}`,
      `t ${c.thicknessMm.toFixed(1)} mm · ${c.material} · ${fmt(c.heightMm, 0)} mm high`
    );
    o.model.add(mesh);
    const band = new THREE.Mesh(new THREE.TorusGeometry(R + 3, Math.max(5, c.thicknessMm * 0.9), 8, 96), steelMat(o, 0x2b3546, 0.8, true));
    band.rotation.x = Math.PI / 2;
    band.position.y = c.y1;
    o.model.add(band);
  });

  // roof: the designed cone slope (1:N) or a shallow dome; external floating
  // roofs are open at the top
  if (tm.roof.kind === 'cone') {
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(R + 12, Math.max(60, tm.roof.riseMm), 96, 1, true),
      surfaceMat(o, 0.5, 0x9fb2c8)
    );
    roof.position.y = tm.roof.rimY + Math.max(60, tm.roof.riseMm) / 2;
    part(roof, 'Cone roof', `rise ${Math.round(tm.roof.riseMm)} mm (1:${calc.tank?.roofSlopeRun ?? 16}) · t ${tm.roof.thicknessMm.toFixed(1)} mm`);
    o.model.add(roof);
  } else if (tm.roof.kind === 'dome') {
    const roof = new THREE.Mesh(domeGeometry(R + 12, tm.roof.riseMm), surfaceMat(o, 0.5, 0x9fb2c8));
    roof.position.y = tm.roof.rimY;
    part(roof, 'Dome roof', `rise ${Math.round(tm.roof.riseMm)} mm · t ${tm.roof.thicknessMm.toFixed(1)} mm`);
    o.model.add(roof);
  }

  // floating roof deck (internal or external) riding the design liquid level
  if (tm.floatingDeckY !== null) {
    const deckR = Math.max(100, R - 80);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(deckR, deckR, 50, 72), steelMat(o, 0x6f8098, 0.55, true));
    deck.position.y = tm.floatingDeckY;
    part(deck, 'Floating roof deck', `${equip.tank?.roofType === 'externalFloating' ? 'External' : 'Internal'} floating roof · seal ${equip.tank?.primarySeal ?? '—'}`);
    o.model.add(deck);
    const pontoon = new THREE.Mesh(new THREE.TorusGeometry(deckR * 0.93, 120, 10, 72), steelMat(o, 0x5d6f86, 0.6, true));
    pontoon.rotation.x = Math.PI / 2;
    pontoon.position.y = tm.floatingDeckY + 40;
    o.model.add(pontoon);
  }

  // wind girders (top + intermediate)
  tm.windGirdersY.forEach((y, i) => {
    const girder = new THREE.Mesh(new THREE.TorusGeometry(R + 90, 65, 10, 96), steelMat(o, 0x5e738f, 0.6));
    girder.rotation.x = Math.PI / 2;
    girder.position.y = y;
    part(girder, i === 0 ? 'Top wind girder' : `Intermediate wind girder ${i}`, `API 650 §5.8.7 · ${Math.round(y)} mm elevation`);
    o.model.add(girder);
  });

  // The spiral stair / roof landing used to be drawn here; access is now
  // described by structure3d (treads, stringers, handrails, landings, roof
  // walkway and perimeter rail) and drawn once by buildAccess().
  // product fill — a translucent surface at the design liquid level
  if (o.showLiquid && tm.liquidY !== null) {
    const fillH = Math.max(1, tm.liquidY - tm.shellBaseY);
    const fill = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 25, R - 25, fillH, 72, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x2f8fb0,
        metalness: 0.1,
        roughness: 0.2,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes: o.clip,
      })
    );
    fill.position.y = tm.shellBaseY + fillH / 2;
    part(fill, 'Product fill', `${equip.tank?.fluidName || 'product'} · SG ${equip.tank?.specificGravity ?? 1} at ${fmt(tm.levelMm, 0)} mm`);
    o.model.add(fill);
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(R - 25, 72),
      new THREE.MeshStandardMaterial({ color: 0x54b6d6, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = tm.liquidY;
    o.model.add(surface);
  }

  // shell nozzles, placed from their elevation above the shell bottom
  if (o.showNozzles && calc.nozzles.length) {
    const layout = buildBodyLayout(calc.sections);
    for (const n of calc.nozzles) {
      const place = locateNozzle(layout, n.spec.elevation);
      if (!place) continue;
      const [dx, , dz] = radialDirection(n.spec.azimuth, true);
      const dir = new THREE.Vector3(dx, 0, dz);
      addNozzle(o, n, new THREE.Vector3(dx * R, tm.shellBaseY + place.y, dz * R), dir);
    }
  }

  if (o.showDims) {
    dimension(o, new THREE.Vector3(-R, 0, 0), new THREE.Vector3(-R, tm.shellTopY, 0), new THREE.Vector3(-R * 0.35, 0, 0), `Shell ${fmt(tm.shellTopY - tm.shellBaseY, 0)} mm`);
    dimension(o, new THREE.Vector3(-R, tm.shellBaseY, 0), new THREE.Vector3(R, tm.shellBaseY, 0), new THREE.Vector3(0, -R * 0.28, 0), `Ø${fmt(tm.diameterMm, 0)} mm`);
    if (tm.roof.riseMm > 0) {
      dimension(o, new THREE.Vector3(R * 0.55, tm.roof.rimY, 0), new THREE.Vector3(R * 0.55, tm.roof.apexY, 0), new THREE.Vector3(R * 0.3, 0, 0), `Rise ${fmt(tm.roof.riseMm, 0)} mm`);
    }
  }
}

// ---------------------------------------------------------------------------
// API 661 air cooler
// ---------------------------------------------------------------------------

function finMaterial(o: BuildOpts, lengthMm: number): THREE.Material {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 8;
  const c = canvas.getContext('2d');
  if (!c) return steelMat(o, 0xa8b8c9, 0.5);
  c.fillStyle = '#a3b4c6';
  c.fillRect(0, 0, 32, 8);
  c.fillStyle = '#5f7189';
  for (let i = 0; i < 32; i += 4) c.fillRect(i, 0, 2, 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.min(400, Math.max(8, lengthMm / 130)), 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: o.mode === 'heatmap' ? utilColor(0.35) : 0xffffff,
    metalness: 0.5,
    roughness: 0.45,
    side: THREE.DoubleSide,
    clippingPlanes: o.clip,
  });
}

function buildFinFan(g: THREE.Group, equip: Equipment, calc: EquipmentCalc, fm: FinFanModel, o: BuildOpts) {
  const L = fm.tubeLengthMm;
  const halfL = L / 2;
  const headerX = halfL + fm.headerDiaMm / 2 + 80;
  const finMat = o.mode === 'wireframe' ? steelMat(o, 0x93a6bd, 0.55) : finMaterial(o, L);
  const bundleMidY = fm.bundleBottomY + fm.bundleHeightMm / 2;

  for (let b = 0; b < fm.bays; b++) {
    const z = fm.bayCentersZ[b];
    const bay = new THREE.Group();
    bay.position.z = z;

    // finned tube rows: one striped block per row, the height of a fin OD
    for (let r = 0; r < fm.rows; r++) {
      const y = fm.bundleBottomY + (r + 0.5) * (fm.bundleHeightMm / fm.rows);
      const row = new THREE.Mesh(new THREE.BoxGeometry(L, fm.finODMm, fm.bankDepthMm), finMat);
      row.position.y = y;
      part(row, `Finned tube row ${r + 1} (bay ${b + 1})`, `${fm.rows} rows · ${fm.tubesPerRow} tubes/row · Ø${fm.tubeODMm} mm tubes, ${fm.finODMm} mm fins`);
      bay.add(row);
    }

    // headers at each end of the tubes
    for (const sx of [-1, 1]) {
      const header = new THREE.Mesh(
        new THREE.CylinderGeometry(fm.headerDiaMm / 2, fm.headerDiaMm / 2, fm.bankDepthMm + 260, 32),
        steelMat(o, 0x7d8fa6, 0.55)
      );
      header.rotation.x = Math.PI / 2;
      header.position.set(sx * headerX, bundleMidY, 0);
      part(header, 'Header', `Ø${fmt(fm.headerDiaMm, 0)} mm · ${equip.finfan?.headerThk ?? 0} mm wall · ${equip.finfan?.tubeMatKey ?? ''}`);
      bay.add(header);
      // nozzle stub on each header
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(fm.headerDiaMm * 0.18, fm.headerDiaMm * 0.18, 500, 20), steelMat(o, 0x8a9bb0, 0.5));
      stub.rotation.z = Math.PI / 2;
      stub.position.set(sx * (headerX + fm.headerDiaMm / 2 + 200), bundleMidY, 0);
      part(stub, 'Header nozzle', sx < 0 ? 'Inlet' : 'Outlet');
      bay.add(stub);
    }

    // bundle frame side channels
    for (const sz of [-1, 1]) {
      const channel = new THREE.Mesh(new THREE.BoxGeometry(L + 200, 120, 90), steelMat(o, 0x62748b, 0.6));
      channel.position.set(0, fm.bundleBottomY - 40, sz * (fm.bankDepthMm / 2 + 20));
      bay.add(channel);
    }

    // plenum walls (translucent so the fans and bundle stay readable)
    const plenumW = L + 2 * fm.headerDiaMm + 400;
    const plenumD = fm.bayDepthMm;
    const plenumH = fm.plenumHeightMm;
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(60, plenumH, plenumD), glassMat(o, 0x6b7f99, 0.32));
      wall.position.set((sx * plenumW) / 2, fm.plenumBottomY + plenumH / 2, 0);
      part(wall, 'Plenum', `${Math.round(plenumH)} mm deep · air duct to the bundle`);
      bay.add(wall);
    }
    for (const sz of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(plenumW, plenumH, 60), glassMat(o, 0x6b7f99, 0.32));
      wall.position.set(0, fm.plenumBottomY + plenumH / 2, (sz * plenumD) / 2);
      bay.add(wall);
    }

    // four legs per bay
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(180, fm.legHeightMm, 180),
          steelMat(o, 0x556275, 0.7)
        );
        leg.position.set((sx * plenumW) / 2 - sx * 90, fm.legHeightMm / 2, (sz * plenumD) / 2 - sz * 90);
        part(leg, 'Support leg', `${Math.round(fm.legHeightMm)} mm · 4 per bay`);
        bay.add(leg);
        const base = new THREE.Mesh(new THREE.BoxGeometry(360, 30, 360), steelMat(o, 0x46526b, 0.75));
        base.position.set(leg.position.x, 15, leg.position.z);
        bay.add(base);
      }
    }

    // fan: ring, spinning blades, hub, motor
    const fanRing = new THREE.Mesh(new THREE.TorusGeometry(fm.fanDiaMm / 2, 70, 10, 64), steelMat(o, 0x60738c, 0.6));
    fanRing.rotation.x = Math.PI / 2;
    fanRing.position.y = fm.fanY;
    part(fanRing, 'Fan ring', `Ø${fmt(fm.fanDiaMm, 0)} mm · ${fm.bays === 1 ? '1 fan' : `${fm.bays} fans`} · ${calc.finfan?.fanKW.toFixed(1)} kW`);
    bay.add(fanRing);

    const rotor = new THREE.Group();
    rotor.position.y = fm.fanY;
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(fm.fanDiaMm * 0.09, fm.fanDiaMm * 0.09, 240, 20),
      steelMat(o, 0x8b9bb0, 0.5)
    );
    hub.position.y = 60;
    rotor.add(hub);
    const bladeMat = steelMat(o, 0xa8b7c8, 0.45);
    const nBlades = 6;
    for (let i = 0; i < nBlades; i++) {
      const a = (i / nBlades) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(fm.fanDiaMm * 0.4, 26, fm.fanDiaMm * 0.16), bladeMat);
      blade.position.set(Math.cos(a) * fm.fanDiaMm * 0.26, 60, Math.sin(a) * fm.fanDiaMm * 0.26);
      blade.rotation.set(0.42, -a, 0);
      part(blade, 'Fan blade', `${nBlades} blades · ${calc.finfan?.fanKW.toFixed(1)} kW · ${fmt(calc.finfan?.airFlowCMH ?? 0, 0)} m³/h`);
      rotor.add(blade);
    }
    bay.add(rotor);
    o.spin.push(rotor);

    const motorY = fm.fanY + (fm.arrangement === 'forced' ? -420 : 420);
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(fm.fanDiaMm * 0.11, fm.fanDiaMm * 0.11, 520, 20),
      steelMat(o, 0x4c5a6e, 0.6)
    );
    motor.position.y = motorY;
    part(motor, 'Fan motor', `${equip.finfan?.motorKw ? `${equip.finfan.motorKw} kW specified` : `${(calc.finfan?.fanKW ?? 0).toFixed(1)} kW shaft`}`);
    bay.add(motor);

    addLabel(o, `Bay ${b + 1} · ${fm.rows} rows`, new THREE.Vector3(0, fm.bundleTopY + 220, 0), 'plain');
    o.model.add(bay);
  }

  // bay-level annotations
  if (o.showDims) {
    const z0 = fm.bayCentersZ[0] - fm.bayDepthMm / 2;
    const z1 = fm.bayCentersZ[0] + fm.bayDepthMm / 2;
    dimension(o, new THREE.Vector3(-halfL, fm.bundleTopY, z0), new THREE.Vector3(halfL, fm.bundleTopY, z0), new THREE.Vector3(0, 400, 0), `Finned length ${fmt(L, 0)} mm`);
    dimension(o, new THREE.Vector3(halfL + 400, fm.fanY, z0), new THREE.Vector3(halfL + 400, fm.fanY, z1), new THREE.Vector3(600, 0, 0), `Bay depth ${fmt(fm.bayDepthMm, 0)} mm`);
    dimension(o, new THREE.Vector3(-headerX, 0, fm.bayCentersZ[fm.bays - 1]), new THREE.Vector3(-headerX, fm.overallHeightMm, fm.bayCentersZ[fm.bays - 1]), new THREE.Vector3(-700, 0, 0), `Overall ${fmt(fm.overallHeightMm, 0)} mm`);
  }
}

// ---------------------------------------------------------------------------
// Access & structural steelwork
//
// The descriptors come from the pure structure3d module (upright erection
// frame: y = height above grade). Everything below is only drawing: ladders
// with cages and guide rails, stair flights and spiral stairs, grating
// platforms with top/mid rail and toe board, walkways, fan guards, bracing and
// the skid/portal/pedestal the register can select. Keeping the rules in the
// engine means the access you see is the access that was counted.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Quaternion for a flat (XY-plane) ring/torus, laid into plan and centred on an azimuth. */
function planQuat(azimuthDeg: number, sweepDeg: number): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromAxisAngle(UP_Y, (azimuthDeg - 90 - sweepDeg / 2) * DEG);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  return q;
}

let gratingTex: THREE.CanvasTexture | null = null;
function gratingTexture(): THREE.CanvasTexture {
  if (gratingTex) return gratingTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#4d5c70';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#93a4b8';
    for (let i = 0; i < 64; i += 8) g.fillRect(0, i, 64, 4); // bearing bars
    for (let i = 0; i < 64; i += 32) g.fillRect(i, 0, 4, 64); // cross rods
  }
  gratingTex = new THREE.CanvasTexture(c);
  gratingTex.wrapS = gratingTex.wrapT = THREE.RepeatWrapping;
  gratingTex.colorSpace = THREE.SRGBColorSpace;
  return gratingTex;
}

function deckMat(o: BuildOpts, repeatU: number, repeatV: number): THREE.Material {
  if (o.mode === 'wireframe') return new THREE.MeshBasicMaterial({ color: 0x8fa2b8, wireframe: true, transparent: true, opacity: 0.35 });
  const tex = gratingTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, repeatU), Math.max(1, repeatV));
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: o.mode === 'heatmap' ? 0xb9c6d6 : 0xffffff,
    metalness: 0.45,
    roughness: 0.75,
    side: THREE.DoubleSide,
    clippingPlanes: o.clip,
  });
}

function railMat(o: BuildOpts): THREE.Material {
  return steelMat(o, 0xbfccdb, 0.4);
}

/** Square-section member between two points (rails, bracing, stringers). */
function barBetween(
  o: BuildOpts,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sizeMm: number,
  mat: THREE.Material,
  label = '',
  detail = ''
) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (!(len > 1)) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeMm, len, sizeMm), mat);
  mesh.quaternion.setFromUnitVectors(UP_Y, d.clone().normalize());
  mesh.position.copy(a).addScaledVector(d, 0.5);
  if (label) part(mesh, label, detail);
  o.model.add(mesh);
}

function buildBar(o: BuildOpts, b: AccessBar) {
  const a = new THREE.Vector3(b.a[0], b.a[1], b.a[2]);
  const c = new THREE.Vector3(b.b[0], b.b[1], b.b[2]);
  const d = c.clone().sub(a);
  const len = d.length();
  if (!(len > 1)) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.diaMm, len, b.diaMm), steelMat(o, 0x6a7a92, 0.6));
  mesh.quaternion.setFromUnitVectors(UP_Y, d.clone().normalize());
  mesh.position.copy(a).addScaledVector(d, 0.5);
  part(mesh, b.label, b.detail);
  o.model.add(mesh);
}

/** Top rail + mid rail + toe board + posts along a circular arc. */
function ringRail(
  o: BuildOpts,
  radius: number,
  y: number,
  azimuthDeg: number,
  sweepDeg: number,
  mat: THREE.Material,
  withToe: boolean
) {
  const sw = Math.max(1, Math.min(360, Math.abs(sweepDeg)));
  const seg = Math.max(16, Math.ceil(sw / 3));
  const top = new THREE.Mesh(new THREE.TorusGeometry(radius, 17, 6, seg, sw * DEG), mat);
  top.quaternion.copy(planQuat(azimuthDeg, sw));
  top.position.y = y + ACCESS.railHeightMm;
  o.model.add(top);
  const mid = new THREE.Mesh(new THREE.TorusGeometry(radius, 14, 6, seg, sw * DEG), mat);
  mid.quaternion.copy(planQuat(azimuthDeg, sw));
  mid.position.y = y + ACCESS.midRailMm;
  o.model.add(mid);

  const posts = Math.max(2, Math.ceil((sw * DEG * radius) / ACCESS.postPitchMm));
  for (let i = 0; i <= posts; i++) {
    const a = (azimuthDeg - sw / 2 + (sw * i) / posts) * DEG;
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    barBetween(o, new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + ACCESS.railHeightMm, z), 34, mat);
  }
  if (withToe) {
    const toe = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, ACCESS.toeBoardMm, Math.max(24, seg), 1, true, (azimuthDeg - sw / 2) * DEG, sw * DEG),
      mat
    );
    toe.position.y = y + ACCESS.toeBoardMm / 2;
    o.model.add(toe);
  }
}

/** Handrail, mid rail, toe board and posts along the given rectangular edges. */
function rectRails(
  o: BuildOpts,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  y: number,
  sides: string[],
  mat: THREE.Material
) {
  const edges: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    north: [new THREE.Vector3(cx - hx, y, cz + hz), new THREE.Vector3(cx + hx, y, cz + hz)],
    south: [new THREE.Vector3(cx - hx, y, cz - hz), new THREE.Vector3(cx + hx, y, cz - hz)],
    east: [new THREE.Vector3(cx + hx, y, cz - hz), new THREE.Vector3(cx + hx, y, cz + hz)],
    west: [new THREE.Vector3(cx - hx, y, cz - hz), new THREE.Vector3(cx - hx, y, cz + hz)],
  };
  for (const side of sides) {
    const edge = edges[side];
    if (!edge) continue;
    const [a, b] = edge;
    barBetween(o, a.clone().setY(y + ACCESS.railHeightMm), b.clone().setY(y + ACCESS.railHeightMm), 34, mat);
    barBetween(o, a.clone().setY(y + ACCESS.midRailMm), b.clone().setY(y + ACCESS.midRailMm), 28, mat);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const toe = new THREE.Mesh(new THREE.BoxGeometry(len, ACCESS.toeBoardMm, 10), mat);
    toe.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    toe.position.set((a.x + b.x) / 2, y + ACCESS.toeBoardMm / 2, (a.z + b.z) / 2);
    o.model.add(toe);
    const posts = Math.max(1, Math.ceil(len / ACCESS.postPitchMm));
    for (let i = 0; i <= posts; i++) {
      const p = a.clone().lerp(b, i / posts);
      barBetween(o, p.clone(), p.clone().setY(y + ACCESS.railHeightMm), 34, mat);
    }
  }
}

function buildPlatform(o: BuildOpts, p: AccessPlatform) {
  const rail = railMat(o);
  if (p.kind === 'ring') {
    const sw = Math.max(1, Math.min(360, Math.abs(p.sweepDeg)));
    const geo = new THREE.RingGeometry(p.r0, p.r1, Math.max(24, Math.ceil(sw / 3)), 1, 0, sw * DEG);
    const deck = new THREE.Mesh(geo, deckMat(o, (sw * DEG * p.r1) / 160, (p.r1 - p.r0) / 160));
    deck.quaternion.copy(planQuat(p.azimuthDeg, sw));
    deck.position.y = p.y;
    part(deck, p.label, p.detail);
    o.model.add(deck);
    if (p.rails.includes('outer')) ringRail(o, p.r1, p.y, p.azimuthDeg, sw, rail, true);
    if (p.rails.includes('inner')) ringRail(o, p.r0, p.y, p.azimuthDeg, sw, rail, false);
  } else {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(p.hx * 2, 40, p.hz * 2),
      deckMat(o, (p.hx * 2) / 160, (p.hz * 2) / 160)
    );
    deck.position.set(p.cx, p.y, p.cz);
    part(deck, p.label, p.detail);
    o.model.add(deck);
    rectRails(o, p.cx, p.cz, p.hx, p.hz, p.y + 20, p.rails, rail);
  }
}

function buildWalkway(o: BuildOpts, w: AccessWalkway) {
  const a = new THREE.Vector3(w.x0, w.y0, w.z0);
  const b = new THREE.Vector3(w.x1, w.y1, w.z1);
  const d = b.clone().sub(a);
  const len = d.length();
  if (!(len > 1)) return;
  d.normalize();
  const right = new THREE.Vector3().crossVectors(UP_Y, d).normalize();
  if (right.lengthSq() < 0.5) right.set(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(right, d).normalize();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const width = Math.max(1, w.widthMm);

  if (w.widthMm > 0) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, len, 36), deckMat(o, width / 160, len / 160));
    deck.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, d, normal));
    deck.position.copy(mid);
    part(deck, w.label, w.detail);
    o.model.add(deck);
  }

  if (w.rails) {
    const rail = railMat(o);
    for (const sgn of [-1, 1]) {
      const off = right.clone().multiplyScalar(sgn * Math.max(0, width / 2 - 40));
      const p0 = a.clone().add(off);
      const p1 = b.clone().add(off);
      barBetween(o, p0.clone().setY(p0.y + ACCESS.railHeightMm), p1.clone().setY(p1.y + ACCESS.railHeightMm), 34, rail);
      barBetween(o, p0.clone().setY(p0.y + ACCESS.midRailMm), p1.clone().setY(p1.y + ACCESS.midRailMm), 28, rail);
      const posts = Math.max(1, Math.ceil(len / ACCESS.postPitchMm));
      for (let i = 0; i <= posts; i++) {
        const p = p0.clone().lerp(p1, i / posts);
        barBetween(o, p.clone(), p.clone().setY(p.y + ACCESS.railHeightMm), 34, rail);
      }
    }
  }
}

function buildGuard(o: BuildOpts, g: AccessGuard) {
  const rail = railMat(o);
  if (g.heightMm <= 200) {
    // intake screen: a hoop with a mesh disc
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(g.radiusMm, 30, 8, 48), steelMat(o, 0x7c8b9f, 0.6));
    hoop.quaternion.copy(planQuat(g.azimuthDeg, 360));
    hoop.position.y = g.y;
    part(hoop, g.label, g.detail);
    o.model.add(hoop);
    const screen = new THREE.Mesh(
      new THREE.CircleGeometry(g.radiusMm, 40),
      new THREE.MeshStandardMaterial({ color: 0x5d6d81, metalness: 0.5, roughness: 0.6, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = g.y;
    o.model.add(screen);
    return;
  }
  ringRail(o, g.radiusMm, g.y - ACCESS.railHeightMm, g.azimuthDeg, g.sweepDeg, rail, true);
}

// ---------------------------------------------------------------------------
// Ladders and stairs
// ---------------------------------------------------------------------------

function buildLadder(o: BuildOpts, l: AccessLadder) {
  const mat = steelMat(o, 0xa9b8ca, 0.55);
  const f = l.facingDeg * DEG;
  const right = new THREE.Vector3(Math.cos(f), 0, -Math.sin(f));
  const fwd = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
  const h = l.y1 - l.y0;
  if (!(h > 0)) return;

  for (const sgn of [-1, 1]) {
    const p = new THREE.Vector3(l.x, 0, l.z).addScaledVector(right, (sgn * l.widthMm) / 2);
    const stile = new THREE.Mesh(new THREE.BoxGeometry(16, h, 70), mat);
    stile.position.set(p.x, l.y0 + h / 2, p.z);
    stile.rotation.y = f;
    part(stile, l.label, l.detail);
    o.model.add(stile);
  }

  const n = Math.max(1, Math.floor(h / Math.max(150, l.rungPitchMm)));
  const rungs = new THREE.InstancedMesh(new THREE.BoxGeometry(l.widthMm, 22, 22), mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(UP_Y, f);
  for (let i = 0; i < n; i++) {
    m.compose(new THREE.Vector3(l.x, l.y0 + l.rungPitchMm * (i + 0.5), l.z), q, new THREE.Vector3(1, 1, 1));
    rungs.setMatrixAt(i, m);
  }
  rungs.instanceMatrix.needsUpdate = true;
  o.model.add(rungs);

  // safety cage: hoops every 900 mm plus straps down the back
  if (l.cageFromY > 0 && l.y1 > l.cageFromY) {
    const cageR = l.widthMm / 2 + 360;
    for (let y = l.cageFromY; y < l.y1 - 150; y += 900) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(cageR, 9, 6, 28, 200 * DEG), mat);
      hoop.quaternion.copy(planQuat(l.facingDeg, 200));
      hoop.position.set(l.x, y, l.z);
      o.model.add(hoop);
    }
    for (const off of [-70, 0, 70]) {
      const a = (l.facingDeg + off) * DEG;
      const px = l.x + Math.sin(a) * cageR;
      const pz = l.z + Math.cos(a) * cageR;
      barBetween(o, new THREE.Vector3(px, l.cageFromY, pz), new THREE.Vector3(px, l.y1, pz), 12, mat);
    }
  }

  // standoff guide rails with brackets — a long unbraced ladder needs them
  if (l.guideRails) {
    for (const sgn of [-1, 1]) {
      const base = new THREE.Vector3(l.x, 0, l.z)
        .addScaledVector(right, sgn * (l.widthMm / 2 + 60))
        .addScaledVector(fwd, 300);
      barBetween(o, new THREE.Vector3(base.x, l.y0 + 900, base.z), new THREE.Vector3(base.x, l.y1, base.z), 70, mat);
      const stileX = l.x + right.x * sgn * (l.widthMm / 2);
      const stileZ = l.z + right.z * sgn * (l.widthMm / 2);
      for (let y = l.y0 + 1200; y < l.y1; y += 1500) {
        barBetween(o, new THREE.Vector3(base.x, y, base.z), new THREE.Vector3(stileX, y, stileZ), 60, mat);
      }
    }
  }

  if (o.showLabels) {
    addLabel(o, `Ladder · ${Math.round(l.y1 - 1100)} mm`, new THREE.Vector3(l.x, l.y1 + 200, l.z), 'plain');
  }
}

/** Switchback stair: alternating flights with a landing at every turn. */
function buildStraightStair(o: BuildOpts, s: AccessStair) {
  const mat = steelMat(o, 0x8b9bb0, 0.55);
  const rail = railMat(o);
  const flights = Math.max(1, s.flights);
  const perFlight = (s.y1 - s.y0) / flights;
  const nSteps = Math.max(2, Math.round(perFlight / 175));
  const rise = perFlight / nSteps;
  const going = 250;
  const width = Math.max(700, s.widthMm);

  let px = s.x;
  let pz = s.z;
  let py = s.y0;
  let heading = s.headingDeg * DEG;

  for (let k = 0; k < flights; k++) {
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));

    const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 36, going - 20), mat, nSteps);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(UP_Y, heading);
    for (let i = 0; i < nSteps; i++) {
      m.compose(
        new THREE.Vector3(px + dir.x * going * (i + 0.5), py + rise * (i + 1), pz + dir.z * going * (i + 0.5)),
        q,
        new THREE.Vector3(1, 1, 1)
      );
      treads.setMatrixAt(i, m);
    }
    treads.instanceMatrix.needsUpdate = true;
    part(treads, s.label, s.detail);
    o.model.add(treads);

    const endX = px + dir.x * going * nSteps;
    const endZ = pz + dir.z * going * nSteps;
    for (const sgn of [-1, 1]) {
      const off = right.clone().multiplyScalar(sgn * (width / 2 - 60));
      const a0 = new THREE.Vector3(px + off.x, py, pz + off.z);
      const b0 = new THREE.Vector3(endX + off.x, py + perFlight, endZ + off.z);
      barBetween(o, a0, b0, 70, mat);
      barBetween(o, a0.clone().setY(a0.y + ACCESS.railHeightMm), b0.clone().setY(b0.y + ACCESS.railHeightMm), 34, rail);
      barBetween(o, a0.clone().setY(a0.y + ACCESS.midRailMm), b0.clone().setY(b0.y + ACCESS.midRailMm), 28, rail);
    }

    // landing where this flight ends (drawn here, weighed in the engine)
    buildPlatform(o, {
      label: `Stair landing ${k + 1}`,
      detail: `Landing at ${Math.round(py + perFlight)} mm between flights`,
      kind: 'rect',
      y: py + perFlight,
      r0: 0,
      r1: 0,
      azimuthDeg: 0,
      sweepDeg: 0,
      cx: endX + dir.x * 300,
      cz: endZ + dir.z * 300,
      hx: 650,
      hz: 650,
      railHeightMm: ACCESS.railHeightMm,
      rails: ['north', 'south', 'east', 'west'],
      kg: 0,
    });

    px = endX;
    pz = endZ;
    py += perFlight;
    // switch back, stepping sideways so the next flight clears the one below
    heading += Math.PI;
    px += right.x * (width + 300);
    pz += right.z * (width + 300);
  }
}

/** Spiral stair: instanced treads, helical stringers/handrails and posts. */
function buildSpiralStair(o: BuildOpts, s: AccessStair) {
  const n = Math.max(1, s.steps);
  const mat = steelMat(o, 0x7f8fa4, 0.7);
  const rail = railMat(o);
  const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(s.widthMm, 36, 240), mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const a = (s.startDeg + i * s.stepAngleDeg) * DEG;
    q.setFromAxisAngle(UP_Y, a - Math.PI / 2);
    m.compose(
      new THREE.Vector3(Math.sin(a) * s.radiusMm, s.y0 + i * s.riseMm, Math.cos(a) * s.radiusMm),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    treads.setMatrixAt(i, m);
  }
  treads.instanceMatrix.needsUpdate = true;
  part(treads, s.label, s.detail);
  o.model.add(treads);

  const rIn = Math.max(200, s.radiusMm - s.widthMm / 2);
  const rOut = s.radiusMm + s.widthMm / 2;
  for (const r of [rIn, rOut]) {
    const treadPts: THREE.Vector3[] = [];
    const railPts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i += 2) {
      const a = (s.startDeg + i * s.stepAngleDeg) * DEG;
      const y = s.y0 + i * s.riseMm;
      treadPts.push(new THREE.Vector3(Math.sin(a) * r, y - 60, Math.cos(a) * r));
      railPts.push(new THREE.Vector3(Math.sin(a) * r, y + ACCESS.railHeightMm, Math.cos(a) * r));
    }
    if (treadPts.length > 1) {
      const stringer = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(treadPts), Math.max(12, treadPts.length * 2), 26, 5, false), mat);
      o.model.add(stringer);
      const topRail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), Math.max(12, railPts.length * 2), 17, 5, false), rail);
      o.model.add(topRail);
    }
  }
  // posts every third tread
  for (let i = 0; i < n; i += 3) {
    const a = (s.startDeg + i * s.stepAngleDeg) * DEG;
    const y = s.y0 + i * s.riseMm;
    for (const r of [rIn, rOut]) {
      barBetween(
        o,
        new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r),
        new THREE.Vector3(Math.sin(a) * r, y + ACCESS.railHeightMm, Math.cos(a) * r),
        34,
        rail
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

function buildFrame(o: BuildOpts, f: AccessFrame) {
  const mat = steelMat(o, 0x4e5d74, 0.72);
  const { hx, hz, heightMm: h } = f;
  if (f.kind === 'skid') {
    for (const sgn of [-1, 1]) {
      const runner = new THREE.Mesh(new THREE.BoxGeometry(260, 280, hz * 2), mat);
      runner.position.set(sgn * hx, 140, 0);
      part(runner, f.label, f.detail);
      o.model.add(runner);
    }
    for (let i = -1; i <= 1; i++) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 200, 200), mat);
      cross.position.set(0, 120, i * hz * 0.8);
      o.model.add(cross);
    }
  } else if (f.kind === 'portal') {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(220, h, 220), mat);
        col.position.set(sx * hx, h / 2, sz * hz);
        part(col, f.label, f.detail);
        o.model.add(col);
        const base = new THREE.Mesh(new THREE.BoxGeometry(520, 40, 520), steelMat(o, 0x46526b, 0.8));
        base.position.set(sx * hx, 20, sz * hz);
        o.model.add(base);
      }
    }
    for (const sz of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 260, 260, 200), mat);
      beam.position.set(0, h - 130, sz * hz);
      o.model.add(beam);
    }
    for (const sx of [-1, 1]) {
      barBetween(
        o,
        new THREE.Vector3(sx * (hx - 900), h - 1600, hz),
        new THREE.Vector3(sx * hx, h - 900, hz),
        90,
        mat
      );
    }
  } else if (f.kind === 'pedestal') {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, h, hz * 2), steelMat(o, 0x59687f, 0.85));
    ped.position.y = h / 2;
    part(ped, f.label, f.detail);
    o.model.add(ped);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 200, 60, hz * 2 + 200), steelMat(o, 0x4a576b, 0.8));
    cap.position.y = h + 30;
    o.model.add(cap);
  } else {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(200, h, 200), mat);
        col.position.set(sx * (hx - 200), h / 2, sz * (hz - 200));
        part(col, f.label, f.detail);
        o.model.add(col);
      }
    }
    buildPlatform(o, {
      label: f.label,
      detail: f.detail,
      kind: 'rect',
      y: h,
      r0: 0,
      r1: 0,
      azimuthDeg: 0,
      sweepDeg: 0,
      cx: 0,
      cz: 0,
      hx,
      hz,
      railHeightMm: ACCESS.railHeightMm,
      rails: ['north', 'south', 'east', 'west'],
      kg: 0,
    });
  }
}

/**
 * Draw all access/structure steelwork for the tag. The descriptors are in the
 * upright erection frame (y = height above grade); this only has to place that
 * frame on the particular model family.
 */
function buildAccess(equip: Equipment, calc: EquipmentCalc, o: BuildOpts) {
  const am = accessModel(equip, calc);
  const hasAny =
    am.ladders.length || am.stairs.length || am.platforms.length || am.walkways.length || am.guards.length || am.bars.length || am.frame;
  if (!hasAny) return;

  const acc = new THREE.Group();
  if (equip.equipType === 'tank' || equip.equipType === 'finfan') {
    // these models already put grade at y = 0
  } else if (equip.orientation === 'horizontal') {
    // lay the erection frame on its side: descriptor z becomes the vessel axis
    const layout = buildBodyLayout(sectionsFor(equip, calc));
    const R = Math.max(...layout.segments.map((sg) => Math.max(sg.r0, sg.r1)), 100);
    acc.position.set(0, 0, R * 1.01 + 40);
    acc.rotation.x = -Math.PI / 2;
  } else {
    const layout = buildBodyLayout(sectionsFor(equip, calc));
    acc.position.y = layout.bottomDepth - supportHeightMm(equip);
  }

  // draw into the access group, then hand it back to the model
  const target = o.model;
  o.model = acc;
  for (const l of am.ladders) buildLadder(o, l);
  for (const st of am.stairs) {
    if (st.kind === 'spiral') buildSpiralStair(o, st);
    else buildStraightStair(o, st);
  }
  for (const p of am.platforms) buildPlatform(o, p);
  for (const w of am.walkways) buildWalkway(o, w);
  for (const g of am.guards) buildGuard(o, g);
  for (const b of am.bars) buildBar(o, b);
  if (am.frame) buildFrame(o, am.frame);
  o.model = target;
  target.add(acc);

  if (o.showLabels && am.platforms.length) {
    const top = [...am.platforms].sort((a, b) => b.y - a.y)[0];
    const at =
      top.kind === 'ring'
        ? new THREE.Vector3(Math.sin(top.azimuthDeg * DEG) * top.r1, top.y + 1500, Math.cos(top.azimuthDeg * DEG) * top.r1)
        : new THREE.Vector3(top.cx + top.hx, top.y + 1500, top.cz + top.hz);
    addLabel(o, `Access · ${am.platforms.length} platform${am.platforms.length === 1 ? '' : 's'}`, at, 'accent');
  }
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Viewer3D() {
  const equipment = useStore((s) => s.equipment);
  const selectedId = useStore((s) => s.selectedEquipId);
  const mountRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('heatmap');
  const [showNozzles, setShowNozzles] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [showInternals, setShowInternals] = useState(true);
  const [showLiquid, setShowLiquid] = useState(true);
  const [showAccess, setShowAccess] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [view, setView] = useState<ViewPreset>('iso');

  const groupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const spinRef = useRef<THREE.Object3D[]>([]);
  const fitRef = useRef<{ target: THREE.Vector3; span: number } | null>(null);
  const viewRef = useRef<ViewPreset>('iso');
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
  } | null>(null);

  const equip = useMemo(
    () => equipment.find((e) => e.id === selectedId) ?? equipment[0],
    [equipment, selectedId]
  );
  const calc = useMemo(() => (equip ? computeEquipment(equip) : null), [equip]);
  const summary = useMemo(() => (equip && calc ? viewerSummary(equip, calc) : null), [equip, calc]);
  const access = useMemo(() => (equip && calc ? accessModel(equip, calc) : null), [equip, calc]);

  // ---------- three.js lifecycle ----------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0f16');
    scene.fog = new THREE.Fog('#0a0f16', 90000, 260000);

    const w0 = Math.max(1, mount.clientWidth);
    const h0 = Math.max(1, mount.clientHeight);
    const camera = new THREE.PerspectiveCamera(42, w0 / h0, 10, 400000);
    camera.position.set(9000, 6000, 11000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w0, h0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495; // never orbit under the foundation
    controls.screenSpacePanning = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.32));
    scene.add(new THREE.HemisphereLight(0x9dc0f0, 0x161d27, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(12000, 18000, 9000);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7ea2ff, 0.5);
    fill.position.set(-14000, 4000, -10000);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd8a8, 0.35);
    rim.position.set(0, -6000, 12000);
    scene.add(rim);

    const grid = new THREE.GridHelper(40000, 40, 0x33415c, 0x1b2431);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.6;
    scene.add(grid);

    // soft radial pool of light under the model so it reads as grounded
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const c2d = canvas.getContext('2d');
    if (c2d) {
      const grad = c2d.createRadialGradient(128, 128, 4, 128, 128, 126);
      grad.addColorStop(0, 'rgba(120,160,220,0.42)');
      grad.addColorStop(0.55, 'rgba(70,100,150,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c2d.fillStyle = grad;
      c2d.fillRect(0, 0, 256, 256);
    }
    const groundTex = new THREE.CanvasTexture(canvas);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false, opacity: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);
    groundRef.current = ground;
    gridRef.current = grid;

    sceneRef.current = { scene, camera, renderer, controls };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      for (const rotor of spinRef.current) rotor.rotation.y += 0.02;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w = Math.max(1, mountRef.current.clientWidth);
      const h = Math.max(1, mountRef.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      groundTex.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      controls.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ---------- model build ----------
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !equip || !calc) return;

    // dispose the previous model
    if (groupRef.current) {
      ctx.scene.remove(groupRef.current);
      groupRef.current.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        mats.forEach((mm) => {
          const m = mm as THREE.MeshStandardMaterial;
          m.map?.dispose();
          mm.dispose();
        });
      });
    }
    spinRef.current = [];

    const g = new THREE.Group();
    const model = new THREE.Group();
    const ann = new THREE.Group();
    g.add(model);
    g.add(ann);

    const clip: THREE.Plane[] | undefined = cutaway
      ? [new THREE.Plane(new THREE.Vector3(-0.62, 0, 0.78).normalize(), 0)]
      : undefined;

    const o: BuildOpts = {
      mode,
      showNozzles,
      showLabels,
      showDims,
      cutaway,
      showInternals,
      showLiquid,
      clip,
      model,
      ann,
      labels: [],
      spin: spinRef.current,
    };

    const tm = tankModel(equip, calc);
    const fm = finFanModel(equip, calc);
    if (equip.equipType === 'tank' && tm) buildTank(g, equip, calc, tm, o);
    else if (equip.equipType === 'finfan' && fm) buildFinFan(g, equip, calc, fm, o);
    else buildVessel(g, equip, calc, o);

    // ladders, stairs, platforms, rails and any selected structure frame
    if (showAccess) buildAccess(equip, calc, o);

    // userData.partLabel is only used for picking — no state involved
    ctx.scene.add(g);

    // rest the model on the grade line and frame the camera on its bounds
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    g.position.y -= box.min.y;
    const span = Math.max(1200, size.x, size.y, size.z);
    const target = new THREE.Vector3(center.x, center.y - box.min.y, center.z);

    for (const l of o.labels) {
      const h = span * 0.03;
      l.sprite.scale.set(h * l.aspect, h, 1);
    }

    if (gridRef.current) {
      const gridSpan = Math.max(span * 2.6, 12000);
      gridRef.current.scale.setScalar(gridSpan / 40000);
      gridRef.current.position.y = 0;
    }
    if (groundRef.current) {
      groundRef.current.scale.set(span * 7, span * 7, 1);
    }

    fitRef.current = { target, span };
    ctx.controls.target.copy(target);
    const setCam = (preset: ViewPreset) => {
      const d = span * 1.55;
      if (preset === 'front') ctx.camera.position.set(target.x, target.y, target.z + d);
      else if (preset === 'side') ctx.camera.position.set(target.x + d, target.y, target.z);
      else if (preset === 'top') ctx.camera.position.set(target.x + 0.01, target.y + d * 1.1, target.z + 0.01);
      else ctx.camera.position.set(target.x + span * 0.95, target.y + span * 0.62, target.z - span * 1.15);
      ctx.camera.near = Math.max(10, span / 400);
      ctx.camera.far = span * 60;
      ctx.camera.updateProjectionMatrix();
      ctx.controls.update();
    };
    setCam(viewRef.current);

    // hover picking: identify the part under the cursor
    const raycaster = new THREE.Raycaster();
    const dom = ctx.renderer.domElement;
    const onMove = (ev: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      raycaster.setFromCamera(ndc, ctx.camera);
      const hits = raycaster.intersectObjects(model.children, true);
      const hit = hits.find((h) => (h.object as THREE.Mesh).userData.partLabel);
      if (hit) {
        const d = hit.object.userData as { partLabel: string; partDetail?: string };
        setHover({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          text: `${d.partLabel}${d.partDetail ? ` — ${d.partDetail}` : ''}`,
        });
        dom.style.cursor = 'crosshair';
      } else {
        setHover(null);
        dom.style.cursor = 'grab';
      }
    };
    const onLeave = () => {
      setHover(null);
      dom.style.cursor = 'grab';
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);

    groupRef.current = g;
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
    };
  }, [equip, calc, mode, showNozzles, showLabels, showDims, cutaway, showInternals, showLiquid, showAccess]);

  // camera presets drive the existing camera; they must not rebuild the model
  useEffect(() => {
    viewRef.current = view;
    const ctx = sceneRef.current;
    const fit = fitRef.current;
    if (!ctx || !fit) return;
    const { target, span } = fit;
    const d = span * 1.55;
    if (view === 'front') ctx.camera.position.set(target.x, target.y, target.z + d);
    else if (view === 'side') ctx.camera.position.set(target.x + d, target.y, target.z);
    else if (view === 'top') ctx.camera.position.set(target.x + 0.01, target.y + d * 1.1, target.z + 0.01);
    else ctx.camera.position.set(target.x + span * 0.95, target.y + span * 0.62, target.z - span * 1.15);
    ctx.camera.updateProjectionMatrix();
    ctx.controls.target.copy(target);
    ctx.controls.update();
  }, [view]);

  const snapshot = () => {
    const ctx = sceneRef.current;
    if (!ctx || !equip) return;
    ctx.renderer.render(ctx.scene, ctx.camera);
    const url = ctx.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${equip.tag || 'equipment'}-3d.png`;
    a.click();
  };

  if (!equip || !calc) {
    return <div className="card">No equipment yet — create a tag in the Equipment Register first.</div>;
  }

  const tm = equip.equipType === 'tank' ? tankModel(equip, calc) : null;
  const fm = equip.equipType === 'finfan' ? finFanModel(equip, calc) : null;
  const sizeLabel = tm
    ? `Ø${fmt(tm.diameterMm, 0)} × ${fmt(tm.shellTopY - tm.shellBaseY, 0)} mm shell`
    : fm
      ? `${fm.bays} bay × ${fm.rows} rows · Ø${fmt(fm.fanDiaMm, 0)} fans`
      : `Ø${equip.sections[0]?.dia ?? 0} × ${equip.sections.reduce((s2, x) => s2 + x.ttLength, 0)} mm`;

  return (
    <div className="viewer-page">
      <div className="row viewer-toolbar">
        <select
          value={equip.id}
          onChange={(e) => setState({ selectedEquipId: e.target.value })}
          style={{ minWidth: 260 }}
          aria-label="Equipment tag"
        >
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
          ))}
        </select>
        <div className="seg">
          <button className={mode === 'heatmap' ? 'primary' : ''} onClick={() => setMode('heatmap')}>Stress heatmap</button>
          <button className={mode === 'material' ? 'primary' : ''} onClick={() => setMode('material')}>Material</button>
          <button className={mode === 'wireframe' ? 'primary' : ''} onClick={() => setMode('wireframe')}>Wireframe</button>
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button className={view === 'iso' ? 'primary' : ''} onClick={() => setView('iso')}>Iso</button>
          <button className={view === 'front' ? 'primary' : ''} onClick={() => setView('front')}>Front</button>
          <button className={view === 'side' ? 'primary' : ''} onClick={() => setView('side')}>Side</button>
          <button className={view === 'top' ? 'primary' : ''} onClick={() => setView('top')}>Top</button>
        </div>
        <button onClick={snapshot} title="Download a PNG of the current view">⤓ Snapshot</button>
        <button onClick={() => exportOBJ(equip, calc)} title="Export the model as OBJ for CAD">Export OBJ</button>
        <button onClick={() => window.print()}>Print view</button>
      </div>

      <div className="row viewer-toolbar" style={{ marginTop: -4 }}>
        <span className="small muted">Show</span>
        <label className="small muted"><input type="checkbox" checked={showNozzles} onChange={(e) => setShowNozzles(e.target.checked)} /> Nozzles</label>
        <label className="small muted"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Tags</label>
        <label className="small muted"><input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Dimensions</label>
        <label className="small muted"><input type="checkbox" checked={showInternals} onChange={(e) => setShowInternals(e.target.checked)} /> Internals</label>
        <label className="small muted"><input type="checkbox" checked={showAccess} onChange={(e) => setShowAccess(e.target.checked)} /> Access &amp; steelwork</label>
        <label className="small muted"><input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} /> Cutaway</label>
        {(equip.equipType === 'tank' || equip.equipType === 'vessel' || equip.equipType === 'column') && (
          <label className="small muted"><input type="checkbox" checked={showLiquid} onChange={(e) => setShowLiquid(e.target.checked)} /> Liquid</label>
        )}
      </div>

      <div className="viewer-layout">
        <div className="viewer3d" ref={mountRef}>
          <div className="viewer-overlay">
            <span className="badge info">{equip.tag} · {sizeLabel}</span>
            <span className="badge info">{equip.equipType === 'tank' ? 'API 650' : equip.equipType === 'finfan' ? 'API 661' : `MAWP ${fmt(calc.mawpBar, 2)} bar g`}</span>
            <span className={`badge ${calc.membraneUtil > 1 ? 'err' : calc.membraneUtil > 0.9 ? 'warn' : 'ok'}`}>
              {equip.equipType === 'finfan' ? `Thermal margin ${calc.finfan?.thermalMarginPct.toFixed(0) ?? 0}%` : `Membrane util ${(calc.membraneUtil * 100).toFixed(0)}%`}
            </span>
            {cutaway && <span className="badge warn">Cutaway — half the shell is clipped</span>}
            {showAccess && access && access.weightKg > 0 && (
              <span className="badge info">{Math.round(access.weightKg)} kg access steel</span>
            )}
          </div>
          <div className="legend">
            <strong>Utilization</strong>
            <div className="bar" />
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 140 }}>
              <span>0%</span><span>50%</span><span>100%+</span>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>Blue: nozzle OK · Red: nozzle fails</div>
          </div>
          {hover && (
            <div className="viewer-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              {hover.text}
            </div>
          )}
          <div className="viewer-hint">Drag to orbit · scroll to zoom · right-drag to pan · hover a part to identify it</div>
        </div>

        <aside className="viewer-panel">
          <h3>{summary?.title}</h3>
          <p className="small muted" style={{ marginTop: -4 }}>{summary?.subtitle}</p>
          <div className="viewer-parts">
            {summary?.rows.map((r, i) => (
              <div className="vp-row" key={`${r.label}-${i}`}>
                <div className="vp-label">{r.label}</div>
                <div className={`vp-value ${r.tone ?? ''}`}>{r.value}</div>
                {r.note && <div className="vp-note">{r.note}</div>}
              </div>
            ))}
          </div>
          {showAccess && access && access.rows.length > 0 && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
                <h4 style={{ margin: 0 }}>Access &amp; steelwork</h4>
                <span className="badge info">{Math.round(access.weightKg)} kg</span>
              </div>
              <div className="viewer-parts">
                {access.rows.map((r, i) => (
                  <div className="vp-row" key={`acc-${r.label}-${i}`}>
                    <div className="vp-label">{r.label}</div>
                    <div className={`vp-value ${r.tone ?? ''}`}>{r.value}</div>
                    {r.note && <div className="vp-note">{r.note}</div>}
                  </div>
                ))}
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>{access.basis}</p>
            </>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            Model is built from the design results — course heights, plate thicknesses, roof slope and fan size all come
            from the engine, so what you see is what was calculated. OBJ export and the drawing views under
            Reports &amp; CAD Export use the same geometry.
          </p>
        </aside>
      </div>

      <p className="muted small" style={{ marginTop: 8 }}>
        {equip.equipType === 'tank'
          ? 'Tank model: bottom plates + annular ring, every shell course at its calculated thickness, the cone/dome roof at the entered slope, wind girders, spiral stair and shell nozzles. Enable Cutaway to see the product fill and floating roof inside.'
          : equip.equipType === 'finfan'
            ? 'Air cooler model: finned tube rows, headers, plenum, legs and the fans sized by API 661 (≥ 40 % bay coverage). Fans turn as the model renders.'
            : 'Vessel model: all joined parts — bottom head, shell courses, cones, top head, supports and nozzles by elevation/azimuth. Enable Cutaway or Internals to see trays, packing and the exchanger bundle.'}
      </p>
    </div>
  );
}
