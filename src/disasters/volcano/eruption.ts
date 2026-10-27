import { Cartesian3, Cartographic, Rectangle, sampleTerrain } from "cesium";
import type { DisasterContext, DisasterDefinition, DisasterInstance, DisasterStatus, Metric, Params, Site } from "../types";
import { seededRandom } from "../random";
import { breachVent } from "./lavaSim";
import type { LavaRequest, LavaSnapshot, LavaView } from "./lavaProtocol";
import { BuildingFires } from "./fires";
import { LavaLayer } from "./lavaLayer";
import { Plume } from "./plume";
import { Debris } from "./debris";

/** Lava model resolution: 176 × 176 cells, 57–150 m each depending on the lava setting. */
const GRID = 176;
/** How often the worker's lava is fetched and repainted; ~5 times a second looks smooth. */
const LAVA_REPAINT_MS = 200;
/** Lava never reaches farther than this from the vent. */
const MAX_RUNOUT_M = 10_000;
/** Column heights by intensity 1–5, in km, before the plume-scale multiplier. */
const COLUMN_KM = [3, 6, 10, 16, 24];

/**
 * Timeline as fractions of the duration.
 * Warning: steam, a growing glow, rumbling and shaking.
 * Boom (at mainStart): flash, blast ring, fireball, surge, jet of ash, big shake.
 * Main eruption: ash column, ejecta, lightning, column collapses sending surges.
 * Lava erupts from shortly after the boom.
 * Aftermath: the plume thins and the lava cools.
 */
const PHASES = {
  mainStart: 0.07,
  mainEnd: 0.55,
  ashFadeEnd: 0.78,
  lavaStart: 0.1,
  lavaEnd: 0.7,
  /** Column collapses, as fractions of the duration. */
  collapses: [0.2, 0.32, 0.45],
};

export const volcanicEruption: DisasterDefinition = {
  id: "volcano",
  name: "Volcanic eruption",
  category: "Geological",
  available: true,
  description:
    "The ground shakes, then the vent explodes: a blast wave, a towering ash column with lightning, surges racing down the slopes, and lava flowing over the real terrain.",
  params: [
    { key: "intensity", label: "Eruption intensity", min: 1, max: 5, step: 1, hint: "Sets the blast, the column height and how much is thrown out" },
    { key: "duration", label: "Duration", min: 45, max: 240, step: 15, unit: "s", hint: "Length of the time-lapse" },
    { key: "plumeScale", label: "Ash plume scale", min: 0.5, max: 1.5, step: 0.1, unit: "×" },
    { key: "lava", label: "Lava flow", min: 0, max: 5, step: 1, hint: "0 turns lava off" },
    { key: "windDir", label: "Wind blowing toward", min: 0, max: 345, step: 15, unit: "°", hint: "0 = north, 90 = east" },
    { key: "windSpeed", label: "Wind strength", min: 0, max: 10, step: 1 },
  ],
  defaults: { intensity: 4, duration: 90, plumeScale: 1, lava: 3, windDir: 90, windSpeed: 4 },
  create: createEruption,
};

