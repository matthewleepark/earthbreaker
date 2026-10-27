import { Cartesian3, Rectangle } from "cesium";
import type { DisasterContext, DisasterDefinition, DisasterInstance, DisasterStatus, Metric, Params, Site } from "../types";
import { seededRandom } from "../random";
import { gridHeight, loadGround } from "../terrainGrid";
import { GridOverlay } from "../gridOverlay";
import { BuildingFires } from "../buildingFires";
import { Plume } from "../volcano/plume";
import { Debris } from "../volcano/debris";
import { editDelta, type SculptEdit } from "../../globe/sculptShapes";
import { craterFor, impactEnergyMt } from "./scaling";
import { FireSpread, treeLineM } from "./fireSpread";
import { MeteorEntry } from "./entry";
import { Wildfire } from "./wildfire";

/** Seconds from Trigger until the meteor appears, and until it hits. */
const ENTRY_START_S = 1.5;
const IMPACT_S = 7;
/** Stony asteroid. */
const DENSITY = 3000;
const FIRE_GRID = 128;
const CRATER_GRID = 64;
const REPAINT_MS = 200;

export const meteorImpact: DisasterDefinition = {
  id: "meteor",
  name: "Meteor impact",
  category: "Space",
  siteLabel: "Impact point",
  siteNote: {
    title: "Hypothetical impact.",
    text: "No known asteroid is on course to hit here. Crater size comes from published impact-scaling formulas; the blast and fires are simplified.",
  },
  needsTerrain: true,
  available: true,
  description:
    "A meteor streaks in and hits: a blinding flash, a blast wave, a crater blasted into the real terrain, rock thrown for kilometres, and forest fires spreading from the impact.",
  params: [
    { key: "diameter", label: "Meteor size", min: 30, max: 800, step: 10, unit: " m", hint: "Diameter of a stony asteroid" },
    { key: "speed", label: "Speed", min: 11, max: 40, step: 1, unit: " km/s", hint: "Most hit Earth at 15–25 km/s" },
    { key: "angle", label: "Entry angle", min: 15, max: 90, step: 5, unit: "°", hint: "90 = straight down" },
    { key: "approach", label: "Coming from", min: 0, max: 345, step: 15, unit: "°", hint: "0 = north, 90 = east" },
    { key: "duration", label: "Duration", min: 45, max: 180, step: 15, unit: "s", hint: "Length of the time-lapse" },
    { key: "windDir", label: "Wind blowing toward", min: 0, max: 345, step: 15, unit: "°", hint: "Pushes the fires and dust" },
    { key: "windSpeed", label: "Wind strength", min: 0, max: 10, step: 1 },
  ],
  defaults: { diameter: 150, speed: 20, angle: 45, approach: 270, duration: 75, windDir: 90, windSpeed: 4 },
  create: createImpact,
};

