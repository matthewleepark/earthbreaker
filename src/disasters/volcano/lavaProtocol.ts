// Messages between the eruption (main thread) and the lava worker.

export type LavaRequest =
  | {
      type: "init";
      size: number;
      cellSizeM: number;
      ground: Float32Array;
      ventCells: number[];
      seed: number;
      maxRunoutM: number;
      schedule: { duration: number; lavaStart: number; lavaEnd: number; effusion: number };
    }
  /** Bring the model up to this many seconds since the eruption was triggered. */
  | { type: "advance"; elapsed: number };

export interface LavaSnapshot {
  type: "state";
  thickness: Float32Array;
  temperature: Float32Array;
  /** Simulated lava seconds the snapshot is at. */
  lavaClock: number;
  areaKm2: number;
  runoutKm: number;
  moltenShare: number;
  reachedEdge: boolean;
}

/**
 * What the main thread knows about the lava: the latest snapshot from the
 * worker, in the shape the lava texture and the building fires read.
 */
export interface LavaView {
  size: number;
  cellSizeM: number;
  thickness: Float32Array;
  temperature: Float32Array;
}
