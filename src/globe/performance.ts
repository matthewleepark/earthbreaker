import type { Cesium3DTileset, Viewer } from "cesium";

/**
 * Keeps rendering cost in line with the machine, in two ways.
 *
 * 1. A power mode caps the frame rate. Rendering at 60 fps keeps a laptop GPU
 *    at full load (and its fan spinning) even when it copes; 30 fps halves
 *    that work and still looks smooth for eruptions. The mode is picked
 *    automatically (Balanced on integrated graphics, few cores, little
 *    memory, or battery power) and can be changed in the details panel.
 *
 *    While you drag, scroll or the camera is still gliding after, Balanced
 *    lifts the cap so moving around is as smooth as the screen allows.
 *
 * 2. While the scene renders continuously (a disaster running, the camera
 *    moving) the frame rate is measured every 1.5 s. Well below the target it
 *    steps a quality level down at once; at the target for two windows in a
 *    row it steps back up (the wait stops it flip-flopping). Each level trades
 *    render resolution, map detail and particle count. A change waits until
 *    you stop moving the camera, so the picture never blurs or sharpens
 *    suddenly under your hands.
 */
interface Level {
  name: string;
  /** Render resolution relative to CSS pixels. */
  resolution: number;
  /** Detail of Google's 3D tiles, the terrain and OSM buildings (lower = sharper, heavier). */
  tilesError: number;
  globeError: number;
  buildingsError: number;
  /** Multiplier on effect particle counts. */
  effects: number;
}

function levels(): Level[] {
  const sharp = Math.min(window.devicePixelRatio || 1, 1.5);
  return [
    { name: "Ultra", resolution: sharp, tilesError: 8, globeError: 1.5, buildingsError: 8, effects: 1 },
    { name: "High", resolution: 1, tilesError: 12, globeError: 1.75, buildingsError: 12, effects: 1 },
    { name: "Medium", resolution: 0.85, tilesError: 16, globeError: 2, buildingsError: 16, effects: 0.75 },
    { name: "Low", resolution: 0.72, tilesError: 20, globeError: 2.5, buildingsError: 24, effects: 0.55 },
    { name: "Lowest", resolution: 0.6, tilesError: 28, globeError: 3, buildingsError: 32, effects: 0.4 },
  ];
}

export type PowerMode = "smooth" | "balanced" | "saver";

interface ModeRules {
  /** Frame-rate cap; undefined renders as fast as the screen refreshes. */
  fps?: number;
  /** Best and worst quality levels this mode may use, and where it starts. */
  best: number;
  worst: number;
  start: number;
}

const MODES: Record<PowerMode, ModeRules> = {
  smooth: { best: 0, worst: 4, start: 1 },
  balanced: { fps: 30, best: 1, worst: 4, start: 1 },
  saver: { fps: 30, best: 3, worst: 4, start: 3 },
};

export const POWER_LABELS: Record<PowerMode, string> = {
  smooth: "Smooth",
  balanced: "Balanced",
  saver: "Saver",
};

const POWER_KEY = "earthbreaker.power";
const WINDOW_MS = 1500;
/** Gaps longer than this mean the scene stopped rendering (idle), not that it's slow. */
const IDLE_GAP_MS = 250;
/** How long the camera keeps gliding after the last scroll or drag (Cesium's inertia). */
const GLIDE_MS = 1200;

export class PerformanceMonitor {
  private readonly viewer: Viewer;
  private readonly tileset?: Cesium3DTileset;
  private readonly buildings?: Cesium3DTileset;
  private readonly table = levels();
  private level = 1;
  private lastFrame = 0;
  private frames = 0;
  private elapsed = 0;
  private goodWindows = 0;
  private rules: ModeRules = MODES.smooth;
  private listeners = new Set<() => void>();
  /** Current power mode, and whether it was chosen automatically. */
  mode: PowerMode = "smooth";
  automatic = true;
  /** Most recent measured frame rate while animating. */
  fps?: number;
  /** The user is moving the camera (or it's still gliding). */
  private interacting = false;
  private pressed = false;
  private lastInput = 0;
  /** A quality change waiting for the camera to stop. */
  private pending = false;

