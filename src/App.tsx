import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { GlobeView, type CameraReadout } from "./globe/GlobeView";
import { flyToPoint, sampleGroundHeight, setMarker, type Globe } from "./globe/createGlobe";
import { PRESETS, viewForExtent, type Place } from "./data/places";
import { searchPlaces, type SearchResult } from "./services/geocode";

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() || undefined;

interface Selection {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  elevationM?: number;
  elevationSource?: string;
  volcanic?: boolean;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: SearchResult[] }
  | { kind: "error"; message: string };

export default function App() {
  const globeRef = useRef<Globe | null>(null);
  const [globeState, setGlobeState] = useState<"loading" | "ready" | "error">("loading");
  const [fatalError, setFatalError] = useState<string>();
  const [providerNote, setProviderNote] = useState<string>();
  const [camera, setCamera] = useState<CameraReadout>();
  const [tilesPending, setTilesPending] = useState(0);
  const [selection, setSelection] = useState<Selection>();
  const [flying, setFlying] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [panelOpen, setPanelOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  const handleReady = useCallback((globe: Globe) => {
    globeRef.current = globe;
    setGlobeState("ready");
    if (globe.providerError) {
      setProviderNote(`${globe.providerError} Showing street-map imagery on flat terrain instead.`);
    } else if (globe.mode === "fallback") {
      setProviderNote(
        "No Cesium ion token, so terrain is flat and imagery is a street map. Add VITE_CESIUM_ION_TOKEN to .env.local for real elevation and satellite imagery (see README).",
      );
    }
  }, []);

  const handleError = useCallback((message: string) => {
    setGlobeState("error");
    setFatalError(message);
  }, []);

  const goTo = useCallback((target: Selection, heightM: number, view: Place["view"]) => {
    const globe = globeRef.current;
    if (!globe) return;
    setSelection(target);
    setFlying(true);
    setMarker(globe.viewer, target.lon, target.lat, heightM, target.name);
    flyToPoint(globe.viewer, target.lon, target.lat, heightM, view, () => setFlying(false));
  }, []);

  const goToPreset = useCallback(
    (place: Place) => {
      setSearch({ kind: "idle" });
      goTo(
        {
          name: place.name,
          detail: place.region,
          lat: place.lat,
          lon: place.lon,
          elevationM: place.elevationM,
          elevationSource: place.elevationSource,
          volcanic: place.volcanic,
        },
        // On the flat fallback globe the summit is at sea level, so aim there.
        globeRef.current?.mode === "ion" ? (place.elevationM ?? 0) : 0,
        place.view,
      );
    },
    [goTo],
  );

  const goToResult = useCallback(
    async (result: SearchResult) => {
      const globe = globeRef.current;
      if (!globe) return;
      setSearch({ kind: "idle" });
      const ground = await sampleGroundHeight(globe, result.lon, result.lat);
      goTo(
        {
          name: result.name,
          detail: result.detail,
          lat: result.lat,
          lon: result.lon,
          elevationM: ground,
          elevationSource: ground === undefined ? undefined : "Cesium World Terrain",
        },
        ground ?? 0,
        viewForExtent(result.spanDegrees),
      );
    },
    [goTo],
  );

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearch({ kind: "loading" });
    try {
      const results = await searchPlaces(q, controller.signal);
      setSearch(
        results.length ? { kind: "results", results } : { kind: "error", message: `No places found for “${q}”.` },
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setSearch({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // A link like ?place=rainier opens straight onto that preset.
  useEffect(() => {
    if (globeState !== "ready") return;
    const id = new URLSearchParams(window.location.search).get("place");
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) goToPreset(preset);
  }, [globeState, goToPreset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelpOpen(false);
        setSearch({ kind: "idle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = globeState === "ready";

  return (
    <div className="app">
      <GlobeView
        ionToken={ION_TOKEN}
        onReady={handleReady}
        onError={handleError}
        onCamera={setCamera}
        onTilesPending={setTilesPending}
      />

      <header className="topbar">
        <div className="brand" aria-label="Earthbreaker">
          <span className="brand-mark" aria-hidden="true" />
          EARTHBREAKER
        </div>

        <div className="search">
          <form onSubmit={submitSearch} role="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any place on Earth"
              aria-label="Search for a place"
              disabled={!ready}
            />
            <button type="submit" disabled={!ready || !query.trim() || search.kind === "loading"}>
              {search.kind === "loading" ? "Searching…" : "Search"}
            </button>
          </form>

          {search.kind === "results" && (
            <ul className="results" role="listbox" aria-label="Search results">
              {search.results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => goToResult(r)}>
                    <strong>{r.name}</strong>
                    <span>{r.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.kind === "error" && <p className="results note">{search.message}</p>}
        </div>

        <nav className="presets" aria-label="Featured places">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={selection?.name === p.name ? "chip active" : "chip"}
              onClick={() => goToPreset(p)}
              disabled={!ready}
            >
              {p.name}
            </button>
          ))}
          <button type="button" className="chip icon" onClick={() => setHelpOpen(true)} aria-label="Controls help">
            ?
          </button>
        </nav>
      </header>

      {providerNote && (
        <div className="banner warn" role="status">
          <span>{providerNote}</span>
          <button type="button" onClick={() => setProviderNote(undefined)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {globeState === "loading" && <div className="overlay">Starting the globe…</div>}
      {globeState === "error" && (
        <div className="overlay error" role="alert">
          <h2>The globe could not start</h2>
          <p>{fatalError}</p>
        </div>
      )}

      {ready && (
        <aside className={panelOpen ? "panel" : "panel collapsed"} aria-label="Location details">
          <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? "Hide details" : "Details"}
          </button>
          {panelOpen && (
            <dl>
              {selection ? (
                <>
                  <div className="place">
                    <h2>{selection.name}</h2>
                    {selection.detail && <p>{selection.detail}</p>}
                    {selection.volcanic === false && (
                      <p className="tag">Not a volcano: an eruption here would be fictional</p>
                    )}
                  </div>
                  <Row label="Coordinates" value={formatLatLon(selection.lat, selection.lon)} />
                  <Row
                    label="Elevation"
                    value={selection.elevationM === undefined ? "Not available" : formatMetres(selection.elevationM)}
                    note={selection.elevationSource}
                  />
                </>
              ) : (
                <p className="hint">Search for a place or pick a featured mountain.</p>
              )}
              {camera && (
                <Row
                  label="Camera"
                  value={`${formatMetres(camera.altitudeM)} up`}
                  note={formatLatLon(camera.lat, camera.lon)}
                />
              )}
            </dl>
          )}
        </aside>
      )}

      {ready && (flying || tilesPending > 0) && (
        <div className="loading-pill" role="status">
          {flying ? "Flying…" : `Loading map tiles · ${tilesPending}`}
        </div>
      )}

      {helpOpen && (
        <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="help" role="dialog" aria-label="Controls" onClick={(e) => e.stopPropagation()}>
            <h2>Controls</h2>
            <ul>
              <li><kbd>Left-drag</kbd> rotate the globe or pan the ground</li>
              <li><kbd>Scroll</kbd> or <kbd>right-drag</kbd> zoom</li>
              <li><kbd>Ctrl</kbd> + <kbd>left-drag</kbd> or <kbd>middle-drag</kbd> tilt and turn the camera</li>
              <li><kbd>Esc</kbd> close menus</li>
            </ul>
            <p className="fine">
              Terrain and imagery come from real geographic data. Disaster simulations, when added, will be
              approximate visualisations, not scientific forecasts.
            </p>
            <button type="button" className="chip" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

function formatLatLon(lat: number, lon: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function formatMetres(m: number) {
  if (Math.abs(m) >= 100_000) return `${Math.round(m / 1000).toLocaleString()} km`;
  return `${Math.round(m).toLocaleString()} m`;
}
