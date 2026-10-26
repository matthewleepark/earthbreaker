import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Color,
  ConeEmitter,
  Material,
  Math as CesiumMath,
  Matrix4,
  ParticleSystem,
  PolylineCollection,
  SphereEmitter,
  Transforms,
  type Billboard,
  type Particle,
  type Polyline,
  type Scene,
} from "cesium";
import { ashPuffTexture, glowTexture, shockRingTexture } from "./textures";

export interface PlumeOptions {
  vent: Cartesian3;
  /** Height the ash column rises to above the vent, in metres. */
  columnHeightM: number;
  /** Wind as east and north components, in (time-lapse) metres per second. */
  windEast: number;
  windNorth: number;
  intensity: number;
}

/** Continuous emission levels set by the eruption every frame (before the effects budget). */
export interface PlumeRates {
  steam: number;
  ash: number;
  ejecta: number;
  /** Vent glow, 0–1. */
  glow: number;
}

/** How long each part of the boom lasts, in simulated seconds. */
const FLASH_S = 1.6;
const FIREBALL_S = 5;
const RING_S = 4.5;

const BOLTS = 3;
const BOLT_SEGMENTS = 10;
const BOLT_LIFE_S = 0.22;

/**
 * The airborne half of the eruption: steam, the ash column, glowing ejecta,
 * ground-hugging pyroclastic surges, the blast ring, the fireball and
 * lightning. The eruption sets rates and fires events; this class only knows
 * how each effect moves and fades.
 */
export class Plume {
  private readonly scene: Scene;
  private readonly steam: ParticleSystem;
  private readonly ash: ParticleSystem;
  private readonly ejecta: ParticleSystem;
  private readonly surge: ParticleSystem;
  private readonly glows = new BillboardCollection();
  private readonly bolts = new PolylineCollection();
  private readonly ventGlow: Billboard;
  private readonly flash: Billboard;
  private readonly fireball: Billboard;
  private readonly ring: Billboard;
  private readonly boltGlow: Billboard;
  private readonly boltLines: Polyline[] = [];

  private readonly vent: Cartesian3;
  private readonly up: Cartesian3;
  private readonly east: Cartesian3;
  private readonly north: Cartesian3;
  private readonly wind: Cartesian3;
  private readonly top: number;
  private readonly ringRadius: number;
  private readonly baseSpeeds: { ash: [number, number] };

  /** Current vent glow, 0–1; tints the base of the column. */
  private glowLevel = 0;
  /** Seconds since the last boom (Infinity before the first). */
  private sinceBoom = Infinity;
  private boomStrength = 0;
  /** Remaining seconds of a surge burst and its emission rate. */
  private surgeLeft = 0;
  private surgeRate = 0;
  private boltAge = Infinity;
  /** 0–1: how lit the cloud is by the latest strike. */
  private cloudFlash = 0;

