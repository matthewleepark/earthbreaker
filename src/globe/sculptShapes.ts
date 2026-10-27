// The shapes Sculpt mode adds to the terrain, as plain height functions (no
// Cesium imports, so they can be tested with Node).

/** "crater" is made by impacts, not by the Sculpt tools. */
export type SculptKind = "peak" | "raise" | "lower" | "crater";

export interface SculptEdit {
  id: number;
  kind: SculptKind;
  lon: number;
  lat: number;
  /** Footprint radius in metres (for a crater: the rim's radius). */
  radiusM: number;
  /** Height added at the centre in metres (lowering subtracts it; for a crater, its depth). */
  heightM: number;
  /** Varies a peak's ridges (or a crater's rim) so no two look alike. */
  seed: number;
  /** Crater only: how high the rim stands above the surrounding ground. */
  rimM?: number;
  /**
   * Crater only: a complex crater's central peak height. When set, the crater
   * has a flat floor and a central peak instead of a simple bowl.
   */
  peakM?: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
/** A crater's ejecta blanket reaches this many rim radii out. */
const CRATER_REACH = 2.2;
/** A complex crater's flat floor reaches this fraction of the rim radius. */
const COMPLEX_FLOOR = 0.5;

/** How far an edit reaches, as a multiple of its radius. */
function reach(edit: SculptEdit) {
  return edit.kind === "crater" ? CRATER_REACH : 1;
}

/** Height change from one edit at a point, in metres. */
export function editDelta(edit: SculptEdit, lon: number, lat: number): number {
  const dx = (lon - edit.lon) * DEG * Math.cos(edit.lat * DEG) * EARTH_RADIUS_M;
  const dy = (lat - edit.lat) * DEG * EARTH_RADIUS_M;
  const d = Math.hypot(dx, dy) / edit.radiusM;
  if (d >= reach(edit)) return 0;
  switch (edit.kind) {
    case "crater": {
      // A raised rim (slightly irregular) at d = 1 with an ejecta blanket
      // thinning out beyond it. A simple crater is a bowl inside.
      const angle = Math.atan2(dy, dx);
      const rim = (edit.rimM ?? 0) * (1 + 0.15 * Math.sin(5 * angle + edit.seed) + 0.08 * Math.sin(11 * angle + edit.seed * 2));
      if (d >= 1) return rim * ((CRATER_REACH - d) / (CRATER_REACH - 1)) ** 2;
      if (!edit.peakM) return -edit.heightM * (1 - d * d) + rim * d ** 4;
      // A complex crater: the floor rebounded after the impact, leaving it
      // flat out to half the radius with a central peak, and steep walls.
      const peak = edit.peakM * Math.exp(-((d / 0.17) ** 2)) * (1 + 0.25 * Math.sin(3 * angle + edit.seed * 3));
      if (d < COMPLEX_FLOOR) return -edit.heightM + peak;
      const t = (d - COMPLEX_FLOOR) / (1 - COMPLEX_FLOOR);
      return -edit.heightM * (1 - t ** 1.5) + rim * t ** 4;
    }
    case "peak": {
      // A concave mountain profile, steepest near the top, with a few ridges
      // and gullies running down its flanks.
      const angle = Math.atan2(dy, dx);
      const s = edit.seed;
      const ridges =
        0.55 * Math.sin(3 * angle + s) + 0.3 * Math.sin(5 * angle + s * 1.7) + 0.15 * Math.sin(9 * angle + s * 2.3);
      const flank = Math.sin(Math.PI * Math.min(1, d * 1.4));
      return edit.heightM * Math.pow(1 - d, 1.8) * (1 + 0.16 * ridges * flank);
    }
    case "raise":
    case "lower": {
      // A smooth swell or hollow that fades to nothing at the radius.
      const bump = Math.exp(-((d / 0.45) ** 2)) * (1 - d * d);
      return (edit.kind === "raise" ? 1 : -1) * edit.heightM * bump;
    }
  }
}

/** Total height change from all edits at a point. */
export function totalDelta(edits: readonly SculptEdit[], lon: number, lat: number): number {
  let sum = 0;
  for (const edit of edits) sum += editDelta(edit, lon, lat);
  return sum;
}

/** The edit's footprint as a lon/lat box in degrees, for quick overlap tests. */
/** How far an edit's footprint reaches from its centre, in metres. */
export function editReachM(edit: SculptEdit): number {
  return edit.radiusM * reach(edit);
}

export function editBounds(edit: SculptEdit): { west: number; south: number; east: number; north: number } {
  const dLat = (edit.radiusM * reach(edit)) / (DEG * EARTH_RADIUS_M);
  const dLon = dLat / Math.max(0.01, Math.cos(edit.lat * DEG));
  return { west: edit.lon - dLon, south: edit.lat - dLat, east: edit.lon + dLon, north: edit.lat + dLat };
}
