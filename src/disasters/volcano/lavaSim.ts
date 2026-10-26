// A simplified lava-flow model on a square height grid (a cellular automaton).
//
// Each cell holds the ground height, the lava thickness on top of it and the
// lava's temperature. Every step, molten lava moves from a cell to its lower
// neighbours in proportion to the height difference, carrying its heat with
// it, and every cell cools. Cooler lava is stiffer, so it slows and finally
// stops as solid rock. This is the shape of how real flow models work, not a
// calibrated one: speeds and volumes are tuned for a time-lapse, not measured.
//
// Grid layout: index = row * size + col, row 0 is the north edge, col 0 west.
// No imports, so it can be tested on its own with Node.

/** Below this temperature lava no longer flows. 1 = fresh from the vent. */
export const SOLID_TEMPERATURE = 0.45;

/** How readily lava moves downhill; tuned so flows travel a few km in under a minute. */
const FLOW_RATE = 6;
/** Lava thinner than this stays put, like the crust at a flow's edge. */
const YIELD_THICKNESS_M = 0.2;
/** Cooling per second; divided by thickness so thin edges freeze first. */
const COOLING = 0.016;
/** Never move more than this fraction of a cell's mobile lava in one step. */
const MAX_OUTFLOW_FRACTION = 0.45;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2],
];

export interface LavaSimOptions {
  size: number;
  cellSizeM: number;
  ground: Float32Array;
  /** Indices of the cells lava erupts from. */
  ventCells: number[];
  rng: () => number;
}

export class LavaSim {
  readonly size: number;
  readonly cellSizeM: number;
  readonly ground: Float32Array;
  readonly thickness: Float32Array;
  readonly temperature: Float32Array;
  readonly ventCells: number[];
  /** Total lava erupted so far, in cubic metres. */
  eruptedM3 = 0;

  private readonly roughness: Float32Array;
  private readonly dThickness: Float32Array;
  private readonly dHeat: Float32Array;
  private readonly outflow = new Float32Array(8);

  constructor({ size, cellSizeM, ground, ventCells, rng }: LavaSimOptions) {
    this.size = size;
    this.cellSizeM = cellSizeM;
    this.ground = ground;
    this.ventCells = ventCells;
    const cells = size * size;
    this.thickness = new Float32Array(cells);
    this.temperature = new Float32Array(cells);
    this.dThickness = new Float32Array(cells);
    this.dHeat = new Float32Array(cells);
    // Per-cell bias of up to ±25% on how much each cell passes on. Without it
    // flows on smooth or flat ground spread as perfect fans instead of lobes.
    this.roughness = new Float32Array(cells);
    for (let i = 0; i < cells; i++) this.roughness[i] = 0.75 + rng() * 0.5;
  }

