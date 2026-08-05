import { describe, expect, it } from 'vitest';
import {
  cleanRing,
  extrudeFootprint,
  polygonArea,
  signedArea,
  triangulate,
  type Point2,
} from '../src/world/buildings/extrude';
import {
  buildBuildingQuery,
  buildingHeight,
  parseBuildings,
  parseHeight,
} from '../src/world/buildings/overpass';
import type { OverpassResponse } from '../src/world/roads/overpass';
import { resamplePolyline, smoothHeights, type RibbonPoint } from '../src/world/roads/ribbon';

const SQUARE: Point2[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

/** An L, so triangulation has to handle a reflex corner. */
const L_SHAPE: Point2[] = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 8 },
  { x: 8, z: 8 },
  { x: 8, z: 20 },
  { x: 0, z: 20 },
];

describe('footprint geometry', () => {
  it('measures area regardless of winding', () => {
    expect(polygonArea(SQUARE)).toBeCloseTo(100, 6);
    expect(polygonArea([...SQUARE].reverse())).toBeCloseTo(100, 6);
    expect(Math.sign(signedArea(SQUARE))).toBe(-Math.sign(signedArea([...SQUARE].reverse())));
    expect(polygonArea(L_SHAPE)).toBeCloseTo(20 * 8 + 8 * 12, 6);
  });

  it('drops the repeated closing point', () => {
    const closed = [...SQUARE, { x: 0, z: 0 }];
    expect(cleanRing(closed)).toHaveLength(4);
    expect(cleanRing([{ x: 1, z: 1 }, { x: 1, z: 1 }])).toHaveLength(1);
  });

  it('triangulates a convex ring into n-2 triangles', () => {
    const triangles = triangulate(SQUARE);
    expect(triangles.length / 3).toBe(2);
    expect(new Set(triangles).size).toBeLessThanOrEqual(4);
  });

  it('triangulates a reflex corner without leaving the polygon', () => {
    const triangles = triangulate(L_SHAPE);
    expect(triangles.length / 3).toBe(L_SHAPE.length - 2);
    // Total triangle area must equal the polygon area: no gaps, no overlaps.
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = L_SHAPE[triangles[i]];
      const b = L_SHAPE[triangles[i + 1]];
      const c = L_SHAPE[triangles[i + 2]];
      area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    }
    expect(area).toBeCloseTo(polygonArea(L_SHAPE), 4);
  });

  it('handles both windings', () => {
    expect(triangulate([...L_SHAPE].reverse()).length / 3).toBe(L_SHAPE.length - 2);
  });

  it('refuses degenerate rings', () => {
    expect(triangulate([{ x: 0, z: 0 }, { x: 1, z: 1 }])).toEqual([]);
  });
});

describe('extrusion', () => {
  it('builds four walls and a roof for a square', () => {
    const geometry = extrudeFootprint(SQUARE, { base: 100, top: 112 })!;
    // 4 walls x 4 corners + 4 roof corners.
    expect(geometry.positions.length / 3).toBe(20);
    // 4 walls x 2 triangles + 2 roof triangles.
    expect(geometry.indices.length / 3).toBe(10);
  });

  it('spans exactly base to top', () => {
    const geometry = extrudeFootprint(SQUARE, { base: 100, top: 112 })!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i < geometry.positions.length; i += 3) {
      min = Math.min(min, geometry.positions[i]);
      max = Math.max(max, geometry.positions[i]);
    }
    expect(min).toBeCloseTo(100, 6);
    expect(max).toBeCloseTo(112, 6);
  });

  it('points wall normals outward', () => {
    const geometry = extrudeFootprint(SQUARE, { base: 0, top: 10 })!;
    const centre = { x: 5, z: 5 };
    // Check one vertex per wall: the normal must face away from the centre.
    for (let wall = 0; wall < 4; wall++) {
      const v = wall * 4;
      const px = geometry.positions[v * 3];
      const pz = geometry.positions[v * 3 + 2];
      const nx = geometry.normals[v * 3];
      const nz = geometry.normals[v * 3 + 2];
      const outX = px - centre.x;
      const outZ = pz - centre.z;
      expect(nx * outX + nz * outZ).toBeGreaterThan(0);
    }
  });

  it('marks the roof so the window shader can skip it', () => {
    const geometry = extrudeFootprint(SQUARE, { base: 0, top: 10 })!;
    const roofV = geometry.uvs[geometry.uvs.length - 1];
    expect(roofV).toBeLessThan(0);
  });

  it('counts wall uv in floors', () => {
    const geometry = extrudeFootprint(SQUARE, { base: 0, top: 16, floorHeight: 4 })!;
    // The top corner of the first wall is four floors up.
    expect(geometry.uvs[2 * 2 + 1]).toBeCloseTo(4, 6);
  });

  it('rejects zero-height and broken footprints', () => {
    expect(extrudeFootprint(SQUARE, { base: 10, top: 10 })).toBeNull();
    expect(extrudeFootprint([{ x: 0, z: 0 }], { base: 0, top: 5 })).toBeNull();
  });
});

