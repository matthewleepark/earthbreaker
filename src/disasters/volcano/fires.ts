import { BillboardCollection, Cartesian3, Color, type Billboard, type Scene } from "cesium";
import type { BuildingRef, Buildings } from "../../globe/buildings";
import type { LavaView } from "./lavaProtocol";
import { ashPuffTexture, glowTexture } from "./textures";

/** Lava at least this thick counts as reaching a building. */
const CONTACT_M = 0.3;
/** Burning, then charred; buried buildings collapse at the end. */
const BURN_S = 7;
const COLLAPSE_AT_S = 8;
/** Lava deeper than this (or 40% of the building's height) buries it. */
const BURY_M = 2.5;
const CHECK_EVERY_S = 0.25;
const MAX_FLAMES = 160;
const MAX_SMOKE = 320;

const FLAME = new Color(1, 0.55, 0.15, 1);
const EMBER = new Color(0.95, 0.3, 0.06, 1);
const CHARRED = new Color(0.11, 0.095, 0.085, 1);
const SMOKE = new Color(0.16, 0.15, 0.14, 1);

interface Burning {
  ref: BuildingRef;
  since: number;
  roof: Cartesian3;
  base: Cartesian3;
  flame?: Billboard;
  smokeClock: number;
  buried: boolean;
  /** Collapsed and counted in `destroyed`. */
  counted: boolean;
}

interface Smoke {
  billboard: Billboard;
  position: Cartesian3;
  rise: number;
  age: number;
  life: number;
  alive: boolean;
}

/**
 * Sets buildings on fire where the lava model's flows reach them. The
 * buildings are real OpenStreetMap footprints (globe/buildings.ts); the
 * contact test is the lava model's thickness in the building's cell. In
 * terrain mode the building itself glows, chars and (if buried) collapses; in
 * photoreal mode Google's mesh can't be recoloured, so the flames and smoke
 * carry the effect.
 */
export class BuildingFires {
  private readonly scene: Scene;
  private readonly buildings: Buildings;
  private readonly sim: () => LavaView | undefined;
  private readonly rect: { west: number; south: number; east: number; north: number };
  private readonly groundAt: (lon: number, lat: number) => number;
  private readonly up: Cartesian3;
  private readonly flames = new BillboardCollection();
  private readonly smoke = new BillboardCollection();
  private readonly smokePool: Smoke[] = [];
  private readonly burning = new Map<BuildingRef["feature"], Burning>();
  private nextSmoke = 0;
  private freeFlames: Billboard[] = [];
  private sinceCheck = 0;
  private clock = 0;
  private visible = true;
  private readonly colour = new Color();
  private readonly step = new Cartesian3();
  reached = 0;
  destroyed = 0;

  constructor(
    scene: Scene,
    buildings: Buildings,
    opts: {
      sim: () => LavaView | undefined;
      /** Lava grid bounds in degrees. */
      rect: { west: number; south: number; east: number; north: number };
      groundAt: (lon: number, lat: number) => number;
      up: Cartesian3;
    },
  ) {
    this.scene = scene;
    this.buildings = buildings;
    this.sim = opts.sim;
    this.rect = opts.rect;
    this.groundAt = opts.groundAt;
    this.up = opts.up;
    buildings.need(true);
    for (let i = 0; i < MAX_FLAMES; i++) {
      this.freeFlames.push(this.flames.add({ image: glowTexture(), position: Cartesian3.ZERO, sizeInMeters: true, show: false }));
    }
    for (let i = 0; i < MAX_SMOKE; i++) {
      const billboard = this.smoke.add({ image: ashPuffTexture(), position: Cartesian3.ZERO, sizeInMeters: true, show: false });
      this.smokePool.push({ billboard, position: new Cartesian3(), rise: 0, age: 0, life: 1, alive: false });
    }
    scene.primitives.add(this.smoke);
    scene.primitives.add(this.flames);
  }

