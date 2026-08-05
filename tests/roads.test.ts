import { describe, expect, it } from 'vitest';
import {
  LAMP_SPACING,
  ROAD_WIDTH,
  buildQuery,
  parseOverpass,
  type OverpassResponse,
} from '../src/world/roads/overpass';
import {
  bridgeDeck,
  buildRibbon,
  lampSites,
  polylineLength,
  type RibbonPoint,
} from '../src/world/roads/ribbon';

/** A trimmed Overpass response, in the shape the real service returns. */
const RESPONSE: OverpassResponse = {
  elements: [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'motorway', ref: 'D400', lit: 'yes' },
      geometry: [
        { lat: 36.5, lon: 32.0 },
        { lat: 36.51, lon: 32.01 },
        { lat: 36.52, lon: 32.02 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential', name: 'Liman Sokak' },
      geometry: [
        { lat: 36.5, lon: 32.0 },
        { lat: 36.501, lon: 32.001 },
      ],
    },
    // Rejected: not a road.
    {
      type: 'way',
      id: 3,
      tags: { waterway: 'river' },
      geometry: [
        { lat: 36.5, lon: 32.0 },
        { lat: 36.51, lon: 32.0 },
      ],
    },
    // Rejected: a single point cannot make a ribbon.
    { type: 'way', id: 4, tags: { highway: 'primary' }, geometry: [{ lat: 36.5, lon: 32.0 }] },
    // Rejected: nodes carry no geometry we can use here.
    { type: 'node', id: 5, tags: { highway: 'street_lamp' } },
  ],
};

describe('overpass parsing', () => {
  it('keeps roads and drops everything else', () => {
    const ways = parseOverpass(RESPONSE);
    expect(ways.map((w) => w.id)).toEqual([1, 2]);
  });

  it('maps highway tags to classes and names', () => {
    const [motorway, residential] = parseOverpass(RESPONSE);
    expect(motorway.roadClass).toBe('motorway');
    expect(motorway.name).toBe('D400'); // falls back to ref when unnamed
    expect(motorway.lit).toBe(true);
    expect(residential.roadClass).toBe('minor');
    expect(residential.name).toBe('Liman Sokak');
    expect(residential.lit).toBe(false);
  });

  it('treats link roads as their parent class', () => {
    const ways = parseOverpass({
      elements: [
        {
          type: 'way',
          id: 9,
          tags: { highway: 'motorway_link' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0.01, lon: 0.01 },
          ],
        },
      ],
    });
    expect(ways[0].roadClass).toBe('motorway');
  });

  it('survives an empty or malformed response', () => {
    expect(parseOverpass({})).toEqual([]);
    expect(parseOverpass({ elements: [] })).toEqual([]);
  });

  it('builds a bounded query', () => {
    const query = buildQuery({ south: 36.5, west: 32, north: 36.52, east: 32.02 });
    expect(query).toContain('36.50000,32.00000,36.52000,32.02000');
    expect(query).toContain('[out:json]');
    expect(query).toContain('out geom;');
  });

  it('sizes roads and lamp spacing by class', () => {
    expect(ROAD_WIDTH.motorway).toBeGreaterThan(ROAD_WIDTH.primary);
    expect(ROAD_WIDTH.primary).toBeGreaterThan(ROAD_WIDTH.minor);
    // Bigger roads carry taller poles set further apart, as they do in reality.
    expect(LAMP_SPACING.motorway!).toBeGreaterThan(LAMP_SPACING.secondary!);
    // Residential streets are only lit when OSM says so.
    expect(LAMP_SPACING.minor).toBeNull();
    for (const spacing of Object.values(LAMP_SPACING)) {
      if (spacing !== null) {
        expect(spacing).toBeGreaterThan(20);
        expect(spacing).toBeLessThan(80);
      }
    }
  });
});

const straight: RibbonPoint[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: -100 },
  { x: 0, y: 0, z: -200 },
];

describe('road ribbon', () => {
  it('produces two vertices per point and two triangles per segment', () => {
    const ribbon = buildRibbon(straight, 10)!;
    expect(ribbon.positions.length).toBe(straight.length * 2 * 3);
    expect(ribbon.indices.length).toBe((straight.length - 1) * 6);
  });

  it('is exactly as wide as asked on a straight run', () => {
    const ribbon = buildRibbon(straight, 12)!;
    const left = { x: ribbon.positions[0], z: ribbon.positions[2] };
    const right = { x: ribbon.positions[3], z: ribbon.positions[5] };
    expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeCloseTo(12, 6);
  });

  it('follows the terrain height of its points', () => {
    const hilly: RibbonPoint[] = [
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 40, z: -100 },
    ];
    const ribbon = buildRibbon(hilly, 8)!;
    expect(ribbon.positions[1]).toBe(10);
    expect(ribbon.positions[7]).toBe(40);
  });

  it('widens a corner without spiking', () => {
    const corner: RibbonPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -50 },
      { x: 50, y: 0, z: -50 },
    ];
    const ribbon = buildRibbon(corner, 10)!;
    const midLeft = { x: ribbon.positions[6], z: ribbon.positions[8] };
    const midRight = { x: ribbon.positions[9], z: ribbon.positions[11] };
    const width = Math.hypot(midLeft.x - midRight.x, midLeft.z - midRight.z);
    // A 90 degree corner mitres wider than the road, but stays bounded.
    expect(width).toBeGreaterThan(10);
    expect(width).toBeLessThan(35);
  });

  it('refuses a degenerate line', () => {
    expect(buildRibbon([{ x: 0, y: 0, z: 0 }], 10)).toBeNull();
    expect(buildRibbon([], 10)).toBeNull();
  });

  it('measures polyline length', () => {
    expect(polylineLength(straight)).toBeCloseTo(200, 6);
  });
});

