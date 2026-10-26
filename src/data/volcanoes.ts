// Famous volcanoes: the Volcanoes menu, and the real/fictional label on every
// eruption. Coordinates are approximate summits or craters (good to about a
// kilometre). Peaked volcanoes have `snap` set, so the vent moves to the
// highest ground within 1.5 km, which corrects small coordinate errors. Calderas
// and lava lakes don't, because their highest point is a rim, not the vent.
// Elevations aren't stored: they're read from the terrain model on arrival.
import type { CameraView } from "./places";

export type VolcanoShape = "cone" | "massif" | "shield" | "caldera" | "crater";

export interface Volcano {
  id: string;
  name: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
  shape: VolcanoShape;
  /** Move the vent to the local summit on arrival. */
  snap: boolean;
  /** One line on why it's famous. */
  note: string;
  /** How far from these coordinates still counts as this volcano, in km. */
  radiusKm: number;
}

export type Region =
  | "North America"
  | "Hawaiʻi"
  | "Central & South America"
  | "Europe"
  | "Africa"
  | "Asia & Pacific"
  | "Antarctica";

export const REGIONS: Region[] = [
  "North America",
  "Hawaiʻi",
  "Central & South America",
  "Europe",
  "Africa",
  "Asia & Pacific",
  "Antarctica",
];

const v = (
  id: string, name: string, country: string, region: Region, lat: number, lon: number,
  shape: VolcanoShape, note: string, radiusKm = 7,
): Volcano => ({ id, name, country, region, lat, lon, shape, snap: shape === "cone" || shape === "massif", note, radiusKm });

