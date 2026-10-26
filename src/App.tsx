import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  BillboardCollection,
  HeadingPitchRange,
  ParticleSystem,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
} from "cesium";
import { GlobeView } from "./globe/GlobeView";
import { CameraRow, LoadingPill, PerformanceRow } from "./ui/LiveReadouts";
import { formatLatLon, formatMetres } from "./ui/format";
import {
  flyToPoint,
  pickGround,
  removeMarker,
  findSummit,
  sampleGroundHeight,
  setMarker,
  setQuality,
  startOrbit,
  type Globe,
  type Quality,
} from "./globe/createGlobe";
import { PRESETS, closeViewFor, viewForExtent, type CameraView, type Place } from "./data/places";
import { VOLCANOES, matchVolcano, volcanoView, type Volcano } from "./data/volcanoes";
import { VolcanoMenu } from "./ui/VolcanoMenu";
import { searchGoogle, searchOsm, type SearchResult } from "./services/geocode";
import { DISASTERS } from "./disasters/registry";
import { IDLE_STATE, SimulationController, type SimState } from "./disasters/controller";
import { randomSeed } from "./disasters/random";
import type { Params } from "./disasters/types";
import { DisasterPanel, type Vent } from "./ui/DisasterPanel";
import { SimControls } from "./ui/SimControls";
import { isPhone } from "./ui/isPhone";
import { SoundBoard } from "./audio/sound";

const sound = new SoundBoard();
/** How many times App has rendered; read through ?debug to check UI performance. */
let appRenders = 0;

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() || undefined;
const VENT_MARKER = "vent";
/** Quick-access chips; every other volcano is in the Volcanoes menu. */
const TOP_BAR_PRESETS = ["everest", "rainier"];

interface Selection {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  elevationM?: number;
  elevationSource?: string;
  volcanic?: boolean;
  /** Height the camera aims at, and the two framings the view buttons fly to. */
  aimHeightM: number;
  view: CameraView;
  closeView: CameraView;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: SearchResult[]; attribution: string }
  | { kind: "error"; message: string };

