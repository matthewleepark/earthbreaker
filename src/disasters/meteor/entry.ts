import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix3,
  Matrix4,
  ParticleSystem,
  PolylineCollection,
  Primitive,
  Quaternion,
  SphereEmitter,
  type Billboard,
  type Particle,
  type Polyline,
  type Scene,
} from "cesium";
import { ashPuffTexture, glowTexture } from "../volcano/textures";
import { lightLevel } from "../../globe/timeOfDay";
import type { CameraShot } from "../types";
import { rockMesh } from "./rockMesh";
import { rockGeometry, rockMaterial } from "./meteorite";

/** Where the meteor is first seen, above the impact point (fireballs light up around 80–100 km). */
const START_ALTITUDE_M = 90_000;
/** The glowing ionised trail is drawn as this many segments, fading toward the tail. */
const TRAIL_SEGMENTS = 14;
const TRAIL_MAX_M = 30_000;
/** Seconds the trail keeps glowing after the strike, to about a third. */
const TRAIL_FADE_S = 2.5;
/**
 * The fly-by camera rides with the meteor until this far down (about 22 km
 * up on a 90 km fall), then brakes to a stop over BRAKE of the path, and the
 * meteor passes it.
 */
const RIDE_UNTIL = 0.75;
const BRAKE = 0.08;

export interface EntryOptions {
  impact: Cartesian3;
  up: Cartesian3;
  east: Cartesian3;
  north: Cartesian3;
  /** Compass bearing the meteor comes from. */
  approachDeg: number;
  /** Angle above the horizon. */
  angleDeg: number;
  diameterM: number;
  /** Where the pieces that break off come down (the small craters). */
  fragmentTargets: Cartesian3[];
  rng: () => number;
}

interface Fragment {
  target: Cartesian3;
  glow: Billboard;
  trail: Polyline;
}

/**
 * The incoming meteor, from first light 90 km up to the ground:
 * - the rock itself, tumbling and white-hot as its surface ablates;
 * - a layered fireball around it: a blue-white core and a wide red-orange
 *   glow, flickering;
 * - a long ionised trail fading from yellow to red, which keeps glowing for
 *   a moment after the strike;
 * - sparks of molten rock shed into the wake, and a dusty smoke train that
 *   hangs in the sky afterwards;
 * - a flare part-way down where a few pieces break off and fall on their own
 *   paths to the small craters around the main one.
 * It also supplies the chase camera that follows it down.
 */
export class MeteorEntry {
  /** Length of the visible flight in metres. */
  readonly pathM: number;
  private readonly scene: Scene;
  private readonly start: Cartesian3;
  private readonly end: Cartesian3;
  /** Unit vector from the impact back toward where the meteor came from. */
  private readonly back: Cartesian3;
  private readonly side: Cartesian3;
  private readonly up: Cartesian3;
  private readonly radiusM: number;
  private readonly rock: Primitive;
  private readonly rockMat: Material;
  private readonly spinAxis: Cartesian3;
  private readonly spinRate: number;
  private readonly heads = new BillboardCollection();
  private readonly core: Billboard;
  private readonly halo: Billboard;
  private readonly trails = new PolylineCollection();
  private readonly trail: Polyline[] = [];
  private readonly trailMats: Material[] = [];
  private readonly plasma: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly smoke: ParticleSystem;
  private readonly fragments: Fragment[] = [];
  private readonly splitAt: number;
  private readonly sizes: { core: number; halo: number };
  private readonly position = new Cartesian3();
  private readonly frame = new Matrix4();
  private readonly scratch = new Cartesian3();
  private last = 0;
  private landedAt?: number;
  private visible = true;
  /** How brightly the fireball lights the ground right now, 0–1. */
  light = 0;

