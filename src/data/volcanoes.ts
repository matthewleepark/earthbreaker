// Real volcanoes, used only to label an eruption as real or fictional. The
// coordinates are approximate summits (good to about a kilometre), which is
// plenty for "is the vent on this volcano?".
interface KnownVolcano {
  name: string;
  lat: number;
  lon: number;
  /** How far from the summit still counts as this volcano, in km. */
  radiusKm: number;
}

const KNOWN_VOLCANOES: KnownVolcano[] = [
  { name: "Mount Rainier", lat: 46.853, lon: -121.76, radiusKm: 8 },
  { name: "Mount St. Helens", lat: 46.191, lon: -122.194, radiusKm: 7 },
  { name: "Mount Hood", lat: 45.374, lon: -121.696, radiusKm: 7 },
  { name: "Mount Baker", lat: 48.777, lon: -121.813, radiusKm: 7 },
  { name: "Mount Shasta", lat: 41.409, lon: -122.193, radiusKm: 8 },
  { name: "Yellowstone Caldera", lat: 44.43, lon: -110.67, radiusKm: 35 },
  { name: "Kīlauea", lat: 19.421, lon: -155.287, radiusKm: 10 },
  { name: "Mauna Loa", lat: 19.475, lon: -155.608, radiusKm: 20 },
  { name: "Mount Fuji", lat: 35.361, lon: 138.727, radiusKm: 8 },
  { name: "Mount Vesuvius", lat: 40.821, lon: 14.426, radiusKm: 5 },
  { name: "Mount Etna", lat: 37.751, lon: 14.993, radiusKm: 12 },
  { name: "Eyjafjallajökull", lat: 63.63, lon: -19.62, radiusKm: 8 },
  { name: "Popocatépetl", lat: 19.023, lon: -98.622, radiusKm: 7 },
  { name: "Mount Pinatubo", lat: 15.13, lon: 120.35, radiusKm: 7 },
  { name: "Krakatau", lat: -6.102, lon: 105.423, radiusKm: 5 },
];

export type VolcanoMatch =
  | { kind: "real"; name: string }
  | { kind: "not-volcano" }
  | { kind: "unknown" };

/**
 * Says whether a vent sits on a real volcano. `knownNotVolcano` is for places
 * we know are not volcanic (like Everest), which are labelled fictional outright.
 */
export function matchVolcano(lat: number, lon: number, knownNotVolcano: boolean): VolcanoMatch {
  for (const v of KNOWN_VOLCANOES) {
    if (distanceKm(lat, lon, v.lat, v.lon) <= v.radiusKm) return { kind: "real", name: v.name };
  }
  return knownNotVolcano ? { kind: "not-volcano" } : { kind: "unknown" };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
