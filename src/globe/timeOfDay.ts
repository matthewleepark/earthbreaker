import {
  Cartesian3,
  Color,
  CustomShader,
  DirectionalLight,
  DynamicAtmosphereLightingType,
  JulianDate,
  Matrix3,
  Matrix4,
  Simon1994PlanetaryPositions,
  Transforms,
  UniformType,
  type Cesium3DTileset,
  type Viewer,
} from "cesium";

export type TimeOfDay = "dawn" | "noon" | "dusk" | "night";

export const TIMES: TimeOfDay[] = ["dawn", "noon", "dusk", "night"];
export const TIME_LABELS: Record<TimeOfDay, string> = { dawn: "Dawn", noon: "Noon", dusk: "Dusk", night: "Night" };

interface Look {
  colour: Color;
  intensity: number;
  /** Sky and ground-haze brightness shift (negative darkens). */
  sky: number;
  haze: number;
  /** Tint for Google's photorealistic tiles, which ignore scene lighting. */
  tint: Cartesian3;
  /** How lit unlit effects (smoke, ash) should look, 0–1. */
  ambient: number;
}

const LOOKS: Record<TimeOfDay, Look> = {
  dawn: { colour: new Color(1, 0.86, 0.72), intensity: 2.1, sky: 0, haze: 0, tint: new Cartesian3(1, 0.88, 0.78), ambient: 0.8 },
  noon: { colour: new Color(1, 0.98, 0.95), intensity: 2.4, sky: 0, haze: 0, tint: new Cartesian3(1, 1, 1), ambient: 1 },
  dusk: { colour: new Color(1, 0.74, 0.55), intensity: 1.9, sky: 0, haze: 0, tint: new Cartesian3(1, 0.78, 0.62), ambient: 0.7 },
  night: { colour: new Color(0.55, 0.64, 0.92), intensity: 0.55, sky: -0.85, haze: -0.6, tint: new Cartesian3(0.24, 0.28, 0.42), ambient: 0.28 },
};

/** The sun this far above the horizon counts as dawn or dusk: low, warm light. */
const LOW_SUN_DEG = 4;
/** Night light: a moon-like direction, high in the south-east. */
const MOON_AZIMUTH_DEG = 150;
const MOON_ELEVATION_DEG = 38;

/** Read by effects that aren't lit by the scene (smoke, ash) to match the light. */
export const lightLevel = { ambient: 1 };

const registry = new WeakMap<Viewer, Daylight>();

/** Re-aims the light for a new place, if this viewer has a Daylight (used by camera flights). */
export function aimDaylight(viewer: Viewer, lon: number, lat: number) {
  registry.get(viewer)?.placeAt(lon, lat);
}

/**
 * Time of day for the current view: Dawn, Noon, Dusk or Night.
 *
 * Instead of moving the simulation clock (which particle systems and the
 * eruption timeline run on), the scene is lit by a directional light pointed
 * from where the real sun is at that time today, at the place being viewed,
 * computed with Cesium's own solar model. The sky and ground haze follow that
 * light, so dawn and dusk get Cesium's low-sun colours. Night uses a dim,
 * blue moon-like light and a darkened sky. Google's photorealistic tiles have
 * their lighting baked in, so they're tinted to match instead.
 */
export class Daylight {
  private readonly viewer: Viewer;
  private readonly tint: CustomShader;
  private lon = -30;
  private lat = 25;
  time: TimeOfDay = "noon";
  /** Local solar time of the current setting at the current place, e.g. "06:12". */
  localTime = "";