  tick(dt: number) {
    if (dt <= 0) return;
    this.clock += dt;
    this.sinceCheck += dt;
    const sim = this.sim();
    if (sim && this.sinceCheck >= CHECK_EVERY_S) {
      this.sinceCheck = 0;
      this.findNewFires(sim);
    }

    for (const b of this.burning.values()) {
      const t = this.clock - b.since;
      const { feature } = b.ref;
      const collapsing = b.buried && t >= COLLAPSE_AT_S;
      if (collapsing && !b.counted) {
        b.counted = true;
        this.destroyed++;
        for (let k = 0; k < 4; k++) this.puff(b.base, 2.2, 0.6);
      }
      // While "Before" is showing, buildings keep their normal look.
      if (this.visible) {
        if (collapsing) {
          feature.show = false;
        } else if (t < BURN_S) {
          // Flicker between flame and ember colours, darkening as it burns out.
          const flicker = 0.5 + 0.5 * Math.sin(this.clock * 17 + b.roof.x * 0.01);
          Color.lerp(FLAME, EMBER, flicker, this.colour);
          Color.lerp(this.colour, CHARRED, Math.max(0, (t - BURN_S * 0.6) / (BURN_S * 0.4)), this.colour);
          feature.color = this.colour;
        } else {
          feature.color = CHARRED;
        }
      }
      if (b.flame) {
        const strength = t < BURN_S ? Math.min(1, t / 0.8) : Math.max(0, 1 - (t - BURN_S) / 2);
        Color.clone(FLAME, this.colour).alpha = 0.85 * strength;
        b.flame.color = this.colour;
        b.flame.scale = 0.8 + 0.35 * Math.sin(this.clock * 11 + b.roof.y * 0.01) * strength + 0.2;
        if (strength <= 0) {
          b.flame.show = false;
          this.freeFlames.push(b.flame);
          b.flame = undefined;
        }
      }
      // A column of smoke while it burns, thinning as it chars.
      if (t < BURN_S + 4) {
        b.smokeClock -= dt;
        if (b.smokeClock <= 0) {
          b.smokeClock = t < BURN_S ? 0.45 : 1.1;
          this.puff(b.roof, 1, 1);
        }
      }
    }

    for (const s of this.smokePool) {
      if (!s.alive) continue;
      s.age += dt;
      const f = s.age / s.life;
      if (f >= 1) {
        s.alive = false;
        s.billboard.show = false;
        continue;
      }
      Cartesian3.add(s.position, Cartesian3.multiplyByScalar(this.up, s.rise * dt, this.step), s.position);
      s.billboard.position = s.position;
      s.billboard.scale = 1 + 3 * f;
      Color.clone(SMOKE, this.colour).alpha = 0.7 * (1 - f) * Math.min(1, s.age / 0.4);
      s.billboard.color = this.colour;
    }
  }

  private findNewFires(sim: LavaView) {
    const { west, south, east, north } = this.rect;
    const n = sim.size;
    for (const ref of this.buildings.within(west, south, east, north)) {
      if (this.burning.has(ref.feature)) continue;
      const col = Math.floor(((ref.lon - west) / (east - west)) * n);
      const row = Math.floor(((north - ref.lat) / (north - south)) * n);
      if (col < 0 || row < 0 || col >= n || row >= n) continue;
      const lava = sim.thickness[row * n + col];
      if (lava < CONTACT_M) continue;
      const ground = this.groundAt(ref.lon, ref.lat);
      const b: Burning = {
        ref,
        since: this.clock,
        base: Cartesian3.fromDegrees(ref.lon, ref.lat, ground + 2),
        roof: Cartesian3.fromDegrees(ref.lon, ref.lat, ground + ref.heightM),
        smokeClock: Math.random() * 0.4,
        buried: lava > Math.min(BURY_M, ref.heightM * 0.4),
        counted: false,
      };
      const flame = this.freeFlames.pop();
      if (flame) {
        flame.position = Cartesian3.fromDegrees(ref.lon, ref.lat, ground + ref.heightM * 0.7);
        flame.width = flame.height = Math.max(35, ref.heightM * 3);
        flame.show = true;
        b.flame = flame;
      }
      this.burning.set(ref.feature, b);
      this.reached++;
    }
    // A buried building's lava may keep thickening after it caught fire.
    for (const b of this.burning.values()) {
      if (b.buried) continue;
      const col = Math.floor(((b.ref.lon - west) / (east - west)) * n);
      const row = Math.floor(((north - b.ref.lat) / (north - south)) * n);
      if (sim.thickness[row * n + col] > Math.min(BURY_M, b.ref.heightM * 0.4)) b.buried = true;
    }
  }

  private puff(at: Cartesian3, size: number, rise: number) {
    const s = this.smokePool[this.nextSmoke];
    this.nextSmoke = (this.nextSmoke + 1) % MAX_SMOKE;
    s.alive = true;
    s.age = 0;
    s.life = 4 + Math.random() * 2;
    s.rise = 60 * rise * (0.7 + Math.random() * 0.6);
    Cartesian3.clone(at, s.position);
    s.billboard.position = s.position;
    s.billboard.width = s.billboard.height = 90 * size * (0.8 + Math.random() * 0.5);
    s.billboard.scale = 1;
    s.billboard.show = true;
  }

  set show(value: boolean) {
    this.visible = value;
    this.flames.show = this.smoke.show = value;
    // Hiding: put buildings back to normal; showing again re-applies burns on the next tick.
    if (!value) this.buildings.restore();
  }

  destroy() {
    this.scene.primitives.remove(this.flames);
    this.scene.primitives.remove(this.smoke);
    this.buildings.need(false);
    this.buildings.restore();
  }
}
