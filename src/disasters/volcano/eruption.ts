import { Cartesian3, Cartographic, Rectangle, sampleTerrainMostDetailed } from "cesium";
import type { DisasterContext, DisasterDefinition, DisasterInstance, DisasterStatus, Metric, Params, Site } from "../types";
import { seededRandom } from "../random";
import { LavaSim } from "./lavaSim";
import { LavaLayer } from "./lavaLayer";
import { Plume } from "./plume";

const GRID = 128;
const LAVA_STEP_S = 0.1;
/** Cap on model steps per frame so a slow frame can't snowball. */
const MAX_STEPS_PER_FRAME = 30;
const LAVA_REPAINT_MS = 120;
/** Column heights by intensity 1–5, in km, before the plume-scale multiplier. */
const COLUMN_KM = [3, 6, 10, 16, 24];

/**
 * Timeline as fractions of the duration. Warning: steam and a glow. Main
 * eruption: ash column, ejecta, flash at the start. Lava erupts from shortly
 * after the main phase begins. Aftermath: the plume thins and the lava cools.
 */
const PHASES = {
  mainStart: 0.08,
  mainEnd: 0.55,
  ashFadeEnd: 0.78,
  lavaStart: 0.12,
  lavaEnd: 0.7,
};

export const volcanicEruption: DisasterDefinition = {
  id: "volcano",
  name: "Volcanic eruption",
  category: "Geological",
  available: true,
  description: "An ash column rises from the vent, glowing rock is thrown out, and lava flows downhill over the real terrain.",
  params: [
    { key: "intensity", label: "Eruption intensity", min: 1, max: 5, step: 1, hint: "Sets the ash column height and how much is thrown out" },
    { key: "duration", label: "Duration", min: 45, max: 240, step: 15, unit: "s", hint: "Length of the time-lapse" },
    { key: "plumeScale", label: "Ash plume scale", min: 0.5, max: 1.5, step: 0.1, unit: "×" },
    { key: "lava", label: "Lava flow", min: 0, max: 5, step: 1, hint: "0 turns lava off" },
    { key: "windDir", label: "Wind blowing toward", min: 0, max: 345, step: 15, unit: "°", hint: "0 = north, 90 = east" },
    { key: "windSpeed", label: "Wind strength", min: 0, max: 10, step: 1 },
  ],
  defaults: { intensity: 3, duration: 90, plumeScale: 1, lava: 3, windDir: 90, windSpeed: 4 },
  create: createEruption,
};

