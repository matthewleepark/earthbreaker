import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Color,
  ConeEmitter,
  Math as CesiumMath,
  Matrix4,
  ParticleSystem,
  Transforms,
  type Billboard,
  type Particle,
  type Scene,
} from "cesium";
import { ashPuffTexture, glowTexture } from "./textures";

export interface PlumeOptions {
  vent: Cartesian3;
  /** Height the ash column rises to above the vent, in metres. */
  columnHeightM: number;
  /** Wind as east and north components, in (time-lapse) metres per second. */
  windEast: number;
  windNorth: number;
  intensity: number;
}

/**
 * The airborne half of the eruption: steam, the ash column and glowing ejecta,
 * plus the vent glow and the opening flash. Emission rates are set from the
 * eruption's phase every frame; this class only knows how particles move.
 */
export class Plume {
  private readonly scene: Scene;
  private readonly steam: ParticleSystem;
  private readonly ash: ParticleSystem;
  private readonly ejecta: ParticleSystem;
  private readonly glows = new BillboardCollection();
  private readonly ventGlow: Billboard;
  private readonly flash: Billboard;
  /** Current vent glow, 0–1; tints the base of the column. */
  private glowLevel = 0;

  constructor(scene: Scene, opts: PlumeOptions) {
    this.scene = scene;
    const frame = Transforms.eastNorthUpToFixedFrame(opts.vent);
    const axis = (column: number) =>
      Cartesian3.fromCartesian4(Matrix4.getColumn(frame, column, new Cartesian4()), new Cartesian3());
    const east = axis(0);
    const north = axis(1);
    const up = axis(2);
    const wind = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, opts.windEast, new Cartesian3()),
      Cartesian3.multiplyByScalar(north, opts.windNorth, new Cartesian3()),
      new Cartesian3(),
    );
    const vent = opts.vent;
    const top = opts.columnHeightM;
    // The column reaches about 80% of its height in ~12 s of simulated time.
    const rise = top / 9;
    const puffM = Math.max(250, top * 0.045);

    // Scratch vectors reused by every particle callback (no allocations per frame).
    const rel = new Cartesian3();
    const horizontal = new Cartesian3();
    const desired = new Cartesian3();
    const tmp = new Cartesian3();

    // Each particle's `mass` is a random 0–1 that Cesium picks at birth; it is
    // used as that puff's personality (how buoyant, how light or dark).
    const ashUpdate = (p: Particle, dt: number) => {
      if (dt <= 0) return;
      if (p.age === 0) spreadBatch(p, dt, tmp);
      const own = p.mass;
      Cartesian3.subtract(p.position, vent, rel);
      const height = Cartesian3.dot(rel, up);
      Cartesian3.subtract(rel, Cartesian3.multiplyByScalar(up, height, tmp), horizontal);
      const r = Cartesian3.magnitude(horizontal);
      const f = height / top;

      // Buoyant rise that slows towards the column top, sinking slightly past it.
      const lift = rise * (0.65 + 0.7 * own);
      const upSpeed = f < 1 ? lift * Math.pow(1 - f, 0.6) : -rise * 0.04 * (f - 1);
      Cartesian3.multiplyByScalar(up, upSpeed, desired);
      // Wind bends the column more the higher the ash gets.
      Cartesian3.add(desired, Cartesian3.multiplyByScalar(wind, 0.15 + 0.85 * Math.min(f, 1.2), tmp), desired);
      if (r > 1) {
        // The column widens as it rises (it pulls in surrounding air), and
        // near the top it spreads sideways into an umbrella cloud.
        const outward = Math.max(0, upSpeed) * (0.1 + 0.12 * own) + rise * 0.55 * smoothstep(0.65, 1.0, f);
        Cartesian3.add(desired, Cartesian3.multiplyByScalar(horizontal, outward / r, tmp), desired);
      }
      Cartesian3.lerp(p.velocity, desired, 1 - Math.exp(-dt * 1.3), p.velocity);

      // Colour: dark brown-grey near the vent, lighter and greyer as it rises,
      // lit warm from below by the vent glow. Alpha fades in quickly and out at
      // the end of life so puffs never pop.
      const grey = 0.27 + 0.4 * smoothstep(0, 0.85, f) + (own - 0.5) * 0.1;
      const warm = Math.max(0, 1 - f * 10) * this.glowLevel;
      const alpha = 0.9 * Math.min(1, p.age / 1.2) * (1 - smoothstep(0.72, 1, p.normalizedAge));
      setColour(p, grey + 0.22 * warm, grey + 0.06 * warm, grey - 0.02, alpha);
    };

    this.ash = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: frame,
      emitter: new ConeEmitter(CesiumMath.toRadians(10)),
      emissionRate: 0,
      minimumSpeed: rise * 0.8,
      maximumSpeed: rise * 1.2,
      minimumParticleLife: 32,
      maximumParticleLife: 55,
      minimumMass: 0,
      maximumMass: 1,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(puffM * 0.7, puffM * 0.7),
      maximumImageSize: new Cartesian2(puffM * 1.4, puffM * 1.4),
      startScale: 1,
      endScale: 6,
      // Colour is set per particle in ashUpdate.
      updateCallback: ashUpdate,
    });

    const steamRise = Math.max(25, top / 120);
    this.steam = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: frame,
      emitter: new ConeEmitter(CesiumMath.toRadians(18)),
      emissionRate: 0,
      minimumSpeed: steamRise,
      maximumSpeed: steamRise * 1.8,
      minimumParticleLife: 9,
      maximumParticleLife: 15,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(120, 120),
      maximumImageSize: new Cartesian2(260, 260),
      startScale: 1,
      endScale: 4,
      startColor: new Color(0.95, 0.95, 0.95, 0.5),
      endColor: new Color(1, 1, 1, 0),
      updateCallback: (p, dt) => {
        if (dt <= 0) return;
        if (p.age === 0) spreadBatch(p, dt, tmp);
        Cartesian3.add(Cartesian3.multiplyByScalar(up, steamRise, desired), Cartesian3.multiplyByScalar(wind, 0.3, tmp), desired);
        Cartesian3.lerp(p.velocity, desired, 1 - Math.exp(-dt * 0.6), p.velocity);
      },
    });

    // Ballistic ejecta, time-lapsed: thrown up to about 15% of the column height
    // and back down in ~5 s. For a flight time t and apex H: g = 8H/t², v = g·t/2.
    const apex = top * 0.15;
    const flight = 5;
    const gravity = (8 * apex) / (flight * flight);
    const throwSpeed = (gravity * flight) / 2;
    this.ejecta = new ParticleSystem({
      image: glowTexture(),
      modelMatrix: frame,
      emitter: new ConeEmitter(CesiumMath.toRadians(28)),
      emissionRate: 0,
      minimumSpeed: throwSpeed * 0.5,
      maximumSpeed: throwSpeed * 1.1,
      minimumParticleLife: 3,
      maximumParticleLife: 6,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(40 + opts.intensity * 10, 40 + opts.intensity * 10),
      maximumImageSize: new Cartesian2(110 + opts.intensity * 25, 110 + opts.intensity * 25),
      startScale: 1,
      endScale: 0.5,
      startColor: new Color(1, 0.85, 0.45, 1),
      endColor: new Color(0.5, 0.08, 0.02, 0.4),
      updateCallback: (p, dt) => {
        if (dt <= 0) return;
        if (p.age === 0) spreadBatch(p, dt, tmp);
        Cartesian3.add(p.velocity, Cartesian3.multiplyByScalar(up, -gravity * dt, tmp), p.velocity);
      },
    });

    const glowAt = Cartesian3.add(vent, Cartesian3.multiplyByScalar(up, 120, new Cartesian3()), new Cartesian3());
    this.ventGlow = this.glows.add({
      image: glowTexture(),
      position: glowAt,
      sizeInMeters: true,
      width: 900,
      height: 900,
      color: new Color(1, 0.45, 0.1, 0),
    });
    this.flash = this.glows.add({
      image: glowTexture(),
      position: Cartesian3.add(vent, Cartesian3.multiplyByScalar(up, top * 0.08, new Cartesian3()), new Cartesian3()),
      sizeInMeters: true,
      width: top * 0.9,
      height: top * 0.9,
      color: new Color(1, 0.85, 0.6, 0),
    });

    scene.primitives.add(this.steam);
    scene.primitives.add(this.ash);
    scene.primitives.add(this.ejecta);
    scene.primitives.add(this.glows);
  }

  /** Emission rates in particles per second, glow strength 0–1 and flash strength 0–1. */
  set(rates: { steam: number; ash: number; ejecta: number; glow: number; flash: number }) {
    this.glowLevel = rates.glow;
    this.steam.emissionRate = rates.steam;
    this.ash.emissionRate = rates.ash;
    this.ejecta.emissionRate = rates.ejecta;
    this.ventGlow.color = new Color(1, 0.45, 0.1, 0.85 * rates.glow);
    this.ventGlow.scale = 0.7 + rates.glow * 0.6;
    this.flash.color = new Color(1, 0.85, 0.6, 0.9 * rates.flash);
    this.flash.scale = 0.4 + (1 - rates.flash) * 0.8;
  }

  set show(value: boolean) {
    this.steam.show = this.ash.show = this.ejecta.show = this.glows.show = value;
  }

  destroy() {
    for (const p of [this.steam, this.ash, this.ejecta, this.glows]) this.scene.primitives.remove(p);
  }
}

/**
 * Cesium emits a whole frame's worth of particles at the same instant and
 * place, which shows up as clumps on slow frames. On a particle's first update,
 * pull it back along its path by a random part of the frame.
 */
function spreadBatch(p: Particle, dt: number, scratch: Cartesian3) {
  Cartesian3.multiplyByScalar(p.velocity, -Math.random() * dt, scratch);
  Cartesian3.add(p.position, scratch, p.position);
}

/** Pins a particle's colour regardless of age (Cesium blends start→end colour). */
function setColour(p: Particle, r: number, g: number, b: number, a: number) {
  for (const c of [p.startColor, p.endColor]) {
    c.red = r;
    c.green = g;
    c.blue = b;
    c.alpha = a;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
