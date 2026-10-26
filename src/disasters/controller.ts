import { JulianDate, type Clock, type Viewer } from "cesium";
import type { DisasterContext, DisasterDefinition, DisasterInstance, Metric, Params, Site } from "./types";

export type SimStatus = "idle" | "preparing" | "running" | "paused" | "finished";

export interface SimState {
  status: SimStatus;
  elapsed: number;
  duration: number;
  speed: number;
  phase: string;
  metrics: Metric[];
  effectsVisible: boolean;
  seed?: number;
  error?: string;
}

export const IDLE_STATE: SimState = {
  status: "idle",
  elapsed: 0,
  duration: 0,
  speed: 1,
  phase: "",
  metrics: [],
  effectsVisible: true,
};

/**
 * Runs one disaster at a time on Cesium's clock. Particle systems already
 * advance with that clock, so pausing it freezes every effect at once and the
 * speed multiplier time-lapses all of them together.
 */
export class SimulationController {
  private readonly viewer: Viewer;
  private readonly onChange: (state: SimState) => void;
  private instance?: DisasterInstance;
  private startTime?: JulianDate;
  /** The clock time before the run, restored on reset so the sun goes back too. */
  private timeBefore?: JulianDate;
  private lastElapsed = 0;
  private lastEmit = 0;
  private removeTick?: () => void;
  private state: SimState = IDLE_STATE;
  /** Bumped on every trigger/reset so a slow create() can tell it was superseded. */
  private generation = 0;

  constructor(viewer: Viewer, onChange: (state: SimState) => void) {
    this.viewer = viewer;
    this.onChange = onChange;
  }

  async trigger(ctx: DisasterContext, def: DisasterDefinition, site: Site, params: Params, seed: number) {
    this.reset();
    const generation = ++this.generation;
    this.set({ ...IDLE_STATE, status: "preparing", speed: this.state.speed, seed, phase: "Preparing" });

    let instance: DisasterInstance;
    try {
      instance = await def.create(ctx, site, params, seed);
    } catch (err) {
      if (generation === this.generation) {
        this.set({ ...IDLE_STATE, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (generation !== this.generation) {
      instance.destroy();
      return;
    }

    const clock = this.viewer.clock;
    this.instance = instance;
    this.timeBefore = clock.currentTime.clone();
    this.startTime = clock.currentTime.clone();
    this.lastElapsed = 0;
    clock.multiplier = this.state.speed;
    clock.shouldAnimate = true;
    this.removeTick = clock.onTick.addEventListener((c: Clock) => this.tick(c));
    this.set({ ...this.state, status: "running", duration: instance.duration });
    return instance;
  }

  pause() {
    if (this.state.status !== "running") return;
    this.viewer.clock.shouldAnimate = false;
    this.set({ ...this.state, status: "paused" });
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.viewer.clock.shouldAnimate = true;
    this.set({ ...this.state, status: "running" });
  }

  setSpeed(speed: number) {
    this.viewer.clock.multiplier = speed;
    this.set({ ...this.state, speed });
  }

  setEffectsVisible(visible: boolean) {
    this.instance?.setVisible(visible);
    this.set({ ...this.state, effectsVisible: visible });
  }

  /** Removes every effect and puts the clock (and sun) back where it was. */
  reset() {
    this.generation++;
    this.removeTick?.();
    this.removeTick = undefined;
    this.instance?.destroy();
    this.instance = undefined;
    const clock = this.viewer.clock;
    clock.shouldAnimate = false;
    if (this.timeBefore) clock.currentTime = this.timeBefore;
    this.timeBefore = undefined;
    this.set({ ...IDLE_STATE, speed: this.state.speed });
  }

  get current(): SimState {
    return this.state;
  }

  private tick(clock: Clock) {
    const instance = this.instance;
    if (!instance || !this.startTime) return;
    let elapsed = JulianDate.secondsDifference(clock.currentTime, this.startTime);
    let finished = false;
    if (elapsed >= instance.duration) {
      elapsed = instance.duration;
      finished = true;
    }
    const dt = elapsed - this.lastElapsed;
    this.lastElapsed = elapsed;
    instance.update(elapsed, dt);

    if (finished) {
      // Stop the clock but keep the aftermath on screen to inspect.
      clock.shouldAnimate = false;
      clock.currentTime = JulianDate.addSeconds(this.startTime, instance.duration, new JulianDate());
      this.removeTick?.();
      this.removeTick = undefined;
    }

    // React only needs about ten updates a second.
    const now = performance.now();
    if (finished || now - this.lastEmit > 100) {
      this.lastEmit = now;
      const { phase, metrics } = instance.status();
      this.set({
        ...this.state,
        status: finished ? "finished" : this.state.status,
        elapsed,
        phase,
        metrics,
      });
    }
  }

  private set(state: SimState) {
    this.state = state;
    this.onChange(state);
  }
}
