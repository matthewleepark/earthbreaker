import type { Cesium3DTileset, Viewer } from "cesium";

/**
 * Adapts rendering cost to the machine. While the scene renders continuously
 * (a disaster running, the camera moving), it measures the frame rate every
 * 1.5 s and steps a quality level down below ~28 fps or up above ~52 fps.
 * Each level trades render resolution, map detail and particle count.
 */
interface Level {
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
    { resolution: sharp, tilesError: 8, globeError: 1.5, effects: 1 },
    { resolution: 1, tilesError: 8, globeError: 1.5, effects: 1 },
    { resolution: 0.85, tilesError: 12, globeError: 2, effects: 0.8 },
    { resolution: 0.72, tilesError: 16, globeError: 2.5, effects: 0.6 },
    { resolution: 0.6, tilesError: 24, globeError: 3, effects: 0.45 },
  ];
}

const START_LEVEL = 1;
const WINDOW_MS = 1500;
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
  /** Most recent measured frame rate, for the details panel. */
  fps?: number;

  constructor(viewer: Viewer, tileset?: Cesium3DTileset) {
    this.viewer = viewer;
    this.tileset = tileset;
    this.apply();
    viewer.scene.postRender.addEventListener(() => this.onFrame());
  }

  /** Multiplier (0.45–1) for how many particles effects should emit. */
  get effects(): number {
    return this.table[this.level].effects;
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
    if (fps < 28 && this.level < this.table.length - 1) {
      this.level++;
      this.apply();
    } else if (fps > 52 && this.level > 0) {
      this.level--;
      this.apply();
    }
  }

  private apply() {
    const l = this.table[this.level];
    this.viewer.resolutionScale = l.resolution;
    this.viewer.scene.globe.maximumScreenSpaceError = l.globeError;
    if (this.tileset) this.tileset.maximumScreenSpaceError = l.tilesError;
  }
}
