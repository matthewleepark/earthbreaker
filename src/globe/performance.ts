import type { Cesium3DTileset, Viewer } from "cesium";

/**
 * Adapts rendering cost to the machine. While the scene renders continuously
 * (a disaster running, the camera moving), it measures the frame rate every
 * 1.5 s. Below ~45 fps it steps a quality level down straight away; above
 * ~57 fps for two windows in a row it steps back up (the wait stops it
 * flip-flopping). Each level trades render resolution, map detail and
 * particle count.
 */
interface Level {
  name: string;
  /** Render resolution relative to CSS pixels. */
  resolution: number;
  /** Detail of Google's 3D tiles and of the terrain (lower = sharper, heavier). */
  tilesError: number;
  globeError: number;
  /** Multiplier on effect particle counts. */
  effects: number;
}

function levels(): Level[] {
  const sharp = Math.min(window.devicePixelRatio || 1, 1.5);
  return [
    { name: "Ultra", resolution: sharp, tilesError: 8, globeError: 1.5, effects: 1 },
    { name: "High", resolution: 1, tilesError: 12, globeError: 1.75, effects: 1 },
    { name: "Medium", resolution: 0.85, tilesError: 16, globeError: 2, effects: 0.75 },
    { name: "Low", resolution: 0.72, tilesError: 20, globeError: 2.5, effects: 0.55 },
    { name: "Lowest", resolution: 0.6, tilesError: 28, globeError: 3, effects: 0.4 },
  ];
}

const START_LEVEL = 1;
const WINDOW_MS = 1500;
const STEP_DOWN_BELOW = 45;
const STEP_UP_ABOVE = 57;
/** Gaps longer than this mean the scene stopped rendering (idle), not that it's slow. */
const IDLE_GAP_MS = 250;

export class PerformanceMonitor {
  private readonly viewer: Viewer;
  private readonly tileset?: Cesium3DTileset;
  private readonly table = levels();
  private level = START_LEVEL;
  private lastFrame = 0;
  private frames = 0;
  private elapsed = 0;
  private goodWindows = 0;
  /** Most recent measured frame rate while animating. */
  fps?: number;

  constructor(viewer: Viewer, tileset?: Cesium3DTileset) {
    this.viewer = viewer;
    this.tileset = tileset;
    this.apply();
    viewer.scene.postRender.addEventListener(() => this.onFrame());
  }

  /** Multiplier (0.4–1) for how many particles effects should emit. */
  get effects(): number {
    return this.table[this.level].effects;
  }

  get levelName(): string {
    return this.table[this.level].name;
  }

  private onFrame() {
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    if (gap > IDLE_GAP_MS) return;
    this.frames++;
    this.elapsed += gap;
    if (this.elapsed < WINDOW_MS) return;

    const fps = (this.frames * 1000) / this.elapsed;
    this.fps = fps;
    this.frames = 0;
    this.elapsed = 0;
    if (fps < STEP_DOWN_BELOW) {
      this.goodWindows = 0;
      if (this.level < this.table.length - 1) {
        this.level++;
        this.apply();
      }
    } else if (fps > STEP_UP_ABOVE) {
      if (++this.goodWindows >= 2 && this.level > 0) {
        this.goodWindows = 0;
        this.level--;
        this.apply();
      }
    } else {
      this.goodWindows = 0;
    }
  }

  private apply() {
    const l = this.table[this.level];
    this.viewer.resolutionScale = l.resolution;
    this.viewer.scene.globe.maximumScreenSpaceError = l.globeError;
    if (this.tileset) this.tileset.maximumScreenSpaceError = l.tilesError;
  }
}
