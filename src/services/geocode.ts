// Place search through OpenStreetMap Nominatim. It needs no key, but its
// usage policy allows at most one request per second, so searches only run
// when the user submits the form, never on every keystroke.
// https://operations.osmfoundation.org/policies/nominatim/

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

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
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