  constructor(scene: Scene, opts: EntryOptions) {
    this.scene = scene;
    const { up, east, north, rng } = opts;
    this.up = up;
    const az = (opts.approachDeg * Math.PI) / 180;
    const el = (Math.max(10, opts.angleDeg) * Math.PI) / 180;
    const toward = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, Math.sin(az), new Cartesian3()),
      Cartesian3.multiplyByScalar(north, Math.cos(az), new Cartesian3()),
      new Cartesian3(),
    );
    this.end = Cartesian3.clone(opts.impact);
    this.start = Cartesian3.add(
      opts.impact,
      Cartesian3.add(
        Cartesian3.multiplyByScalar(up, START_ALTITUDE_M, new Cartesian3()),
        Cartesian3.multiplyByScalar(toward, START_ALTITUDE_M / Math.tan(el), new Cartesian3()),
        new Cartesian3(),
      ),
      new Cartesian3(),
    );
    this.pathM = Cartesian3.distance(this.start, this.end);
    this.back = Cartesian3.normalize(Cartesian3.subtract(this.start, this.end, new Cartesian3()), new Cartesian3());
    // Square to the path and level; for a vertical fall, east will do.
    const side = Cartesian3.cross(this.back, up, new Cartesian3());
    this.side = Cartesian3.magnitude(side) < 1e-3 ? Cartesian3.clone(east) : Cartesian3.normalize(side, side);
    Cartesian3.clone(this.start, this.position);

    const d = opts.diameterM;
    this.radiusM = d / 2;
    this.sizes = { core: Math.max(d * 1.8, 150), halo: Math.max(d * 7, 700) };
    this.splitAt = 0.58 + rng() * 0.14;
    this.spinAxis = Cartesian3.normalize(new Cartesian3(rng() - 0.5, rng() - 0.5, rng() - 0.5), new Cartesian3());
    this.spinRate = 0.6 + rng() * 1.4;

    this.rockMat = rockMaterial();
    this.rock = new Primitive({
      geometryInstances: new GeometryInstance({ geometry: rockGeometry(rockMesh(rng, 3)) }),
      appearance: new MaterialAppearance({ material: this.rockMat, materialSupport: MaterialAppearance.MaterialSupport.TEXTURED, closed: true }),
      modelMatrix: Matrix4.fromTranslation(this.start),
      asynchronous: false,
      compressVertices: false,
    });

    this.halo = this.heads.add({
      image: glowTexture(), position: this.start, sizeInMeters: true,
      width: this.sizes.halo, height: this.sizes.halo, color: new Color(1, 0.42, 0.15, 0.4),
    });
    this.core = this.heads.add({
      image: glowTexture(), position: this.start, sizeInMeters: true,
      width: this.sizes.core, height: this.sizes.core, color: new Color(0.85, 0.95, 1, 1),
    });

    // The ionised trail, hottest (yellow-white, widest) at the head.
    for (let k = 0; k < TRAIL_SEGMENTS; k++) {
      const t = k / (TRAIL_SEGMENTS - 1);
      const mat = Material.fromType("PolylineGlow", {
        color: new Color(1, 0.88 - 0.55 * t, 0.55 - 0.45 * t, 0.85 * (1 - t) ** 1.6),
        glowPower: 0.28 - 0.12 * t,
        taperPower: 1,
      });
      this.trailMats.push(mat);
      this.trail.push(this.trails.add({ positions: [this.start, this.start], width: 16 - 12 * t, material: mat, show: false }));
    }

    // Pieces that break off part-way down, each with a small glow and trail.
    for (const target of opts.fragmentTargets) {
      this.fragments.push({
        target,
        glow: this.heads.add({
          image: glowTexture(), position: this.start, sizeInMeters: true, show: false,
          width: this.sizes.core * 0.5, height: this.sizes.core * 0.5, color: new Color(1, 0.8, 0.5, 1),
        }),
        trail: this.trails.add({
          positions: [this.start, this.start], width: 5, show: false,
          material: Material.fromType("PolylineGlow", { color: new Color(1, 0.6, 0.25, 0.7), glowPower: 0.2, taperPower: 1 }),
        }),
      });
    }

    const drag = (rate: number) => (p: Particle, dt: number) => {
      if (dt > 0) Cartesian3.multiplyByScalar(p.velocity, Math.exp(-dt * rate), p.velocity);
    };
    this.plasma = new ParticleSystem({
      image: glowTexture(),
      modelMatrix: this.frame,
      emitter: new SphereEmitter(this.sizes.core * 0.3),
      emissionRate: 0,
      speed: 5,
      minimumParticleLife: 0.5,
      maximumParticleLife: 1.2,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(this.sizes.core, this.sizes.core),
      maximumImageSize: new Cartesian2(this.sizes.core * 1.8, this.sizes.core * 1.8),
      startScale: 1,
      endScale: 0.3,
      startColor: new Color(1, 0.85, 0.5, 0.85),
      endColor: new Color(0.9, 0.25, 0.05, 0),
      updateCallback: drag(2),
    });
    const spark = Math.max(15, d * 0.2);
    this.sparks = new ParticleSystem({
      image: glowTexture(),
      modelMatrix: this.frame,
      emitter: new SphereEmitter(this.radiusM),
      emissionRate: 0,
      minimumSpeed: d * 0.3,
      maximumSpeed: d * 1.6,
      minimumParticleLife: 0.3,
      maximumParticleLife: 1.0,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(spark * 0.6, spark * 0.6),
      maximumImageSize: new Cartesian2(spark * 1.6, spark * 1.6),
      startScale: 1,
      endScale: 0.2,
      startColor: new Color(1, 0.95, 0.8, 1),
      endColor: new Color(1, 0.3, 0.05, 0),
      updateCallback: drag(1.5),
    });
    // Dust and smoke from the ablating rock: dark grey, thin at first, then
    // spreading into a train that hangs in the sky.
    const grey = 0.5 * lightLevel.ambient;
    const puff = Math.max(d * 3, 300);
    this.smoke = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: this.frame,
      emitter: new SphereEmitter(puff * 0.3),
      emissionRate: 0,
      speed: 3,
      minimumParticleLife: 18,
      maximumParticleLife: 30,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(puff * 1.5, puff * 1.5),
      maximumImageSize: new Cartesian2(puff * 2.5, puff * 2.5),
      startScale: 0.3,
      endScale: 4,
      startColor: new Color(grey, grey * 0.95, grey * 0.9, 0.45),
      endColor: new Color(grey + 0.1, grey + 0.1, grey + 0.1, 0),
      updateCallback: (p, dt) => {
        if (dt <= 0) return;
        Cartesian3.multiplyByScalar(p.velocity, Math.exp(-dt * 2), p.velocity);
        // Fades in behind the meteor instead of ballooning around its head.
        const alpha = 0.45 * Math.min(1, p.age / 1.5) * (1 - p.normalizedAge);
        p.startColor.alpha = p.endColor.alpha = alpha;
      },
    });
    for (const p of [this.smoke, this.rock, this.plasma, this.sparks, this.trails, this.heads]) scene.primitives.add(p);
  }

  /**
   * Places the meteor `progress` (0–1) of the way down at simulation time
   * `time` (seconds). `budget` scales the particle counts. From progress 1
   * the head is gone and the trail fades, leaving the smoke train.
   */
  set(progress: number, time: number, budget: number) {
    const p = Math.max(0, Math.min(1, progress));
    const flying = progress > 0 && progress < 1;
    if (progress >= 1 && this.landedAt === undefined) this.landedAt = time;
    Cartesian3.lerp(this.start, this.end, p, this.position);
    Matrix4.fromTranslation(this.position, this.frame);
    this.plasma.modelMatrix = this.frame;
    this.sparks.modelMatrix = this.frame;
    this.smoke.modelMatrix = this.frame;

    // Brighter as it plunges into thicker air, flickering as the surface
    // spalls, with a flare when the pieces break away.
    const flare = 1.4 * Math.exp(-(((p - this.splitAt) / 0.025) ** 2));
    const flicker = 1 + 0.1 * Math.sin(time * 37) + 0.07 * Math.sin(time * 83 + 1.3);
    const bright = (0.55 + 0.7 * p ** 1.5 + flare) * flicker;
    this.light = flying ? Math.min(1, 0.15 + 0.6 * p ** 2 + 0.4 * flare) : 0;

    const spin = Quaternion.fromAxisAngle(this.spinAxis, time * this.spinRate);
    const turn = Matrix3.fromQuaternion(spin);
    Matrix3.multiplyByScalar(turn, this.radiusM, turn);
    this.rock.modelMatrix = Matrix4.fromRotationTranslation(turn, this.position);
    this.rock.show = flying && this.visible;
    // Not fully white-hot, so the glowing cracks and the darker crust read.
    this.rockMat.uniforms.heat = 0.82;

    for (const b of [this.core, this.halo]) b.show = flying;
    this.core.position = this.halo.position = this.position;
    this.core.scale = Math.min(2.2, bright);
    this.halo.scale = 0.7 + 0.5 * bright;

    // The trail stays where it was drawn after the strike, fading out.
    const fade = this.landedAt === undefined ? 1 : Math.exp(-(time - this.landedAt) / TRAIL_FADE_S);
    const length = Math.min(p * this.pathM, TRAIL_MAX_M);
    for (let k = 0; k < TRAIL_SEGMENTS; k++) {
      const line = this.trail[k];
      line.show = progress > 0 && fade > 0.02;
      if (!line.show) continue;
      const t = k / (TRAIL_SEGMENTS - 1);
      if (this.landedAt === undefined || this.last < 1) {
        const a = Cartesian3.add(this.position, Cartesian3.multiplyByScalar(this.back, (length * k) / TRAIL_SEGMENTS, this.scratch), new Cartesian3());
        const b = Cartesian3.add(this.position, Cartesian3.multiplyByScalar(this.back, (length * (k + 1)) / TRAIL_SEGMENTS, this.scratch), new Cartesian3());
        line.positions = [a, b];
      }
      this.trailMats[k].uniforms.color.alpha = 0.85 * (1 - t) ** 1.6 * fade * Math.min(1, 0.8 + 0.2 * bright);
    }

    // The broken-off pieces: each a smaller fireball on its own line down.
    const splitPoint = Cartesian3.lerp(this.start, this.end, this.splitAt, new Cartesian3());
    const f = (p - this.splitAt) / (1 - this.splitAt);
    for (const frag of this.fragments) {
      const on = flying && f > 0;
      frag.glow.show = frag.trail.show = on;
      if (!on) continue;
      const at = Cartesian3.lerp(splitPoint, frag.target, f, new Cartesian3());
      frag.glow.position = at;
      frag.glow.scale = 0.8 + 0.3 * flicker;
      frag.trail.positions = [at, Cartesian3.lerp(splitPoint, frag.target, Math.max(0, f - 0.15), new Cartesian3())];
    }

    this.plasma.emissionRate = flying ? 60 * budget : 0;
    this.sparks.emissionRate = flying ? (90 + 500 * flare) * budget : 0;
    this.smoke.emissionRate = flying ? 45 * budget : 0;
    this.last = progress;
  }

  /**
   * The fly-by camera. It rides down just ahead of the meteor, off to one
   * side and a little below its path, looking back up at it against the sky.
   * Part-way down it slows and turns toward the impact point, so the meteor
   * streaks past and on to the ground, and the strike is watched from a safe
   * height. Before the meteor appears it waits at the top of the path.
   */
  shot(progress: number): CameraShot {
    const p = Math.max(0, progress);
    const ride = p < RIDE_UNTIL ? p : RIDE_UNTIL + BRAKE / 2 * (1 - (1 - Math.min(1, (p - RIDE_UNTIL) / BRAKE)) ** 2);
    const d = this.radiusM * 2;
    const at = Cartesian3.lerp(this.start, this.end, ride, new Cartesian3());
    Cartesian3.add(at, Cartesian3.multiplyByScalar(this.back, -Math.max(2500, d * 16), this.scratch), at);
    Cartesian3.add(at, Cartesian3.multiplyByScalar(this.side, Math.max(900, d * 6), this.scratch), at);
    Cartesian3.add(at, Cartesian3.multiplyByScalar(this.up, -Math.max(300, d * 2), this.scratch), at);
    const head = Cartesian3.lerp(this.start, this.end, Math.min(1, p), new Cartesian3());
    // Turn to the impact point just before the meteor passes, rather than whip round after it.
    const t = Math.min(1, Math.max(0, (p - (RIDE_UNTIL - 0.05)) / 0.09));
    const target = Cartesian3.lerp(head, this.end, t * t * (3 - 2 * t), new Cartesian3());
    return { position: at, target };
  }

  set show(value: boolean) {
    this.heads.show = this.trails.show = this.plasma.show = this.sparks.show = this.smoke.show = value;
    this.visible = value;
    this.rock.show = value && this.last > 0 && this.last < 1;
  }

  destroy() {
    for (const p of [this.smoke, this.rock, this.plasma, this.sparks, this.trails, this.heads]) this.scene.primitives.remove(p);
  }
}
