import {
  Cesium3DTileStyle,
  createOsmBuildingsAsync,
  type Cesium3DTile,
  type Cesium3DTileContent,
  type Cesium3DTileFeature,
  type Cesium3DTileset,
  type Viewer,
} from "cesium";

/** A building the eruption can find and set on fire. */
export interface BuildingRef {
  feature: Cesium3DTileFeature;
  lon: number;
  lat: number;
  heightM: number;
}

/** Buildings only load and draw when the camera is lower than this (metres above sea level). */
const SHOW_BELOW_M = 25_000;

/**
 * Cesium OSM Buildings: OpenStreetMap footprints extruded to their heights,
 * worldwide, through Cesium ion (asset 96188).
 *
 * Terrain mode: drawn, tinted by building type, once the camera is low enough.
 * Photoreal mode: Google's mesh already contains buildings, so these are
 * hidden, but they still load while a disaster needs to know where buildings
 * are (to set them on fire).
 *
 * Every loaded building's position is indexed as its tile loads, so a disaster
 * can look up the buildings in its area without scanning the whole tileset.
 */
export class Buildings {
  readonly tileset: Cesium3DTileset;
  private readonly viewer: Viewer;
  private readonly byContent = new Map<Cesium3DTileContent, BuildingRef[]>();
  private photoreal = false;
  private dataNeeded = 0;
  private warned = false;

  static async load(viewer: Viewer): Promise<Buildings | undefined> {
    try {
      const tileset = await createOsmBuildingsAsync({ showOutline: false, enableShowOutline: false });
      return new Buildings(viewer, tileset);
    } catch {
      return undefined;
    }
  }

  private constructor(viewer: Viewer, tileset: Cesium3DTileset) {
    this.viewer = viewer;
    this.tileset = tileset;
    tileset.show = false;
    viewer.scene.primitives.add(tileset);
    tileset.tileLoad.addEventListener((tile: Cesium3DTile) => this.index(tile.content));
    tileset.tileUnload.addEventListener((tile: Cesium3DTile) => this.forget(tile.content));
    viewer.camera.changed.addEventListener(() => this.updateShow());
    this.applyStyle();
    this.updateShow();
  }

  /** Photoreal mode hides these (Google's mesh has its own buildings). */
  setPhotoreal(on: boolean) {
    this.photoreal = on;
    this.applyStyle();
    this.updateShow();
  }

  /** A disaster calls this with true while it runs, so buildings load even in photoreal mode. */
  need(on: boolean) {
    this.dataNeeded = Math.max(0, this.dataNeeded + (on ? 1 : -1));
    this.updateShow();
  }

  /** Every loaded building inside a lon/lat box (degrees). */
  within(west: number, south: number, east: number, north: number): BuildingRef[] {
    const found: BuildingRef[] = [];
    for (const refs of this.byContent.values()) {
      for (const b of refs) if (b.lon >= west && b.lon <= east && b.lat >= south && b.lat <= north) found.push(b);
    }
    return found;
  }

  /** Puts every building back to its normal colour and visibility. */
  restore() {
    this.tileset.makeStyleDirty();
    this.viewer.scene.requestRender();
  }

  private applyStyle() {
    // Muted tints by building type; an OSM `colour` tag wins where there is one.
    this.tileset.style = new Cesium3DTileStyle({
      show: this.photoreal ? "false" : "true",
      color: {
        conditions: [
          ["Boolean(${feature['cesium#color']})", "color(${feature['cesium#color']})"],
          [
            "${feature['building']} === 'house' || ${feature['building']} === 'detached' || ${feature['building']} === 'residential' || ${feature['building']} === 'apartments'",
            "color('#e4d8c6')",
          ],
          [
            "${feature['building']} === 'commercial' || ${feature['building']} === 'retail' || ${feature['building']} === 'office' || ${feature['building']} === 'industrial'",
            "color('#c8ccd2')",
          ],
          ["${feature['building']} === 'church' || ${feature['building']} === 'cathedral'", "color('#d6c3a5')"],
          ["true", "color('#dbd3c7')"],
        ],
      },
    });
  }

  private updateShow() {
    const height = this.viewer.camera.positionCartographic.height;
    const near = height < SHOW_BELOW_M;
    const show = near && (!this.photoreal || this.dataNeeded > 0);
    if (this.tileset.show !== show) {
      this.tileset.show = show;
      this.viewer.scene.requestRender();
    }
  }

  private index(content: Cesium3DTileContent) {
    const refs: BuildingRef[] = [];
    for (const part of [content, ...(content.innerContents ?? [])]) {
      for (let i = 0; i < part.featuresLength; i++) {
        const feature = part.getFeature(i);
        const lat = Number(feature.getProperty("cesium#latitude"));
        const lon = Number(feature.getProperty("cesium#longitude"));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          if (!this.warned) {
            console.warn("OSM buildings have no cesium#latitude/longitude; they won't react to disasters.");
            this.warned = true;
          }
          continue;
        }
        const h = Number(feature.getProperty("cesium#estimatedHeight"));
        refs.push({ feature, lat, lon, heightM: Number.isFinite(h) && h > 0 ? h : 8 });
      }
    }
    if (refs.length) this.byContent.set(content, refs);
  }

  private forget(content: Cesium3DTileContent) {
    this.byContent.delete(content);
  }
}
