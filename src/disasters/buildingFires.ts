import { BillboardCollection, Cartesian3, Color, type Billboard, type Scene } from "cesium";
import type { BuildingRef, Buildings } from "../globe/buildings";
import { ashPuffTexture, glowTexture } from "./volcano/textures";

/**
 * What a disaster is doing to a building right now:
 * "burn" sets it on fire; "bury" sets it on fire and collapses it once it has
 * burned; "obliterate" removes it at once (inside an impact crater).
 */
export type Hazard = "none" | "burn" | "bury" | "obliterate";

/** Burning, then charred; buried buildings collapse at the end. */
const BURN_S = 7;
const COLLAPSE_AT_S = 8;
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
 * Damages real OpenStreetMap buildings (globe/buildings.ts) where a disaster
 * reaches them. Each disaster supplies a `hazard` test (lava thickness in the
 * building's cell, a crater's radius, a wildfire grid...) and this class does
 * the rest. In terrain mode the building itself glows, chars and (if buried)
 * collapses; in photoreal mode Google's mesh can't be recoloured, so the
 * flames and smoke carry the effect.
 */
export class BuildingFires {
  private readonly scene: Scene;
  private readonly buildings: Buildings;
  private readonly hazard: (ref: BuildingRef) => Hazard;
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
      hazard: (ref: BuildingRef) => Hazard;
      /** The area the disaster can reach, in degrees. */
      rect: { west: number; south: number; east: number; north: number };
      groundAt: (lon: number, lat: number) => number;
      up: Cartesian3;
    },
  ) {
    this.scene = scene;
    this.buildings = buildings;
    this.hazard = opts.hazard;
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
    if (this.sinceCheck >= CHECK_EVERY_S) {
      this.sinceCheck = 0;
      this.findNewFires();
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

  private findNewFires() {
    const { west, south, east, north } = this.rect;
    for (const ref of this.buildings.within(west, south, east, north)) {
      const existing = this.burning.get(ref.feature);
      if (existing) {
        // A burning building can still end up buried (lava keeps thickening).
        if (!existing.buried && this.hazard(ref) === "bury") existing.buried = true;
        continue;
      }
      const hazard = this.hazard(ref);
      if (hazard === "none") continue;
      const ground = this.groundAt(ref.lon, ref.lat);
      const base = Cartesian3.fromDegrees(ref.lon, ref.lat, ground + 2);
      if (hazard === "obliterate") {
        // Gone at once: no fire, just a burst of dust where it stood.
        this.burning.set(ref.feature, {
          ref, since: this.clock - COLLAPSE_AT_S, base, roof: base, smokeClock: Infinity, buried: true, counted: false,
        });
        this.reached++;
        continue;
      }
      const b: Burning = {
        ref,
        since: this.clock,
        base,
        roof: Cartesian3.fromDegrees(ref.lon, ref.lat, ground + ref.heightM),
        smokeClock: Math.random() * 0.4,
        buried: hazard === "bury",
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
