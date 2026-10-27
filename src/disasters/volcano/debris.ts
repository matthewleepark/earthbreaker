import {
  BillboardCollection,
  Cartesian3,
  Color,
  NearFarScalar,
  type Billboard,
  type Scene,
} from "cesium";
import { ashPuffTexture, chunkTextures } from "./textures";
import { lightLevel } from "../../globe/timeOfDay";

/** Ground height in metres at a point given as metres east and north of the vent. */
export type GroundAt = (east: number, north: number) => number;

export interface DebrisOptions {
  vent: Cartesian3;
  ventHeightM: number;
  east: Cartesian3;
  north: Cartesian3;
  up: Cartesian3;
  columnHeightM: number;
  groundAt: GroundAt;
  /** True when the summit is high enough to be snow-capped, so some pieces are ice. */
  snowy: boolean;
}

type Kind = "rock" | "hot" | "ice";

interface Chunk {
  billboard: Billboard;
  /** Position and velocity in metres east, north and up of the vent (simple to integrate). */
  e: number; n: number; u: number;
  ve: number; vn: number; vu: number;
  spin: number;
  age: number;
  kind: Kind;
  landed: boolean;
  /** Seconds after landing (or of life) before it fades away. */
  restLeft: number;
  /** Big chunks leave smoke trails. */
  trail: boolean;
  trailClock: number;
  alive: boolean;
}

interface Puff {
  billboard: Billboard;
  age: number;
  life: number;
  grow: number;
  alpha: number;
  alive: boolean;
}

const MAX_CHUNKS = 420;
const MAX_PUFFS = 260;
const FLIGHT_S = 7;
const TRAIL_EVERY_S = 0.12;
const REST_S = 6;

const ROCK = [new Color(0.34, 0.3, 0.27, 1), new Color(0.42, 0.37, 0.33, 1), new Color(0.26, 0.24, 0.23, 1)];
const ICE = new Color(0.86, 0.9, 0.95, 1);
const HOT = new Color(1, 0.62, 0.25, 1);
const COOLED = new Color(0.22, 0.19, 0.17, 1);
const DUST = new Color(0.48, 0.43, 0.38, 1);
const TRAIL_SMOKE = new Color(0.35, 0.33, 0.31, 1);

/**
 * Pieces thrown out by the blast: rock, glowing lava bombs and (on snowy
 * summits) blocks of ice, tumbling on ballistic arcs. Big pieces trail smoke;
 * each one kicks up dust where it lands, using the same terrain heights the
 * lava model reads. Pools of billboards are reused, so nothing is allocated
 * while it runs.
 */
export class Debris {
  private readonly scene: Scene;
  private readonly opts: DebrisOptions;
  private readonly pieces = new BillboardCollection();
  private readonly puffs = new BillboardCollection();
  private readonly chunks: Chunk[] = [];
  private readonly dust: Puff[] = [];
  private nextChunk = 0;
  private nextPuff = 0;
  private readonly gravity: number;
  private readonly speed: number;
  private readonly scratch = new Cartesian3();
  private readonly step = new Cartesian3();
  private readonly colour = new Color();

