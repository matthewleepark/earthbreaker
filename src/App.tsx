import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  BillboardCollection,
  HeadingPitchRange,
  ParticleSystem,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
} from "cesium";
import { GlobeView, type CameraReadout } from "./globe/GlobeView";
import {
  flyToPoint,
  pickGround,
  removeMarker,
  sampleGroundHeight,
  setMarker,
  startOrbit,
  type Globe,
} from "./globe/createGlobe";
import { PRESETS, viewForExtent, type Place } from "./data/places";
import { matchVolcano } from "./data/volcanoes";
import { searchPlaces, type SearchResult } from "./services/geocode";
import { DISASTERS } from "./disasters/registry";
import { IDLE_STATE, SimulationController, type SimState } from "./disasters/controller";
import { randomSeed } from "./disasters/random";
import type { Params } from "./disasters/types";
import { DisasterPanel, type Vent } from "./ui/DisasterPanel";
import { SimControls } from "./ui/SimControls";
import { isPhone } from "./ui/isPhone";

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() || undefined;
const VENT_MARKER = "vent";

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
  const simRef = useRef<SimulationController | null>(null);
  const stopOrbitRef = useRef<(() => void) | null>(null);
  const lastRunRef = useRef<{ vent: Vent; params: Params; seed: number } | null>(null);
  /** Where the camera looks for the current eruption; the orbit circles this point. */
  const framingRef = useRef<{ lon: number; lat: number; heightM: number } | null>(null);

  const [globeState, setGlobeState] = useState<"loading" | "ready" | "error">("loading");
  const [fatalError, setFatalError] = useState<string>();
  const [providerNote, setProviderNote] = useState<string>();
  const [camera, setCamera] = useState<CameraReadout>();
  const [tilesPending, setTilesPending] = useState(0);
  const [selection, setSelection] = useState<Selection>();
  const [flying, setFlying] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [panelOpen, setPanelOpen] = useState(!isPhone());
  const [helpOpen, setHelpOpen] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  const [disasterId, setDisasterId] = useState(DISASTERS[0].id);
  const disaster = DISASTERS.find((d) => d.id === disasterId) ?? DISASTERS[0];
  const [params, setParams] = useState<Params>(disaster.defaults);
  const [vent, setVent] = useState<Vent>();
  const [picking, setPicking] = useState(false);
  const [sim, setSim] = useState<SimState>(IDLE_STATE);
  const [orbiting, setOrbiting] = useState(false);

  const handleReady = useCallback((globe: Globe) => {
    globeRef.current = globe;
    simRef.current = new SimulationController(globe.viewer, setSim);
    // ?debug exposes the viewer in the console for testing camera views.
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { earthbreaker: unknown }).earthbreaker = {
        viewer: globe.viewer,
        sim: simRef.current,
        cesium: { HeadingPitchRange, ParticleSystem, BillboardCollection },
      };
    }
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

  const stopOrbit = useCallback(() => {
    stopOrbitRef.current?.();
    stopOrbitRef.current = null;
    setOrbiting(false);
  }, []);

  /** Ends any running disaster and brings the place markers back. */
  const resetSim = useCallback(() => {
    stopOrbit();
    simRef.current?.reset();
    const globe = globeRef.current;
    if (globe) globe.viewer.entities.show = true;
  }, [stopOrbit]);

  const goTo = useCallback(
    (target: Selection, heightM: number, view: Place["view"]) => {
      const globe = globeRef.current;
      if (!globe) return;
      // Changing location ends the current disaster (and frees its GPU resources).
      resetSim();
      setPicking(false);
      setSelection(target);
      setFlying(true);
      setMarker(globe.viewer, target.lon, target.lat, heightM, target.name);
      removeMarker(globe.viewer, VENT_MARKER);
      // The place itself is the default vent.
      setVent({
        name: target.name,
        lat: target.lat,
        lon: target.lon,
        match: matchVolcano(target.lat, target.lon, target.volcanic === false),
      });
      flyToPoint(globe.viewer, target.lon, target.lat, heightM, view, () => setFlying(false));
    },
    [resetSim],
  );

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

  // While picking, the next click on the ground becomes the vent.
  useEffect(() => {
    const globe = globeRef.current;
    if (!picking || !globe) return;
    const { viewer } = globe;
    viewer.canvas.style.cursor = "crosshair";
    const handler = new ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const hit = pickGround(viewer, click.position.x, click.position.y);
      if (!hit) return;
      const name = `Point ${hit.lat.toFixed(3)}°, ${hit.lon.toFixed(3)}°`;
      setVent({ name, lat: hit.lat, lon: hit.lon, match: matchVolcano(hit.lat, hit.lon, false) });
      setMarker(viewer, hit.lon, hit.lat, hit.heightM, "Vent", VENT_MARKER, "#ffd166");
      setPicking(false);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
      viewer.canvas.style.cursor = "";
    };
  }, [picking]);

  const runDisaster = useCallback(
    async (runVent: Vent, runParams: Params, seed: number) => {
      const globe = globeRef.current;
      const controller = simRef.current;
      if (!globe || !controller) return;
      resetSim();
      setPicking(false);
      lastRunRef.current = { vent: runVent, params: runParams, seed };
      const ground = await sampleGroundHeight(globe, runVent.lon, runVent.lat);
      const instance = await controller.trigger(
        { viewer: globe.viewer, providerMode: globe.mode },
        disaster,
        { name: runVent.name, lon: runVent.lon, lat: runVent.lat, heightM: ground ?? 0 },
        runParams,
        seed,
      );
      if (!instance) return;
      // Pins would float in front of the plume; hide them until reset.
      globe.viewer.entities.show = false;
      const f = instance.framing;
      framingRef.current = f;
      flyToPoint(globe.viewer, f.lon, f.lat, f.heightM, { range: f.range, heading: f.heading, pitch: f.pitch });
    },
    [disaster, resetSim],
  );

  const trigger = () => {
    if (vent) runDisaster(vent, params, randomSeed());
  };

  const replay = () => {
    const last = lastRunRef.current;
    if (last) runDisaster(last.vent, last.params, last.seed);
  };

  const toggleOrbit = () => {
    const globe = globeRef.current;
    const f = framingRef.current;
    if (!globe || !f) return;
    if (stopOrbitRef.current) return stopOrbit();
    globe.viewer.camera.cancelFlight();
    stopOrbitRef.current = startOrbit(globe.viewer, f.lon, f.lat, f.heightM);
    setOrbiting(true);
  };

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
        setPicking(false);
        setSearch({ kind: "idle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = globeState === "ready";
  const simActive = sim.status !== "idle";

  return (
    <div className={simActive ? "app sim-active" : "app"}>
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
        <DisasterPanel
          disasters={DISASTERS}
          selectedId={disaster.id}
          onSelect={(id) => {
            const next = DISASTERS.find((d) => d.id === id);
            if (!next?.available) return;
            setDisasterId(id);
            setParams(next.defaults);
          }}
          params={params}
          onParam={(key, value) => setParams((p) => ({ ...p, [key]: value }))}
          vent={vent}
          picking={picking}
          onPickVent={() => setPicking((p) => !p)}
          busy={sim.status === "preparing"}
          onTrigger={trigger}
        />
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
              {simActive && (
                <div className="sim-details">
                  <h3>Simulation</h3>
                  <Row label="Phase" value={sim.phase} />
                  {sim.metrics.map((m) => (
                    <Row key={m.label} label={m.label} value={m.value} note={m.note} />
                  ))}
                  {sim.seed !== undefined && <Row label="Seed" value={String(sim.seed)} note="Replay uses the same seed" />}
                </div>
              )}
            </dl>
          )}
        </aside>
      )}

      {sim.error && (
        <div className="banner warn sim-error" role="alert">
          <span>The disaster could not start: {sim.error}</span>
        </div>
      )}

      {ready && simActive && (
        <SimControls
          state={sim}
          orbiting={orbiting}
          onPause={() => simRef.current?.pause()}
          onResume={() => simRef.current?.resume()}
          onReset={resetSim}
          onReplay={replay}
          onSpeed={(s) => simRef.current?.setSpeed(s)}
          onToggleEffects={() => simRef.current?.setEffectsVisible(!sim.effectsVisible)}
          onToggleOrbit={toggleOrbit}
        />
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
              <li><kbd>Esc</kbd> close menus or cancel picking a vent</li>
            </ul>
            <p className="fine">
              Terrain and imagery come from real geographic data. Eruptions are simplified time-lapse
              visualisations, not scientific forecasts.
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
