// CAD interop: OBJ (3D mesh) and DXF (2D outline) exports.

import type { Equipment, EquipmentCalc } from './engine/types';

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
  const push = (geo: THREE_BufLike, tx: number, ty: number, tz: number) => {
    const { positions, indices } = geo;
    for (let i = 0; i < positions.length; i += 3) {
      lines.push(`v ${(positions[i] + tx).toFixed(3)} ${(positions[i + 1] + ty).toFixed(3)} ${(positions[i + 2] + tz).toFixed(3)}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      lines.push(`f ${indices[i] + vOff} ${indices[i + 1] + vOff} ${indices[i + 2] + vOff}`);
    }
    vOff += positions.length / 3;
  };

  let z = 0;
  calc.sections.forEach((sc) => {
    const R = sc.spec.dia / 2;
    push(cylinderMesh(R, R, sc.spec.ttLength), 0, 0, z);
    z += sc.spec.ttLength;
    if (sc.headTop && sc.headTop.type !== 'none') {
      const d = sc.headTop.type === 'hemi' ? R : sc.headTop.type === 'ellip2' ? R / 2 : 0.1935 * R;
      push(domeMesh(R, d), 0, 0, z);
      z += d;
    }
  });
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
  let y = 0;
  calc.sections.forEach((sc, i) => {
    const R = sc.spec.dia / 2;
    if (i === 0 && sc.headBot && sc.headBot.type !== 'none') {
      y -= sc.headBot.depth;
      // simple arc approximation via lines
      for (let k = 0; k < 16; k++) {
        const a0 = Math.PI + (k / 16) * (Math.PI / 2);
        const a1 = Math.PI + ((k + 1) / 16) * (Math.PI / 2);
        line(R * Math.cos(a0), y - sc.headBot.depth * Math.sin(a0 - Math.PI), R * Math.cos(a1), y - sc.headBot.depth * Math.sin(a1 - Math.PI));
      }
    }
    const y0 = y;
    line(-R, y0, -R, y0 + sc.spec.ttLength);
    line(R, y0, R, y0 + sc.spec.ttLength);
    y += sc.spec.ttLength;
    if (sc.headTop && sc.headTop.type !== 'none') {
      const d = sc.headTop.type === 'hemi' ? R : sc.headTop.type === 'ellip2' ? R / 2 : 0.1935 * R;
      for (let k = 0; k < 16; k++) {
        const a0 = (k / 16) * (Math.PI / 2);
        const a1 = ((k + 1) / 16) * (Math.PI / 2);
        line(R * Math.cos(a0), y + d * Math.sin(a0), R * Math.cos(a1), y + d * Math.sin(a1));
      }
      y += d;
    }
  });
  // nozzles as radial stubs (schematic)
  for (const nc of calc.nozzles) {
    const sc = calc.sections.find((s) => s.spec.id === nc.spec.sectionId) ?? calc.sections[0];
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
