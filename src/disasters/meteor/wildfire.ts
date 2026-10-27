import { BillboardCollection, Cartesian3, Color, type Billboard, type Rectangle, type Scene } from "cesium";
import { GridOverlay } from "../gridOverlay";
import { ashPuffTexture, glowTexture } from "../volcano/textures";
import { BURNED, BURNING, FireSpread, SCORCHED } from "./fireSpread";
import { lightLevel } from "../../globe/timeOfDay";

const MAX_FLAMES = 140;
const MAX_SMOKE = 260;
const FLAME = new Color(1, 0.58, 0.16, 1);
const SMOKE = new Color(0.2, 0.18, 0.17, 1);

interface Smoke {
  billboard: Billboard;
  position: Cartesian3;
  age: number;
  life: number;
  alive: boolean;
}

/**
 * The wildfire as you see it: the fire model (fireSpread.ts) painted over the
 * terrain (burning orange, charred black, scorched brown), flames dancing over
 * a sample of the burning cells, and smoke rising from the front and drifting
 * with the wind.
 */
export class Wildfire {
  readonly model: FireSpread;
  private readonly scene: Scene;
  private readonly overlay: GridOverlay;
  private readonly flames = new BillboardCollection();
  private readonly flameSlots: Billboard[] = [];
  private readonly smoke = new BillboardCollection();
  private readonly smokePool: Smoke[] = [];
  private readonly cellCentre: (i: number) => Cartesian3;
  private readonly up: Cartesian3;
  private readonly drift: Cartesian3;
  private readonly colour = new Color();
  private readonly step = new Cartesian3();
  private nextSmoke = 0;
  private sinceShuffle = 0;
  private clock = 0;

  constructor(
    scene: Scene,
    model: FireSpread,
    rectangle: Rectangle,
    rng: () => number,
    /** World position of a cell's centre, on the ground. */
    cellCentre: (i: number) => Cartesian3,
    up: Cartesian3,
    /** Wind drift for smoke, metres per second (world vector). */
    drift: Cartesian3,
  ) {
    this.scene = scene;
    this.model = model;
    this.overlay = new GridOverlay(scene, model.size, rectangle, rng);
    this.cellCentre = cellCentre;
    this.up = up;
    this.drift = drift;
    const flameM = Math.max(120, model.cellSizeM * 1.4);
    for (let i = 0; i < MAX_FLAMES; i++) {
      this.flameSlots.push(this.flames.add({ image: glowTexture(), position: Cartesian3.ZERO, sizeInMeters: true, width: flameM, height: flameM * 1.5, show: false }));
    }
    for (let i = 0; i < MAX_SMOKE; i++) {
      const billboard = this.smoke.add({ image: ashPuffTexture(), position: Cartesian3.ZERO, sizeInMeters: true, show: false });
      this.smokePool.push({ billboard, position: new Cartesian3(), age: 0, life: 1, alive: false });
    }
    scene.primitives.add(this.smoke);
    scene.primitives.add(this.flames);
  }

  /** Advances the fire `dt` seconds; `budget` (0.4–1) scales flames and smoke. */
  tick(dt: number, budget: number) {
    if (dt <= 0) return;
    this.clock += dt;
    this.model.step(dt);

    // Every half second, move the flames to a fresh sample of burning cells
    // and send up smoke from some of them.
    this.sinceShuffle += dt;
    if (this.sinceShuffle >= 0.5) {
      this.sinceShuffle = 0;
      const burning: number[] = [];
      this.model.state.forEach((s, i) => s === BURNING && burning.push(i));
      const flames = Math.min(Math.round(MAX_FLAMES * budget), burning.length);
      for (let k = 0; k < this.flameSlots.length; k++) {
        const slot = this.flameSlots[k];
        if (k >= flames) {
          slot.show = false;
          continue;
        }
        const i = burning[Math.floor(Math.random() * burning.length)];
        slot.position = Cartesian3.add(this.cellCentre(i), Cartesian3.multiplyByScalar(this.up, 40, this.step), new Cartesian3());
        slot.show = true;
      }
      const puffs = Math.min(Math.round(18 * budget), burning.length);
      for (let k = 0; k < puffs; k++) this.puff(this.cellCentre(burning[Math.floor(Math.random() * burning.length)]));
    }
    for (const [k, slot] of this.flameSlots.entries()) {
      if (!slot.show) continue;
      const flicker = 0.7 + 0.3 * Math.sin(this.clock * 13 + k * 1.7);
      Color.clone(FLAME, this.colour).alpha = 0.8 * flicker;
      slot.color = this.colour;
      slot.scale = 0.8 + 0.3 * flicker;
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
      Cartesian3.add(s.position, Cartesian3.multiplyByScalar(this.up, 70 * dt, this.step), s.position);
      Cartesian3.add(s.position, Cartesian3.multiplyByScalar(this.drift, dt, this.step), s.position);
      s.billboard.position = s.position;
      s.billboard.scale = 1 + 4 * f;
      const grey = lightLevel.ambient;
      this.colour.red = SMOKE.red * grey;
      this.colour.green = SMOKE.green * grey;
      this.colour.blue = SMOKE.blue * grey;
      this.colour.alpha = 0.65 * (1 - f) * Math.min(1, s.age / 0.6);
      s.billboard.color = this.colour;
    }
  }

  /** Repaints the burned-ground texture. */
  render() {
    const state = this.model.state;
    const t = this.clock;
    this.overlay.render((i, px, o) => {
      switch (state[i]) {
        case BURNING: {
          // Flickering orange, a little different per cell.
          const f = 0.5 + 0.5 * Math.sin(t * 9 + i * 0.37);
          px[o] = 255;
          px[o + 1] = 90 + 80 * f;
          px[o + 2] = 20;
          px[o + 3] = 225;
          break;
        }
        case BURNED:
          px[o] = 26;
          px[o + 1] = 22;
          px[o + 2] = 20;
          px[o + 3] = 215;
          break;
        case SCORCHED:
          px[o] = 70;
          px[o + 1] = 55;
          px[o + 2] = 42;
          px[o + 3] = 170;
          break;
        default:
          px[o + 3] = 0;
      }
    });
  }

  private puff(at: Cartesian3) {
    const s = this.smokePool[this.nextSmoke];
    this.nextSmoke = (this.nextSmoke + 1) % MAX_SMOKE;
    s.alive = true;
    s.age = 0;
    s.life = 6 + Math.random() * 4;
    Cartesian3.add(at, Cartesian3.multiplyByScalar(this.up, 60, this.step), s.position);
    s.billboard.position = s.position;
    const size = Math.max(250, this.model.cellSizeM * 2) * (0.7 + Math.random() * 0.6);
    s.billboard.width = s.billboard.height = size;
    s.billboard.scale = 1;
    s.billboard.show = true;
  }

  set show(value: boolean) {
    this.overlay.show = this.flames.show = this.smoke.show = value;
  }

  destroy() {
    this.overlay.destroy();
    this.scene.primitives.remove(this.flames);
    this.scene.primitives.remove(this.smoke);
  }
}
