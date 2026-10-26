// CAD interop: OBJ (3D mesh) and DXF (2D outline) exports.

import type { Equipment, EquipmentCalc } from './engine/types';
import { buildBodyLayout } from './engine/layout3d';

function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportOBJ(equip: Equipment, calc: EquipmentCalc) {
  const lines: string[] = ['# StaticSuite OBJ export', `# ${equip.tag} ${equip.name}`];
  let vOff = 1;
  const push = (geo: THREE_BufLike, tx: number, ty: number, tz: number, flipZ = false) => {
    const { positions, indices } = geo;
    for (let i = 0; i < positions.length; i += 3) {
      const z = flipZ ? tz - positions[i + 2] : positions[i + 2] + tz;
      lines.push(`v ${(positions[i] + tx).toFixed(3)} ${(positions[i + 1] + ty).toFixed(3)} ${z.toFixed(3)}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      // a mirrored shell reverses its face winding — flip it back
      if (flipZ) lines.push(`f ${indices[i] + vOff} ${indices[i + 2] + vOff} ${indices[i + 1] + vOff}`);
      else lines.push(`f ${indices[i] + vOff} ${indices[i + 1] + vOff} ${indices[i + 2] + vOff}`);
    }
    vOff += positions.length / 3;
  };

  // Same stack as the 3D viewer (buildBodyLayout), so a multi-diameter vessel
  // exports as one connected solid: bottom head → courses → cones → top head.
  const layout = buildBodyLayout(calc.sections);
  if (layout.bottomDepth > 0 && layout.segments[0]) {
    const R = layout.segments[0].r0;
    push(domeMesh(R, layout.bottomDepth), 0, 0, layout.bottomDepth, true); // apex at z = 0
  }
  layout.segments.forEach((seg) => {
    push(cylinderMesh(seg.r0, seg.r1, seg.y1 - seg.y0), 0, 0, seg.y0);
  });
  if (layout.topHeadDepth > 0 && layout.segments.length) {
    const R = layout.segments[layout.segments.length - 1].r1;
    push(domeMesh(R, layout.topHeadDepth), 0, 0, layout.stackTop);
  }
  download(`${equip.tag || 'equipment'}.obj`, lines.join('\n'), 'model/obj');
}

interface THREE_BufLike {
  positions: Float32Array | number[];
  indices: number[];
}

function cylinderMesh(r1: number, r2: number, h: number, seg = 48): THREE_BufLike {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    positions.push(Math.cos(a) * r1, Math.sin(a) * r1, 0);
    positions.push(Math.cos(a) * r2, Math.sin(a) * r2, h);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  return { positions, indices };
}

function domeMesh(r: number, depth: number, seg = 48, rings = 12): THREE_BufLike {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const rr = r * Math.cos((t * Math.PI) / 2);
    const zz = depth * Math.sin((t * Math.PI) / 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      positions.push(Math.cos(a) * rr, Math.sin(a) * rr, zz);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, indices };
}

/** DXF R12 elevation outline: shell rectangle + head profiles + nozzle stubs. */
export function exportDXF(equip: Equipment, calc: EquipmentCalc) {
  const L: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    L.push('0', 'LINE', '8', 'OUTLINE', '10', x1.toFixed(2), '20', y1.toFixed(2), '11', x2.toFixed(2), '21', y2.toFixed(2));
  };
  // Outline drawn from the same layout as the 3D view. Y = 0 is the bottom
  // tangent (the vessel datum nozzle elevations are measured from), so stubs
  // and courses line up; both head arcs are drawn in full and the cone
  // transitions close the step between differing diameters.
  const layout = buildBodyLayout(calc.sections);
  const arc = (R: number, d: number, base: number, down: boolean) => {
    // quarter-circle family swept over the full 180° — half of it was skipped before
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI;
      const a1 = ((k + 1) / 16) * Math.PI;
      const y0 = base + (down ? -d : d) * Math.sin(a0);
      const y1 = base + (down ? -d : d) * Math.sin(a1);
      line(down ? -R * Math.cos(a0) : R * Math.cos(a0), y0, down ? -R * Math.cos(a1) : R * Math.cos(a1), y1);
    }
  };
  const segs = layout.segments;
  if (layout.bottomDepth > 0 && segs[0]) arc(segs[0].r0, layout.bottomDepth, 0, true);
  segs.forEach((seg) => {
    line(-seg.r0, seg.y0, -seg.r1, seg.y1);
    line(seg.r0, seg.y0, seg.r1, seg.y1);
  });
  if (layout.topHeadDepth > 0 && segs.length) arc(segs[segs.length - 1].r1, layout.topHeadDepth, layout.stackTop, false);
  // nozzles as radial stubs (schematic) — elevation is measured from y = 0
  for (const nc of calc.nozzles) {
    const sc = calc.sections.find((s) => s.spec.id === nc.spec.sectionId) ?? calc.sections[0];
    if (!sc) continue;
    const R = sc.spec.dia / 2;
    const r = nc.spec.dn / 2;
    const yy = nc.spec.elevation;
    const side = nc.spec.azimuth < 180 ? 1 : -1;
    line(side * R, yy - r, side * (R + nc.spec.projOutside), yy - r);
    line(side * R, yy + r, side * (R + nc.spec.projOutside), yy + r);
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  download(`${equip.tag || 'equipment'}.dxf`, L.join('\n'), 'application/dxf');
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(','))
    .join('\n');
  download(filename, csv, 'text/csv');
}