describe('building tags', () => {
  it('parses heights with and without units', () => {
    expect(parseHeight('12')).toBe(12);
    expect(parseHeight('12 m')).toBe(12);
    expect(parseHeight('12.5m')).toBe(12.5);
    expect(parseHeight("30'")).toBeCloseTo(9.144, 3);
    expect(parseHeight('about 12')).toBeNull();
    expect(parseHeight(undefined)).toBeNull();
    expect(parseHeight('0')).toBeNull();
  });

  it('prefers a tagged height over a floor count', () => {
    expect(buildingHeight({ building: 'yes', height: '18', 'building:levels': '2' })).toBe(18);
  });

  it('derives height from floors, with a taller ground floor', () => {
    const five = buildingHeight({ building: 'yes', 'building:levels': '5' });
    // Five residential storeys land near 17 m, not a flat 5 x 3.
    expect(five).toBeGreaterThan(15);
    expect(five).toBeLessThan(19);
    expect(buildingHeight({ building: 'yes', 'building:levels': '10' })).toBeGreaterThan(five);
  });

  it('gives office floors more height than flats', () => {
    const office = buildingHeight({ building: 'office', 'building:levels': '30' });
    const flats = buildingHeight({ building: 'apartments', 'building:levels': '30' });
    expect(office).toBeGreaterThan(flats);
    // A 30-storey tower should read as a tower, not a block.
    expect(office).toBeGreaterThan(110);
  });

  it('adds roof storeys on top', () => {
    const plain = buildingHeight({ building: 'yes', 'building:levels': '4' });
    expect(buildingHeight({ building: 'yes', 'building:levels': '4', 'roof:levels': '1' })).toBeGreaterThan(plain);
    expect(buildingHeight({ building: 'yes', 'building:levels': '4', 'roof:height': '6' })).toBeCloseTo(plain + 6, 6);
  });

  it('reads heights tagged in feet', () => {
    expect(parseHeight('100 ft')).toBeCloseTo(30.48, 2);
    expect(parseHeight('100feet')).toBeCloseTo(30.48, 2);
  });

  it('falls back to a plausible height for the type', () => {
    expect(buildingHeight({ building: 'house' })).toBeLessThan(
      buildingHeight({ building: 'office' }),
    );
    expect(buildingHeight({ building: 'yes' })).toBeGreaterThan(2);
  });

  it('clamps absurd tags', () => {
    expect(buildingHeight({ building: 'yes', height: '99999' })).toBeLessThanOrEqual(830);
  });

  it('keeps only closed building ways', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { building: 'apartments' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.001 },
            { lat: 0.001, lon: 0.001 },
            { lat: 0, lon: 0 },
          ],
        },
        // Open ring: not a footprint.
        {
          type: 'way',
          id: 2,
          tags: { building: 'yes' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.001 },
            { lat: 0.001, lon: 0.001 },
          ],
        },
        // Explicitly not a building.
        {
          type: 'way',
          id: 3,
          tags: { building: 'no' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.001 },
            { lat: 0.001, lon: 0.001 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    };
    const buildings = parseBuildings(response);
    expect(buildings.map((b) => b.id)).toEqual([1]);
    // The closing point is dropped, leaving the distinct corners.
    expect(buildings[0].points).toHaveLength(3);
    expect(buildings[0].height).toBeGreaterThan(10);
  });

  it('builds a bounded query', () => {
    expect(buildBuildingQuery({ south: 1, west: 2, north: 3, east: 4 })).toContain(
      '1.00000,2.00000,3.00000,4.00000',
    );
  });
});

describe('road profile', () => {
  const sparse: RibbonPoint[] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -200 },
  ];

  it('resamples a long segment', () => {
    const dense = resamplePolyline(sparse, 12);
    expect(dense.length).toBeGreaterThan(15);
    for (let i = 1; i < dense.length; i++) {
      const gap = Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
      expect(gap).toBeLessThanOrEqual(12.001);
    }
  });

  it('keeps the original corners', () => {
    const corner: RibbonPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -100 },
      { x: 100, y: 0, z: -100 },
    ];
    const dense = resamplePolyline(corner, 15);
    const hasCorner = dense.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.z + 100) < 1e-6);
    expect(hasCorner).toBe(true);
    expect(dense[dense.length - 1].x).toBeCloseTo(100, 6);
  });

  it('leaves a short line alone', () => {
    expect(resamplePolyline([{ x: 0, y: 0, z: 0 }], 10)).toHaveLength(1);
  });

  it('flattens noise but keeps the hill', () => {
    // A steady 2 m ramp with 3 m of alternating noise on top of it.
    const make = (): RibbonPoint[] =>
      Array.from({ length: 40 }, (_, i) => ({
        x: 0,
        y: i * 2 + (i % 2 === 0 ? 3 : -3),
        z: -i * 10,
      }));
    const roughness = (points: RibbonPoint[]): number => {
      let worst = 0;
      for (let i = 6; i < points.length - 6; i++) {
        worst = Math.max(worst, Math.abs(points[i].y - points[i - 1].y));
      }
      return worst;
    };

    const before = make();
    const after = make();
    smoothHeights(after, 2);

    // Step to step the raw line jumps 8 m; smoothed it is close to the ramp.
    expect(roughness(before)).toBeGreaterThan(7);
    expect(roughness(after)).toBeLessThan(3.5);
    // Hill kept: the line still climbs about 66 m over the sampled span.
    expect(after[after.length - 4].y - after[3].y).toBeGreaterThan(55);
  });
});