async function createImpact(ctx: DisasterContext, site: Site, params: Params, seed: number): Promise<DisasterInstance> {
  const { viewer, sound, perf } = ctx;
  const rng = seededRandom(seed);
  const duration = params.duration;
  const impactor = { diameterM: params.diameter, speedMs: params.speed * 1000, angleDeg: params.angle, densityKgM3: DENSITY };
  const crater = craterFor(impactor);
  const energyMt = impactEnergyMt(impactor);
  const craterR = crater.diameterM / 2;
  // Rough stand-ins, not modelled physics: heat ignites vegetation out to a
  // few crater widths, and the blast wrecks buildings out to three.
  const igniteR = Math.min(35_000, Math.max(1_500, 5 * crater.diameterM));
  const blastR = 3 * crater.diameterM;
  // The dust cloud's height grows with the crater (a few to ~40 km).
  const columnM = Math.min(40_000, Math.max(6_000, crater.diameterM * 6));
  const strength = Math.min(1, 0.55 + crater.diameterM / 8000);
  const windRad = (params.windDir * Math.PI) / 180;
  const windE = Math.sin(windRad) * params.windSpeed;
  const windN = Math.cos(windRad) * params.windSpeed;
  const metresPerLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  // Without a terrain token the ground is a flat sphere at 0 m, so height says nothing about sea.
  const ocean = ctx.providerMode === "ion" && site.heightM <= 0;

  const impact = Cartesian3.fromDegrees(site.lon, site.lat, site.heightM);
  const plume = new Plume(viewer.scene, {
    vent: impact,
    columnHeightM: columnM,
    windEast: windE * columnM * 0.0015,
    windNorth: windN * columnM * 0.0015,
    intensity: Math.min(5, Math.max(1, crater.diameterM / 800)),
  });
  const { up, east, north } = plume;
  const entry = new MeteorEntry(
    viewer.scene, impact, up, east, north, params.approach, params.angle,
    Math.min(2500, Math.max(300, params.diameter * 3)),
  );

  // The ground: the main crater (Collins et al. scaling) and a few smaller
  // dents where large blocks thrown out by the impact landed.
  const craters: SculptEdit[] = [
    { id: -1, kind: "crater", lon: site.lon, lat: site.lat, radiusM: craterR, heightM: crater.depthM, rimM: crater.rimM, seed: rng() * 10 },
  ];
  const secondaries = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < secondaries; k++) {
    const a = rng() * Math.PI * 2;
    const d = craterR * (1.9 + rng() * 1.8);
    const r = craterR * (0.1 + rng() * 0.12);
    craters.push({
      id: -2 - k, kind: "crater",
      lon: site.lon + (Math.sin(a) * d) / metresPerLon,
      lat: site.lat + (Math.cos(a) * d) / 110_540,
      radiusM: r, heightM: r * 0.4, rimM: r * 0.07, seed: rng() * 10,
    });
  }
  const craterDelta = (lon: number, lat: number) => craters.reduce((s, c) => s + editDelta(c, lon, lat), 0);

  // The fire grid, centred on the impact.
  const fireHalfM = Math.min(40_000, Math.max(8_000, igniteR * 1.6));
  const fireCellM = (2 * fireHalfM) / FIRE_GRID;
  const fdLat = fireHalfM / 110_540;
  const fdLon = fireHalfM / metresPerLon;
  const fireRect = Rectangle.fromDegrees(site.lon - fdLon, site.lat - fdLat, site.lon + fdLon, site.lat + fdLat);
  let ground: Float32Array | undefined;
  let terrainNote = "";
  let wildfire: Wildfire | undefined;
  let destroyed = false;
  let impacted = false;

  const cellLonLat = (i: number) => {
    const row = Math.floor(i / FIRE_GRID);
    const col = i % FIRE_GRID;
    return [site.lon - fdLon + ((col + 0.5) / FIRE_GRID) * 2 * fdLon, site.lat + fdLat - ((row + 0.5) / FIRE_GRID) * 2 * fdLat];
  };
  /** Ground height including the crater once it exists, at metres east/north of the impact. */
  const groundAt = (e: number, n: number): number => {
    const base = (ground && gridHeight(ground, FIRE_GRID, fireCellM, e, n)) ?? site.heightM;
    return impacted ? base + craterDelta(site.lon + e / metresPerLon, site.lat + n / 110_540) : base;
  };

  loadGround(ctx, fireRect, FIRE_GRID, fireCellM).then((loaded) => {
    if (destroyed) return;
    ground = loaded.ground;
    terrainNote = loaded.note;
    const treeLine = treeLineM(site.lat);
    const fuel = new Uint8Array(FIRE_GRID * FIRE_GRID);
    // Without a terrain token there is no way to tell sea from land, so level ground counts as land.
    const seaLevel = ctx.providerMode === "ion" ? 2 : -Infinity;
    for (let i = 0; i < fuel.length; i++) fuel[i] = ground[i] > seaLevel && ground[i] < treeLine ? 1 : 0;
    const model = new FireSpread({
      size: FIRE_GRID, cellSizeM: fireCellM, ground, fuel,
      windEast: windE / 10, windNorth: windN / 10, rng,
    });
    const drift = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, windE * 25, new Cartesian3()),
      Cartesian3.multiplyByScalar(north, windN * 25, new Cartesian3()),
      new Cartesian3(),
    );
    wildfire = new Wildfire(viewer.scene, model, fireRect, rng, (i) => {
      const [lon, lat] = cellLonLat(i);
      return Cartesian3.fromDegrees(lon, lat, groundAt((lon - site.lon) * metresPerLon, (lat - site.lat) * 110_540));
    }, up, drift);
  });

  const debris = new Debris(viewer.scene, {
    vent: impact, ventHeightM: site.heightM, east, north, up,
    columnHeightM: columnM, groundAt, snowy: site.heightM > 2800,
  });

  // Freshly melted rock in the crater, cooling from orange to dark, and pale
  // ejecta around it, painted on a fine grid over the crater's reach.
  const craterHalfM = craterR * 2.3;
  const cdLat = craterHalfM / 110_540;
  const cdLon = craterHalfM / metresPerLon;
  const craterPaint = new GridOverlay(
    viewer.scene, CRATER_GRID,
    Rectangle.fromDegrees(site.lon - cdLon, site.lat - cdLat, site.lon + cdLon, site.lat + cdLat), rng,
  );
  craterPaint.show = false;

  // Buildings: gone inside the crater, wrecked and burning in the blast zone,
  // and burning wherever the wildfire reaches them.
  const fires = ctx.buildings
    ? new BuildingFires(viewer.scene, ctx.buildings, {
        hazard: (ref) => {
          if (!impacted) return "none";
          const d = Math.hypot((ref.lon - site.lon) * metresPerLon, (ref.lat - site.lat) * 110_540);
          if (d < craterR * 2.2) return "obliterate";
          if (d < blastR) return "bury";
          const model = wildfire?.model;
          if (!model) return "none";
          const col = Math.floor(((ref.lon - (site.lon - fdLon)) / (2 * fdLon)) * FIRE_GRID);
          const row = Math.floor(((site.lat + fdLat - ref.lat) / (2 * fdLat)) * FIRE_GRID);
          if (col < 0 || row < 0 || col >= FIRE_GRID || row >= FIRE_GRID) return "none";
          return model.state[row * FIRE_GRID + col] === 1 ? "burn" : "none";
        },
        rect: { west: site.lon - fdLon, south: site.lat - fdLat, east: site.lon + fdLon, north: site.lat + fdLat },
        groundAt: (lon, lat) => groundAt((lon - site.lon) * metresPerLon, (lat - site.lat) * 110_540),
        up,
      })
    : undefined;

  const baseLayer = viewer.imageryLayers.get(0);
  const baseBrightness = baseLayer?.brightness ?? 1;
  let booms = 0;
  let shake = 0;
  let visible = true;
  let lastPaint = 0;
  let current: DisasterStatus = { phase: "Incoming", metrics: [], booms: 0 };

  const paintCrater = (sinceImpact: number) => {
    const heat = Math.max(0, 1 - sinceImpact / 30);
    craterPaint.render((i, px, o) => {
      const row = Math.floor(i / CRATER_GRID);
      const col = i % CRATER_GRID;
      const dx = ((col + 0.5) / CRATER_GRID - 0.5) * 2 * craterHalfM;
      const dy = (0.5 - (row + 0.5) / CRATER_GRID) * 2 * craterHalfM;
      const d = Math.hypot(dx, dy) / craterR;
      if (d < 0.85) {
        // Melt: glowing at first, cooling to dark rock.
        const glow = heat * (1 - d / 0.85) ** 0.5;
        px[o] = 45 + 210 * glow;
        px[o + 1] = 38 + 100 * glow * glow;
        px[o + 2] = 34 + 20 * glow * glow * glow;
        px[o + 3] = 235;
      } else if (d < 2.2) {
        // Rim and ejecta blanket: shattered grey-brown rock, thinning outward.
        const fade = 1 - (d - 0.85) / (2.2 - 0.85);
        px[o] = 112;
        px[o + 1] = 100;
        px[o + 2] = 88;
        px[o + 3] = 230 * fade ** 1.3;
      } else {
        px[o + 3] = 0;
      }
    });
  };

  const instance: DisasterInstance = {
    duration,
    framing: {
      lon: site.lon,
      lat: site.lat,
      heightM: site.heightM + columnM * 0.25,
      range: Math.max(15_000, columnM * 1.6, igniteR * 1.2),
      // Side-on to the approach, so the meteor crosses the frame.
      heading: (params.approach + 90) % 360,
      pitch: -9,
    },

    update(elapsed, dt) {
      const budget = perf.effects;
      const progress = (elapsed - ENTRY_START_S) / (IMPACT_S - ENTRY_START_S);
      entry.set(progress, budget);
      const since = elapsed - IMPACT_S;

      if (!impacted && elapsed >= IMPACT_S) {
        impacted = true;
        booms++;
        plume.boom(strength);
        sound.boom(1);
        debris.burst(Math.round((160 + crater.diameterM / 20) * budget), 1);
        // Dent the real terrain and start the fires.
        ctx.setGroundDamage(craters);
        craterPaint.show = visible;
        wildfire?.model.ignite(FIRE_GRID / 2, FIRE_GRID / 2, igniteR);
      }

      // The dust column: a burst after the impact, thinning through the aftermath.
      const dust = since < 0 ? 0 : since < 8 ? 1 : Math.max(0, 1 - (since - 8) / (duration * 0.55));
      plume.set(
        {
          steam: 0,
          ash: dust * 55,
          ejecta: since >= 0 && since < 4 ? 40 : 0,
          glow: since < 0 ? 0 : Math.max(0, 1 - since / 25),
        },
        budget,
      );
      plume.tick(dt);
      debris.tick(dt);
      if (impacted) wildfire?.tick(dt, budget);
      fires?.tick(dt);
      if (baseLayer && visible) baseLayer.brightness = baseBrightness * (1 - 0.25 * dust);

      const now = performance.now();
      if (impacted && (now - lastPaint > REPAINT_MS || elapsed >= duration)) {
        lastPaint = now;
        wildfire?.render();
        paintCrater(since);
      }

      // Sound: a rising roar as it plunges, the blast, then the rumble of the fires and dust.
      const approach = Math.max(0, Math.min(1, progress));
      sound.level("roar", since < 0 ? 0.9 * approach * approach : 0.5 * dust);
      sound.level("rumble", since < 0 ? 0.3 * approach : 0.6 * dust);
      shake = since < 0 ? 0.04 + 0.12 * approach * approach : Math.max(Math.exp(-since / 1.4), 0.08 * dust);

      if (elapsed >= duration) {
        sound.level("roar", 0);
        sound.level("rumble", 0);
      }
      current = {
        phase: since < 0 ? "Incoming" : since < 8 ? "Impact" : elapsed < duration * 0.7 ? "Firestorm" : elapsed < duration ? "Aftermath" : "Ended",
        metrics: metrics(),
        booms,
      };
    },

    status: () => current,

    shake: () => (visible ? shake : 0),

    setVisible(show) {
      visible = show;
      plume.show = show;
      entry.show = show;
      debris.show = show;
      craterPaint.show = show && impacted;
      if (wildfire) wildfire.show = show;
      if (fires) fires.show = show;
      // "Before" shows the land as it was, crater and all removed.
      if (impacted) ctx.setGroundDamage(show ? craters : []);
      if (!show && baseLayer) baseLayer.brightness = baseBrightness;
    },

    destroy() {
      destroyed = true;
      plume.destroy();
      entry.destroy();
      debris.destroy();
      craterPaint.destroy();
      wildfire?.destroy();
      fires?.destroy();
      sound.stop();
      ctx.setGroundDamage([]);
      if (baseLayer && !baseLayer.isDestroyed()) baseLayer.brightness = baseBrightness;
    },
  };

  function metrics(): Metric[] {
    const list: Metric[] = [
      {
        label: "Meteor",
        value: `${params.diameter} m rock at ${params.speed} km/s, ${params.angle}°`,
        note: `About ${energyMt < 10 ? energyMt.toFixed(1) : Math.round(energyMt).toLocaleString()} megatons of TNT`,
      },
      {
        label: "Crater",
        value: `${(crater.diameterM / 1000).toFixed(1)} km wide, ${Math.round(crater.depthM).toLocaleString()} m deep`,
        note: `${crater.complex ? "Complex" : "Bowl-shaped"} crater; Collins et al. (2005) scaling estimate`,
      },
    ];
    if (ocean) list.push({ label: "Ocean impact", value: "Crater on the sea floor", note: "No tsunami is modelled" });
    const model = wildfire?.model;
    if (!model) {
      list.push({ label: "Fires", value: "Reading terrain…" });
    } else {
      const cellKm2 = (fireCellM * fireCellM) / 1e6;
      list.push(
        { label: "Burned", value: `${model.burnedAreaKm2().toFixed(1)} km²`, note: `Simulated${terrainNote}; burnable land approximated as below the tree line and above sea level` },
        { label: "Still burning", value: `${(model.burningCount() * cellKm2).toFixed(1)} km²` },
      );
    }
    if (fires) {
      list.push({
        label: "Buildings hit",
        value: `${fires.destroyed.toLocaleString()} destroyed · ${fires.reached.toLocaleString()} hit`,
        note: "OpenStreetMap buildings in loaded map tiles; zoom in to load more",
      });
    } else if (!ctx.buildings) {
      list.push({ label: "Buildings", value: "Not available", note: "Building data needs a Cesium ion token" });
    }
    return list;
  }

  return instance;
}