  constructor(viewer: Viewer, photoreal?: Cesium3DTileset) {
    this.viewer = viewer;
    registry.set(viewer, this);
    const { scene } = viewer;
    scene.globe.enableLighting = true;
    scene.globe.dynamicAtmosphereLighting = true;
    scene.globe.dynamicAtmosphereLightingFromSun = false;
    scene.atmosphere.dynamicLighting = DynamicAtmosphereLightingType.SCENE_LIGHT;
    // The drawn sun and moon follow the clock, not this light, so hide them.
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    this.tint = new CustomShader({
      uniforms: { u_tint: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) } },
      fragmentShaderText: "void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) { material.diffuse *= u_tint; }",
    });
    if (photoreal) photoreal.customShader = this.tint;
    this.apply();
  }

  set(time: TimeOfDay) {
    this.time = time;
    this.apply();
  }

  placeAt(lon: number, lat: number) {
    this.lon = lon;
    this.lat = lat;
    this.apply();
  }

  private apply() {
    const look = LOOKS[this.time];
    const site = Cartesian3.fromDegrees(this.lon, this.lat);
    const up = Cartesian3.normalize(site, new Cartesian3());
    let towardLight: Cartesian3;
    if (this.time === "night") {
      towardLight = localDirection(site, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
      this.localTime = solarTime(nightTime(this.lon), this.lon);
    } else {
      const when = this.time === "noon" ? highestSun(this.lon, up) : lowSun(this.lon, up, this.time === "dawn");
      towardLight = sunDirection(when);
      this.localTime = solarTime(when, this.lon);
    }
    const { scene } = this.viewer;
    scene.light = new DirectionalLight({
      direction: Cartesian3.negate(towardLight, new Cartesian3()),
      color: look.colour,
      intensity: look.intensity,
    });
    if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = look.sky;
    scene.atmosphere.brightnessShift = look.haze;
    this.tint.setUniform("u_tint", look.tint);
    lightLevel.ambient = look.ambient;
    scene.requestRender();
  }
}

const icrfToFixed = new Matrix3();

/** Unit vector from the Earth toward the sun at a time, in Earth-fixed coordinates. */
function sunDirection(time: JulianDate): Cartesian3 {
  const inertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time, new Cartesian3());
  const m = Transforms.computeIcrfToFixedMatrix(time, icrfToFixed) ?? Transforms.computeTemeToPseudoFixedMatrix(time, icrfToFixed);
  return Cartesian3.normalize(Matrix3.multiplyByVector(m, inertial, new Cartesian3()), new Cartesian3());
}

function elevationDeg(time: JulianDate, up: Cartesian3): number {
  return (Math.asin(Cartesian3.dot(sunDirection(time), up)) * 180) / Math.PI;
}

/** Today's local solar day at this longitude, sampled every 10 minutes. */
function samples(lon: number): JulianDate[] {
  const now = new Date();
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const localMidnight = midnightUtc - (lon / 15) * 3_600_000;
  return Array.from({ length: 145 }, (_, k) => JulianDate.fromDate(new Date(localMidnight + k * 600_000)));
}

function highestSun(lon: number, up: Cartesian3): JulianDate {
  const times = samples(lon);
  let best = times[72];
  let bestElevation = -Infinity;
  for (const t of times) {
    const e = elevationDeg(t, up);
    if (e > bestElevation) [best, bestElevation] = [t, e];
  }
  return best;
}

/**
 * When the sun crosses LOW_SUN_DEG rising (dawn) or setting (dusk). Near the
 * poles it may not cross at all today; then the time when it's closest to
 * that height, on the right side of noon, is used.
 */
function lowSun(lon: number, up: Cartesian3, rising: boolean): JulianDate {
  const times = samples(lon);
  const elevations = times.map((t) => elevationDeg(t, up));
  const noon = elevations.indexOf(Math.max(...elevations));
  const range = rising ? [0, noon] : [noon, times.length - 1];
  for (let k = range[0] + 1; k <= range[1]; k++) {
    const crossed = rising
      ? elevations[k - 1] < LOW_SUN_DEG && elevations[k] >= LOW_SUN_DEG
      : elevations[k - 1] >= LOW_SUN_DEG && elevations[k] < LOW_SUN_DEG;
    if (crossed) return times[k];
  }
  let best = range[0];
  for (let k = range[0]; k <= range[1]; k++) {
    if (Math.abs(elevations[k] - LOW_SUN_DEG) < Math.abs(elevations[best] - LOW_SUN_DEG)) best = k;
  }
  return times[best];
}

function nightTime(lon: number): JulianDate {
  return samples(lon)[144 - 6]; // 23:00 local solar time
}

/** A direction from a place toward a given compass bearing and height above the horizon. */
function localDirection(site: Cartesian3, azimuthDeg: number, elevationDegrees: number): Cartesian3 {
  const frame = Transforms.eastNorthUpToFixedFrame(site);
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDegrees * Math.PI) / 180;
  const local = new Cartesian3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  const rotation = Matrix4.getMatrix3(frame, new Matrix3());
  return Cartesian3.normalize(Matrix3.multiplyByVector(rotation, local, new Cartesian3()), new Cartesian3());
}

function solarTime(time: JulianDate, lon: number): string {
  const minutes = ((JulianDate.toDate(time).getTime() / 60_000 + lon * 4) % 1440 + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
