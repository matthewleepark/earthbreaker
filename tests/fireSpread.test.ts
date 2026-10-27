// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BARE, BURNED, BURNING, FireSpread, SCORCHED, UNBURNED, treeLineM } from "../src/disasters/meteor/fireSpread.ts";
import { seededRandom } from "../src/disasters/random.ts";

const N = 81;
const CELL = 200;
const MID = Math.floor(N / 2);

function fire(opts: { ground?: (x: number, y: number) => number; fuel?: (x: number, y: number) => boolean; windEast?: number; windNorth?: number; seed?: number } = {}) {
  const ground = new Float32Array(N * N);
  const fuel = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = (c - MID) * CELL;
      const y = (MID - r) * CELL;
      ground[r * N + c] = opts.ground?.(x, y) ?? 0;
      fuel[r * N + c] = (opts.fuel?.(x, y) ?? true) ? 1 : 0;
    }
  }
  return new FireSpread({ size: N, cellSizeM: CELL, ground, fuel, windEast: opts.windEast ?? 0, windNorth: opts.windNorth ?? 0, rng: seededRandom(opts.seed ?? 1) });
}

/** Mean position of burned-or-burning cells, in metres east and north of the centre. */
function centroid(f: FireSpread) {
  let x = 0, y = 0, n = 0;
  f.state.forEach((s, i) => {
    if (s !== BURNING && s !== BURNED) return;
    x += (i % N) - MID;
    y += MID - Math.floor(i / N);
    n++;
  });
  return { east: (x / n) * CELL, north: (y / n) * CELL };
}

test("the impact ignites fuel within its radius and scorches bare ground", () => {
  const f = fire({ fuel: (x) => x < 0 });
  f.ignite(MID, MID, 1000);
  assert.equal(f.state[MID * N + MID - 2], BURNING);
  assert.equal(f.state[MID * N + MID + 2], SCORCHED);
  assert.equal(f.state[MID * N + MID - 20], UNBURNED, "outside the radius");
});

test("fire spreads outward, then burns out", () => {
  const f = fire();
  f.ignite(MID, MID, 600);
  const start = f.burnedAreaKm2();
  for (let t = 0; t < 20; t += 0.25) f.step(0.25);
  assert.ok(f.burnedAreaKm2() > start * 3, `area ${start.toFixed(1)} -> ${f.burnedAreaKm2().toFixed(1)} km²`);
  for (let t = 0; t < 400 && f.burningCount() > 0; t += 0.25) f.step(0.25);
  assert.equal(f.burningCount(), 0, "eventually everything has burned out");
});

test("fire does not cross bare ground", () => {
  // A 3-cell firebreak of bare ground running north-south just east of the centre.
  const f = fire({ fuel: (x) => !(x > 400 && x < 1100) });
  f.ignite(MID, MID, 300);
  for (let t = 0; t < 120; t += 0.25) f.step(0.25);
  const eastSide = f.state.filter((s, i) => (i % N) - MID > 6 && (s === BURNED || s === BURNING)).length;
  assert.equal(eastSide, 0);
  assert.ok(f.state.some((s) => s === BARE));
});

test("wind and uphill slopes push the fire their way", () => {
  const windy = fire({ windEast: 1, seed: 3 });
  windy.ignite(MID, MID, 400);
  for (let t = 0; t < 12; t += 0.25) windy.step(0.25);
  assert.ok(centroid(windy).east > 300, `downwind centroid ${centroid(windy).east.toFixed(0)} m east`);

  const slope = fire({ ground: (_, y) => 0.4 * y, seed: 3 }); // rising to the north
  slope.ignite(MID, MID, 400);
  for (let t = 0; t < 12; t += 0.25) slope.step(0.25);
  assert.ok(centroid(slope).north > 300, `uphill centroid ${centroid(slope).north.toFixed(0)} m north`);
});

test("the tree line falls with latitude", () => {
  assert.ok(treeLineM(0) > treeLineM(46) && treeLineM(46) > treeLineM(65));
});
