// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { rockMesh } from "../src/disasters/meteor/rockMesh.ts";
import { seededRandom } from "../src/disasters/random.ts";

test("a rock mesh is a closed, irregular boulder inside a unit sphere", () => {
  const { positions, st } = rockMesh(seededRandom(7), 3);
  const vertices = positions.length / 3;
  assert.equal(vertices, 20 * 4 ** 3 * 3, "1,280 flat-shaded faces");
  assert.equal(st.length, vertices * 2);
  const radii: number[] = [];
  for (let i = 0; i < positions.length; i += 3) radii.push(Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
  assert.ok(radii.every((r) => Number.isFinite(r) && r <= 1 + 1e-9 && r > 0.2), "within the unit sphere");
  assert.ok(Math.abs(Math.max(...radii) - 1) < 1e-9, "scaled so the farthest point is 1");
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const spread = Math.sqrt(radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length);
  assert.ok(spread > 0.05, `lumpy, not a sphere (spread ${spread.toFixed(3)})`);
});

test("every face winds outward, so the back faces can be culled", () => {
  const { positions } = rockMesh(seededRandom(3), 2);
  let inward = 0;
  for (let f = 0; f < positions.length; f += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(f, f + 9);
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz) < 0) inward++;
  }
  assert.equal(inward, 0);
});

test("the same seed gives the same rock, a different seed a different one", () => {
  const a = rockMesh(seededRandom(11), 2).positions;
  assert.deepEqual(rockMesh(seededRandom(11), 2).positions, a);
  assert.notDeepEqual(rockMesh(seededRandom(12), 2).positions, a);
});
