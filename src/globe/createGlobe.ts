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
  Viewer,
  type TerrainProvider,
} from "cesium";
import type { CameraView } from "../data/places";

export type ProviderMode = "ion" | "fallback";

export interface Globe {
  viewer: Viewer;
  mode: ProviderMode;
  /** Set when ion was configured but terrain or imagery failed to load. */
  providerError?: string;
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
  scene.fog.enabled = true;
  scene.backgroundColor = Color.BLACK;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  // The sun stays where we put it; it only moves when we fly somewhere new.
  viewer.clock.shouldAnimate = false;
  setLocalMorning(viewer, -30);

  // Keep the camera above the ground and stop it wandering too far into space.
  const controller = scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 150;
  controller.maximumZoomDistance = 40_000_000;

  viewer.camera.setView({ destination: Cartesian3.fromDegrees(-30, 25, 22_000_000) });

  return { viewer, mode, providerError };
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

/** Drops a single pin with a label at the selected place, replacing the last one. */
export function setMarker(viewer: Viewer, lon: number, lat: number, heightM: number, label: string) {
  viewer.entities.removeById(MARKER_ID);
  viewer.entities.add({
    id: MARKER_ID,
    position: Cartesian3.fromDegrees(lon, lat, heightM),
    point: {
      pixelSize: 9,
      color: Color.fromCssColorString("#ff7a3d"),
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
