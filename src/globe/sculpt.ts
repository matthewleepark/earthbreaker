import {
  AttributeCompression,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  EllipsoidalOccluder,
  Event,
  OrientedBoundingBox,
  QuantizedMeshTerrainData,
  Rectangle,
  type Credit,
  type Request,
  type TerrainData,
  type TerrainProvider,
  type TileAvailability,
  type TilingScheme,
  type Viewer,
} from "cesium";
import { editBounds, editReachM, totalDelta, type SculptEdit } from "./sculptShapes";
import type { Buildings } from "./buildings";

/**
 * Changes to the ground and the terrain that shows them, in two layers:
 * the user's Sculpt-mode edits, and damage from a running disaster (a meteor's
 * craters), which Reset clears without touching the user's edits.
 *
 * Each change swaps in a fresh SculptedTerrainProvider (the globe reloads its
 * tiles), and buildings standing on changed ground are hidden, since they
 * would otherwise float or sink.
 */
export class Sculpt {
  private readonly viewer: Viewer;
  private readonly base: TerrainProvider;
  private readonly buildings?: Buildings;
  /** The user's Sculpt-mode edits. */
  edits: readonly SculptEdit[] = [];
  /** Ground damage from the current disaster. */
  damage: readonly SculptEdit[] = [];

  constructor(viewer: Viewer, base: TerrainProvider, buildings?: Buildings) {
    this.viewer = viewer;
    this.base = base;
    this.buildings = buildings;
  }

  setEdits(edits: readonly SculptEdit[]) {
    this.edits = edits;
    this.apply();
  }

  setDamage(damage: readonly SculptEdit[]) {
    this.damage = damage;
    this.apply();
  }

  /** The height change at a point from both layers, in metres. */
  deltaAt(lon: number, lat: number): number {
    return totalDelta(this.edits, lon, lat) + totalDelta(this.damage, lon, lat);
  }

  private apply() {
    const all = [...this.edits, ...this.damage];
    this.viewer.terrainProvider = all.length
      ? (new SculptedTerrainProvider(this.base, all) as unknown as TerrainProvider)
      : this.base;
    this.buildings?.hideWithin(all.map((e) => ({ lon: e.lon, lat: e.lat, radiusM: editReachM(e) })));
    this.viewer.scene.requestRender();
  }
}

/** Vertices per side of a rebuilt tile: even spacing so a new peak isn't a few big triangles. */
const GRID = 65;
const QUANTIZED_MAX = 32767;

/**
 * Wraps the real terrain provider and adds Sculpt-mode edits on top of it.
 *
 * Tiles an edit doesn't touch pass through unchanged. A tile it does touch is
 * rebuilt as a regular GRID × GRID mesh: real height (interpolated from the
 * original tile) plus the edit, with fresh normals for lighting, bounding
 * volumes and skirts. Satellite imagery drapes over the new shape as it does
 * over real terrain, and anything that samples the viewer's terrain (the lava
 * model, vent heights) sees the sculpted ground.
 *
 * The original provider is kept untouched for things that must ignore
 * sculpting, such as snapping a catalogue volcano's vent to its real summit.
 */
export class SculptedTerrainProvider {
  readonly base: TerrainProvider;
  private readonly edits: readonly SculptEdit[];
  private readonly bounds: Array<{ west: number; south: number; east: number; north: number }>;
  readonly errorEvent = new Event();

  constructor(base: TerrainProvider, edits: readonly SculptEdit[]) {
    this.base = base;
    this.edits = edits;
    this.bounds = edits.map(editBounds);
  }

  get tilingScheme(): TilingScheme {
    return this.base.tilingScheme;
  }
  get credit(): Credit {
    return this.base.credit;
  }
  get hasWaterMask(): boolean {
    return this.base.hasWaterMask;
  }
  get hasVertexNormals(): boolean {
    return this.base.hasVertexNormals;
  }
  get availability(): TileAvailability | undefined {
    return this.base.availability;
  }

  getLevelMaximumGeometricError(level: number): number {
    return this.base.getLevelMaximumGeometricError(level);
  }
  getTileDataAvailable(x: number, y: number, level: number): boolean | undefined {
    return this.base.getTileDataAvailable(x, y, level);
  }
  loadTileDataAvailability(x: number, y: number, level: number): Promise<void> | undefined {
    return this.base.loadTileDataAvailability(x, y, level);
  }

  requestTileGeometry(x: number, y: number, level: number, request?: Request): Promise<TerrainData> | undefined {
    const pending = this.base.requestTileGeometry(x, y, level, request);
    if (!pending) return undefined;
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
    // Only tiles fine enough to show the edit (it spans at least two grid
    // cells) are rebuilt. Coarser ones, up to half the globe in size, keep the
    // original data: the edit would fall between their samples anyway.
    const cellM = (rect.width * 6_371_000 * Math.cos((rect.north + rect.south) / 2)) / (GRID - 1);
    const touching = this.edits.filter((e, i) => overlaps(this.bounds[i], rect) && e.radiusM >= 2 * cellM);
    if (!touching.length) return pending;
    return pending.then((data) => this.rebuild(data, rect, level, touching) ?? data);
  }

