// Impact crater size and energy, from the scaling relations in
// Collins, Melosh & Marcus (2005), "Earth Impact Effects Program",
// Meteoritics & Planetary Science 40(6), 817–840. These are estimates for a
// solid impactor reaching the ground; small stony bodies (under ~50 m) usually
// break up in the air instead (like Tunguska), which isn't modelled.
// No imports, so it can be tested on its own with Node.

const G = 9.81;
const TARGET_DENSITY = 2500; // kg/m³, typical crustal rock
/** On Earth, final craters wider than this become complex (central peaks, terraces). */
const COMPLEX_THRESHOLD_M = 3200;
const MEGATON_J = 4.184e15;

export interface Impactor {
  diameterM: number;
  speedMs: number;
  /** Angle above the horizon, degrees (90 = straight down). */
  angleDeg: number;
  densityKgM3: number;
}

export interface Crater {
  /** Final rim-to-rim diameter, metres. */
  diameterM: number;
  /** Floor depth below the rim, metres. */
  depthM: number;
  /** Rim height above the surrounding ground, metres. */
  rimM: number;
  complex: boolean;
}

export function impactEnergyMt({ diameterM, speedMs, densityKgM3 }: Impactor): number {
  const mass = densityKgM3 * (Math.PI / 6) * diameterM ** 3;
  return (0.5 * mass * speedMs ** 2) / MEGATON_J;
}

export function craterFor(i: Impactor): Crater {
  const sinAngle = Math.sin((i.angleDeg * Math.PI) / 180);
  // Transient crater (eq. 21).
  const transient =
    1.161 *
    Math.cbrt(i.densityKgM3 / TARGET_DENSITY) *
    i.diameterM ** 0.78 *
    i.speedMs ** 0.44 *
    G ** -0.22 *
    Math.cbrt(sinAngle);
  let diameterM = 1.25 * transient; // simple crater (eq. 22)
  let depthM = 0.2 * diameterM;
  const complex = diameterM > COMPLEX_THRESHOLD_M;
  if (complex) {
    diameterM = (1.17 * transient ** 1.13) / COMPLEX_THRESHOLD_M ** 0.13; // eq. 27
    depthM = 0.4 * (diameterM / 1000) ** 0.3 * 1000; // eq. 28, in km
  }
  const rimM = (0.07 * transient ** 4) / diameterM ** 3; // eq. 24
  return { diameterM, depthM, rimM, complex };
}
