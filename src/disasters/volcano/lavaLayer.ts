import type { Rectangle, Scene } from "cesium";
import { SOLID_TEMPERATURE } from "./lavaSim";
import type { LavaView } from "./lavaProtocol";
import { GridOverlay } from "../gridOverlay";

// Colour by temperature, from fresh (1) to cold rock. Matches the look of
// aerial lava photos: yellow-white cores, orange channels, dark red edges and
// near-black cooled crust.
const RAMP: Array<[number, [number, number, number]]> = [
  [1.0, [255, 244, 190]],
  [0.88, [255, 188, 64]],
  [0.76, [246, 108, 22]],
  [0.64, [178, 40, 12]],
  [0.53, [92, 26, 16]],
  [SOLID_TEMPERATURE, [44, 36, 33]],
  [0.0, [30, 27, 26]],
];

/** The lava model painted over the terrain: glowing where molten, dark crust where cooled. */
export class LavaLayer {
  private readonly sim: LavaView;
  private readonly overlay: GridOverlay;

  constructor(scene: Scene, sim: LavaView, rectangle: Rectangle, rng: () => number) {
    this.sim = sim;
    this.overlay = new GridOverlay(scene, sim.size, rectangle, rng);
  }

  /** Repaints the texture from the model's current state. */
  render() {
    const { thickness, temperature } = this.sim;
    this.overlay.render((i, px, o) => {
      const h = thickness[i];
      if (h < 0.05) {
        px[o + 3] = 0;
        return;
      }
      const [r, g, b] = colourFor(temperature[i]);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = Math.min(255, (h / 0.35) * 255);
    });
  }

  set show(value: boolean) {
    this.overlay.show = value;
  }

  destroy() {
    this.overlay.destroy();
  }
}

function colourFor(t: number): [number, number, number] {
  for (let k = 1; k < RAMP.length; k++) {
    const [t1, c1] = RAMP[k];
    if (t >= t1) {
      const [t0, c0] = RAMP[k - 1];
      const f = (t - t1) / (t0 - t1);
      return [c1[0] + (c0[0] - c1[0]) * f, c1[1] + (c0[1] - c1[1]) * f, c1[2] + (c0[2] - c1[2]) * f];
    }
  }
  return RAMP[RAMP.length - 1][1];
}
