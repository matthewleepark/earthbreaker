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
import { crustTexture } from "./volcano/textures";

/** 512 px over a 7–60 km square is 14–120 m per pixel. */
const TEXTURE_SIZE = 512;

/** Sets the RGBA bytes of one grid cell at px[o..o+3]. */
export type CellPainter = (cell: number, px: Uint8ClampedArray, o: number) => void;

/**
 * A square grid of a disaster model (lava, burned ground) painted into a
 * texture and draped over the terrain with a GroundPrimitive, so it follows
 * every ridge and gully. Row 0 of the grid is the north edge.
 */
export class GridOverlay {
  private readonly scene: Scene;
  private readonly size: number;
  private readonly primitive: GroundPrimitive;
  private readonly material: Material;
  private readonly cells: HTMLCanvasElement;
  private readonly cellPixels: ImageData;
  private readonly crust: HTMLCanvasElement | undefined;
  // Cesium only re-uploads a canvas texture when it is handed a different
  // canvas object, so frames alternate between two.
  private readonly frames: [HTMLCanvasElement, HTMLCanvasElement];
  private frame = 0;

  /** `crust` overlays lava-style cracks and speckles on whatever is painted. */
  constructor(scene: Scene, size: number, rectangle: Rectangle, rng: () => number, crust = true) {
    this.scene = scene;
    this.size = size;
    this.cells = document.createElement("canvas");
    this.cells.width = this.cells.height = size;
    this.cellPixels = this.cells.getContext("2d")!.createImageData(size, size);
    this.crust = crust ? crustTexture(TEXTURE_SIZE, rng) : undefined;
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
      // BOTH so it drapes over Google's 3D tiles as well as plain terrain.
      classificationType: ClassificationType.BOTH,
    });
    scene.primitives.add(this.primitive);
  }

  /** Repaints the texture, asking `paint` for each cell's colour. */
  render(paint: CellPainter) {
    const px = this.cellPixels.data;
    for (let i = 0; i < this.size * this.size; i++) paint(i, px, i * 4);
    this.cells.getContext("2d")!.putImageData(this.cellPixels, 0, 0);

    this.frame ^= 1;
    const target = this.frames[this.frame];
    const ctx = target.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.cells, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    if (this.crust) {
      // Cracks and speckles only where something is painted.
      ctx.globalCompositeOperation = "source-atop";
      ctx.drawImage(this.crust, 0, 0);
    }
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