async function createEruption(ctx: DisasterContext, site: Site, params: Params, seed: number): Promise<DisasterInstance> {
  const { viewer, sound, perf } = ctx;
  const rng = seededRandom(seed);
  const intensity = params.intensity;
  const duration = params.duration;
  const columnM = COLUMN_KM[intensity - 1] * 1000 * params.plumeScale;
  const windRad = (params.windDir * Math.PI) / 180;
  // Time-lapsed wind: each step of the slider drifts the cloud about 1.5% of
  // the column height per second.
  const windSpeed = params.windSpeed * columnM * 0.015;
  // How violent the explosive moments are, 0.4–1.
  const blast = 0.25 + intensity * 0.15;

  const vent = Cartesian3.fromDegrees(site.lon, site.lat, site.heightM);
  const plume = new Plume(viewer.scene, {
    vent,
    columnHeightM: columnM,
    windEast: Math.sin(windRad) * windSpeed,
    windNorth: Math.cos(windRad) * windSpeed,
    intensity,
  });

  // Lava grid: a square centred on the vent, from 10 km across (setting 1) to
  // 26 km (setting 5), big enough for flows to reach towns on the lower slopes.
  const lavaOn = params.lava > 0;
  const halfSizeM = 3000 + params.lava * 2000;
  const cellM = (2 * halfSizeM) / GRID;
  const dLat = halfSizeM / 110_540;
  const dLon = halfSizeM / (111_320 * Math.cos((site.lat * Math.PI) / 180));
  const rectangle = Rectangle.fromDegrees(site.lon - dLon, site.lat - dLat, site.lon + dLon, site.lat + dLat);
  // Effusion rate in time-lapse cubic metres per second.
  const effusion = 12_000 * params.lava * params.lava;

  // The lava model runs in a worker (lavaWorker.ts); `view` holds its latest
  // snapshot for the texture and the fires, `latest` its numbers.
  let sim: LavaView | undefined;
  let latest: LavaSnapshot | undefined;
  let worker: Worker | undefined;
  let waiting = false;
  let finalSent = false;
  let lastAsk = 0;
  let layer: LavaLayer | undefined;
  let ground: Float32Array | undefined;
  let groundLowest = site.heightM;
  let terrainNote = "";
  let destroyed = false;

  // Ground heights around the vent come from the terrain model; the lava flows
  // over them and debris lands on them. On the flat fallback globe there is no
  // terrain, so the ground is level.
  loadGround(ctx, rectangle, cellM).then((loaded) => {
    if (destroyed) return;
    ground = loaded.ground;
    groundLowest = ground.reduce((a, b) => Math.min(a, b), Infinity);
    terrainNote = loaded.note;
    if (!lavaOn) return;
    const view: LavaView = {
      size: GRID,
      cellSizeM: cellM,
      thickness: new Float32Array(GRID * GRID),
      temperature: new Float32Array(GRID * GRID),
    };
    worker = new Worker(new URL("./lavaWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<LavaSnapshot>) => {
      if (destroyed) return;
      latest = event.data;
      view.thickness = latest.thickness;
      view.temperature = latest.temperature;
      waiting = false;
      layer?.render();
      viewer.scene.requestRender();
    };
    const request: LavaRequest = {
      type: "init",
      size: GRID,
      cellSizeM: cellM,
      ground,
      // Lava breaks out through the lowest notch of the crater and runs down that side.
      ventCells: breachVent(ground, GRID, cellM),
      seed,
      maxRunoutM: MAX_RUNOUT_M,
      schedule: { duration, lavaStart: PHASES.lavaStart, lavaEnd: PHASES.lavaEnd, effusion },
    };
    worker.postMessage(request);
    sim = view;
    layer = new LavaLayer(viewer.scene, view, rectangle, rng);
  });

  /** Terrain height at a point east/north of the vent: the grid where it has data, a guess beyond it. */
  const groundAt = (east: number, north: number): number => {
    const col = (east + halfSizeM) / cellM - 0.5;
    const row = (halfSizeM - north) / cellM - 0.5;
    if (ground && col >= 0 && row >= 0 && col < GRID - 1 && row < GRID - 1) {
      const c0 = Math.floor(col);
      const r0 = Math.floor(row);
      const fc = col - c0;
      const fr = row - r0;
      const i = r0 * GRID + c0;
      const top = ground[i] * (1 - fc) + ground[i + 1] * fc;
      const bottom = ground[i + GRID] * (1 - fc) + ground[i + GRID + 1] * fc;
      return top * (1 - fr) + bottom * fr;
    }
    // Outside the grid (or before it loads): assume the slopes keep falling away.
    return Math.max(groundLowest, site.heightM - 0.3 * Math.hypot(east, north));
  };

  // Real OpenStreetMap buildings in the lava's path catch fire when it reaches them.
  const metresPerLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  const fires =
    lavaOn && ctx.buildings
      ? new BuildingFires(viewer.scene, ctx.buildings, {
          sim: () => sim,
          rect: {
            west: site.lon - dLon,
            south: site.lat - dLat,
            east: site.lon + dLon,
            north: site.lat + dLat,
          },
          groundAt: (lon, lat) => groundAt((lon - site.lon) * metresPerLon, (lat - site.lat) * 110_540),
          up: plume.up,
        })
      : undefined;

  const debris = new Debris(viewer.scene, {
    vent,
    ventHeightM: site.heightM,
    east: plume.east,
    north: plume.north,
    up: plume.up,
    columnHeightM: columnM,
    groundAt,
    snowy: site.heightM > 2800,
  });

  // Imagery dims while ash fills the sky, then recovers.
  const baseLayer = viewer.imageryLayers.get(0);
  const baseBrightness = baseLayer?.brightness ?? 1;

  const boomAt = PHASES.mainStart * duration;
  const collapseAt = PHASES.collapses.map((f) => f * duration);
  let nextCollapse = 0;
  let booms = 0;
  let lastElapsed = 0;
  let lastCollapse = -Infinity;
  let debrisCarry = 0;
  let visible = true;
  let shake = 0;
  let current: DisasterStatus = { phase: "Warning signs", metrics: [], booms: 0 };

  const instance: DisasterInstance = {
    duration,
    framing: {
      // Aim a little downwind of the vent so the drifting cloud stays in frame.
      lon: site.lon + (Math.sin(windRad) * params.windSpeed * columnM * 0.02) / (111_320 * Math.cos((site.lat * Math.PI) / 180)),
      lat: site.lat + (Math.cos(windRad) * params.windSpeed * columnM * 0.02) / 110_540,
      // Close and low, so the column towers over the camera rather than
      // sitting small in the middle of a map.
      heightM: site.heightM + columnM * 0.3,
      range: Math.max(columnM * 1.8, halfSizeM * 2.4),
      // Look across the wind so the plume drifts sideways through the frame.
      heading: (params.windDir + 90) % 360,
      pitch: -7,
    },

    update(elapsed, dt) {
      const f = elapsed / duration;
      const main = f >= PHASES.mainStart && f < PHASES.mainEnd;
      const ashLevel = f < PHASES.mainStart
        ? 0
        : f < PHASES.mainEnd
          ? Math.min(1, (elapsed - boomAt) / 3)
          : Math.max(0, 1 - (f - PHASES.mainEnd) / (PHASES.ashFadeEnd - PHASES.mainEnd));
      const warning = Math.min(1, f / PHASES.mainStart);

      // Events fire once, when the timeline passes them.
      const budget = perf.effects;
      if (lastElapsed < boomAt && elapsed >= boomAt) {
        plume.boom(blast);
        sound.boom(blast);
        // The blast tears the summit apart: a big burst of rock, bombs and ice.
        debris.burst(Math.round((90 + 50 * intensity) * budget), 0.75 + 0.25 * blast);
        booms++;
      }
      while (nextCollapse < collapseAt.length && elapsed >= collapseAt[nextCollapse]) {
        if (lastElapsed < collapseAt[nextCollapse]) {
          plume.collapse(blast * 0.7);
          sound.boom(blast * 0.45);
          debris.burst(Math.round((25 + 12 * intensity) * budget), 0.6);
          lastCollapse = elapsed;
        }
        nextCollapse++;
      }
      // A steady spatter of pieces while the vent roars.
      if (main && dt > 0) {
        debrisCarry += (1.5 + 1.5 * intensity) * budget * dt;
        const n = Math.floor(debrisCarry);
        if (n > 0) {
          debris.burst(n, 0.45 + Math.random() * 0.3);
          debrisCarry -= n;
        }
      }
      debris.tick(dt);
      fires?.tick(dt);
      // Lightning strikes at random while the column is thick.
      if (main && ashLevel > 0.6 && dt > 0) {
        const perSecond = 0.3 + intensity * 0.35;
        if (Math.random() < 1 - Math.exp(-perSecond * dt)) {
          plume.lightning();
          if (Math.random() < 0.6) sound.thunder();
        }
      }
      lastElapsed = elapsed;

      plume.set(
        {
          steam: f < PHASES.mainStart ? 4 + 12 * warning : 3,
          ash: ashLevel * (12 + 8 * intensity),
          ejecta: main ? 6 + 6 * intensity : 0,
          glow: f < PHASES.mainStart ? warning : Math.max(0.15, ashLevel),
        },
        budget,
      );
      plume.tick(dt);
      if (baseLayer && visible) baseLayer.brightness = baseBrightness * (1 - 0.22 * ashLevel);

      sound.level("rumble", f < PHASES.mainStart ? 0.25 + 0.75 * warning * warning : 0.55 * ashLevel);
      sound.level("roar", 0.85 * ashLevel * (0.6 + 0.08 * intensity));

      // Shake builds through the warning, hits hard at the boom and decays,
      // kicks again with each collapse, and trembles while the column roars.
      const sinceBoom = elapsed - boomAt;
      shake = Math.max(
        f < PHASES.mainStart ? 0.25 * warning * warning : 0,
        sinceBoom >= 0 ? blast * Math.exp(-sinceBoom / 1.1) : 0,
        0.45 * blast * Math.exp(-(elapsed - lastCollapse) / 0.8),
        0.1 * ashLevel,
      );

      // Ask the lava worker to catch up to the clock about five times a second
      // (one request at a time), and once more at the very end so the
      // aftermath shows the flows fully crusted over.
      if (worker && !waiting) {
        const now = performance.now();
        if ((f >= 1 && !finalSent) || (f < 1 && now - lastAsk > LAVA_REPAINT_MS)) {
          const ask: LavaRequest = { type: "advance", elapsed: Math.min(elapsed, duration) };
          worker.postMessage(ask);
          waiting = true;
          lastAsk = now;
          if (f >= 1) finalSent = true;
        }
      }

      if (f >= 1) {
        sound.level("rumble", 0);
        sound.level("roar", 0);
      }
      current = {
        phase: f < PHASES.mainStart ? "Warning signs" : f < PHASES.mainEnd ? "Main eruption" : f < 1 ? "Aftermath" : "Ended",
        metrics: metrics(),
        booms,
      };
    },

    status: () => current,

    shake: () => (visible ? shake : 0),

    setVisible(show) {
      visible = show;
      plume.show = show;
      debris.show = show;
      if (fires) fires.show = show;
      if (layer) layer.show = show;
      if (!show && baseLayer) baseLayer.brightness = baseBrightness;
    },

    destroy() {
      destroyed = true;
      worker?.terminate();
      plume.destroy();
      debris.destroy();
      fires?.destroy();
      layer?.destroy();
      sound.stop();
      if (baseLayer && !baseLayer.isDestroyed()) baseLayer.brightness = baseBrightness;
    },
  };

  function metrics(): Metric[] {
    const list: Metric[] = [
      { label: "Ash column", value: `${(columnM / 1000).toFixed(1)} km`, note: "Set by intensity and scale, not computed" },
    ];
    if (!lavaOn) return list;
    if (!sim) return [...list, { label: "Lava", value: "Reading terrain…" }];
    const lava = latest ?? { areaKm2: 0, runoutKm: 0, moltenShare: 0, reachedEdge: false };
    list.push(
      { label: "Lava area", value: `${lava.areaKm2.toFixed(2)} km²`, note: `Simulated estimate${terrainNote}` },
      { label: "Runout", value: `${lava.runoutKm.toFixed(1)} km`, note: lava.reachedEdge ? "Reached the edge of the modelled area" : "Farthest lava from the vent" },
      { label: "Still molten", value: `${Math.round(lava.moltenShare * 100)}%` },
    );
    if (fires) {
      list.push({
        label: "Buildings hit",
        value: `${fires.reached.toLocaleString()} reached · ${fires.destroyed.toLocaleString()} buried`,
        note: "OpenStreetMap buildings in loaded map tiles; zoom in to load more",
      });
    } else if (!ctx.buildings) {
      list.push({ label: "Buildings", value: "Not available", note: "Building data needs a Cesium ion token" });
    }
    return list;
  }

  return instance;
}

async function loadGround(ctx: DisasterContext, rectangle: Rectangle, cellM: number): Promise<{ ground: Float32Array; note: string }> {
  const ground = new Float32Array(GRID * GRID);
  if (ctx.providerMode !== "ion") {
    // No terrain model: the ground is level except where it has been sculpted.
    let sculpted = false;
    const toDeg = 180 / Math.PI;
    for (let row = 0; row < GRID; row++) {
      const lat = (rectangle.north - ((row + 0.5) / GRID) * rectangle.height) * toDeg;
      for (let col = 0; col < GRID; col++) {
        const lon = (rectangle.west + ((col + 0.5) / GRID) * rectangle.width) * toDeg;
        const h = ctx.sculptDelta(lon, lat);
        ground[row * GRID + col] = h;
        if (h !== 0) sculpted = true;
      }
    }
    return { ground, note: sculpted ? " on sculpted ground (no terrain token)" : " · flat ground (no terrain token)" };
  }

  const points: Cartographic[] = [];
  for (let row = 0; row < GRID; row++) {
    // Row 0 is the north edge; sample at cell centres.
    const lat = rectangle.north - ((row + 0.5) / GRID) * rectangle.height;
    for (let col = 0; col < GRID; col++) {
      const lon = rectangle.west + ((col + 0.5) / GRID) * rectangle.width;
      points.push(new Cartographic(lon, lat));
    }
  }
  try {
    // Sample at the one terrain level whose detail matches the lava cells
    // (a tile at level L is 180/2^L degrees wide with ~64 samples across).
    // "Most detailed" fetched many times more tiles than the model can use,
    // which delayed the lava by up to a minute while Google's tiles loaded.
    const level = Math.max(9, Math.min(13, Math.round(Math.log2((180 * 111_320) / (64 * cellM)))));
    const sampled = await sampleTerrain(ctx.viewer.terrainProvider, level, points);
    sampled.forEach((p, i) => (ground[i] = Number.isFinite(p.height) ? p.height : 0));
    return { ground, note: " on real terrain" };
  } catch {
    return { ground, note: " · terrain unavailable, flat ground used" };
  }
}
