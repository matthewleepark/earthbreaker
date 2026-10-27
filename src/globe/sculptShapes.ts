// The shapes Sculpt mode adds to the terrain, as plain height functions (no
// Cesium imports, so they can be tested with Node).

export type SculptKind = "peak" | "raise" | "lower";

export interface SculptEdit {
  id: number;
  kind: SculptKind;
  lon: number;
  lat: number;
  /** Footprint radius in metres. */
  radiusM: number;
  /** Height added at the centre in metres (lowering subtracts it). */
  heightM: number;
  /** Varies a peak's ridges so no two look alike. */
  seed: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/** Height change from one edit at a point, in metres. */
export function editDelta(edit: SculptEdit, lon: number, lat: number): number {
  const dx = (lon - edit.lon) * DEG * Math.cos(edit.lat * DEG) * EARTH_RADIUS_M;
  const dy = (lat - edit.lat) * DEG * EARTH_RADIUS_M;
  const d = Math.hypot(dx, dy) / edit.radiusM;
  if (d >= 1) return 0;
  switch (edit.kind) {
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
export function editBounds(edit: SculptEdit): { west: number; south: number; east: number; north: number } {
  const dLat = edit.radiusM / (DEG * EARTH_RADIUS_M);
  const dLon = dLat / Math.max(0.01, Math.cos(edit.lat * DEG));
  return { west: edit.lon - dLon, south: edit.lat - dLat, east: edit.lon + dLon, north: edit.lat + dLat };
}
