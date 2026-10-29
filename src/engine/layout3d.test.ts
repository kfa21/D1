// Layout maths for the 3D/CAD views — these rules decide where every surface,
// nozzle and support sits, so a regression here shows up as floating or
// mis-positioned parts in the viewer.

import { describe, it, expect } from 'vitest';
import {
  buildBodyLayout,
  headDepthMm,
  headProfile,
  headRadiusAt,
  locateHeadNozzle,
  locateNozzle,
  radiusAtY,
  saddleStations,
  radialDirection,
} from './layout3d';
import type { SectionCalc, SectionSpec } from './types';

const sec = (spec: Partial<SectionSpec>, extra: Partial<SectionCalc> = {}): SectionCalc =>
  ({
    spec: {
      id: 's1',
      dia: 1000,
      ttLength: 1000,
      headTop: 'none',
      headBottom: 'none',
      shellThk: 0,
      headThkTop: 0,
      headThkBot: 0,
      coneAngleDeg: 0,
      coneThk: 0,
      ...spec,
    },
    utilization: 0,
    ...extra,
  }) as SectionCalc;

describe('headDepthMm', () => {
  it('matches the ASME head geometry used by asme.ts', () => {
    expect(headDepthMm({ type: 'hemi' }, 700)).toBe(700);
    expect(headDepthMm({ type: 'ellip2' }, 700)).toBe(350);
    expect(headDepthMm({ type: 'toriD' }, 700)).toBeCloseTo(0.152 * 1400, 9);
    expect(headDepthMm({ type: 'toriFD', tMinNominal: 12 }, 700)).toBeCloseTo(0.1935 * 1400 + 12, 9);
    expect(headDepthMm({ type: 'none' }, 700)).toBe(0);
  });
});

describe('headProfile (revolve profile of a dished end)', () => {
  const R = 700; // Ø1400 head

  it('starts at the shell tangent (r = R, y = 0) and ends on the axis at the head depth', () => {
    for (const type of ['hemi', 'ellip2', 'toriFD', 'toriD'] as const) {
      const p = headProfile({ type }, R);
      const first = p.points[0];
      const last = p.points[p.points.length - 1];
      expect(first[0]).toBeCloseTo(R, 6);
      expect(first[1]).toBeCloseTo(0, 6);
      expect(last[0]).toBeCloseTo(0, 6);
      // apex lands on the engine head depth, which every nozzle elevation and the
      // T-T length are measured against
      expect(last[1]).toBeCloseTo(headDepthMm({ type }, R), 6);
      expect(p.depth).toBeCloseTo(last[1], 6);
      expect(p.points.length).toBeGreaterThan(10);
    }
  });

  it('leaves the shell vertically: the knuckle tangents the shell wall', () => {
    for (const type of ['toriFD', 'toriD'] as const) {
      const p = headProfile({ type }, R);
      const [r0, y0] = p.points[0];
      const [r1, y1] = p.points[1];
      expect(r0 - r1).toBeLessThan(0.02 * R); // almost no radial step at the rim
      expect(y1 - y0).toBeGreaterThan(0); // but it rises off the tangent line
    }
  });

  it('is a genuine crown + knuckle: radius falls monotonically and the surface never turns back', () => {
    for (const type of ['toriFD', 'toriD', 'ellip2', 'hemi'] as const) {
      const p = headProfile({ type }, R);
      for (let i = 1; i < p.points.length; i++) {
        expect(p.points[i][0]).toBeLessThanOrEqual(p.points[i - 1][0] + 1e-6);
        expect(p.points[i][1]).toBeGreaterThanOrEqual(p.points[i - 1][1] - 1e-6);
      }
    }
  });

  it('uses the UG-32 knuckle proportion (F&D 6 % D, D-type 17 % D) and reports the exact depth', () => {
    const fd = headProfile({ type: 'toriFD' }, R);
    expect(fd.knuckleR).toBeCloseTo(0.06 * 2 * R, 6);
    expect(fd.crownR).toBeCloseTo(2 * R, 6);
    const dType = headProfile({ type: 'toriD' }, R);
    expect(dType.knuckleR).toBeCloseTo(0.17 * 2 * R, 6);
    // the exact arc geometry is documented, and the drawn profile is normalised onto it
    expect(fd.exactDepth).toBeGreaterThan(0);
    expect(dType.exactDepth).toBeGreaterThan(0);
  });

  it('a torispherical head is flatter at the crown than a 2:1 ellipsoidal head of the same diameter', () => {
    const tori = headProfile({ type: 'toriFD' }, R);
    const ellip = headProfile({ type: 'ellip2' }, R);
    const atHalfR = (p: typeof tori) => {
      // first point whose radius is below R/2, interpolated onto the half-radius
      for (let i = 1; i < p.points.length; i++) {
        const [ra, ya] = p.points[i - 1];
        const [rb, yb] = p.points[i];
        if (ra >= R / 2 && rb <= R / 2) {
          const t = (ra - R / 2) / Math.max(1e-9, ra - rb);
          return ya + t * (yb - ya);
        }
      }
      return 0;
    };
    expect(atHalfR(tori)).toBeLessThan(atHalfR(ellip));
  });

  it('normalises onto a supplied depth without changing the rim radius', () => {
    const p = headProfile({ type: 'toriFD' }, R, 250);
    expect(p.points[0][0]).toBeCloseTo(R, 6);
    expect(p.points[p.points.length - 1][1]).toBeCloseTo(250, 6);
  });
});

