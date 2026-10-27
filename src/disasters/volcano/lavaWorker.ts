// Runs the lava model off the main thread. Rendering and the model no longer
// compete for each frame, so on a slow computer (or at 4×) the lava keeps up
// with the eruption clock instead of falling behind and catching up at the end.
import { LavaSim } from "./lavaSim";
import { seededRandom } from "../random";
import type { LavaRequest, LavaSnapshot } from "./lavaProtocol";

/** Normal model step; longer steps are used to catch up when behind. */
const STEP_S = 0.1;
const MAX_STEP_S = 0.5;

let sim: LavaSim | undefined;
let clock = 0;
let schedule: Extract<LavaRequest, { type: "init" }>["schedule"] | undefined;

self.onmessage = (event: MessageEvent<LavaRequest>) => {
  const msg = event.data;
  if (msg.type === "init") {
    sim = new LavaSim({
      size: msg.size,
      cellSizeM: msg.cellSizeM,
      ground: msg.ground,
      ventCells: msg.ventCells,
      rng: seededRandom(msg.seed),
      maxRunoutM: msg.maxRunoutM,
    });
    schedule = msg.schedule;
    clock = 0;
    return;
  }
  if (!sim || !schedule) return;
  const { duration, lavaStart, lavaEnd, effusion } = schedule;
  const target = Math.max(0, msg.elapsed - lavaStart * duration);
  while (clock + STEP_S <= target + 1e-6) {
    const behind = target - clock;
    const step = Math.min(MAX_STEP_S, behind > 3 ? 0.5 : behind > 1 ? 0.25 : STEP_S, behind);
    const lf = (clock + lavaStart * duration) / duration;
    // Effusion eases off over the last fifth of the lava phase. After it
    // stops, cooling speeds up (up to 80×: hours of cooling compressed into
    // seconds) so even thick flows have crusted over by the end.
    const taper = Math.min(1, Math.max(0, (lavaEnd - lf) / 0.12));
    const cooling = lf < lavaEnd ? 1 : 1 + 79 * Math.min(1, (lf - lavaEnd) / (0.92 - lavaEnd));
    sim.step(step, lf < lavaEnd ? effusion * taper : 0, cooling);
    clock += step;
  }
  const snapshot: LavaSnapshot = {
    type: "state",
    thickness: sim.thickness.slice(),
    temperature: sim.temperature.slice(),
    lavaClock: clock,
    areaKm2: sim.coveredAreaKm2(),
    runoutKm: sim.runoutKm(),
    moltenShare: sim.moltenShare(),
    reachedEdge: sim.reachedEdge(),
  };
  (self as unknown as Worker).postMessage(snapshot, [snapshot.thickness.buffer, snapshot.temperature.buffer]);
};
