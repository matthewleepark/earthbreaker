// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { craterFor, impactEnergyMt } from "../src/disasters/meteor/scaling.ts";

test("Meteor Crater, Arizona: a ~50 m iron body at ~12.8 km/s makes a crater around 1.2 km wide", () => {
  const c = craterFor({ diameterM: 50, speedMs: 12_800, angleDeg: 45, densityKgM3: 7800 });
  // The real crater is 1.19 km; these scaling laws are good to tens of percent.
  assert.ok(c.diameterM > 900 && c.diameterM < 2000, `${c.diameterM.toFixed(0)} m`);
  assert.equal(c.complex, false);
  assert.ok(c.depthM > 150 && c.depthM < 400, `depth ${c.depthM.toFixed(0)} m (real: ~170 m)`);
  assert.ok(c.rimM > 20 && c.rimM < 80, `rim ${c.rimM.toFixed(0)} m (real: ~45 m)`);
});

test("bigger, faster and steeper impacts make bigger craters", () => {
  const base = { diameterM: 200, speedMs: 20_000, angleDeg: 45, densityKgM3: 3000 };
  const d = craterFor(base).diameterM;
  assert.ok(craterFor({ ...base, diameterM: 400 }).diameterM > d);
  assert.ok(craterFor({ ...base, speedMs: 30_000 }).diameterM > d);
  assert.ok(craterFor({ ...base, angleDeg: 90 }).diameterM > d);
});

test("large craters are complex and relatively shallow", () => {
  const c = craterFor({ diameterM: 1000, speedMs: 20_000, angleDeg: 45, densityKgM3: 3000 });
  assert.equal(c.complex, true);
  assert.ok(c.depthM / c.diameterM < 0.1, `depth/diameter ${(c.depthM / c.diameterM).toFixed(2)}`);
});

test("energy: a 100 m stony body at 20 km/s is on the order of 100 megatons", () => {
  const e = impactEnergyMt({ diameterM: 100, speedMs: 20_000, angleDeg: 45, densityKgM3: 3000 });
  assert.ok(e > 50 && e < 150, `${e.toFixed(0)} Mt`);
});