describe('nozzles on a dished end (I7)', () => {
  const s = sec(
    { dia: 1400, ttLength: 3000, headTop: 'toriFD', headBottom: 'ellip2' },
    {
      headTop: { type: 'toriFD', tReq: 9, tMinNominal: 12, depth: 0.1935 * 1400 + 12, utilization: 0.5 } as never,
      headBot: { type: 'ellip2', tReq: 9, tMinNominal: 12, depth: 350, utilization: 0.5 } as never,
    }
  );
  const layout = buildBodyLayout([s]);

  it('starts at the tangent line with the shell radius', () => {
    const at0 = locateHeadNozzle(layout, 0, 'topHead', () => s, 0)!;
    expect(at0.y).toBeCloseTo(layout.stackTop, 6);
    expect(at0.r).toBeCloseTo(700, 3);
    expect(at0.outside).toBe(false);
  });

  it('follows the head profile to the crown', () => {
    const depth = headDepthMm({ type: 'toriFD', tMinNominal: 12 }, 700);
    const crown = locateHeadNozzle(layout, depth, 'topHead', () => s, 0)!;
    expect(crown.outside).toBe(false);
    expect(crown.r).toBeLessThan(30);
    expect(crown.y).toBeCloseTo(layout.stackTop + depth, 3);
    // half way up the head the radius is between the shell and the crown
    const mid = locateHeadNozzle(layout, depth / 2, 'topHead', () => s, 0)!;
    expect(mid.r).toBeGreaterThan(0);
    expect(mid.r).toBeLessThan(700);
  });

  it('flags an elevation past the crown', () => {
    expect(locateHeadNozzle(layout, 4000, 'topHead', () => s, 0)!.outside).toBe(true);
  });

  it('mirrors onto the bottom head', () => {
    const bot = locateHeadNozzle(layout, 0, 'bottomHead', () => s, 0)!;
    expect(bot.y).toBeCloseTo(layout.bottomDepth, 6);
    expect(bot.r).toBeCloseTo(700, 3);
  });

  it('returns null when that end is flat, so the caller can warn', () => {
    const flat = sec({ dia: 1400, headTop: 'none', headBottom: 'none' });
    const l2 = buildBodyLayout([flat]);
    expect(locateHeadNozzle(l2, 100, 'topHead', () => flat, 0)).toBeNull();
  });

  it('interpolates the profile radius by height', () => {
    const p = headProfile({ type: 'ellip2' }, 700);
    expect(headRadiusAt(p, 0)).toBeCloseTo(700, 6);
    expect(headRadiusAt(p, p.depth)).toBeCloseTo(0, 6);
    expect(headRadiusAt(p, p.depth * 2)).toBeCloseTo(0, 6); // clamped past the apex
  });
});

