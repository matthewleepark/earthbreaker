// A simple wildfire model on a square grid (a cellular automaton).
//
// Each cell is unburned fuel, burning, burned, or bare (nothing to burn).
// Every step, each burning cell may light each of its eight neighbours, more
// readily uphill (flames lean into the slope) and downwind, then burns out
// after several seconds. This is the shape of how fire-spread models work,
// tuned for a time-lapse, not a calibrated forecast: real spread depends on the
// vegetation, its moisture and the weather, none of which is modelled.
//
// Grid layout: index = row * size + col, row 0 is the north edge, col 0 west.
// No imports, so it can be tested on its own with Node.

export const UNBURNED = 0;
export const BURNING = 1;
export const BURNED = 2;
/** Nothing to burn (water, bare rock, ice), or scorched by the impact itself. */
export const BARE = 3;
export const SCORCHED = 4;

/** Chance per second that a burning cell lights a level, windless neighbour. */
const SPREAD_RATE = 0.45;
/** Seconds a cell burns, at least and at most. */
const BURN_MIN_S = 6;
const BURN_MAX_S = 12;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2],
];

export interface FireOptions {
  size: number;
  cellSizeM: number;
  ground: Float32Array;
  /** 1 where there is something to burn. */
  fuel: Uint8Array;
  /** Wind the fire is pushed toward, east and north components, 0–1 strength. */
  windEast: number;
  windNorth: number;
  rng: () => number;
}

export class FireSpread {
  readonly size: number;
  readonly cellSizeM: number;
  readonly state: Uint8Array;
  /** Seconds left to burn, for burning cells. */
  private readonly burnLeft: Float32Array;
  private readonly ground: Float32Array;
  private readonly rng: () => number;
  private readonly windEast: number;
  private readonly windNorth: number;
  private readonly toLight: number[] = [];

  constructor({ size, cellSizeM, ground, fuel, windEast, windNorth, rng }: FireOptions) {
    this.size = size;
    this.cellSizeM = cellSizeM;
    this.ground = ground;
    this.rng = rng;
    this.windEast = windEast;
    this.windNorth = windNorth;
    this.state = new Uint8Array(size * size);
    this.burnLeft = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) this.state[i] = fuel[i] ? UNBURNED : BARE;
  }

  /**
   * The impact's heat: every fuel cell within `radiusM` of (row, col) starts
   * burning, and bare ground inside it is scorched. Cells within `innerM`
   * are left alone (the crater and its ejecta, which have nothing left to burn).
   * With `patchy`, fuel only catches with a chance that falls from near
   * certain close in to about a third at the edge, the way a heat flash
   * lights some stands and not others; the fire then spreads into the gaps.
   */
  ignite(row: number, col: number, radiusM: number, innerM = 0, patchy = false) {
    const r = radiusM / this.cellSizeM;
    const inner = innerM / this.cellSizeM;
    const { size } = this;
    for (let y = Math.max(0, Math.floor(row - r)); y <= Math.min(size - 1, Math.ceil(row + r)); y++) {
      for (let x = Math.max(0, Math.floor(col - r)); x <= Math.min(size - 1, Math.ceil(col + r)); x++) {
        const d2 = (y - row) ** 2 + (x - col) ** 2;
        if (d2 > r * r || d2 < inner * inner) continue;
        const i = y * size + x;
        if (patchy && this.rng() > 1 - 0.65 * (Math.sqrt(d2) / r) ** 1.2) continue;
        if (this.state[i] === UNBURNED) this.light(i);
        else if (this.state[i] === BARE) this.state[i] = SCORCHED;
      }
    }
  }

  step(dt: number) {
    const { size, state, ground, cellSizeM } = this;
    const toLight = this.toLight;
    toLight.length = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const i = row * size + col;
        if (state[i] !== BURNING) continue;
        for (const [dr, dc, dist] of NEIGHBOURS) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const j = r * size + c;
          if (state[j] !== UNBURNED) continue;
          // Uphill spreads faster (up to 3×), downhill slower.
          const slope = (ground[j] - ground[i]) / (dist * cellSizeM);
          const slopeFactor = Math.min(3, Math.max(0.35, Math.exp(3 * slope)));
          // Downwind spreads faster, upwind slower. Rows grow southward, so north is -dr.
          const along = (dc * this.windEast - dr * this.windNorth) / dist;
          const windFactor = Math.max(0.15, 1 + 1.5 * along);
          const rate = (SPREAD_RATE * slopeFactor * windFactor) / dist;
          if (this.rng() < 1 - Math.exp(-rate * dt)) toLight.push(j);
        }
        this.burnLeft[i] -= dt;
        if (this.burnLeft[i] <= 0) state[i] = BURNED;
      }
    }
    for (const j of toLight) if (state[j] === UNBURNED) this.light(j);
  }

  private light(i: number) {
    this.state[i] = BURNING;
    this.burnLeft[i] = BURN_MIN_S + this.rng() * (BURN_MAX_S - BURN_MIN_S);
  }

  /** Cells that are burning or burned, as square km. */
  burnedAreaKm2(): number {
    let n = 0;
    for (const s of this.state) if (s === BURNING || s === BURNED) n++;
    return (n * this.cellSizeM * this.cellSizeM) / 1e6;
  }

  burningCount(): number {
    let n = 0;
    for (const s of this.state) if (s === BURNING) n++;
    return n;
  }
}

/**
 * Rough tree line in metres for a latitude: about 4,300 m at the equator,
 * 2,000 m at 46° (Rainier's forests end near 1,800–2,000 m), 1,300 m at 60°.
 */
export function treeLineM(latDeg: number): number {
  return Math.max(300, 4300 - 50 * Math.abs(latDeg));
}
