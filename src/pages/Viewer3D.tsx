// Interactive 3D visualization of the selected tag with stress-utilization coloring.
// Model is built along the local +Y axis with the bottom datum at the grid plane:
// bottom head → shell sections (stacked, joined by cones) → top head, with nozzles
// placed radially by elevation/azimuth and supports (legs/skirt/saddle/ring) attached.

import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore, setState } from '../store';
import { computeEquipment } from '../engine/compute';
import type { SectionCalc } from '../engine/types';
import { fmt } from '../engine/units';
import { exportOBJ } from '../cad';
import { buildBodyLayout, locateNozzle, radialDirection, radiusAtY, saddleStations } from '../engine/layout3d';

function utilColor(u: number): THREE.Color {
  // green (low util) -> amber -> red (near/over limit)
  const t = Math.min(1, Math.max(0, u));
  const c = new THREE.Color();
  if (t < 0.5) c.lerpColors(new THREE.Color('#35c46f'), new THREE.Color('#e8b23c'), t / 0.5);
  else c.lerpColors(new THREE.Color('#e8b23c'), new THREE.Color('#e85c5c'), (t - 0.5) / 0.5);
  return c;
}

const UP_Y = new THREE.Vector3(0, 1, 0);

export default function Viewer3D() {
  const equipment = useStore((s) => s.equipment);
  const selectedId = useStore((s) => s.selectedEquipId);
  const mountRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'heatmap' | 'material' | 'wireframe'>('heatmap');
  const [showNozzles, setShowNozzles] = useState(true);
  const groupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls } | null>(null);

  const equip = useMemo(
    () => equipment.find((e) => e.id === selectedId) ?? equipment[0],
    [equipment, selectedId]
  );
  const calc = useMemo(() => (equip ? computeEquipment(equip) : null), [equip]);

  // three.js lifecycle
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0e14');
    const w0 = Math.max(1, mount.clientWidth);
    const h0 = Math.max(1, mount.clientHeight);
    const camera = new THREE.PerspectiveCamera(45, w0 / h0, 10, 200000);
    camera.position.set(9000, 6000, 11000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w0, h0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(5000, 9000, 7000);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.4);
    dir2.position.set(-6000, -3000, -5000);
    scene.add(dir2);

    const grid = new THREE.GridHelper(40000, 40, 0x2a3550, 0x1c2536);
    scene.add(grid);

    sceneRef.current = { scene, camera, renderer, controls };
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / Math.max(1, mountRef.current.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      controls.dispose();
    };
  }, []);

  // rebuild model when equipment/mode changes
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !equip || !calc) return;
    if (groupRef.current) {
      ctx.scene.remove(groupRef.current);
      groupRef.current.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = Array.isArray(o.material) ? o.material : [o.material];
          m.forEach((mm) => mm.dispose());
        }
      });
    }
    const g = new THREE.Group();
    const vertical = equip.orientation === 'vertical';

    const matFor = (u: number, base = 0x9fb2c8) => {
      if (mode === 'material') return new THREE.MeshStandardMaterial({ color: base, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide });
      if (mode === 'wireframe') return new THREE.MeshStandardMaterial({ color: base, wireframe: true, roughness: 0.6 });
      return new THREE.MeshStandardMaterial({ color: utilColor(u), roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    };
    const steel = (color = 0x556275) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.35, side: THREE.DoubleSide });

    /** Dome geometry pointing +Y, depth d on radius R (sphere-cap approximation). */
    const headGeo = (type: string, R: number, d: number) => {
      let geo: THREE.BufferGeometry;
      if (type === 'hemi') geo = new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
      else if (type === 'ellip2') {
        geo = new THREE.SphereGeometry(R, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
        geo.scale(1, 0.5, 1);
      } else {
        const alpha = Math.acos(Math.max(-1, Math.min(1, 1 - d / Math.max(1, R))));
        geo = new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, alpha);
      }
      return geo;
    };

    // ---------- pressure boundary: bottom head → sections → cones → top head ----------
    // All spans come from buildBodyLayout(), so the drawn geometry, the nozzle
    // elevations, the support stations and the camera framing agree on one length.
    const sections: SectionCalc[] = calc.sections.length
      ? calc.sections
      : equip.sections.map((sp) => ({ spec: sp, utilization: 0, tNominal: 0 }) as SectionCalc);
    const layout = buildBodyLayout(sections);
    const bottomDepth = layout.bottomDepth;
    const totalLen = layout.totalLen;

    // bottom head: rim on the shell datum, apex on the ground (local Y 0 … bottomDepth)
    if (bottomDepth > 0 && sections[0]) {
      const first = sections[0];
      const R = first.spec.dia / 2;
      const head = new THREE.Mesh(headGeo(first.headBot!.type, R, bottomDepth), matFor(first.headBot!.utilization ?? 0));
      head.rotation.x = Math.PI; // flip the cap so the apex points down
      head.position.y = bottomDepth; // rim lands exactly on the shell start — no gap
      g.add(head);
    }
    // shell courses and cone transitions, drawn as one continuous stack
    layout.segments.forEach((seg) => {
      const sc = sections[seg.sectionIndex];
      const h = seg.y1 - seg.y0;
      const mesh = new THREE.Mesh(
        // radiusTop = r1 (upper end) so a reducing cone narrows upward, widening otherwise
        new THREE.CylinderGeometry(seg.r1, seg.r0, h, 64, 1, false),
        matFor(sc?.utilization ?? 0)
      );
      mesh.position.y = (seg.y0 + seg.y1) / 2;
      g.add(mesh);
    });
    // top head sits on the top of the stack
    const last = sections[sections.length - 1];
    const ht = last?.headTop;
    if (ht && ht.type !== 'none' && last) {
      const R = last.spec.dia / 2;
      const head = new THREE.Mesh(headGeo(ht.type, R, layout.topHeadDepth), matFor(ht.utilization ?? 0));
      head.position.y = layout.stackTop;
      g.add(head);
    }

    // ---------- supports (built in local coords; group rotated for horizontal) ----------
    // Legs/skirt hang BELOW the vessel datum (they were drawn inside the shell,
    // so the vessel appeared to rest on its own head); saddles sit on stations
    // along the shell measured from the layout, not from y = 0.
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
    /** ground level in local coords — supports reach from here up to the bottom tangent */
    const gradeY = bottomDepth - supportH;
    if (s.type === 'legs' && vertical) {
      const n = Math.max(2, s.legCount || 4);
      const h = supportH;
      const t = Math.max(8, s.legPlateThk || 16);
      const w = Math.min(400, Math.max(150, t * 10));
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + Math.PI / n;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), steel());
        leg.rotation.y = az; // thickness radial against the shell, width tangential
        leg.position.set(Math.sin(az) * (R0 + t / 2), gradeY + h / 2, Math.cos(az) * (R0 + t / 2));
        g.add(leg);
        const bp = new THREE.Mesh(new THREE.BoxGeometry(w + 90, 20, w + 90), steel(0x46526b));
        bp.rotation.y = az;
        bp.position.set(leg.position.x, gradeY + 10, leg.position.z);
        g.add(bp);
      }
    } else if (s.type === 'skirt' && vertical) {
      const h = supportH;
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 1.001, R0 * 1.001, h, 64, 1, false), steel(0x4d5a70));
      skirt.position.y = bottomDepth - h / 2; // top of skirt meets the shell bottom
      g.add(skirt);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.06, 30, 12, 64), steel(0x46526b));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = gradeY + 20; // base ring on the foundation
      g.add(ring);
    } else if (s.type === 'ring' && vertical) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.05, 45, 12, 64), steel());
      ring.rotation.x = Math.PI / 2;
      ring.position.y = bottomDepth; // circling the bottom edge of the shell
      g.add(ring);
    } else if (s.type === 'saddle' && !vertical) {
      // laid-down vessel: local +Z is the ground, so the cradle (centred on +Z)
      // wraps the underside; stations come from saddleStations so the pair is
      // symmetric about the shell centre instead of about the bottom head tip.
      const a = ((s.saddleAngle || 120) * Math.PI) / 180;
      const { stations } = saddleStations(layout, s.saddleSpan);
      for (const st of stations) {
        const R = st.r;
        const width = Math.max(300, R * 0.5);
        const arc = new THREE.Mesh(
          new THREE.CylinderGeometry(R * 1.01, R * 1.01, width, 48, 1, true, 2 * Math.PI - a / 2, a),
          steel()
        );
        arc.position.set(0, st.y, 0);
        g.add(arc);
        const base = new THREE.Mesh(new THREE.BoxGeometry(2 * R * Math.sin(a / 2) + 60, width, 40), steel(0x46526b));
        base.position.set(0, st.y, R * 1.01 + 20); // underside of the cradle
        g.add(base);
      }
    }
    if (s.padeyes) {
      const nLug = calc.weightDryKg > 20000 ? 4 : 2;
      for (let i = 0; i < nLug; i++) {
        // vertical: evenly around the shell; horizontal: lifting lugs on the crown,
        // spread along the axis, which is where they actually sit on a drum
        const station = vertical
          ? totalLen * 0.78
          : totalLen * (0.25 + (0.5 * i) / (nLug - 1));
        const az = vertical ? Math.PI / 2 + (i / Math.max(1, nLug)) * Math.PI * 2 : 0;
        const [ux, , uz] = radialDirection(az, vertical);
        const r = radiusAtY(layout, station);
        const lug = new THREE.Mesh(new THREE.BoxGeometry(60, 260, 24), steel(0x6c7a92));
        lug.position.set(ux * (r + 12), station, uz * (r + 12));
        lug.quaternion.setFromUnitVectors(UP_Y, new THREE.Vector3(ux, 0, uz));
        g.add(lug);
      }
    }
    if (s.guyLines && vertical) {
      const topY = totalLen * 0.85;
      const deadR = R0 * 4;
      const shellT = calc.sections[0]?.tNominal ?? 10;
      const unterR = Math.max(8, shellT * 2);
      const rTop = radiusAtY(layout, topY);
      for (const off of [0, Math.PI]) {
        const dx = Math.sin(off) * deadR, dz = Math.cos(off) * deadR;
        const sx = Math.sin(off) * rTop, sz = Math.cos(off) * rTop; // attach on the shell surface
        const dir = new THREE.Vector3(dx - sx, gradeY - topY, dz - sz);
        const lenGuy = dir.length();
        const guy = new THREE.Mesh(new THREE.CylinderGeometry(unterR, unterR, lenGuy, 8), steel(0x8b94a6));
        guy.position.set((sx + dx) / 2, (topY + gradeY) / 2, (sz + dz) / 2);
        guy.quaternion.setFromUnitVectors(UP_Y, dir.normalize());
        g.add(guy);
        const dm = new THREE.Mesh(new THREE.BoxGeometry(600, 40, 260), steel(0x46526b));
        dm.position.set(dx, gradeY + 20, dz);
        g.add(dm);
      }
    }

    // ---------- nozzles (radial, by elevation & azimuth) ----------
    if (showNozzles) {
      for (const n of calc.nozzles) {
        const place = locateNozzle(layout, n.spec.elevation);
        if (!place) continue;
        const R = place.r;
        const yNoz = place.y;
        const [dxv, dyv, dzv] = radialDirection(n.spec.azimuth, vertical);
        const dirV = new THREE.Vector3(dxv, dyv, dzv);
        const outer = n.spec.dn + 2 * (n.wall ?? 8);
        const len = Math.max(60, n.spec.projOutside);
        const nozzleMat = new THREE.MeshStandardMaterial({ color: n.reinforceOK ? 0x3fa9f5 : 0xe85c5c, roughness: 0.4, metalness: 0.6 });
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(outer / 2, outer / 2, len, 24), nozzleMat);
        neck.quaternion.setFromUnitVectors(UP_Y, dirV);
        neck.position.copy(dirV.clone().multiplyScalar(R + len / 2));
        neck.position.y = yNoz;
        g.add(neck);
        if (n.spec.padDia > 0 && n.spec.padThk > 0) {
          const pad = new THREE.Mesh(new THREE.CylinderGeometry(n.spec.padDia / 2, n.spec.padDia / 2, n.spec.padThk + 2, 32), steel(0x71809a));
          pad.quaternion.setFromUnitVectors(UP_Y, dirV);
          pad.position.copy(dirV.clone().multiplyScalar(R + n.spec.padThk / 2));
          pad.position.y = yNoz;
          g.add(pad);
        }
        const fl = new THREE.Mesh(
          new THREE.CylinderGeometry(outer / 2 + n.spec.dn / 3, outer / 2 + n.spec.dn / 3, 28, 24),
          new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.35, metalness: 0.7 })
        );
        fl.quaternion.setFromUnitVectors(UP_Y, dirV);
        fl.position.copy(dirV.clone().multiplyScalar(R + len + 14));
        fl.position.y = yNoz;
        g.add(fl);
      }
    }

    // build orientation decided before adding to the scene (no post-hoc flips); the local
    // model Y is the ground axis in both cases so the whole assembly sits on the grid plane.
    if (!vertical) g.rotation.x = Math.PI / 2; // lay the vessel down: local +Y axis → world Z, local −Z → sky
    ctx.scene.add(g);

    // rest the model on the ground plane and frame the camera on its bounding box
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    g.position.y -= box.min.y; // sit on grid
    const span2 = Math.max(1200, Math.max(size.x, size.y, size.z));
    ctx.controls.target.set(center.x, center.y - box.min.y, center.z);
    ctx.camera.position.set(center.x + span2 * 0.85, center.y - box.min.y + span2 * 0.55, center.z - span2 * 1.15);
    ctx.camera.near = Math.max(20, span2 / 200);
    ctx.camera.far = span2 * 40;
    ctx.camera.updateProjectionMatrix();
    ctx.controls.update();
    groupRef.current = g;
  }, [equip, calc, mode, showNozzles]);

  if (!equip || !calc) {
    return <div className="card">No equipment yet — create a tag in the Equipment Register first.</div>;
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select
          value={equip.id}
          onChange={(e) => setState({ selectedEquipId: e.target.value })}
          style={{ minWidth: 260 }}
        >
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
          ))}
        </select>
        <button className={mode === 'heatmap' ? 'primary' : ''} onClick={() => setMode('heatmap')}>Stress heatmap</button>
        <button className={mode === 'material' ? 'primary' : ''} onClick={() => setMode('material')}>Material view</button>
        <button className={mode === 'wireframe' ? 'primary' : ''} onClick={() => setMode('wireframe')}>Wireframe</button>
        <label className="small muted"><input type="checkbox" checked={showNozzles} onChange={(e) => setShowNozzles(e.target.checked)} /> Nozzles</label>
        <div className="spacer" style={{ flex: 1 }} />
        <button onClick={() => exportOBJ(equip, calc)}>Export OBJ (CAD)</button>
        <button onClick={() => window.print()}>Print view</button>
      </div>

      <div className="viewer3d" ref={mountRef}>
        <div className="viewer-overlay">
          <span className="badge info">{equip.tag} · Ø{equip.sections[0]?.dia} × {equip.sections.reduce((s, x) => s + x.ttLength, 0)} mm</span>
          <span className="badge info">MAWP {fmt(calc.mawpBar, 2)} bar g</span>
          <span className={`badge ${calc.membraneUtil > 1 ? 'err' : calc.membraneUtil > 0.9 ? 'warn' : 'ok'}`}>
            Membrane util {(calc.membraneUtil * 100).toFixed(0)}%
          </span>
        </div>
        <div className="legend">
          <strong>Utilization</strong>
          <div className="bar" />
          <div style={{ display: 'flex', justifyContent: 'space-between', width: 140 }}>
            <span>0%</span><span>50%</span><span>100%+</span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>Blue: nozzle OK · Red: nozzle fails</div>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Drag to orbit, scroll to zoom, right-drag to pan. Model shows all joined parts — bottom head, shell courses,
        cones, top head, supports and nozzles by elevation/azimuth. OBJ export can be imported into most CAD tools;
        DXF outline exports are available under Reports & CAD Export.
      </p>
    </div>
  );
}
