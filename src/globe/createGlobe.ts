import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  LabelStyle,
  sampleTerrainMostDetailed,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  BoundingSphere,
  Ion,
  ImageryLayer,
  JulianDate,
  IonWorldImageryStyle,
  createWorldImageryAsync,
  OpenStreetMapImageryProvider,
  Math as CesiumMath,
  Matrix4,
  Viewer,
  createGooglePhotorealistic3DTileset,
  type Cesium3DTileset,
  type TerrainProvider,
} from "cesium";
import type { CameraView } from "../data/places";
import { PerformanceMonitor } from "./performance";

export type ProviderMode = "ion" | "fallback";

/**
 * "photoreal": Google Photorealistic 3D Tiles (a textured 3D mesh of the
 * world, like Google Earth). "terrain": Cesium World Terrain draped with
 * satellite imagery. Photoreal looks far better up close; terrain is lighter.
 */
export type Quality = "photoreal" | "terrain";

export interface Globe {
  viewer: Viewer;
  mode: ProviderMode;
  /** Set when ion was configured but terrain or imagery failed to load. */
  providerError?: string;
  /** Google Photorealistic 3D Tiles, when they loaded. */
  photoreal?: Cesium3DTileset;
  /** Why photorealistic tiles are unavailable, when ion works but they don't. */
  photorealError?: string;
  quality: Quality;
  perf: PerformanceMonitor;
}

/**
 * Builds the Cesium viewer. With a Cesium ion token it uses Cesium World
 * Terrain (real elevation) and Bing satellite imagery through ion. Without one
 * it falls back to OpenStreetMap imagery on a smooth ellipsoid and says so,
 * rather than pretending the terrain is real.
 */
export async function createGlobe(container: HTMLElement, ionToken: string | undefined): Promise<Globe> {
  let mode: ProviderMode = "fallback";
  let providerError: string | undefined;
  let terrainProvider: TerrainProvider = new EllipsoidTerrainProvider();
  let baseLayer = new ImageryLayer(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));

  if (ionToken) {
    Ion.defaultAccessToken = ionToken;
    try {
      const [terrain, imagery] = await Promise.all([
        createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true }),
        createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL }),
      ]);
      terrainProvider = terrain;
      baseLayer = new ImageryLayer(imagery);
      mode = "ion";
    } catch (err) {
      providerError = describeIonError(err);
    }
  }

  const viewer = new Viewer(container, {
    terrainProvider,
    baseLayer,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  const { scene } = viewer;
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.showGroundAtmosphere = true;
  // Sharper terrain and imagery than Cesium's default of 2 (lower = more detail, more tiles).
  scene.globe.maximumScreenSpaceError = 1.5;
  scene.fog.enabled = true;
  scene.backgroundColor = Color.BLACK;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.postProcessStages.fxaa.enabled = true;
  // Only draw a frame when something changed (camera, tiles loading, or
  // simulation time while a disaster runs) instead of 60 times a second
  // regardless. This is the biggest saving when the view is still.
  scene.requestRenderMode = true;
  scene.maximumRenderTimeChange = 0;
  // The sun stays where we put it; it only moves when we fly somewhere new.
  viewer.clock.shouldAnimate = false;
  setLocalMorning(viewer, -30);

  // Let the camera get right down to the ground. Collision detection (on by
  // default) stops it going below the terrain or into the 3D tiles.
  const controller = scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 15;
  controller.maximumZoomDistance = 40_000_000;

  viewer.camera.setView({ destination: Cartesian3.fromDegrees(-30, 25, 22_000_000) });

  let photoreal: Cesium3DTileset | undefined;
  let photorealError: string | undefined;
  if (mode === "ion") {
    try {
      photoreal = await loadPhotoreal(viewer);
    } catch (err) {
      photorealError = describePhotorealError(err);
    }
  }
  const globe: Globe = {
    viewer,
    mode,
    providerError,
    photoreal,
    photorealError,
    quality: "terrain",
    perf: new PerformanceMonitor(viewer, photoreal),
  };
  if (photoreal) setQuality(globe, preferredQuality());
  return globe;
}

/**
 * Google Photorealistic 3D Tiles through Cesium ion (asset 2275207). With no
 * Google key configured, Cesium requests them with the ion token. Google's
 * terms only allow them alongside Google's geocoder, which is why search
 * switches to the ion Google geocoder in this mode (services/geocode.ts).
 */
async function loadPhotoreal(viewer: Viewer): Promise<Cesium3DTileset> {
  const tileset = await createGooglePhotorealistic3DTileset(
    { onlyUsingWithGoogleGeocoder: true },
    {
      // Default is 16; lower loads finer tiles sooner for sharper close-ups.
      maximumScreenSpaceError: 8,
      // The camera bumps into mountains instead of passing through them.
      enableCollision: true,
      // Google requires its attribution on screen, not hidden behind a button.
      showCreditsOnScreen: true,
    },
  );
  tileset.show = false;
  viewer.scene.primitives.add(tileset);
  return tileset;
}

/** Switches between photorealistic tiles and terrain + imagery. */
export function setQuality(globe: Globe, quality: Quality) {
  const photoreal = quality === "photoreal" && !!globe.photoreal;
  if (globe.photoreal) globe.photoreal.show = photoreal;
  // The tiles include their own ground, so the globe underneath is hidden.
  // Terrain still loads in the background for height sampling.
  globe.viewer.scene.globe.show = !photoreal;
  globe.quality = photoreal ? "photoreal" : "terrain";
  globe.viewer.scene.requestRender();
  try {
    localStorage.setItem(QUALITY_KEY, globe.quality);
  } catch {
    // Storage blocked (private mode): the choice just isn't remembered.
  }
}

const QUALITY_KEY = "earthbreaker.quality";

function preferredQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === "terrain" ? "terrain" : "photoreal";
  } catch {
    return "photoreal";
  }
}