  constructor(scene: Scene, opts: DebrisOptions) {
    this.scene = scene;
    this.opts = opts;
    // Time-lapsed ballistics like the ejecta: up to ~22% of the column height
    // and back in about FLIGHT_S seconds. For flight t and apex H: g = 8H/t², v = g·t/2.
    const apex = opts.columnHeightM * 0.22;
    this.gravity = (8 * apex) / (FLIGHT_S * FLIGHT_S);
    this.speed = (this.gravity * FLIGHT_S) / 2;

    const images = chunkTextures();
    // Screen-sized pieces that grow when the camera is close, so they read as
    // debris from 40 km away and as boulders up close.
    const scaling = new NearFarScalar(2_000, 2.6, 60_000, 0.65);
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const billboard = this.pieces.add({ image: images[i % images.length], position: opts.vent, show: false, scaleByDistance: scaling });
      this.chunks.push({
        billboard, e: 0, n: 0, u: 0, ve: 0, vn: 0, vu: 0, spin: 0, age: 0,
        kind: "rock", landed: false, restLeft: 0, trail: false, trailClock: 0, alive: false,
      });
    }
    for (let i = 0; i < MAX_PUFFS; i++) {
      const billboard = this.puffs.add({ image: ashPuffTexture(), position: opts.vent, show: false, sizeInMeters: true });
      this.dust.push({ billboard, age: 0, life: 1, grow: 1, alpha: 1, alive: false });
    }
    scene.primitives.add(this.puffs);
    scene.primitives.add(this.pieces);
  }

  /** Throws `count` pieces out of the vent; `force` 0–1 scales how far they fly. */
  burst(count: number, force: number) {
    for (let i = 0; i < count; i++) this.throwOne(force);
  }

  private throwOne(force: number) {
    const c = this.chunks[this.nextChunk];
    this.nextChunk = (this.nextChunk + 1) % MAX_CHUNKS;
    // Mostly upward, some flung out low and wide (up to 60° from vertical).
    const tilt = Math.acos(1 - Math.random() * (1 - Math.cos((60 * Math.PI) / 180)));
    const turn = Math.random() * Math.PI * 2;
    const v = this.speed * force * (0.45 + Math.random() * 0.75);
    c.ve = Math.sin(tilt) * Math.cos(turn) * v;
    c.vn = Math.sin(tilt) * Math.sin(turn) * v;
    c.vu = Math.cos(tilt) * v;
    c.e = c.n = 0;
    c.u = 60;
    c.age = 0;
    c.landed = false;
    c.restLeft = REST_S * (0.6 + Math.random() * 0.8);
    c.spin = (Math.random() * 2 - 1) * 7;
    const roll = Math.random();
    c.kind = roll < 0.3 ? "hot" : this.opts.snowy && roll > 0.72 ? "ice" : "rock";
    // A few big pieces, many small ones.
    const size = 7 + 26 * Math.pow(Math.random(), 2.4);
    c.trail = size > 17;
    c.trailClock = Math.random() * TRAIL_EVERY_S;
    c.alive = true;
    const b = c.billboard;
    b.width = size;
    b.height = size * (0.75 + Math.random() * 0.4);
    b.rotation = Math.random() * Math.PI * 2;
    if (c.kind === "hot") {
      b.color = HOT;
    } else {
      // Rock and ice are lit by the time of day; lava bombs glow on their own.
      const base = c.kind === "ice" ? ICE : ROCK[Math.floor(Math.random() * ROCK.length)];
      const a = lightLevel.ambient;
      b.color = Color.fromBytes(base.red * 255 * a, base.green * 255 * a, base.blue * 255 * a, 255, this.colour);
    }
    b.show = true;
    this.place(c);
  }

  tick(dt: number) {
    if (dt <= 0) return;
    const g = this.gravity;
    for (const c of this.chunks) {
      if (!c.alive) continue;
      c.age += dt;
      const b = c.billboard;
      if (!c.landed) {
        c.vu -= g * dt;
        c.e += c.ve * dt;
        c.n += c.vn * dt;
        c.u += c.vu * dt;
        b.rotation += c.spin * dt;
        const ground = this.opts.groundAt(c.e, c.n) - this.opts.ventHeightM;
        if (c.vu < 0 && c.u <= ground) {
          c.u = ground;
          c.landed = true;
          this.puff(c.e, c.n, c.u, c.trail ? 1.6 : 0.9);
        } else if (c.trail) {
          c.trailClock -= dt;
          if (c.trailClock <= 0) {
            c.trailClock = TRAIL_EVERY_S;
            this.puff(c.e, c.n, c.u, 0.35, true);
          }
        }
        this.place(c);
      } else {
        c.restLeft -= dt;
        if (c.restLeft <= 0) {
          c.alive = false;
          b.show = false;
          continue;
        }
      }
      const fading = c.landed && c.restLeft < 1.5;
      if (c.kind === "hot" || fading) {
        // Lava bombs cool from orange to dark rock over ~8 s; landed pieces fade out at the end.
        const colour = c.kind === "hot" ? Color.lerp(HOT, COOLED, Math.min(1, c.age / 8), this.colour) : Color.clone(b.color, this.colour);
        colour.alpha = fading ? Math.max(0, c.restLeft / 1.5) : 1;
        b.color = colour;
      }
    }

    for (const p of this.dust) {
      if (!p.alive) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.alive = false;
        p.billboard.show = false;
        continue;
      }
      p.billboard.scale = 1 + p.grow * t;
      const colour = Color.clone(p.billboard.color, this.colour);
      colour.alpha = p.alpha * (1 - t);
      p.billboard.color = colour;
    }
  }

  /** Smoke or dust at a point (metres east/north/up of the vent). */
  private puff(e: number, n: number, u: number, size: number, trail = false) {
    const p = this.dust[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
    p.alive = true;
    p.age = 0;
    p.life = trail ? 1.6 : 3.5;
    p.grow = trail ? 2 : 3;
    p.alpha = trail ? 0.55 : 0.75;
    const b = p.billboard;
    const m = (trail ? 160 : 260) * size;
    b.width = b.height = m;
    b.scale = 1;
    const colour = Color.clone(trail ? TRAIL_SMOKE : DUST, this.colour);
    colour.alpha = p.alpha;
    b.color = colour;
    b.position = this.toWorld(e, n, u + m * 0.3);
    b.show = true;
  }

  private place(c: Chunk) {
    c.billboard.position = this.toWorld(c.e, c.n, c.u);
  }

  /** Vent-relative metres to a world position. Returns a scratch vector: billboards copy it. */
  private toWorld(e: number, n: number, u: number): Cartesian3 {
    const { vent, east, north, up } = this.opts;
    const p = this.scratch;
    const step = this.step;
    Cartesian3.clone(vent, p);
    Cartesian3.add(p, Cartesian3.multiplyByScalar(east, e, step), p);
    Cartesian3.add(p, Cartesian3.multiplyByScalar(north, n, step), p);
    return Cartesian3.add(p, Cartesian3.multiplyByScalar(up, u, step), p);
  }

  set show(value: boolean) {
    this.pieces.show = this.puffs.show = value;
  }

  destroy() {
    this.scene.primitives.remove(this.pieces);
    this.scene.primitives.remove(this.puffs);
  }
}
