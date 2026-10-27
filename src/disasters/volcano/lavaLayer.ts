import {
  Color,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  ClassificationType,
  Material,
  RectangleGeometry,
  type Rectangle,
  type Scene,
} from "cesium";
import { SOLID_TEMPERATURE } from "./lavaSim";
import type { LavaView } from "./lavaProtocol";
import { crustTexture } from "./textures";

/** 512 px over a 7–20 km square is 14–40 m per pixel, finer than the 55–160 m model cells. */
const TEXTURE_SIZE = 512;

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

/**
 * Paints the lava model into a texture and drapes it over the terrain with a
 * GroundPrimitive, so it follows every ridge and gully the terrain has.
 */
export class LavaLayer {
  private readonly scene: Scene;
  private readonly sim: LavaView;
  private readonly primitive: GroundPrimitive;
  private readonly material: Material;
  private readonly cells: HTMLCanvasElement;
  private readonly cellPixels: ImageData;
  private readonly crust: HTMLCanvasElement;
  // Cesium only re-uploads a canvas texture when it is handed a different
  // canvas object, so frames alternate between two.
  private readonly frames: [HTMLCanvasElement, HTMLCanvasElement];
  private frame = 0;

  constructor(scene: Scene, sim: LavaView, rectangle: Rectangle, rng: () => number) {
    this.scene = scene;
    this.sim = sim;
    this.cells = document.createElement("canvas");
    this.cells.width = this.cells.height = sim.size;
    this.cellPixels = this.cells.getContext("2d")!.createImageData(sim.size, sim.size);
    this.crust = crustTexture(TEXTURE_SIZE, rng);
    this.frames = [makeCanvas(), makeCanvas()];

    this.material = Material.fromType("Image", {
      image: this.frames[0],
      // Slightly under 1 so Cesium treats the layer as translucent and blends it.
      color: new Color(1, 1, 1, 0.995),
    });
    this.primitive = new GroundPrimitive({
      geometryInstances: new GeometryInstance({
        geometry: new RectangleGeometry({ rectangle, vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT }),
      }),
      appearance: new EllipsoidSurfaceAppearance({ aboveGround: false, flat: true, material: this.material }),
      // BOTH so the lava drapes over Google's 3D tiles as well as plain terrain.
      classificationType: ClassificationType.BOTH,
    });
    scene.primitives.add(this.primitive);
  }

  /** Repaints the texture from the model's current state. */
  render() {
    const { size, thickness, temperature } = this.sim;
    const px = this.cellPixels.data;
    for (let i = 0; i < size * size; i++) {
      const h = thickness[i];
      const o = i * 4;
      if (h < 0.05) {
        px[o + 3] = 0;
        continue;
      }
      const [r, g, b] = colourFor(temperature[i]);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = Math.min(255, (h / 0.35) * 255);
    }
    this.cells.getContext("2d")!.putImageData(this.cellPixels, 0, 0);

    this.frame ^= 1;
    const target = this.frames[this.frame];
    const ctx = target.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.cells, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    // Crust cracks only where there is lava.
    ctx.globalCompositeOperation = "source-atop";
    ctx.drawImage(this.crust, 0, 0);
    this.material.uniforms.image = target;
  }

  set show(value: boolean) {
    this.primitive.show = value;
  }

  destroy() {
    this.scene.primitives.remove(this.primitive);
  }
}

function makeCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = TEXTURE_SIZE;
  return c;
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