async function createEruption(ctx: DisasterContext, site: Site, params: Params, seed: number): Promise<DisasterInstance> {
  const { viewer } = ctx;
  const rng = seededRandom(seed);
  const intensity = params.intensity;
  const duration = params.duration;
  const columnM = COLUMN_KM[intensity - 1] * 1000 * params.plumeScale;
  const windRad = (params.windDir * Math.PI) / 180;
  // Time-lapsed wind: each step of the slider drifts the cloud about 1.5% of
  // the column height per second.
  const windSpeed = params.windSpeed * columnM * 0.015;

  const vent = Cartesian3.fromDegrees(site.lon, site.lat, site.heightM);
  const plume = new Plume(viewer.scene, {
    vent,
    columnHeightM: columnM,
    windEast: Math.sin(windRad) * windSpeed,
    windNorth: Math.cos(windRad) * windSpeed,
    intensity,
  });

  // Lava grid: a square centred on the vent, bigger for stronger flows.
  const lavaOn = params.lava > 0;
  const halfSizeM = 2500 + params.lava * 1300;
  const cellM = (2 * halfSizeM) / GRID;
  const dLat = halfSizeM / 110_540;
  const dLon = halfSizeM / (111_320 * Math.cos((site.lat * Math.PI) / 180));
  const rectangle = Rectangle.fromDegrees(site.lon - dLon, site.lat - dLat, site.lon + dLon, site.lat + dLat);
  // Effusion rate in time-lapse cubic metres per second.
  const effusion = 12_000 * params.lava * params.lava;

  let sim: LavaSim | undefined;
  let layer: LavaLayer | undefined;
  let terrainNote = "";
  let destroyed = false;

  if (lavaOn) {
    // Ground heights for the grid come from the terrain model. On the flat
    // fallback globe there is no terrain, so lava spreads over level ground.
    loadGround(ctx, rectangle).then(({ ground, note }) => {
      if (destroyed) return;
      terrainNote = note;
      const mid = (GRID / 2) * GRID + GRID / 2;
      sim = new LavaSim({
        size: GRID,
        cellSizeM: cellM,
        ground,
        ventCells: [mid, mid - 1, mid + 1, mid - GRID, mid + GRID],
        rng,
      });
      layer = new LavaLayer(viewer.scene, sim, rectangle, rng);
    });
  }

  // Imagery dims a little while ash fills the sky, then recovers.
  const baseLayer = viewer.imageryLayers.get(0);
  const baseBrightness = baseLayer?.brightness ?? 1;

  let lavaClock = 0;
  let lastPaint = 0;
  let visible = true;
  let current: DisasterStatus = { phase: "Warning signs", metrics: [] };

  const instance: DisasterInstance = {
    duration,
    framing: {
      // Aim a little downwind of the vent so the drifting cloud stays in frame.
      lon: site.lon + (Math.sin(windRad) * params.windSpeed * columnM * 0.02) / (111_320 * Math.cos((site.lat * Math.PI) / 180)),
      lat: site.lat + (Math.cos(windRad) * params.windSpeed * columnM * 0.02) / 110_540,
      heightM: site.heightM + columnM * 0.4,
      range: Math.max(columnM * 3.2, halfSizeM * 2.8),
      // Look across the wind so the plume drifts sideways through the frame.
      heading: (params.windDir + 90) % 360,
      pitch: -14,
    },

    update(elapsed) {
      const f = elapsed / duration;
      const main = f >= PHASES.mainStart && f < PHASES.mainEnd;
      const ashLevel = f < PHASES.mainStart
        ? 0
        : f < PHASES.mainEnd
          ? Math.min(1, (elapsed - PHASES.mainStart * duration) / 4)
          : Math.max(0, 1 - (f - PHASES.mainEnd) / (PHASES.ashFadeEnd - PHASES.mainEnd));
      const sinceStart = elapsed - PHASES.mainStart * duration;
      plume.set({
        steam: f < PHASES.mainStart ? 4 + 10 * (f / PHASES.mainStart) : 3,
        ash: ashLevel * (18 + intensity * 12),
        ejecta: main ? 8 + intensity * 10 : 0,
        glow: f < PHASES.mainStart ? f / PHASES.mainStart : Math.max(0.15, ashLevel),
        flash: sinceStart >= 0 && sinceStart < 2 ? 1 - sinceStart / 2 : 0,
      });
      if (baseLayer && visible) baseLayer.brightness = baseBrightness * (1 - 0.18 * ashLevel);

      if (sim && layer) {
        const target = Math.max(0, elapsed - PHASES.lavaStart * duration);
        let steps = 0;
        while (lavaClock + LAVA_STEP_S <= target && steps < MAX_STEPS_PER_FRAME) {
          const lf = (lavaClock + PHASES.lavaStart * duration) / duration;
          // Effusion eases off over the last fifth of the lava phase. After it
          // stops, cooling speeds up (up to 25×) so the flows have crusted over
          // into dark rock by the end of the time-lapse.
          const taper = Math.min(1, Math.max(0, (PHASES.lavaEnd - lf) / 0.12));
          const cooling = lf < PHASES.lavaEnd ? 1 : 1 + 24 * Math.min(1, (lf - PHASES.lavaEnd) / (0.92 - PHASES.lavaEnd));
          sim.step(LAVA_STEP_S, lf < PHASES.lavaEnd ? effusion * taper : 0, cooling);
          lavaClock += LAVA_STEP_S;
          steps++;
        }
        const now = performance.now();
        if (steps > 0 && now - lastPaint > LAVA_REPAINT_MS) {
          layer.render();
          lastPaint = now;
        }
      }

      current = {
        phase: f < PHASES.mainStart ? "Warning signs" : f < PHASES.mainEnd ? "Main eruption" : f < 1 ? "Aftermath" : "Ended",
        metrics: metrics(),
      };
    },

    status: () => current,

    setVisible(show) {
      visible = show;
      plume.show = show;
      if (layer) layer.show = show;
      if (!show && baseLayer) baseLayer.brightness = baseBrightness;
    },

    destroy() {
      destroyed = true;
      plume.destroy();
      layer?.destroy();
      if (baseLayer && !baseLayer.isDestroyed()) baseLayer.brightness = baseBrightness;
    },
  };

  function metrics(): Metric[] {
    const list: Metric[] = [
      { label: "Ash column", value: `${(columnM / 1000).toFixed(1)} km`, note: "Set by intensity and scale, not computed" },
    ];
    if (!lavaOn) return list;
    if (!sim) return [...list, { label: "Lava", value: "Reading terrain…" }];
    list.push(
      { label: "Lava area", value: `${sim.coveredAreaKm2().toFixed(2)} km²`, note: `Simulated estimate${terrainNote}` },
      { label: "Runout", value: `${sim.runoutKm().toFixed(1)} km`, note: sim.reachedEdge() ? "Reached the edge of the modelled area" : "Farthest lava from the vent" },
      { label: "Still molten", value: `${Math.round(sim.moltenShare() * 100)}%` },
    );
    return list;
  }

  return instance;
}

async function loadGround(ctx: DisasterContext, rectangle: Rectangle): Promise<{ ground: Float32Array; note: string }> {
  const ground = new Float32Array(GRID * GRID);
  if (ctx.providerMode !== "ion") return { ground, note: " · flat ground (no terrain token)" };

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
    const sampled = await sampleTerrainMostDetailed(ctx.viewer.terrainProvider, points);
    sampled.forEach((p, i) => (ground[i] = Number.isFinite(p.height) ? p.height : 0));
    return { ground, note: " on real terrain" };
  } catch {
    return { ground, note: " · terrain unavailable, flat ground used" };
  }
}