  constructor(scene: Scene, opts: PlumeOptions) {
    this.scene = scene;
    const frame = Transforms.eastNorthUpToFixedFrame(opts.vent);
    const axis = (column: number) =>
      Cartesian3.fromCartesian4(Matrix4.getColumn(frame, column, new Cartesian4()), new Cartesian3());
    const east = (this.east = axis(0));
    const north = (this.north = axis(1));
    const up = (this.up = axis(2));
    const wind = (this.wind = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, opts.windEast, new Cartesian3()),
      Cartesian3.multiplyByScalar(north, opts.windNorth, new Cartesian3()),
      new Cartesian3(),
    ));
    const vent = (this.vent = opts.vent);
    const top = (this.top = opts.columnHeightM);
    // The column reaches about 80% of its height in ~12 s of simulated time.
    const rise = top / 9;
    this.ringRadius = 3000 + opts.intensity * 1800;
    const puffM = Math.max(320, top * 0.06);

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
      // Turbulence: each puff wobbles on its own phase so the column churns.
      const phase = p.age * 1.4 + own * 40;
      const churn = rise * 0.14;
      Cartesian3.add(desired, Cartesian3.multiplyByScalar(east, Math.sin(phase) * churn, tmp), desired);
      Cartesian3.add(desired, Cartesian3.multiplyByScalar(north, Math.cos(phase * 1.3) * churn, tmp), desired);
      Cartesian3.lerp(p.velocity, desired, 1 - Math.exp(-dt * 1.3), p.velocity);

      // Colour: near-black at the vent, lighter grey as it rises, lit orange
      // from below by the vent glow. Alpha fades in quickly and out at the end
      // of life so puffs never pop.
      const grey = 0.2 + 0.45 * smoothstep(0, 0.85, f) + (own - 0.5) * 0.12;
      const warm = Math.max(0, 1 - f * 8) * this.glowLevel;
      // A lightning strike lights the cloud from inside for an instant.
      const zap = this.cloudFlash * smoothstep(0.1, 0.5, f) * (1 - smoothstep(0.8, 1.1, f));
      const alpha = 0.92 * Math.min(1, p.age / 1.0) * (1 - smoothstep(0.72, 1, p.normalizedAge));
      setColour(p, grey + 0.3 * warm + 0.45 * zap, grey + 0.1 * warm + 0.5 * zap, grey - 0.02 + 0.6 * zap, alpha);
    };

    this.baseSpeeds = { ash: [rise * 0.8, rise * 1.2] };
    this.ash = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: frame,
      emitter: new ConeEmitter(CesiumMath.toRadians(10)),
      emissionRate: 0,
      minimumSpeed: this.baseSpeeds.ash[0],
      maximumSpeed: this.baseSpeeds.ash[1],
      minimumParticleLife: 26,
      maximumParticleLife: 44,
      minimumMass: 0,
      maximumMass: 1,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(puffM * 0.7, puffM * 0.7),
      maximumImageSize: new Cartesian2(puffM * 1.4, puffM * 1.4),
      startScale: 1,
      endScale: 6.5,
      updateCallback: ashUpdate,
    });

    // Pyroclastic surges: dense clouds of hot ash that hug the ground and race
    // outward and downhill from the vent, then slow and lift.
    const surgeSpeed = this.ringRadius / 4;
    this.surge = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: frame,
      emitter: new SphereEmitter(150),
      emissionRate: 0,
      minimumSpeed: surgeSpeed * 0.5,
      maximumSpeed: surgeSpeed,
      minimumParticleLife: 8,
      maximumParticleLife: 14,
      minimumMass: 0,
      maximumMass: 1,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(500, 500),
      maximumImageSize: new Cartesian2(1100, 1100),
      startScale: 1,
      endScale: 4,
      updateCallback: (p, dt) => {
        if (dt <= 0) return;
        if (p.age === 0) spreadBatch(p, dt, tmp);
        // Keep its outward direction, drop the vertical part of the emitter's push.
        const vUp = Cartesian3.dot(p.velocity, up);
        Cartesian3.subtract(p.velocity, Cartesian3.multiplyByScalar(up, vUp, tmp), horizontal);
        const h = Cartesian3.magnitude(horizontal) || 1;
        const speed = surgeSpeed * (0.5 + 0.8 * p.mass) * Math.exp(-p.age / 3.5);
        Cartesian3.multiplyByScalar(horizontal, speed / h, desired);
        // Down the flanks at first, then the cooling cloud lifts off.
        const vertical = -0.28 * speed + 40 * p.normalizedAge;
        Cartesian3.add(desired, Cartesian3.multiplyByScalar(up, vertical, tmp), desired);
        Cartesian3.add(desired, Cartesian3.multiplyByScalar(wind, 0.2, tmp), desired);
        Cartesian3.lerp(p.velocity, desired, 1 - Math.exp(-dt * 3), p.velocity);
        const grey = 0.3 + 0.12 * p.normalizedAge + (p.mass - 0.5) * 0.08;
        const alpha = 0.88 * Math.min(1, p.age / 0.4) * (1 - smoothstep(0.6, 1, p.normalizedAge));
        setColour(p, grey + 0.04, grey + 0.01, grey - 0.02, alpha);
      },
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
      emitter: new ConeEmitter(CesiumMath.toRadians(32)),
      emissionRate: 0,
      minimumSpeed: throwSpeed * 0.5,
      maximumSpeed: throwSpeed * 1.2,
      minimumParticleLife: 3,
      maximumParticleLife: 6,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(50 + opts.intensity * 12, 50 + opts.intensity * 12),
      maximumImageSize: new Cartesian2(130 + opts.intensity * 30, 130 + opts.intensity * 30),
      startScale: 1,
      endScale: 0.5,
      startColor: new Color(1, 0.88, 0.5, 1),
      endColor: new Color(0.55, 0.1, 0.02, 0.4),
      updateCallback: (p, dt) => {
        if (dt <= 0) return;
        if (p.age === 0) spreadBatch(p, dt, tmp);
        Cartesian3.add(p.velocity, Cartesian3.multiplyByScalar(up, -gravity * dt, tmp), p.velocity);
      },
    });

    const above = (m: number) => Cartesian3.add(vent, Cartesian3.multiplyByScalar(up, m, new Cartesian3()), new Cartesian3());
    const glow = (position: Cartesian3, size: number, image = glowTexture()) =>
      this.glows.add({ image, position, sizeInMeters: true, width: size, height: size, color: new Color(1, 1, 1, 0) });
    this.ventGlow = glow(above(120), 900);
    this.fireball = glow(above(top * 0.04), top * 0.35);
    this.flash = glow(above(top * 0.08), top * 1.1);
    this.ring = glow(above(top * 0.03), 1, shockRingTexture());
    this.boltGlow = glow(above(top * 0.4), top * 0.3);

    for (let i = 0; i < BOLTS; i++) {
      // One material per bolt: a polyline destroys its material along with itself.
      const material = Material.fromType("PolylineGlow", { color: new Color(0.82, 0.88, 1, 1), glowPower: 0.25, taperPower: 1 });
      this.boltLines.push(this.bolts.add({ positions: [vent, vent], width: i === 0 ? 7 : 4, material, show: false }));
    }

    for (const p of [this.steam, this.surge, this.ash, this.ejecta, this.glows, this.bolts]) scene.primitives.add(p);
  }

  /** Continuous emission and glow, scaled by the machine's effects budget. */
  set(rates: PlumeRates, budget: number) {
    this.glowLevel = rates.glow;
    const boost = this.sinceBoom < 3 ? 1 + 1.6 * this.boomStrength * (1 - this.sinceBoom / 3) : 1;
    this.steam.emissionRate = rates.steam * budget;
    this.ash.emissionRate = rates.ash * budget * boost;
    this.ejecta.emissionRate = rates.ejecta * budget * (this.sinceBoom < 2 ? 1 + 5 * this.boomStrength : 1);
    this.surge.emissionRate = this.surgeLeft > 0 ? this.surgeRate * budget : 0;
    this.ventGlow.color = new Color(1, 0.45, 0.1, 0.85 * rates.glow);
    this.ventGlow.scale = 0.7 + rates.glow * 0.8;
  }

  /** The explosive opening blast: flash, fireball, blast ring, surge and a jet of ash. */
  boom(strength: number) {
    this.sinceBoom = 0;
    this.boomStrength = strength;
    this.surgeLeft = 1.2;
    this.surgeRate = 150 * strength;
    // The first seconds of the column shoot up much faster.
    this.ash.minimumSpeed = this.baseSpeeds.ash[0] * 2.4;
    this.ash.maximumSpeed = this.baseSpeeds.ash[1] * 2.4;
  }

  /** A collapse of part of the column, sending a smaller surge down the slopes. */
  collapse(strength: number) {
    this.surgeLeft = 0.8;
    this.surgeRate = 80 * strength;
  }

  /** A lightning strike inside the plume (volcanic lightning is real and common). */
  lightning() {
    const { up, east, north, vent, top } = this;
    const at = (f: number, spread: number) => {
      // Points sit on the plume's axis, which drifts downwind with height.
      const drift = Cartesian3.multiplyByScalar(this.wind, (0.15 + 0.85 * f) * 6 * f, new Cartesian3());
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread * top;
      const p = Cartesian3.add(vent, Cartesian3.multiplyByScalar(up, f * top, new Cartesian3()), new Cartesian3());
      Cartesian3.add(p, drift, p);
      Cartesian3.add(p, Cartesian3.multiplyByScalar(east, Math.cos(a) * r, new Cartesian3()), p);
      return Cartesian3.add(p, Cartesian3.multiplyByScalar(north, Math.sin(a) * r, new Cartesian3()), p);
    };
    const start = at(0.3 + Math.random() * 0.45, 0.12);
    for (let i = 0; i < BOLTS; i++) {
      const line = this.boltLines[i];
      // The main bolt sometimes reaches the ground near the vent; branches stay in the cloud.
      const end = i === 0 && Math.random() < 0.35 ? at(0.01, 0.18) : at(Math.max(0.05, 0.15 + Math.random() * 0.5), 0.2);
      line.positions = jagged(start, end, i === 0 ? 0.08 : 0.12);
      line.show = i === 0 || Math.random() < 0.6;
    }
    this.boltGlow.position = start;
    this.boltAge = 0;
  }

  /** Advances the timed effects by `dt` simulated seconds. */
  tick(dt: number) {
    if (dt <= 0) return;
    this.sinceBoom += dt;
    this.surgeLeft = Math.max(0, this.surgeLeft - dt);
    if (this.sinceBoom >= 3 && this.ash.minimumSpeed !== this.baseSpeeds.ash[0]) {
      this.ash.minimumSpeed = this.baseSpeeds.ash[0];
      this.ash.maximumSpeed = this.baseSpeeds.ash[1];
    }

    const s = this.sinceBoom;
    const k = Math.min(1, this.boomStrength * 1.15);
    this.flash.color = new Color(1, 0.92, 0.75, s < FLASH_S ? k * (1 - s / FLASH_S) : 0);
    this.flash.scale = 0.3 + Math.min(1, s / FLASH_S) * 1.1;
    this.fireball.color = new Color(1, 0.48, 0.1, s < FIREBALL_S ? k * Math.pow(1 - s / FIREBALL_S, 1.2) : 0);
    this.fireball.scale = 0.5 + Math.min(1, s / FIREBALL_S) * 1.6;
    if (s < RING_S) {
      // Fast at first, then slowing, like a real blast front.
      const grow = (1 - Math.exp(-s * 1.4)) / (1 - Math.exp(-1.4 * RING_S));
      const d = 2 * this.ringRadius * grow;
      this.ring.width = this.ring.height = Math.max(1, d);
      this.ring.color = new Color(1, 0.97, 0.92, 0.95 * k * Math.pow(1 - s / RING_S, 1.1));
    } else {
      this.ring.color = new Color(1, 1, 1, 0);
    }

    // Flicker: on, off for a moment, on again, then gone. The first frame after
    // a strike is always lit, so a slow frame can't swallow the whole bolt.
    const first = this.boltAge === 0;
    this.boltAge += dt;
    const lit = first || this.boltAge < 0.07 || (this.boltAge > 0.1 && this.boltAge < BOLT_LIFE_S);
    this.cloudFlash = lit ? 1 : this.cloudFlash * Math.exp(-dt * 12);
    this.bolts.show = lit;
    this.boltGlow.color = new Color(0.75, 0.82, 1, lit ? 0.7 : 0);
  }

  set show(value: boolean) {
    this.steam.show = this.ash.show = this.ejecta.show = this.surge.show = this.glows.show = value;
    if (!value) this.bolts.show = false;
  }

  destroy() {
    for (const p of [this.steam, this.surge, this.ash, this.ejecta, this.glows, this.bolts]) this.scene.primitives.remove(p);
  }
}

/** A zig-zag path from a to b, with sideways kinks of up to `rough` × its length. */
function jagged(a: Cartesian3, b: Cartesian3, rough: number): Cartesian3[] {
  const length = Cartesian3.distance(a, b);
  const points: Cartesian3[] = [];
  for (let i = 0; i <= BOLT_SEGMENTS; i++) {
    const t = i / BOLT_SEGMENTS;
    const p = Cartesian3.lerp(a, b, t, new Cartesian3());
    if (i > 0 && i < BOLT_SEGMENTS) {
      const kink = rough * length * Math.sin(Math.PI * t);
      p.x += (Math.random() * 2 - 1) * kink;
      p.y += (Math.random() * 2 - 1) * kink;
      p.z += (Math.random() * 2 - 1) * kink;
    }
    points.push(p);
  }
  return points;
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