  /**
   * Advances the model by `dt` seconds while the vent erupts `effusionM3s`
   * cubic metres per second. `coolingScale` speeds up cooling, which lets the
   * aftermath compress hours of cooling into the end of a time-lapse.
   */
  step(dt: number, effusionM3s: number, coolingScale = 1) {
    const { size, ground, thickness: h, temperature: T, dThickness: dh, dHeat, outflow } = this;
    const cell = this.cellSizeM;

    if (effusionM3s > 0) {
      const added = (effusionM3s * dt) / (this.ventCells.length * cell * cell);
      for (const i of this.ventCells) {
        T[i] = (h[i] * T[i] + added) / (h[i] + added);
        h[i] += added;
      }
      this.eruptedM3 += effusionM3s * dt;
    }

    dh.fill(0);
    dHeat.fill(0);

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const i = row * size + col;
        const mobile = h[i] - YIELD_THICKNESS_M;
        if (mobile <= 0) continue;
        const fluidity = fluidityAt(T[i]);
        if (fluidity <= 0) continue;

        const top = ground[i] + h[i];
        let total = 0;
        let steepest = 0;
        for (let k = 0; k < 8; k++) {
          const [dr, dc, dist] = NEIGHBOURS[k];
          const r = row + dr;
          const c = col + dc;
          outflow[k] = 0;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const drop = top - (ground[r * size + c] + h[r * size + c]);
          if (drop <= 0) continue;
          const slope = drop / (dist * cell);
          // Weight by slope cubed so most lava takes the steepest way down.
          // This is what turns an even sheet into channels and lobes.
          const weight = slope * slope * slope;
          outflow[k] = weight;
          total += weight;
          if (slope > steepest) steepest = slope;
        }
        if (total === 0) continue;

        const fraction = Math.min(MAX_OUTFLOW_FRACTION, FLOW_RATE * fluidity * steepest * dt * this.roughness[i]);
        const moving = fraction * mobile;
        for (let k = 0; k < 8; k++) {
          if (outflow[k] === 0) continue;
          const [dr, dc] = NEIGHBOURS[k];
          const j = (row + dr) * size + (col + dc);
          // Never pass on more than would level the two cells.
          const drop = ground[i] + h[i] - (ground[j] + h[j]);
          const levelling = drop * 0.5;
          const amount = Math.min((moving * outflow[k]) / total, levelling);
          dh[i] -= amount;
          dh[j] += amount;
          dHeat[i] -= amount * T[i];
          dHeat[j] += amount * T[i];
        }
      }
    }

    const cells = size * size;
    for (let i = 0; i < cells; i++) {
      const before = h[i];
      const after = before + dh[i];
      if (after <= 1e-4) {
        h[i] = 0;
        T[i] = 0;
        continue;
      }
      let t = (before * T[i] + dHeat[i]) / after;
      t -= (COOLING * coolingScale * dt) / (after + 0.5);
      h[i] = after;
      T[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }

  /** Area covered by at least `minThicknessM` of lava, molten or solid, in square km. */
  coveredAreaKm2(minThicknessM = 0.1): number {
    let count = 0;
    for (const t of this.thickness) if (t >= minThicknessM) count++;
    return (count * this.cellSizeM * this.cellSizeM) / 1e6;
  }

  /** Straight-line distance from the vent to the farthest covered cell, in km. */
  runoutKm(minThicknessM = 0.1): number {
    const { size } = this;
    const v = this.ventCells[0];
    const vr = Math.floor(v / size);
    const vc = v % size;
    let best = 0;
    for (let i = 0; i < this.thickness.length; i++) {
      if (this.thickness[i] < minThicknessM) continue;
      const dr = Math.floor(i / size) - vr;
      const dc = (i % size) - vc;
      const d = dr * dr + dc * dc;
      if (d > best) best = d;
    }
    return (Math.sqrt(best) * this.cellSizeM) / 1000;
  }

  /** Share of covered cells that are still molten, from 0 to 1. */
  moltenShare(minThicknessM = 0.1): number {
    let covered = 0;
    let molten = 0;
    for (let i = 0; i < this.thickness.length; i++) {
      if (this.thickness[i] < minThicknessM) continue;
      covered++;
      if (this.temperature[i] > SOLID_TEMPERATURE) molten++;
    }
    return covered ? molten / covered : 0;
  }

  /** True once lava has reached the grid edge, where the model stops tracking it. */
  reachedEdge(minThicknessM = 0.1): boolean {
    const { size, thickness } = this;
    for (let k = 0; k < size; k++) {
      if (
        thickness[k] >= minThicknessM ||
        thickness[(size - 1) * size + k] >= minThicknessM ||
        thickness[k * size] >= minThicknessM ||
        thickness[k * size + size - 1] >= minThicknessM
      ) return true;
    }
    return false;
  }
}

function fluidityAt(t: number): number {
  if (t <= SOLID_TEMPERATURE) return 0;
  const x = (t - SOLID_TEMPERATURE) / (1 - SOLID_TEMPERATURE);
  return x * Math.sqrt(x);
}