describe('street lamps', () => {
  it('spaces lamps evenly by distance, not by vertex', () => {
    // One long segment and one short: spacing must not follow the vertices.
    const uneven: RibbonPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -300 },
      { x: 0, y: 0, z: -310 },
    ];
    const sites = lampSites(uneven, 50, 6);
    expect(sites.length).toBeGreaterThan(5);
    for (let i = 1; i < sites.length; i++) {
      const gap = Math.hypot(sites[i].x - sites[i - 1].x, sites[i].z - sites[i - 1].z);
      expect(gap).toBeGreaterThan(40);
      expect(gap).toBeLessThan(60);
    }
  });

  it('alternates sides of the road', () => {
    const sites = lampSites(straight, 40, 8);
    expect(sites.length).toBeGreaterThan(2);
    // Offsets are perpendicular to a north-running road, so they differ in x.
    expect(Math.sign(sites[0].offsetX)).toBe(-Math.sign(sites[1].offsetX));
    expect(Math.abs(sites[0].offsetX)).toBeCloseTo(8, 6);
  });

  it('follows the height of the road under it', () => {
    const slope: RibbonPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 100, z: -200 },
    ];
    const sites = lampSites(slope, 100, 5);
    for (const site of sites) {
      expect(site.y).toBeGreaterThan(0);
      expect(site.y).toBeLessThan(100);
    }
  });

  it('handles lines too short for a single lamp', () => {
    expect(lampSites([{ x: 0, y: 0, z: 0 }], 40, 6)).toEqual([]);
    expect(lampSites(straight, 0, 6)).toEqual([]);
  });
});

describe('bridges', () => {
  it('spans between its ends instead of following the ground', () => {
    // A crossing: high banks either side, open water in the middle.
    const points: RibbonPoint[] = Array.from({ length: 11 }, (_, i) => ({
      x: 0,
      y: 0,
      z: -i * 100,
    }));
    const ground = points.map((_, i) => (i === 0 || i === 10 ? 60 : -0));
    bridgeDeck(points, ground, 5, 9);
    // Ends sit on their abutments, the middle stays up with them.
    expect(points[0].y).toBeCloseTo(60, 6);
    expect(points[10].y).toBeCloseTo(60, 6);
    expect(points[5].y).toBeGreaterThan(50);
  });

  it('keeps a deck clear of open water even between low banks', () => {
    const points: RibbonPoint[] = Array.from({ length: 5 }, (_, i) => ({ x: 0, y: 0, z: -i * 50 }));
    const ground = [1, 0, 0, 0, 1];
    bridgeDeck(points, ground, 5, 9);
    for (const point of points.slice(1, 4)) expect(point.y).toBeGreaterThanOrEqual(9);
  });

  it('lifts over anything that pokes through the span', () => {
    const points: RibbonPoint[] = Array.from({ length: 5 }, (_, i) => ({ x: 0, y: 0, z: -i * 50 }));
    // A hillock in the middle, higher than a straight line between the ends.
    const ground = [10, 12, 40, 12, 10];
    bridgeDeck(points, ground, 5, 9);
    expect(points[2].y).toBeGreaterThanOrEqual(45);
  });

  it('parses bridge and tunnel tags', () => {
    const ways = parseOverpass({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { highway: 'motorway', bridge: 'yes', layer: '1', name: 'Boğaziçi Köprüsü' },
          geometry: [
            { lat: 41.04, lon: 29.02 },
            { lat: 41.045, lon: 29.04 },
          ],
        },
        // Tunnels are dropped: draped on the surface they would cross the hill.
        {
          type: 'way',
          id: 2,
          tags: { highway: 'primary', tunnel: 'yes' },
          geometry: [
            { lat: 41.04, lon: 29.02 },
            { lat: 41.045, lon: 29.04 },
          ],
        },
      ],
    });
    expect(ways).toHaveLength(1);
    expect(ways[0].bridge).toBe(true);
    expect(ways[0].layer).toBe(1);
    expect(ways[0].name).toBe('Boğaziçi Köprüsü');
  });
});