export default function App() {
  appRenders++;
  const globeRef = useRef<Globe | null>(null);
  const simRef = useRef<SimulationController | null>(null);
  const stopOrbitRef = useRef<(() => void) | null>(null);
  const lastRunRef = useRef<{ vent: Vent; params: Params; seed: number } | null>(null);
  /** Where the camera looks for the current eruption; the orbit circles this point. */
  const framingRef = useRef<{ lon: number; lat: number; heightM: number } | null>(null);

  const [globeState, setGlobeState] = useState<"loading" | "ready" | "error">("loading");
  const [fatalError, setFatalError] = useState<string>();
  const [providerNote, setProviderNote] = useState<string>();
  /** The globe once ready, for components that subscribe to it directly. */
  const [readyGlobe, setReadyGlobe] = useState<Globe>();
  const [selection, setSelection] = useState<Selection>();
  const [flying, setFlying] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [panelOpen, setPanelOpen] = useState(!isPhone());
  const [helpOpen, setHelpOpen] = useState(false);
  const [quality, setQualityState] = useState<Quality>("terrain");
  const [photorealAvailable, setPhotorealAvailable] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "close">("overview");
  const searchAbort = useRef<AbortController | null>(null);
  const searchSeq = useRef(0);

  const [disasterId, setDisasterId] = useState(DISASTERS[0].id);
  const disaster = DISASTERS.find((d) => d.id === disasterId) ?? DISASTERS[0];
  const [params, setParams] = useState<Params>(disaster.defaults);
  const [vent, setVent] = useState<Vent>();
  const [picking, setPicking] = useState(false);
  const [sim, setSim] = useState<SimState>(IDLE_STATE);
  const [orbiting, setOrbiting] = useState(false);
  const [muted, setMuted] = useState(sound.muted);
  /** Bumped on each boom; keys the screen-flash element so its animation replays. */
  const [flash, setFlash] = useState(0);
  const lastBooms = useRef(0);

  useEffect(() => {
    if (sim.booms > lastBooms.current) setFlash((n) => n + 1);
    lastBooms.current = sim.booms;
  }, [sim.booms]);

  const handleReady = useCallback((globe: Globe) => {
    globeRef.current = globe;
    simRef.current = new SimulationController(globe.viewer, sound, setSim);
    // ?debug exposes the viewer in the console for testing camera views.
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { earthbreaker: unknown }).earthbreaker = {
        viewer: globe.viewer,
        sim: simRef.current,
        perf: globe.perf,
        renders: () => appRenders,
        cesium: { HeadingPitchRange, ParticleSystem, BillboardCollection },
      };
    }
    setGlobeState("ready");
    setReadyGlobe(globe);
    setQualityState(globe.quality);
    setPhotorealAvailable(!!globe.photoreal);
    if (globe.providerError) {
      setProviderNote(`${globe.providerError} Showing street-map imagery on flat terrain instead.`);
    } else if (globe.mode === "fallback") {
      setProviderNote(
        "No Cesium ion token, so terrain is flat and imagery is a street map. Add VITE_CESIUM_ION_TOKEN to .env.local for real elevation and satellite imagery (see README).",
      );
    } else if (globe.photorealError) {
      setProviderNote(`${globe.photorealError} Showing terrain with satellite imagery instead.`);
    }
  }, []);

  const toggleQuality = useCallback(() => {
    const globe = globeRef.current;
    if (!globe?.photoreal) return;
    setQuality(globe, globe.quality === "photoreal" ? "terrain" : "photoreal");
    setQualityState(globe.quality);
    // Search results came from the other mode's provider, so clear them.
    setSearch({ kind: "idle" });
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
    (target: Selection) => {
      const globe = globeRef.current;
      if (!globe) return;
      // Changing location ends the current disaster (and frees its GPU resources).
      resetSim();
      setPicking(false);
      setSelection(target);
      setActiveView("overview");
      setFlying(true);
      setMarker(globe.viewer, target.lon, target.lat, target.aimHeightM, target.name);
      removeMarker(globe.viewer, VENT_MARKER);
      // The place itself is the default vent.
      setVent({
        name: target.name,
        lat: target.lat,
        lon: target.lon,
        match: matchVolcano(target.lat, target.lon, target.volcanic === false),
      });
      flyToPoint(globe.viewer, target.lon, target.lat, target.aimHeightM, target.view, () => setFlying(false));
    },
    [resetSim],
  );

  /** Re-frames the selected place: the wide overview or the low close-up. */
  const showView = useCallback(
    (which: "overview" | "close") => {
      const globe = globeRef.current;
      if (!globe || !selection) return;
      stopOrbit();
      setActiveView(which);
      setFlying(true);
      const view = which === "close" ? selection.closeView : selection.view;
      flyToPoint(globe.viewer, selection.lon, selection.lat, selection.aimHeightM, view, () => setFlying(false));
    },
    [selection, stopOrbit],
  );

  const goToPreset = useCallback(
    (place: Place) => {
      setSearch({ kind: "idle" });
      goTo({
        name: place.name,
        detail: place.region,
        lat: place.lat,
        lon: place.lon,
        elevationM: place.elevationM,
        elevationSource: place.elevationSource,
        volcanic: place.volcanic,
        // On the flat fallback globe the summit is at sea level, so aim there.
        aimHeightM: globeRef.current?.mode === "ion" ? (place.elevationM ?? 0) : 0,
        view: place.view,
        closeView: place.closeView,
      });
    },
    [goTo],
  );

  /** Flies to a volcano from the menu, with the vent moved onto its summit where it has one. */
  const goToVolcano = useCallback(
    async (volcano: Volcano) => {
      const globe = globeRef.current;
      if (!globe) return;
      setSearch({ kind: "idle" });
      const summit = volcano.snap ? await findSummit(globe, volcano.lon, volcano.lat) : undefined;
      const lat = summit?.lat ?? volcano.lat;
      const lon = summit?.lon ?? volcano.lon;
      const ground = summit?.heightM ?? (await sampleGroundHeight(globe, lon, lat));
      const view = volcanoView(volcano);
      goTo({
        name: volcano.name,
        detail: `${volcano.country} · ${volcano.note}`,
        lat,
        lon,
        elevationM: ground,
        elevationSource: ground === undefined ? undefined : summit ? "Highest point nearby, Cesium World Terrain" : "Cesium World Terrain",
        volcanic: true,
        aimHeightM: ground ?? 0,
        view,
        closeView: closeViewFor(view),
      });
    },
    [goTo],
  );

  const goToResult = useCallback(
    async (result: SearchResult) => {
      const globe = globeRef.current;
      if (!globe) return;
      setSearch({ kind: "idle" });
      const ground = await sampleGroundHeight(globe, result.lon, result.lat);
      const view = viewForExtent(result.spanDegrees);
      goTo({
        name: result.name,
        detail: result.detail,
        lat: result.lat,
        lon: result.lon,
        elevationM: ground,
        elevationSource: ground === undefined ? undefined : "Cesium World Terrain",
        aimHeightM: ground ?? 0,
        view,
        closeView: closeViewFor(view),
      });
    },
    [goTo],
  );

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    const globe = globeRef.current;
    if (!q || !globe) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const seq = ++searchSeq.current;
    setSearch({ kind: "loading" });
    try {
      // Google's tiles may only be used with Google's geocoder.
      const { results, attribution } =
        globe.quality === "photoreal" ? await searchGoogle(globe.viewer.scene, q) : await searchOsm(q, controller.signal);
      if (seq !== searchSeq.current) return;
      setSearch(
        results.length
          ? { kind: "results", results, attribution }
          : { kind: "error", message: `No places found for “${q}”.` },
      );
    } catch (err) {
      if (controller.signal.aborted || seq !== searchSeq.current) return;
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
        { viewer: globe.viewer, providerMode: globe.mode, sound, perf: globe.perf },
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

  // Both run inside a click, which is when browsers allow audio to start.
  const trigger = useCallback(() => {
    sound.unlock();
    if (vent) runDisaster(vent, params, randomSeed());
  }, [vent, params, runDisaster]);

  // Stable callbacks so the (memoised) disaster panel doesn't re-render ten
  // times a second while a simulation updates the rest of the app.
  const selectDisaster = useCallback((id: string) => {
    const next = DISASTERS.find((d) => d.id === id);
    if (!next?.available) return;
    setDisasterId(id);
    setParams(next.defaults);
  }, []);
  const changeParam = useCallback((key: string, value: number) => setParams((p) => ({ ...p, [key]: value })), []);
  const togglePicking = useCallback(() => setPicking((p) => !p), []);

  const replay = () => {
    sound.unlock();
    const last = lastRunRef.current;
    if (last) runDisaster(last.vent, last.params, last.seed);
  };

  const toggleSound = () => {
    sound.unlock();
    sound.setMuted(!muted);
    setMuted(!muted);
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
    const volcano = VOLCANOES.find((v) => v.id === id);
    if (preset) goToPreset(preset);
    else if (volcano) void goToVolcano(volcano);
  }, [globeState, goToPreset, goToVolcano]);

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
              <li className="attribution">{search.attribution}</li>
            </ul>
          )}
          {search.kind === "error" && <p className="results note">{search.message}</p>}
        </div>

        <nav className="presets" aria-label="Featured places">
          {PRESETS.filter((p) => TOP_BAR_PRESETS.includes(p.id)).map((p) => (
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
          <VolcanoMenu disabled={!ready} onPick={goToVolcano} />
          <button
            type="button"
            className={quality === "photoreal" ? "chip active" : "chip"}
            onClick={toggleQuality}
            disabled={!ready || !photorealAvailable}
            aria-pressed={quality === "photoreal"}
            title={
              photorealAvailable
                ? "Switch between photorealistic 3D (Google) and terrain with satellite imagery"
                : "Photorealistic 3D needs a working Cesium ion token"
            }
          >
            Photoreal 3D
          </button>
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
          onSelect={selectDisaster}
          params={params}
          onParam={changeParam}
          vent={vent}
          picking={picking}
          onPickVent={togglePicking}
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
                    <div className="view-buttons" role="group" aria-label="Camera view">
                      <button
                        type="button"
                        className={activeView === "overview" ? "chip active" : "chip"}
                        onClick={() => showView("overview")}
                      >
                        Overview
                      </button>
                      <button
                        type="button"
                        className={activeView === "close" ? "chip active" : "chip"}
                        onClick={() => showView("close")}
                      >
                        Close-up
                      </button>
                    </div>
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
              {readyGlobe && <CameraRow globe={readyGlobe} />}
              {readyGlobe && <PerformanceRow globe={readyGlobe} />}
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
          muted={muted}
          onToggleSound={toggleSound}
        />
      )}

      {flash > 0 && sim.effectsVisible && <div key={flash} className="screen-flash" aria-hidden="true" />}

      {readyGlobe && <LoadingPill globe={readyGlobe} flying={flying} />}

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
