// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { editBounds, editDelta, totalDelta, type SculptEdit } from "../src/globe/sculptShapes.ts";
import { VOLCANOES } from "../src/data/volcanoes.ts";

const base = { id: 1, lon: 10, lat: 45, radiusM: 5000, heightM: 2000, seed: 1 };

test("a peak is full height at its centre and nothing beyond its radius", () => {
  const peak: SculptEdit = { ...base, kind: "peak" };
  assert.ok(Math.abs(editDelta(peak, 10, 45) - 2000) < 1);
  const beyond = 10 + (5100 / (111_320 * Math.cos((45 * Math.PI) / 180)));
  assert.equal(editDelta(peak, beyond, 45), 0);
  // Falls off steadily from the top.
  const lonAt = (m: number) => 10 + m / (111_320 * Math.cos((45 * Math.PI) / 180));
  assert.ok(editDelta(peak, lonAt(1000), 45) > editDelta(peak, lonAt(3000), 45));
});

test("raise and lower are mirror images, and edits add up", () => {
  const raise: SculptEdit = { ...base, kind: "raise", heightM: 300 };
  const lower: SculptEdit = { ...base, id: 2, kind: "lower", heightM: 300 };
  assert.ok(editDelta(raise, 10.01, 45.01) > 0);
  assert.equal(editDelta(lower, 10.01, 45.01), -editDelta(raise, 10.01, 45.01));
  assert.ok(Math.abs(totalDelta([raise, lower], 10.01, 45.01)) < 1e-9);
});

test("the bounds contain the whole footprint", () => {
  const b = editBounds({ ...base, kind: "peak" });
  assert.ok(b.west < 10 && b.east > 10 && b.south < 45 && b.north > 45);
  assert.equal(editDelta({ ...base, kind: "peak" }, b.east + 0.001, 45), 0);
});

test("a crater is a bowl with a raised rim and an ejecta blanket", () => {
  const crater: SculptEdit = { ...base, kind: "crater", radiusM: 2000, heightM: 500, rimM: 80 };
  const lonAt = (m: number) => 10 + m / (111_320 * Math.cos((45 * Math.PI) / 180));
  assert.ok(Math.abs(editDelta(crater, 10, 45) + 500) < 1, "full depth at the centre");
  assert.ok(editDelta(crater, lonAt(1000), 45) < 0, "still below ground halfway out");
  assert.ok(editDelta(crater, lonAt(2000), 45) > 40, "the rim stands up");
  assert.ok(editDelta(crater, lonAt(3000), 45) > 0, "ejecta beyond the rim");
  assert.equal(editDelta(crater, lonAt(4500), 45), 0, "nothing beyond 2.2 rim radii");
  const b = editBounds(crater);
  assert.ok(editDelta(crater, lonAt(4300), 45) >= 0 && b.east > lonAt(4300), "bounds cover the blanket");
});

test("a complex crater has a flat floor and a central peak", () => {
  const crater: SculptEdit = { ...base, kind: "crater", radiusM: 4000, heightM: 600, rimM: 60, peakM: 180 };
  const lonAt = (m: number) => 10 + m / (111_320 * Math.cos((45 * Math.PI) / 180));
  const centre = editDelta(crater, 10, 45);
  assert.ok(centre > -600 + 120, `the peak rises off the floor (${centre.toFixed(0)} m)`);
  const floor = [1500, 1700, 1900].map((m) => editDelta(crater, lonAt(m), 45));
  assert.ok(floor.every((h) => Math.abs(h + 600) < 5), `flat floor (${floor.map((h) => h.toFixed(0))})`);
  assert.ok(editDelta(crater, lonAt(3000), 45) > -600 && editDelta(crater, lonAt(3000), 45) < 0, "walls climb from the floor");
  assert.ok(editDelta(crater, lonAt(4000), 45) > 40, "the rim stands up");
});

test("sculpting never changes the volcano catalog", () => {
  const before = JSON.stringify(VOLCANOES);
  const edits: SculptEdit[] = VOLCANOES.map((v, i) => ({ ...base, id: i, kind: "peak", lon: v.lon, lat: v.lat }));
  for (const v of VOLCANOES) totalDelta(edits, v.lon, v.lat);
  assert.equal(JSON.stringify(VOLCANOES), before);
});
