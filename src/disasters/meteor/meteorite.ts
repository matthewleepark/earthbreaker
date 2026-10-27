import {
  BillboardCollection,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ComponentDatatype,
  ConeEmitter,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  GeometryPipeline,
  HeadingPitchRoll,
  Material,
  MaterialAppearance,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  ParticleSystem,
  Primitive,
  PrimitiveType,
  Transforms,
  type Billboard,
  type Scene,
} from "cesium";
import { ashPuffTexture, glowTexture } from "../volcano/textures";
import { lightLevel } from "../../globe/timeOfDay";
import { rockMesh, type RockMesh } from "./rockMesh";

export interface RockPiece {
  lon: number;
  lat: number;
  /** Height of the crater floor under the piece, in metres. */
  groundM: number;
  /** Half the piece's longest width, in metres. */
  radiusM: number;
}

/**
 * The rock's surface: a dark fusion crust with grain, glowing white-orange
 * straight after the impact, then cooling until only the cracks glow, and
 * finally dark. `heat` runs from 1 (just landed) to 0 (cold).
 * The pattern is 3D value noise on the direction rebuilt from `st`, so it has
 * no seam.
 */
const ROCK_SHADER = /* glsl */ `
float eb_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float eb_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(eb_hash(i), eb_hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(eb_hash(i + vec3(0.0, 1.0, 0.0)), eb_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(eb_hash(i + vec3(0.0, 0.0, 1.0)), eb_hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(eb_hash(i + vec3(0.0, 1.0, 1.0)), eb_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// Distance to the nearest and second-nearest of a jittered lattice of points.
// Where the two are equal is the edge between two cells, which is where the
// cooling crust cracks into polygons.
float eb_cellEdge(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int k = -1; k <= 1; k++) {
        vec3 g = vec3(float(k), float(y), float(z));
        vec3 o = vec3(eb_hash(i + g), eb_hash(i + g + 19.1), eb_hash(i + g + 47.7));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
  }
  return f2 - f1;
}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  float a = materialInput.st.x * 6.2831853;
  float z = materialInput.st.y * 2.0 - 1.0;
  float s = sqrt(max(0.0, 1.0 - z * z));
  vec3 p = vec3(cos(a) * s, sin(a) * s, z);
  float grain = 0.6 * eb_noise(p * 9.0) + 0.4 * eb_noise(p * 31.0);
  // Big polygonal cracks with slightly wandering edges, and a finer network
  // in patches. Some cracks are wider (hotter) than others.
  vec3 q = p + 0.12 * vec3(eb_noise(p * 6.0), eb_noise(p * 6.0 + 5.2), eb_noise(p * 6.0 + 9.7));
  float wide = 0.05 + 0.06 * eb_noise(p * 3.0 + 2.0);
  float crack = (1.0 - smoothstep(0.0, wide, eb_cellEdge(q * 3.2))) * (0.5 + 0.5 * eb_noise(p * 2.0));
  crack = max(crack, 0.6 * (1.0 - smoothstep(0.0, 0.05, eb_cellEdge(q * 9.0))) * smoothstep(0.45, 0.65, eb_noise(p * 2.5 + 7.0)));
  vec3 rock = mix(vec3(0.07, 0.065, 0.06), vec3(0.24, 0.215, 0.19), grain);
  float h = clamp(heat, 0.0, 1.0);
  float glow = h * h * (0.25 + 0.75 * crack) + max(0.0, h - 0.8) * 3.0;
  m.diffuse = rock * (1.0 - 0.6 * h);
  m.emission = vec3(1.0, 0.36, 0.07) * glow * 1.4 + vec3(1.0, 0.85, 0.6) * max(0.0, h - 0.85) * 3.0;
  m.specular = 0.05;
  m.shininess = 8.0;
  return m;
}
`;

/**
 * The meteorite in its crater: the main mass and broken fragments as real 3D
 * rock meshes resting partly buried in the floor, with a heat glow and steam
 * rising from the main mass while it cools. All pieces are one primitive
 * (one draw call).
 */
export class Meteorite {
  private readonly scene: Scene;
  private readonly primitive: Primitive;
  private readonly material: Material;
  private readonly glows = new BillboardCollection();
  private readonly glow: Billboard;
  private readonly steam: ParticleSystem;

