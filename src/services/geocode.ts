// Place search. Two backends:
//  - OpenStreetMap Nominatim for the terrain and no-token modes. It needs no
//    key, but its usage policy allows at most one request per second, so
//    searches only run when the user submits the form.
//    https://operations.osmfoundation.org/policies/nominatim/
//  - Google, through Cesium ion, in photoreal mode. Google's terms only allow
//    Photorealistic 3D Tiles alongside Google's own geocoder.

import {
  Cartographic,
  IonGeocodeProviderType,
  IonGeocoderService,
  Math as CesiumMath,
  Rectangle,
  type Scene,
} from "cesium";

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export interface SearchResult {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
  /** Rough size of the place, in degrees, from its bounding box. */
  spanDegrees: number;
}

interface NominatimItem {
  place_id: number;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
}

export interface SearchResponse {
  results: SearchResult[];
  /** Attribution the provider requires next to its results. */
  attribution: string;
}

let googleService: { scene: Scene; service: IonGeocoderService } | undefined;

/** Google results through the Cesium ion geocoder (uses the ion token). */
export async function searchGoogle(scene: Scene, query: string): Promise<SearchResponse> {
  if (googleService?.scene !== scene) {
    googleService = { scene, service: new IonGeocoderService({ scene, geocodeProviderType: IonGeocodeProviderType.GOOGLE }) };
  }
  let raw;
  try {
    raw = await googleService.service.geocode(query);
  } catch {
    throw new Error("Search is unreachable. Check your internet connection.");
  }
  const results = raw.map((item, index): SearchResult => {
    const d = item.destination;
    let lat: number;
    let lon: number;
    let span = 0.01;
    if (d instanceof Rectangle) {
      const c = Rectangle.center(d);
      lat = CesiumMath.toDegrees(c.latitude);
      lon = CesiumMath.toDegrees(c.longitude);
      span = Math.max(CesiumMath.toDegrees(d.height), CesiumMath.toDegrees(d.width) * Math.cos(c.latitude));
    } else {
      const c = Cartographic.fromCartesian(d);
      lat = CesiumMath.toDegrees(c.latitude);
      lon = CesiumMath.toDegrees(c.longitude);
    }
    const [first, ...rest] = item.displayName.split(", ");
    return { id: `${index}-${item.displayName}`, name: first, detail: rest.join(", "), lat, lon, spanDegrees: span };
  });
  return { results, attribution: attributionText(raw[0]?.attributions) || "Search by Google" };
}

/** OpenStreetMap results through Nominatim. */
export async function searchOsm(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  return { results: await searchPlaces(query, signal), attribution: "Search © OpenStreetMap contributors" };
}

/** Attribution arrives as HTML from ion; show its text (or image alt text) only. */
function attributionText(attributions: object[] | undefined): string {
  if (!attributions?.length) return "";
  return attributions
    .map((a) => {
      const html = "html" in a && typeof a.html === "string" ? a.html : "";
      const doc = new DOMParser().parseFromString(html, "text/html");
      const text = doc.body.textContent?.trim();
      return text || [...doc.querySelectorAll("img[alt]")].map((img) => img.getAttribute("alt")).join(" ");
    })
    .filter(Boolean)
    .join(" · ");
}

async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "6" })}`;
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Search is unreachable. Check your internet connection.");
  }
  if (response.status === 429) throw new Error("Too many searches. Wait a moment and try again.");
  if (!response.ok) throw new Error(`Search failed (HTTP ${response.status}).`);

  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => {
    const [south, north, west, east] = item.boundingbox.map(Number);
    const [first, ...rest] = item.display_name.split(", ");
    return {
      id: String(item.place_id),
      name: item.name || first,
      detail: rest.join(", "),
      lat: Number(item.lat),
      lon: Number(item.lon),
      spanDegrees: Math.max(north - south, (east - west) * Math.cos((Number(item.lat) * Math.PI) / 180)),
    };
  });
}
