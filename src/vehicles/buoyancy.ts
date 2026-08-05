/**
 * Hull attitude on a wave surface.
 *
 * Rather than integrating buoyancy forces at sample points — stable only with a
 * small timestep and easy to make explode — the hull is fitted to the water it
 * spans: four probes give the surface height at bow, stern and both beams, and
 * the resulting plane gives heave, pitch and roll directly. Springs then ease
 * the hull toward that attitude, which reads as inertia without the instability.
 */

export interface HullProbe {
  /** Height of the water surface at a point. */
  height: number;
}

export interface HullFit {
  /** Mean water height under the hull, metres. */
  heave: number;
  /** Nose-up pitch in radians. */
  pitch: number;
  /** Starboard-down roll in radians. */
  roll: number;
}

export interface HullShape {
  /** Distance from the centre to bow/stern, metres. */
  halfLength: number;
  /** Distance from the centre to each beam, metres. */
  halfBeam: number;
}

/**
 * Fits the hull to four water samples.
 *
 * Samples are taken in the hull's own frame: bow is ahead (-z in scene terms),
 * stern behind, port and starboard to each side.
 */
export function fitHull(
  shape: HullShape,
  bow: number,
  stern: number,
  port: number,
  starboard: number,
): HullFit {
  const heave = (bow + stern + port + starboard) / 4;
  // A bow riding higher than the stern means the nose is up.
  const pitch = Math.atan2(bow - stern, 2 * shape.halfLength);
  const roll = Math.atan2(starboard - port, 2 * shape.halfBeam);
  return { heave, pitch, roll };
}

/** Critically damped-ish approach toward a target, framerate independent. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * Math.min(1, rate * dt);
}
