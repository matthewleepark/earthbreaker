// Irregular rock shapes for the meteorite left in the crater, as plain
// geometry (no Cesium imports, so it can be tested with Node).

export interface RockMesh {
  /** x, y, z per vertex, within a unit sphere. Every triangle has its own three vertices, so faces shade flat like broken rock. */
  positions: Float64Array;
  /**
   * Per vertex, the direction it was pushed out along: longitude as 0–1
   * (unwrapped per triangle, so it can pass 1) and z mapped to 0–1. The
   * material rebuilds the direction from this to draw a seamless pattern.
   */
  st: Float32Array;
}

type Vec = [number, number, number];

const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: Vec[] = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const unit = (v: Vec): Vec => {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
};
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (a: Vec, b: Vec) => unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const randomDir = (rng: () => number): Vec => {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, Math.sin(a) * s, z];
};

/**
 * A lumpy, broken boulder: a subdivided icosphere pushed in and out by a few
 * broad lumps, cut flat by fracture planes where pieces split off, squashed
 * a little, and scaled so its farthest point is 1 from the centre.
 * `subdivisions` = 3 gives 1,280 faces.
 */
export function rockMesh(rng: () => number, subdivisions = 3): RockMesh {
  let faces: Vec[][] = ICO_FACES.map((f) => f.map((i) => unit(ICO_VERTS[i])));
  for (let s = 0; s < subdivisions; s++) {
    const next: Vec[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }

  const lumps = Array.from({ length: 7 }, () => ({ dir: randomDir(rng), amp: -0.2 + rng() * 0.45, width: 0.25 + rng() * 0.35 }));
  const cuts = Array.from({ length: 3 }, () => ({ normal: randomDir(rng), offset: 0.6 + rng() * 0.2 }));
  const ripple = { dir: randomDir(rng), phase: rng() * 10 };
  const stretch: Vec = [1 + rng() * 0.2, 0.8 + rng() * 0.2, 0.62 + rng() * 0.15];

  const shape = (dir: Vec): Vec => {
    let r = 1;
    for (const l of lumps) r += l.amp * Math.exp(-(1 - dot(dir, l.dir)) / l.width);
    r += 0.035 * Math.sin(dot(dir, ripple.dir) * 13 + ripple.phase);
    for (const c of cuts) {
      const along = dot(dir, c.normal);
      if (along > 0 && r * along > c.offset) r = c.offset / along;
    }
    r = Math.max(0.45, r);
    return [dir[0] * r * stretch[0], dir[1] * r * stretch[1], dir[2] * r * stretch[2]];
  };

  const positions = new Float64Array(faces.length * 9);
  const st = new Float32Array(faces.length * 6);
  let maxR = 0;
  faces.forEach((face, f) => {
    let pts = face.map(shape);
    let dirs = face;
    // Wind every face counter-clockwise seen from outside, so back faces can be culled.
    const [a, b, c] = pts;
    const n: Vec = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const centre: Vec = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    if (dot(n, centre) < 0) {
      pts = [pts[0], pts[2], pts[1]];
      dirs = [dirs[0], dirs[2], dirs[1]];
    }
    const us = dirs.map((d) => Math.atan2(d[1], d[0]) / (2 * Math.PI) + 0.5);
    // A face straddling the seam gets its low side moved up by one turn.
    if (Math.max(...us) - Math.min(...us) > 0.5) us.forEach((u, i) => (us[i] = u < 0.5 ? u + 1 : u));
    pts.forEach((p, v) => {
      positions.set(p, f * 9 + v * 3);
      st[f * 6 + v * 2] = us[v];
      st[f * 6 + v * 2 + 1] = (dirs[v][2] + 1) / 2;
      maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2]));
    });
  });
  for (let i = 0; i < positions.length; i++) positions[i] /= maxR;
  return { positions, st };
}