describe('buildBodyLayout', () => {
  it('starts the shell exactly where the bottom head ends (no gap)', () => {
    const l = buildBodyLayout([sec({ dia: 1400, ttLength: 4500, headBottom: 'toriFD', headTop: 'toriFD' }, {
      headBot: { type: 'toriFD', tMinNominal: 12 } as never,
      headTop: { type: 'toriFD', tMinNominal: 12 } as never,
    })]);
    expect(l.segments).toHaveLength(1);
    expect(l.segments[0].y0).toBe(l.bottomDepth);
    expect(l.bottomDepth).toBeGreaterThan(0);
    expect(l.stackTop).toBeCloseTo(l.bottomDepth + 4500, 9);
    expect(l.totalLen).toBeCloseTo(l.stackTop + l.topHeadDepth, 9);
  });

  it('chains multi-diameter sections with a cone of the right radii', () => {
    const lower = sec({ id: 's1', dia: 2000, ttLength: 3000 });
    const upper = sec({ id: 's2', dia: 1400, ttLength: 2000, coneAngleDeg: 20 }, {
      cone: { tReq: 8, tMinNominal: 11, tNominal: 12, theta: 20, mawp: 10, D1: 1400, D2: 2000 },
    });
    const l = buildBodyLayout([lower, upper]);
    expect(l.segments.map((s) => s.kind)).toEqual(['shell', 'cone', 'shell']);
    const [sh1, cone, sh2] = l.segments;
    // continuous — each segment starts exactly where the previous one ended
    expect(cone.y0).toBe(sh1.y1);
    expect(sh2.y0).toBe(cone.y1);
    // reducing upward: bottom radius = lower course, top radius = upper course
    expect(cone.r0).toBe(1000);
    expect(cone.r1).toBe(700);
    expect(sh2.r0).toBe(700);
    // the cone length is part of the modelled length (previously counted twice/never)
    const half = (20 / 2) * (Math.PI / 180);
    const hC = 300 / Math.tan(half);
    expect(cone.y1 - cone.y0).toBeCloseTo(Math.max(120, hC), 9);
    expect(l.totalLen).toBeCloseTo(l.stackTop + l.topHeadDepth, 9);
    expect(l.totalLen - l.bottomDepth).toBeCloseTo(3000 + Math.max(120, hC) + 2000, 9);
  });

  it('widens upward when the upper course is the larger one', () => {
    const lower = sec({ id: 's1', dia: 1400, ttLength: 2000 });
    const upper = sec({ id: 's2', dia: 2000, ttLength: 2000, coneAngleDeg: 30 }, {
      cone: { tReq: 8, tMinNominal: 11, tNominal: 12, theta: 30, mawp: 10, D1: 2000, D2: 1400 },
    });
    const cone = buildBodyLayout([lower, upper]).segments[1];
    expect(cone.kind).toBe('cone');
    expect(cone.r0).toBe(700);
    expect(cone.r1).toBe(1000);
  });

  it('still bridges a diameter step when the engine produced no cone', () => {
    const l = buildBodyLayout([sec({ id: 's1', dia: 2000, ttLength: 2000 }), sec({ id: 's2', dia: 1200, ttLength: 2000 })]);
    expect(l.segments).toHaveLength(3);
    expect(l.segments[1].kind).toBe('cone');
    expect(l.segments[1].assumed).toBe(true);
    expect(l.segments[2].y0).toBe(l.segments[1].y1);
  });

  it('leaves a flat-bottom vessel without a bottom head', () => {
    const l = buildBodyLayout([sec({ dia: 1000, ttLength: 500 })]);
    expect(l.bottomDepth).toBe(0);
    expect(l.segments[0].y0).toBe(0);
    expect(l.totalLen).toBe(500);
  });
});

describe('locateNozzle', () => {
  const layout = buildBodyLayout([
    sec({ id: 's1', dia: 2000, ttLength: 3000 }),
    sec({ id: 's2', dia: 1400, ttLength: 2000, coneAngleDeg: 20 }, {
      cone: { tReq: 8, tMinNominal: 11, tNominal: 12, theta: 20, mawp: 10, D1: 1400, D2: 2000 },
    }),
  ]);

  it('places a nozzle on its elevation against the local radius', () => {
    const p = locateNozzle(layout, 1500)!;
    expect(p.y).toBe(1500);
    expect(p.r).toBe(1000);
    expect(p.clamped).toBe(false);
    expect(p.segment.kind).toBe('shell');
  });

  it('interpolates the radius when the elevation falls on a cone', () => {
    const cone = layout.segments[1];
    const midY = (cone.y0 + cone.y1) / 2;
    const p = locateNozzle(layout, midY)!; // datum is 0 here
    expect(p.segment.kind).toBe('cone');
    expect(p.r).toBeCloseTo((cone.r0 + cone.r1) / 2, 9);
  });

  it('clamps an elevation above the vessel to the TOP, not to the bottom course', () => {
    const p = locateNozzle(layout, 99999)!;
    expect(p.clamped).toBe(true);
    expect(p.y).toBe(layout.segments[layout.segments.length - 1].y1);
    expect(p.r).toBe(700);
  });

  it('clamps a negative elevation to the bottom of the shell', () => {
    const p = locateNozzle(layout, -500)!;
    expect(p.clamped).toBe(true);
    expect(p.y).toBe(0);
    expect(p.r).toBe(1000);
  });

  it('accounts for the bottom-head datum', () => {
    const withHead = buildBodyLayout([
      sec({ dia: 1400, ttLength: 4500, headBottom: 'ellip2' }, { headBot: { type: 'ellip2', tMinNominal: 10 } as never }),
    ]);
    const p = locateNozzle(withHead, 1000)!;
    expect(p.y).toBe(withHead.bottomDepth + 1000);
    expect(p.r).toBe(700);
  });

  it('returns null for equipment with no drawable shell', () => {
    expect(locateNozzle(buildBodyLayout([]), 100)).toBeNull();
  });
});

