import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  Matrix4,
  ParticleSystem,
  SphereEmitter,
  type Billboard,
  type Particle,
  type Scene,
} from "cesium";
import { ashPuffTexture, glowTexture } from "../volcano/textures";
import { lightLevel } from "../../globe/timeOfDay";

/** Where the meteor is first seen, above the impact point. */
const START_ALTITUDE_M = 90_000;

/**
 * The incoming meteor: a white-hot head with an orange halo, a short glowing
 * plasma trail, and a long smoke trail that stays in the sky after the strike.
 * It moves in a straight line from START_ALTITUDE_M down to the impact point
 * along the chosen approach bearing and angle.
 */
export class MeteorEntry {
  private readonly scene: Scene;
  private readonly heads = new BillboardCollection();
  private readonly core: Billboard;
  private readonly halo: Billboard;
  private readonly plasma: ParticleSystem;
  private readonly smoke: ParticleSystem;
  private readonly start: Cartesian3;
  private readonly end: Cartesian3;
  private readonly position = new Cartesian3();
  private readonly frame = new Matrix4();

  /**
   * @param approachDeg compass bearing the meteor comes from
   * @param angleDeg angle above the horizon
   * @param sizeM how big the glowing head looks (it's exaggerated, like a real fireball's glow)
   */
  constructor(scene: Scene, impact: Cartesian3, up: Cartesian3, east: Cartesian3, north: Cartesian3, approachDeg: number, angleDeg: number, sizeM: number) {
    this.scene = scene;
    const az = (approachDeg * Math.PI) / 180;
    const el = (Math.max(10, angleDeg) * Math.PI) / 180;
    // Back along the approach: horizontally toward where it comes from, and up.
    const toward = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, Math.sin(az), new Cartesian3()),
      Cartesian3.multiplyByScalar(north, Math.cos(az), new Cartesian3()),
      new Cartesian3(),
    );
    const horizontalM = START_ALTITUDE_M / Math.tan(el);
    this.end = Cartesian3.clone(impact);
    this.start = Cartesian3.add(
      impact,
      Cartesian3.add(
        Cartesian3.multiplyByScalar(up, START_ALTITUDE_M, new Cartesian3()),
        Cartesian3.multiplyByScalar(toward, horizontalM, new Cartesian3()),
        new Cartesian3(),
      ),
      new Cartesian3(),
    );
    Cartesian3.clone(this.start, this.position);

    this.halo = this.heads.add({ image: glowTexture(), position: this.start, sizeInMeters: true, width: sizeM * 4, height: sizeM * 4, color: new Color(1, 0.55, 0.2, 0.85) });
    this.core = this.heads.add({ image: glowTexture(), position: this.start, sizeInMeters: true, width: sizeM, height: sizeM, color: new Color(1, 0.97, 0.88, 1) });

    const trailUpdate = (p: Particle, dt: number) => {
      if (dt <= 0) return;
      // Trail puffs barely move; scrub off most of the emitter's push.
      Cartesian3.multiplyByScalar(p.velocity, Math.exp(-dt * 2), p.velocity);
    };
    this.plasma = new ParticleSystem({
      image: glowTexture(),
      modelMatrix: Matrix4.fromTranslation(this.start),
      emitter: new SphereEmitter(sizeM * 0.3),
      emissionRate: 0,
      speed: 5,
      minimumParticleLife: 0.6,
      maximumParticleLife: 1.4,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(sizeM * 1.2, sizeM * 1.2),
      maximumImageSize: new Cartesian2(sizeM * 2.2, sizeM * 2.2),
      startScale: 1,
      endScale: 0.3,
      startColor: new Color(1, 0.85, 0.5, 0.9),
      endColor: new Color(0.9, 0.3, 0.05, 0),
      updateCallback: trailUpdate,
    });
    const smokeGrey = 0.55 * lightLevel.ambient;
    this.smoke = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: Matrix4.fromTranslation(this.start),
      emitter: new SphereEmitter(sizeM * 0.4),
      emissionRate: 0,
      speed: 3,
      minimumParticleLife: 18,
      maximumParticleLife: 30,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(sizeM * 1.5, sizeM * 1.5),
      maximumImageSize: new Cartesian2(sizeM * 2.5, sizeM * 2.5),
      startScale: 0.8,
      endScale: 4,
      startColor: new Color(smokeGrey, smokeGrey * 0.95, smokeGrey * 0.9, 0.7),
      endColor: new Color(smokeGrey + 0.1, smokeGrey + 0.1, smokeGrey + 0.1, 0),
      updateCallback: trailUpdate,
    });
    for (const p of [this.smoke, this.plasma, this.heads]) scene.primitives.add(p);
  }

  /**
   * Places the meteor `progress` (0–1) of the way down. `budget` scales the
   * trail's particle counts. Once progress reaches 1 the head is gone and
   * only the smoke trail remains, drifting and fading.
   */
  set(progress: number, budget: number) {
    const arrived = progress >= 1;
    Cartesian3.lerp(this.start, this.end, Math.min(1, progress), this.position);
    this.core.position = this.halo.position = this.position;
    this.core.show = this.halo.show = !arrived && progress > 0;
    // It brightens as it plunges into thicker air.
    this.halo.scale = 0.6 + 0.8 * progress;
    const frame = Matrix4.fromTranslation(this.position, this.frame);
    this.plasma.modelMatrix = frame;
    this.smoke.modelMatrix = frame;
    const flying = !arrived && progress > 0;
    this.plasma.emissionRate = flying ? 60 * budget : 0;
    this.smoke.emissionRate = flying ? 45 * budget : 0;
  }

  set show(value: boolean) {
    this.heads.show = this.plasma.show = this.smoke.show = value;
  }

  destroy() {
    for (const p of [this.smoke, this.plasma, this.heads]) this.scene.primitives.remove(p);
  }
}