function describePhotorealError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/401|403|404|not found|unauthori[sz]ed|forbidden/i.test(text)) {
    return "Your Cesium ion token couldn't open Google Photorealistic 3D Tiles. If your ion account doesn't list them under My Assets, add them from the Asset Depot (search “Google Photorealistic”).";
  }
  return `Photorealistic 3D tiles could not load (${text}).`;
}

/** Flies the camera so it looks at a point from the given heading, tilt and distance. */
export function flyToPoint(
  viewer: Viewer,
  lon: number,
  lat: number,
  heightM: number,
  view: CameraView,
  onArrive?: () => void,
) {
  setLocalMorning(viewer, lon);
  const centre = Cartesian3.fromDegrees(lon, lat, heightM);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 0), {
    offset: new HeadingPitchRange(
      CesiumMath.toRadians(view.heading),
      CesiumMath.toRadians(view.pitch),
      view.range,
    ),
    duration: 5,
    complete: onArrive,
  });
}

/**
 * Drops a labelled pin, replacing any earlier pin with the same id. The
 * selected place and the eruption vent each have their own.
 */
export function setMarker(
  viewer: Viewer,
  lon: number,
  lat: number,
  heightM: number,
  label: string,
  id: string = MARKER_ID,
  colour = "#ff7a3d",
) {
  viewer.entities.removeById(id);
  viewer.entities.add({
    id,
    position: Cartesian3.fromDegrees(lon, lat, heightM),
    point: {
      pixelSize: 9,
      color: Color.fromCssColorString(colour),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: label,
      font: "600 14px system-ui, sans-serif",
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString("#0b0d12"),
      outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}
const MARKER_ID = "selected-place";

export function removeMarker(viewer: Viewer, id: string) {
  viewer.entities.removeById(id);
}

/** The ground point under a screen position, or undefined if it's sky. */
export function pickGround(viewer: Viewer, x: number, y: number): { lon: number; lat: number; heightM: number } | undefined {
  const { scene } = viewer;
  const screen = new Cartesian2(x, y);
  let hit: Cartesian3 | undefined;
  if (!scene.globe.show && scene.pickPositionSupported) {
    // Photoreal mode: the globe is hidden, so read the 3D tiles' depth instead.
    hit = scene.pickPosition(screen);
  } else {
    const ray = viewer.camera.getPickRay(screen);
    hit = ray && scene.globe.pick(ray, scene);
  }
  if (!hit) return undefined;
  const c = Cartographic.fromCartesian(hit);
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), heightM: c.height };
}

/**
 * Slowly circles the camera around a point, keeping the distance and tilt the
 * camera has when it starts. Returns a function that stops the orbit and hands
 * the camera back to the mouse.
 */
export function startOrbit(viewer: Viewer, lon: number, lat: number, heightM: number, degreesPerSecond = 4): () => void {
  const centre = Cartesian3.fromDegrees(lon, lat, heightM);
  const camera = viewer.camera;
  const range = Cartesian3.distance(camera.positionWC, centre);
  const pitch = Math.min(-0.05, camera.pitch);
  let heading = camera.heading;
  let last = performance.now();
  let frame = 0;
  // In request-render mode nothing redraws on its own, so keep asking for
  // frames while the orbit runs (e.g. after a disaster has ended).
  const tick = () => {
    const now = performance.now();
    heading += CesiumMath.toRadians(degreesPerSecond) * ((now - last) / 1000);
    last = now;
    camera.lookAt(centre, new HeadingPitchRange(heading, pitch, range));
    viewer.scene.requestRender();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    camera.lookAtTransform(Matrix4.IDENTITY);
  };
}

/**
 * Ground height at a point from the loaded terrain model. Returns undefined
 * on the flat fallback globe, where any number would be made up.
 */
export async function sampleGroundHeight(globe: Globe, lon: number, lat: number): Promise<number | undefined> {
  if (globe.mode !== "ion") return undefined;
  try {
    const [point] = await sampleTerrainMostDetailed(globe.viewer.terrainProvider, [
      Cartographic.fromDegrees(lon, lat),
    ]);
    return Number.isFinite(point.height) ? point.height : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The highest ground within `radiusM` of a point, from a 9 × 9 grid of terrain
 * samples. Used to put a volcano's vent on its actual summit when the listed
 * coordinates are slightly off. Undefined on the flat fallback globe.
 */
export async function findSummit(
  globe: Globe,
  lon: number,
  lat: number,
  radiusM = 1500,
): Promise<{ lon: number; lat: number; heightM: number } | undefined> {
  if (globe.mode !== "ion") return undefined;
  const dLat = radiusM / 110_540;
  const dLon = radiusM / (111_320 * Math.cos(CesiumMath.toRadians(lat)));
  const points: Cartographic[] = [];
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) points.push(Cartographic.fromDegrees(lon + (j / 4) * dLon, lat + (i / 4) * dLat));
  }
  try {
    const sampled = await sampleTerrainMostDetailed(globe.viewer.terrainProvider, points);
    let best: Cartographic | undefined;
    for (const p of sampled) if (Number.isFinite(p.height) && (!best || p.height > best.height)) best = p;
    return best && { lon: CesiumMath.toDegrees(best.longitude), lat: CesiumMath.toDegrees(best.latitude), heightM: best.height };
  } catch {
    return undefined;
  }
}

/**
 * Globe lighting follows the real sun, so a target on the night side would
 * arrive dark. Put the sun at about 10:30 local solar time over `lon` on a
 * fixed early-autumn date, which gives long, readable shadows on mountains.
 */
function setLocalMorning(viewer: Viewer, lon: number) {
  const utcHours = ((10.5 - lon / 15) % 24 + 24) % 24;
  const date = new Date(Date.UTC(2026, 8, 20, 0, 0, 0));
  date.setUTCMinutes(Math.round(utcHours * 60));
  viewer.clock.currentTime = JulianDate.fromDate(date);
}

function describeIonError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/401|unauthori[sz]ed|invalid.*token/i.test(text)) {
    return "Cesium ion rejected the access token. Check VITE_CESIUM_ION_TOKEN in .env.local.";
  }
  return `Could not load Cesium ion terrain or imagery (${text}).`;
}