describe('radiusAtY', () => {
  it('interpolates across a cone and clamps outside the stack', () => {
    const l = buildBodyLayout([
      sec({ id: 's1', dia: 2000, ttLength: 3000 }),
      sec({ id: 's2', dia: 1000, ttLength: 2000, coneAngleDeg: 30 }, {
        cone: { tReq: 8, tMinNominal: 11, tNominal: 12, theta: 30, mawp: 10, D1: 1000, D2: 2000 },
      }),
    ]);
    expect(radiusAtY(l, 1500)).toBe(1000);
    const cone = l.segments[1];
    expect(radiusAtY(l, (cone.y0 + cone.y1) / 2)).toBeCloseTo(750, 9);
    expect(radiusAtY(l, -10000)).toBe(1000);
    expect(radiusAtY(l, 100000)).toBe(500);
  });
});

describe('saddleStations', () => {
  it('centres the pair on the shell and keeps both stations on it', () => {
    const l = buildBodyLayout([sec({ dia: 1400, ttLength: 4500 })]);
    const { stations, span } = saddleStations(l, 2600);
    expect(span).toBe(2600);
    expect(stations).toHaveLength(2);
    expect(stations[0].y + stations[1].y).toBeCloseTo(l.segments[0].y0 + l.segments[0].y1, 6);
    for (const st of stations) {
      expect(st.y).toBeGreaterThanOrEqual(l.segments[0].y0);
      expect(st.y).toBeLessThanOrEqual(l.segments[0].y1);
      expect(st.r).toBe(700);
    }
  });

  it('falls back to 60% of the shell when no span is given', () => {
    const l = buildBodyLayout([sec({ dia: 1400, ttLength: 4500 })]);
    const { span } = saddleStations(l, 0);
    expect(span).toBeCloseTo(4500 * 0.6, 9);
  });

  it('never puts a station off the end of a span that is too long', () => {
    const l = buildBodyLayout([sec({ dia: 1400, ttLength: 3000 })]);
    const { stations } = saddleStations(l, 20000);
    expect(stations[0].y).toBeGreaterThanOrEqual(l.segments[0].y0);
    expect(stations[1].y).toBeLessThanOrEqual(l.segments[0].y1);
    expect(stations[1].y).toBeGreaterThan(stations[0].y);
  });

  it('supports a station over the smaller course of a multi-dia drum', () => {
    const l = buildBodyLayout([
      sec({ id: 's1', dia: 2000, ttLength: 4000 }),
      sec({ id: 's2', dia: 1400, ttLength: 4000 }),
    ]);
    const { stations } = saddleStations(l, 7000);
    expect(stations[0].y).toBeLessThan(4000);
    expect(stations[1].y).toBeGreaterThan(4000);
    expect(stations[1].r).toBe(700); // local radius of the smaller course
  });
});

describe('radialDirection', () => {
  it('keeps the compass convention on vertical vessels', () => {
    expect(radialDirection(0, true)).toEqual([0, 0, 1]);
    const [x, , z] = radialDirection(90, true);
    expect(x).toBeCloseTo(1, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it('puts 0° at the top and 180° at the bottom on horizontal vessels', () => {
    // local −Z = sky and local +Z = ground once the renderer lays the vessel down
    const up = radialDirection(0, false);
    expect(up[0]).toBeCloseTo(0, 9);
    expect(up[2]).toBeCloseTo(-1, 9);
    const down = radialDirection(180, false);
    expect(down[0]).toBeCloseTo(0, 9);
    expect(down[2]).toBeCloseTo(1, 9);
    const side = radialDirection(90, false);
    expect(side[0]).toBeCloseTo(1, 9);
    expect(side[2]).toBeCloseTo(0, 9);
  });
});