  constructor(scene: Scene, pieces: RockPiece[], rng: () => number) {
    this.scene = scene;
    this.material = rockMaterial();
    this.primitive = new Primitive({
      geometryInstances: pieces.map((piece, i) => {
        // The main mass sits a little deeper; fragments just rest on top.
        const sink = i === 0 ? 0.1 : 0.3;
        const centre = Cartesian3.fromDegrees(piece.lon, piece.lat, piece.groundM + piece.radiusM * sink);
        const turn = Matrix3.fromHeadingPitchRoll(
          new HeadingPitchRoll(rng() * Math.PI * 2, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5),
        );
        Matrix3.multiplyByScalar(turn, piece.radiusM, turn);
        const modelMatrix = Matrix4.multiply(
          Transforms.eastNorthUpToFixedFrame(centre),
          Matrix4.fromRotationTranslation(turn, Cartesian3.ZERO),
          new Matrix4(),
        );
        return new GeometryInstance({ geometry: rockGeometry(rockMesh(rng, i === 0 ? 3 : 2)), modelMatrix });
      }),
      appearance: new MaterialAppearance({
        material: this.material,
        materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
        closed: true,
      }),
      asynchronous: false,
      // Compression assumes texture coordinates in 0–1; the unwrapped seam goes past 1.
      compressVertices: false,
    });

    const main = pieces[0];
    const top = Cartesian3.fromDegrees(main.lon, main.lat, main.groundM + main.radiusM * 0.9);
    this.glow = this.glows.add({
      image: glowTexture(),
      position: top,
      sizeInMeters: true,
      width: main.radiusM * 4.5,
      height: main.radiusM * 4.5,
      color: new Color(1, 0.45, 0.12, 0),
    });
    const grey = 0.75 * lightLevel.ambient + 0.1;
    this.steam = new ParticleSystem({
      image: ashPuffTexture(),
      modelMatrix: Transforms.eastNorthUpToFixedFrame(top),
      emitter: new ConeEmitter(CesiumMath.toRadians(25)),
      emissionRate: 0,
      minimumSpeed: main.radiusM * 0.35,
      maximumSpeed: main.radiusM * 0.7,
      minimumParticleLife: 6,
      maximumParticleLife: 12,
      sizeInMeters: true,
      minimumImageSize: new Cartesian2(main.radiusM * 0.5, main.radiusM * 0.5),
      maximumImageSize: new Cartesian2(main.radiusM, main.radiusM),
      startScale: 1,
      endScale: 6,
      // Thin wisps, so the rock stays visible through them.
      startColor: new Color(grey, grey, grey * 0.97, 0.22),
      endColor: new Color(grey, grey, grey, 0),
    });
    for (const p of [this.primitive, this.steam, this.glows]) scene.primitives.add(p);
  }

  /** `heat` 1 = just landed, 0 = cold. `budget` scales the steam. */
  set(heat: number, budget: number) {
    this.material.uniforms.heat = heat;
    this.glow.color = new Color(1, 0.45, 0.12, 0.6 * heat ** 2);
    this.steam.emissionRate = 6 * budget * Math.min(1, heat * 2.5);
  }

  set show(value: boolean) {
    this.primitive.show = this.glows.show = this.steam.show = value;
  }

  destroy() {
    for (const p of [this.primitive, this.steam, this.glows]) this.scene.primitives.remove(p);
  }
}

/** The rock surface material; set `uniforms.heat` (0–1) to cool it. One per primitive. */
export function rockMaterial(): Material {
  return new Material({ fabric: { uniforms: { heat: 1 }, source: ROCK_SHADER }, translucent: false });
}

/** A rock mesh as Cesium geometry with flat-shaded normals, for a MaterialAppearance that uses `rockMaterial`. */
export function rockGeometry(mesh: RockMesh): Geometry {
  const count = mesh.positions.length / 3;
  const indices = new Uint16Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: mesh.positions });
  attributes.st = new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: mesh.st });
  const geometry = new Geometry({
    attributes,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(mesh.positions as unknown as number[]),
  });
  // No vertex is shared between faces, so these come out as flat face normals.
  return GeometryPipeline.computeNormal(geometry);
}
