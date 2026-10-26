import type { Viewer } from "cesium";
import type { ProviderMode } from "../globe/createGlobe";
import type { PerformanceMonitor } from "../globe/performance";
import type { SoundBoard } from "../audio/sound";

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

export interface DisasterContext {
  viewer: Viewer;
  providerMode: ProviderMode;
  sound: SoundBoard;
  /** Read `perf.effects` for how many particles the machine can afford right now. */
  perf: PerformanceMonitor;
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
  readonly framing: { lon: number; lat: number; heightM: number; range: number; heading: number; pitch: number };
  update(elapsed: number, dt: number): void;
  status(): DisasterStatus;
  /** How hard the camera should shake right now, 0–1. */
  shake(): number;
  /** Hides or shows every effect, for the before/after comparison. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface DisasterDefinition {
  id: string;
  name: string;
  category: string;
  /** False for disasters listed in the panel but not built yet. */
  available: boolean;
  description: string;
  params: ParamSpec[];
  defaults: Params;
  create(ctx: DisasterContext, site: Site, params: Params, seed: number): Promise<DisasterInstance>;
}
