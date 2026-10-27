import type { Cartesian3, Viewer } from "cesium";
import type { ProviderMode } from "../globe/createGlobe";
import type { PerformanceMonitor } from "../globe/performance";
import type { SoundBoard } from "../audio/sound";
import type { Buildings } from "../globe/buildings";
import type { SculptEdit } from "../globe/sculptShapes";

/** Where a disaster happens. `heightM` is the ground height there, if known. */
export interface Site {
  name: string;
  lon: number;
  lat: number;
  heightM: number;
}

/** A slider in the disaster panel. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Shown after the value, e.g. "s" or "m/s". */
  unit?: string;
  hint?: string;
}

export type Params = Record<string, number>;

/** A number the simulation produced, shown in the details panel. */
export interface Metric {
  label: string;
  value: string;
  note?: string;
}

export interface DisasterStatus {
  phase: string;
  metrics: Metric[];
  /** Counts big explosive moments so the UI can flash the screen for each. */
  booms: number;
}

/** Where a disaster wants the camera this frame: placed at `position`, looking at `target`. */
export interface CameraShot {
  position: Cartesian3;
  target: Cartesian3;
}

/** A camera view: the point looked at, and the distance, heading and tilt (degrees) to look from. */
export interface Framing {
  lon: number;
  lat: number;
  heightM: number;
  range: number;
  heading: number;
  pitch: number;
}

export interface DisasterContext {
  viewer: Viewer;
  providerMode: ProviderMode;
  sound: SoundBoard;
  /** Read `perf.effects` for how many particles the machine can afford right now. */
  perf: PerformanceMonitor;
  /** OpenStreetMap buildings, when available, so disasters can damage them. */
  buildings?: Buildings;
  /**
   * Sculpt-mode height change at a point. Terrain sampling already includes it
   * with a token; on the flat fallback globe it is the only relief there is.
   */
  sculptDelta: (lon: number, lat: number) => number;
  /**
   * Reshapes the ground (a meteor's craters). Pass [] to restore it. Kept
   * separate from the user's Sculpt edits, and cleared when the disaster ends.
   */
  setGroundDamage: (damage: SculptEdit[]) => void;
  /**
   * Moves the camera to a new view mid-event (the meteor flies in to its
   * crater), and makes it the point Orbit circles. Skipped while orbiting or
   * once the user has moved the camera themselves.
   */
  focus: (view: Framing) => void;
}

/**
 * One running disaster. The simulation controller owns the clock and calls
 * `update` every frame with the time since the disaster was triggered; the
 * instance owns its own effects and must remove all of them in `destroy`.
 */
export interface DisasterInstance {
  /** Total length of the event in simulated seconds. */
  readonly duration: number;
  /** Returns a camera view that frames the event, used when it starts. */
  readonly framing: Framing;
  update(elapsed: number, dt: number): void;
  status(): DisasterStatus;
  /** How hard the camera should shake right now, 0–1. */
  shake(): number;
  /**
   * A scripted camera (the meteor's chase shot), asked for every frame. The
   * controller blends into it and drops it as soon as the user takes the camera.
   */
  cameraShot?(): CameraShot | undefined;
  /** Hides or shows every effect, for the before/after comparison. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface DisasterDefinition {
  id: string;
  name: string;
  category: string;
  /** What the chosen point is called in the panel ("Vent", "Impact point"). */
  siteLabel: string;
  /** Shown under the site instead of the volcano real/fictional check. */
  siteNote?: { title: string; text: string };
  /** Reshapes the terrain, so it runs in the terrain view (Google's mesh can't be reshaped). */
  needsTerrain?: boolean;
  /** False for disasters listed in the panel but not built yet. */
  available: boolean;
  description: string;
  params: ParamSpec[];
  defaults: Params;
  create(ctx: DisasterContext, site: Site, params: Params, seed: number): Promise<DisasterInstance>;
}