  constructor(viewer: Viewer, tileset?: Cesium3DTileset, buildings?: Cesium3DTileset) {
    this.viewer = viewer;
    this.tileset = tileset;
    this.buildings = buildings;
    const saved = readSavedMode();
    if (saved) {
      this.automatic = false;
      this.setMode(saved, false);
    } else {
      this.setMode(looksLowPowered() ? "balanced" : "smooth", false);
      // A laptop running on battery gets Balanced too (Chromium browsers only).
      void onBattery().then((battery) => {
        if (battery && this.automatic && this.mode === "smooth") this.setMode("balanced", false);
      });
    }
    viewer.scene.postRender.addEventListener(() => this.onFrame());

    const canvas = viewer.canvas;
    canvas.addEventListener("pointerdown", () => {
      this.pressed = true;
      this.input();
    });
    const release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.input();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", () => this.input(), { passive: true });
  }

  private input() {
    this.lastInput = performance.now();
    if (!this.interacting) {
      this.interacting = true;
      this.updateCap();
    }
    // Rendering stops once the camera does, so check back on a timer.
    setTimeout(() => this.settle(), GLIDE_MS + 50);
  }

  private settle() {
    if (!this.interacting || this.pressed || performance.now() - this.lastInput < GLIDE_MS) return;
    this.interacting = false;
    this.updateCap();
    if (this.pending) this.apply();
  }

  private updateCap() {
    const lift = this.interacting && this.mode === "balanced";
    // undefined is Cesium's default: render at the screen's refresh rate.
    this.viewer.targetFrameRate = (lift ? undefined : this.rules.fps) as number;
  }

  /** Multiplier (0.4–1) for how many particles effects should emit. */
  get effects(): number {
    return this.table[this.level].effects;
  }

  get levelName(): string {
    return this.table[this.level].name;
  }

  /** Switches power mode. `remember` saves it as the user's choice. */
  setMode(mode: PowerMode, remember = true) {
    this.mode = mode;
    this.rules = MODES[mode];
    this.level = this.rules.start;
    this.goodWindows = 0;
    this.fps = undefined;
    this.updateCap();
    if (remember) {
      this.automatic = false;
      try {
        localStorage.setItem(POWER_KEY, mode);
      } catch {
        // Not remembered; still applies now.
      }
    }
    this.apply();
    this.listeners.forEach((l) => l());
  }

  /** Called whenever the mode or level changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    const target = this.rules.fps ?? 60;
    if (fps < target * 0.75) {
      this.goodWindows = 0;
      if (this.level < this.rules.worst) {
        this.level++;
        this.changeLevel();
      }
    } else if (fps > target * 0.93) {
      if (++this.goodWindows >= 2 && this.level > this.rules.best) {
        this.goodWindows = 0;
        this.level--;
        this.changeLevel();
      }
    } else {
      this.goodWindows = 0;
    }
  }

  private changeLevel() {
    if (this.interacting) this.pending = true;
    else this.apply();
  }

  private apply() {
    this.pending = false;
    const l = this.table[this.level];
    this.viewer.resolutionScale = l.resolution;
    this.viewer.scene.globe.maximumScreenSpaceError = l.globeError;
    if (this.tileset) this.tileset.maximumScreenSpaceError = l.tilesError;
    if (this.buildings) this.buildings.maximumScreenSpaceError = l.buildingsError;
    this.viewer.scene.requestRender();
  }
}

function readSavedMode(): PowerMode | undefined {
  try {
    const v = localStorage.getItem(POWER_KEY);
    return v === "smooth" || v === "balanced" || v === "saver" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A rough guess from what the browser reveals: integrated or software
 * graphics, 4 or fewer CPU threads, or 4 GB or less of memory.
 */
function looksLowPowered(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4) return true;
  if ((nav.deviceMemory ?? 8) <= 4) return true;
  return /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render/i.test(gpuName());
}

function gpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

async function onBattery(): Promise<boolean> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean }> };
  try {
    return nav.getBattery ? !(await nav.getBattery()).charging : false;
  } catch {
    return false;
  }
}