  private rebuild(base: TerrainData, rect: Rectangle, level: number, edits: SculptEdit[]): TerrainData | undefined {
    const ellipsoid = this.tilingScheme.ellipsoid ?? Ellipsoid.WGS84;
    const n = GRID * GRID;
    const heights = new Float64Array(n);
    const positions: Cartesian3[] = new Array(n);
    const toDeg = 180 / Math.PI;
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < GRID; j++) {
      const lat = rect.south + (j / (GRID - 1)) * rect.height;
      for (let i = 0; i < GRID; i++) {
        const lon = rect.west + (i / (GRID - 1)) * rect.width;
        const k = j * GRID + i;
        const real = base.interpolateHeight(rect, lon, lat) ?? 0;
        const h = real + totalDelta(edits, lon * toDeg, lat * toDeg);
        heights[k] = h;
        positions[k] = Cartesian3.fromRadians(lon, lat, h, ellipsoid);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    if (max - min < 1) max = min + 1;

    // u, v and height, each quantised to 0–32767, stored one after another.
    const vertices = new Uint16Array(n * 3);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const k = j * GRID + i;
        vertices[k] = Math.round((i / (GRID - 1)) * QUANTIZED_MAX);
        vertices[n + k] = Math.round((j / (GRID - 1)) * QUANTIZED_MAX);
        vertices[2 * n + k] = Math.round(((heights[k] - min) / (max - min)) * QUANTIZED_MAX);
      }
    }

    // Two counter-clockwise triangles per grid square (u east, v north).
    const indices = new Uint16Array((GRID - 1) * (GRID - 1) * 6);
    let t = 0;
    for (let j = 0; j < GRID - 1; j++) {
      for (let i = 0; i < GRID - 1; i++) {
        const a = j * GRID + i;
        const b = a + 1;
        const c = a + GRID;
        const d = c + 1;
        indices.set([a, b, c, b, d, c], t);
        t += 6;
      }
    }

    const edge = (pick: (k: number) => number) => Array.from({ length: GRID }, (_, k) => pick(k));
    const west = edge((k) => k * GRID);
    const east = edge((k) => k * GRID + GRID - 1);
    const south = edge((k) => k);
    const north = edge((k) => (GRID - 1) * GRID + k);

    const boundingSphere = BoundingSphere.fromPoints(positions);
    const occluder = new EllipsoidalOccluder(ellipsoid);
    const horizonOcclusionPoint = occluder.computeHorizonCullingPointPossiblyUnderEllipsoid(
      boundingSphere.center,
      positions,
      min,
    );
    // Without a valid horizon point Cesium would cull the tile (and everything
    // under it), so keep the original tile instead.
    if (!horizonOcclusionPoint) return undefined;
    const skirt = this.getLevelMaximumGeometricError(level) * 5;

    return new QuantizedMeshTerrainData({
      quantizedVertices: vertices,
      indices,
      minimumHeight: min,
      maximumHeight: max,
      boundingSphere,
      orientedBoundingBox: OrientedBoundingBox.fromRectangle(rect, min, max, ellipsoid),
      horizonOcclusionPoint,
      westIndices: west,
      southIndices: south,
      eastIndices: east,
      northIndices: north,
      westSkirtHeight: skirt,
      southSkirtHeight: skirt,
      eastSkirtHeight: skirt,
      northSkirtHeight: skirt,
      childTileMask: (base as unknown as { _childTileMask?: number })._childTileMask ?? 15,
      // Keep the tile's own land/water mask. Without one, Cesium borrows a
      // coarser ancestor's, which can paint water shading over dry land.
      waterMask: (base as unknown as { _waterMask?: Uint8Array })._waterMask,
      encodedNormals: this.hasVertexNormals ? encodeNormals(positions, indices) : undefined,
    });
  }
}

function overlaps(b: { west: number; south: number; east: number; north: number }, rect: Rectangle) {
  const toDeg = 180 / Math.PI;
  return !(
    b.east < rect.west * toDeg ||
    b.west > rect.east * toDeg ||
    b.north < rect.south * toDeg ||
    b.south > rect.north * toDeg
  );
}

/** Per-vertex normals (the average of the surrounding triangles), oct-encoded as Cesium expects. */
function encodeNormals(positions: Cartesian3[], indices: Uint16Array): Uint8Array {
  const normals = positions.map(() => new Cartesian3());
  const e1 = new Cartesian3();
  const e2 = new Cartesian3();
  const face = new Cartesian3();
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    Cartesian3.subtract(positions[b], positions[a], e1);
    Cartesian3.subtract(positions[c], positions[a], e2);
    Cartesian3.cross(e1, e2, face);
    for (const v of [a, b, c]) Cartesian3.add(normals[v], face, normals[v]);
  }
  const out = new Uint8Array(positions.length * 2);
  const encoded = new Cartesian2();
  normals.forEach((normal, k) => {
    if (Cartesian3.magnitudeSquared(normal) === 0) Cartesian3.normalize(positions[k], normal);
    else Cartesian3.normalize(normal, normal);
    AttributeCompression.octEncode(normal, encoded);
    out[2 * k] = encoded.x;
    out[2 * k + 1] = encoded.y;
  });
  return out;
}
