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

test("sculpting never changes the volcano catalog", () => {
  const before = JSON.stringify(VOLCANOES);
  const edits: SculptEdit[] = VOLCANOES.map((v, i) => ({ ...base, id: i, kind: "peak", lon: v.lon, lat: v.lat }));
  for (const v of VOLCANOES) totalDelta(edits, v.lon, v.lat);
  assert.equal(JSON.stringify(VOLCANOES), before);
});
