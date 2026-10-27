// Run with: npm test
// Exercises the lava model on made-up terrain, where the right answer is known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LavaSim, SOLID_TEMPERATURE, breachVent } from "../src/disasters/volcano/lavaSim.ts";
import { seededRandom } from "../src/disasters/random.ts";

const N = 96;
const CELL = 80;
const MID = (N / 2) * N + N / 2;
const VENT = [MID, MID - 1, MID + 1, MID - N, MID + N];

/** Builds a grid from a height function of (east, north) metres from the centre. */
function terrain(heightAt: (x: number, y: number) => number) {
  const ground = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) ground[r * N + c] = heightAt((c - N / 2) * CELL, (N / 2 - r) * CELL);
  }
  return ground;
}

function run(ground: Float32Array, seconds: number, effusionUntil: number, seed = 1, coolingAfter = 1) {
  const sim = new LavaSim({ size: N, cellSizeM: CELL, ground, ventCells: VENT, rng: seededRandom(seed) });
  for (let t = 0; t < seconds; t += 0.1) {
    const erupting = t < effusionUntil;
    sim.step(0.1, erupting ? 40_000 : 0, erupting ? 1 : coolingAfter);
  }
  return sim;
}

/** Mean position of covered cells relative to the vent, in metres (east, north). */
function centroid(sim: LavaSim) {
  let x = 0;
  let y = 0;
  let n = 0;
  sim.thickness.forEach((h, i) => {
    if (h < 0.1) return;
    x += (i % N) - N / 2;
    y += N / 2 - Math.floor(i / N);
    n++;
  });
  return { east: (x / n) * CELL, north: (y / n) * CELL };
}

test("conserves lava volume", () => {
  const sim = run(terrain(() => 0), 30, 30);
  const onGrid = sim.thickness.reduce((a, b) => a + b, 0) * CELL * CELL;
  assert.ok(Math.abs(onGrid - sim.eruptedM3) / sim.eruptedM3 < 1e-3, `${onGrid} vs ${sim.eruptedM3}`);
});

test("flows downhill: a slope falling to the east sends lava east", () => {
  const sim = run(terrain((x) => 1000 - 0.25 * x), 30, 30);
  const c = centroid(sim);
  assert.ok(c.east > 400, `centroid ${c.east.toFixed(0)} m east`);
  assert.ok(Math.abs(c.north) < c.east / 3, `stays roughly on the fall line (north ${c.north.toFixed(0)} m)`);
});

test("follows a valley: lava on a cone collects in the cut toward the south", () => {
  const sim = run(
    terrain((x, y) => {
      const r = Math.hypot(x, y);
      const towardSouth = Math.exp(-((x / 250) ** 2)) * (y < 0 ? 1 : 0);
      return 3000 - 0.3 * r - 150 * towardSouth * Math.min(1, r / 600);
    }),
    40,
    40,
  );
  const c = centroid(sim);
  assert.ok(c.north < -150, `centroid ${c.north.toFixed(0)} m north (should be south of the vent)`);
});

test("cools and stops once the vent shuts off", () => {
  const sim = run(terrain((x) => 1000 - 0.2 * x), 70, 30, 1, 25);
  assert.equal(sim.moltenShare(), 0);
  for (const t of sim.temperature) assert.ok(t <= SOLID_TEMPERATURE);
  const area = sim.coveredAreaKm2();
  sim.step(5, 0);
  assert.equal(sim.coveredAreaKm2(), area, "solid lava does not keep spreading");
});

test("a breached vent sends a big eruption kilometres downhill, toward the lowest side", () => {
  // A concave volcano like Rainier or Vesuvius: steep summit, gentle lower flanks,
  // with one valley cut deeper toward the west.
  const size = 160;
  const cell = 150;
  const ground = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = (c - size / 2) * cell;
      const y = (size / 2 - r) * cell;
      const d = Math.hypot(x, y);
      const westValley = x < 0 ? 120 * Math.exp(-((y / 600) ** 2)) * Math.min(1, d / 800) : 0;
      ground[r * size + c] = 3500 * Math.exp(-d / 4500) + 300 - westValley;
    }
  }
  const vent = breachVent(ground, size, cell);
  const sim = new LavaSim({ size, cellSizeM: cell, ground, ventCells: vent, rng: seededRandom(5) });
  for (let t = 0; t < 55; t += 0.1) sim.step(0.1, 300_000);

  const ventCol = (vent[vent.length - 1] % size) - size / 2;
  assert.ok(ventCol < 0, "the breach opens on the side of the deeper valley (west)");
  assert.ok(sim.runoutKm() > 5, `runout ${sim.runoutKm().toFixed(1)} km`);
});

test("lava never travels past the runout limit", () => {
  const size = 120;
  const cell = 150;
  // A long steady slope it would happily run all the way down.
  const ground = terrainOf(size, cell, (x) => 2000 - 0.15 * x);
  const mid = (size / 2) * size + size / 2;
  const sim = new LavaSim({ size, cellSizeM: cell, ground, ventCells: [mid], rng: seededRandom(4), maxRunoutM: 3000 });
  for (let t = 0; t < 60; t += 0.1) sim.step(0.1, 300_000);
  assert.ok(sim.runoutKm() <= 3.0 + cell / 1000, `runout ${sim.runoutKm().toFixed(2)} km`);
});

function terrainOf(size: number, cell: number, heightAt: (x: number, y: number) => number) {
  const ground = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) ground[r * size + c] = heightAt((c - size / 2) * cell, (size / 2 - r) * cell);
  }
  return ground;
}

test("the same seed gives the same flow", () => {
  const ground = terrain((x, y) => 2000 - 0.3 * Math.hypot(x, y));
  const a = run(ground, 20, 20, 7);
  const b = run(ground, 20, 20, 7);
  const c = run(ground, 20, 20, 8);
  assert.deepEqual(a.thickness, b.thickness);
  assert.notDeepEqual(a.thickness, c.thickness);
});
