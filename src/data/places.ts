// A place the camera can fly to. `view` sets where the camera ends up
// relative to the target so the arrival shows the surrounding landscape.
export interface Place {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  /** Summit or ground elevation in metres, only when a published figure exists. */
  elevationM?: number;
  elevationSource?: string;
  /** True for real volcanoes; Everest is not one, so eruptions there are fictional. */
  volcanic: boolean;
  view: CameraView;
}

export interface CameraView {
  /** Straight-line distance from the target to the camera, in metres. */
  range: number;
  /** Compass direction the camera faces, in degrees (0 = north). */
  heading: number;
  /** Downward tilt in degrees; -90 looks straight down. */
  pitch: number;
}

export const PRESETS: Place[] = [
  {
    id: "everest",
    name: "Mount Everest",
    region: "Khumbu, Nepal / Tibet",
    lat: 27.98806,
    lon: 86.92528,
    elevationM: 8849,
    elevationSource: "Nepal–China joint survey, 2020",
    volcanic: false,
    // From the south-west, looking up the Khumbu valley at the summit.
    view: { range: 22000, heading: 20, pitch: -18 },
  },
  {
    id: "rainier",
    name: "Mount Rainier",
    region: "Washington, USA",
    lat: 46.85283,
    lon: -121.76044,
    elevationM: 4392,
    elevationSource: "USGS",
    volcanic: true,
    view: { range: 32000, heading: 340, pitch: -22 },
  },
  {
    id: "st-helens",
    name: "Mount St. Helens",
    region: "Washington, USA",
    lat: 46.1912,
    lon: -122.1944,
    elevationM: 2549,
    elevationSource: "USGS (after the 1980 eruption)",
    volcanic: true,
    // From the north, looking into the horseshoe crater left by 1980.
    view: { range: 16000, heading: 180, pitch: -24 },
  },
];

/** Camera view for a search result: wider for big areas, closer for small ones. */
export function viewForExtent(spanDegrees: number): CameraView {
  const metres = spanDegrees * 111_000;
  const range = Math.min(Math.max(metres * 1.6, 4000), 2_500_000);
  return { range, heading: 0, pitch: range > 500_000 ? -90 : -35 };
}