export const VOLCANOES: Volcano[] = [
  v("rainier", "Mount Rainier", "USA", "North America", 46.853, -121.76, "cone", "One of the highest-threat volcanoes in the US, because of mudflows from its glaciers", 8),
  v("st-helens", "Mount St. Helens", "USA", "North America", 46.191, -122.194, "cone", "Its 1980 eruption blew out the north side of the mountain"),
  v("hood", "Mount Hood", "USA", "North America", 45.374, -121.696, "cone", "Oregon's highest peak"),
  v("baker", "Mount Baker", "USA", "North America", 48.777, -121.813, "cone", "A heavily glaciated Cascade volcano"),
  v("shasta", "Mount Shasta", "USA", "North America", 41.409, -122.193, "cone", "The tallest volcano in California", 8),
  v("yellowstone", "Yellowstone Caldera", "USA", "North America", 44.43, -110.67, "caldera", "A supervolcano; its caldera formed in an eruption about 640,000 years ago", 35),
  v("kilauea", "Kīlauea", "USA", "Hawaiʻi", 19.407, -155.283, "crater", "One of the most active volcanoes on Earth", 10),
  v("mauna-loa", "Mauna Loa", "USA", "Hawaiʻi", 19.475, -155.608, "shield", "The largest active volcano on Earth by volume", 20),
  v("popocatepetl", "Popocatépetl", "Mexico", "Central & South America", 19.023, -98.622, "cone", "An active volcano within sight of Mexico City"),
  v("pelee", "Mount Pelée", "Martinique (France)", "Central & South America", 14.809, -61.165, "cone", "Its 1902 eruption destroyed the town of Saint-Pierre"),
  v("cotopaxi", "Cotopaxi", "Ecuador", "Central & South America", -0.677, -78.436, "cone", "One of the highest active volcanoes in the world"),
  v("villarrica", "Villarrica", "Chile", "Central & South America", -39.42, -71.93, "cone", "One of Chile's most active volcanoes, with a lava lake in its crater"),
  v("vesuvius", "Mount Vesuvius", "Italy", "Europe", 40.821, 14.426, "cone", "Buried Pompeii and Herculaneum in 79 AD", 5),
  v("etna", "Mount Etna", "Italy", "Europe", 37.751, 14.993, "massif", "Europe's most active volcano", 12),
  v("stromboli", "Stromboli", "Italy", "Europe", 38.789, 15.213, "cone", "Has erupted almost nonstop for thousands of years: the “Lighthouse of the Mediterranean”", 4),
  v("santorini", "Santorini", "Greece", "Europe", 36.404, 25.396, "caldera", "Its Minoan eruption around 1600 BC left a flooded caldera", 10),
  v("teide", "Mount Teide", "Spain (Tenerife)", "Europe", 28.272, -16.642, "cone", "Spain's highest peak"),
  v("eyjafjallajokull", "Eyjafjallajökull", "Iceland", "Europe", 63.63, -19.62, "massif", "Its 2010 ash cloud grounded flights across Europe", 8),
  v("hekla", "Hekla", "Iceland", "Europe", 63.983, -19.666, "massif", "Called the “Gateway to Hell” in medieval Europe"),
  v("kilimanjaro", "Mount Kilimanjaro", "Tanzania", "Africa", -3.076, 37.353, "massif", "Africa's highest mountain, a dormant volcano", 10),
  v("nyiragongo", "Mount Nyiragongo", "DR Congo", "Africa", -1.52, 29.25, "crater", "Holds one of the largest lava lakes in the world", 6),
  v("fuji", "Mount Fuji", "Japan", "Asia & Pacific", 35.361, 138.727, "cone", "Japan's highest mountain; last erupted in 1707", 8),
  v("sakurajima", "Sakurajima", "Japan", "Asia & Pacific", 31.593, 130.657, "cone", "Erupts many times a year beside the city of Kagoshima", 5),
  v("pinatubo", "Mount Pinatubo", "Philippines", "Asia & Pacific", 15.142, 120.35, "caldera", "Its 1991 eruption cooled the whole planet by about 0.5 °C"),
  v("mayon", "Mayon", "Philippines", "Asia & Pacific", 13.257, 123.685, "cone", "Famous for its almost perfectly symmetrical cone"),
  v("krakatau", "Krakatau", "Indonesia", "Asia & Pacific", -6.102, 105.423, "crater", "Its 1883 explosion was heard about 4,800 km away", 5),
  v("merapi", "Mount Merapi", "Indonesia", "Asia & Pacific", -7.541, 110.446, "cone", "Indonesia's most active volcano"),
  v("agung", "Mount Agung", "Indonesia (Bali)", "Asia & Pacific", -8.343, 115.508, "cone", "Bali's highest point; erupted in 1963 and 2017"),
  v("tambora", "Mount Tambora", "Indonesia", "Asia & Pacific", -8.25, 118.0, "caldera", "Its 1815 eruption, the largest on record, caused the 1816 “year without a summer”", 10),
  v("ruapehu", "Mount Ruapehu", "New Zealand", "Asia & Pacific", -39.28, 175.57, "massif", "New Zealand's largest active volcano"),
  v("erebus", "Mount Erebus", "Antarctica", "Antarctica", -77.53, 167.17, "massif", "The southernmost active volcano, with a lava lake", 8),
];

/** Camera framing that suits each kind of volcano. */
export function volcanoView(volcano: Volcano): CameraView {
  switch (volcano.shape) {
    case "cone":
      return { range: 15000, heading: 15, pitch: -16 };
    case "massif":
      return { range: 24000, heading: 15, pitch: -18 };
    case "shield":
      return { range: 42000, heading: 20, pitch: -22 };
    case "caldera":
      return { range: volcano.radiusKm * 2400, heading: 0, pitch: -40 };
    case "crater":
      return { range: 9000, heading: 20, pitch: -32 };
  }
}

export type VolcanoMatch =
  | { kind: "real"; name: string }
  | { kind: "not-volcano" }
  | { kind: "unknown" };

/**
 * Says whether a vent sits on a real volcano. `knownNotVolcano` is for places
 * we know are not volcanic (like Everest), which are labelled fictional outright.
 */
export function matchVolcano(lat: number, lon: number, knownNotVolcano: boolean): VolcanoMatch {
  for (const volcano of VOLCANOES) {
    if (distanceKm(lat, lon, volcano.lat, volcano.lon) <= volcano.radiusKm) return { kind: "real", name: volcano.name };
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
