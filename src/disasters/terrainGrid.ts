import { Cartographic, sampleTerrain, type Rectangle } from "cesium";
import type { DisasterContext } from "./types";

/**
 * Ground heights on a size × size grid over `rectangle` (row 0 = north edge,
 * sampled at cell centres), for a disaster model to run on.
 *
 * With a token it samples the terrain model (including any Sculpt edits) at
 * the one level whose detail matches `cellM`: a tile at level L is 180/2^L
 * degrees wide with ~64 samples across. "Most detailed" sampling fetched many
 * times more tiles than a model can use, which delayed the lava by up to a
 * minute while Google's tiles were loading too.
 *
 * Without a token the ground is level except where it has been sculpted.
 */
export async function loadGround(
  ctx: DisasterContext,
  rectangle: Rectangle,
  size: number,
  cellM: number,
): Promise<{ ground: Float32Array; note: string }> {
  const ground = new Float32Array(size * size);
  if (ctx.providerMode !== "ion") {
    let sculpted = false;
    const toDeg = 180 / Math.PI;
    for (let row = 0; row < size; row++) {
      const lat = (rectangle.north - ((row + 0.5) / size) * rectangle.height) * toDeg;
      for (let col = 0; col < size; col++) {
        const lon = (rectangle.west + ((col + 0.5) / size) * rectangle.width) * toDeg;
        const h = ctx.sculptDelta(lon, lat);
        ground[row * size + col] = h;
        if (h !== 0) sculpted = true;
      }
    }
    return { ground, note: sculpted ? " on sculpted ground (no terrain token)" : " · flat ground (no terrain token)" };
  }

  const points: Cartographic[] = [];
  for (let row = 0; row < size; row++) {
    const lat = rectangle.north - ((row + 0.5) / size) * rectangle.height;
    for (let col = 0; col < size; col++) {
      const lon = rectangle.west + ((col + 0.5) / size) * rectangle.width;
      points.push(new Cartographic(lon, lat));
    }
  }
  try {
    const level = Math.max(9, Math.min(13, Math.round(Math.log2((180 * 111_320) / (64 * cellM)))));
    const sampled = await sampleTerrain(ctx.viewer.terrainProvider, level, points);
    sampled.forEach((p, i) => (ground[i] = Number.isFinite(p.height) ? p.height : 0));
    return { ground, note: " on real terrain" };
  } catch {
    return { ground, note: " · terrain unavailable, flat ground used" };
  }
}

/**
 * Bilinear height lookup into a loadGround grid, at a point given in metres
 * east and north of the grid's centre. Undefined outside the grid.
 */
export function gridHeight(
  ground: Float32Array,
  size: number,
  cellM: number,
  east: number,
  north: number,
): number | undefined {
  const half = (size * cellM) / 2;
  const col = (east + half) / cellM - 0.5;
  const row = (half - north) / cellM - 0.5;
  if (col < 0 || row < 0 || col >= size - 1 || row >= size - 1) return undefined;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const fc = col - c0;
  const fr = row - r0;
  const i = r0 * size + c0;
  const top = ground[i] * (1 - fc) + ground[i + 1] * fc;
  const bottom = ground[i + size] * (1 - fc) + ground[i + size + 1] * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * Ground heights at a few points, in metres, on the same terms as loadGround:
 * the terrain model at a fixed level (13, about 40 m between samples) with a
 * token, or the Sculpt edits on the flat fallback globe. Undefined where the
 * terrain couldn't be read.
 */
export async function groundHeights(
  ctx: DisasterContext,
  points: { lon: number; lat: number }[],
): Promise<(number | undefined)[]> {
  if (ctx.providerMode !== "ion") return points.map((p) => ctx.sculptDelta(p.lon, p.lat));
  try {
    const sampled = await sampleTerrain(
      ctx.viewer.terrainProvider,
      13,
      points.map((p) => Cartographic.fromDegrees(p.lon, p.lat)),
    );
    return sampled.map((p) => (Number.isFinite(p.height) ? p.height : undefined));
  } catch {
    return points.map(() => undefined);
  }
}
