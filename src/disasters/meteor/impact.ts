import { Cartesian3, Rectangle } from "cesium";
import type { DisasterContext, DisasterDefinition, DisasterInstance, DisasterStatus, Metric, Params, Site } from "../types";
import { seededRandom } from "../random";
import { gridHeight, groundHeights, loadGround } from "../terrainGrid";
import { GridOverlay } from "../gridOverlay";
import { BuildingFires } from "../buildingFires";
import { Plume } from "../volcano/plume";
import { Debris } from "../volcano/debris";
import { editDelta, type SculptEdit } from "../../globe/sculptShapes";
import { craterFor, impactEnergyMt } from "./scaling";
import { FireSpread, treeLineM } from "./fireSpread";
import { MeteorEntry } from "./entry";
import { Wildfire } from "./wildfire";
import { Meteorite, type RockPiece } from "./meteorite";

/**
 * Seconds from Trigger until the meteor appears: the time the camera takes to
 * ease into the chase shot. It then falls at its real speed, so it hits
 * (path length ÷ speed) later, within these bounds.
 */
const ENTRY_START_S = 3;
const ENTRY_MIN_S = 3.5;
const ENTRY_MAX_S = 12;
/** Seconds after the strike the chase camera keeps watching before letting go. */
const SHOT_HOLD_S = 2.5;
/** Stony asteroid. */
const DENSITY = 3000;
const FIRE_GRID = 128;
const CRATER_GRID = 128;
/** Seconds for the meteorite's heat to fall to about a third. */
const ROCK_COOL_S = 25;
/** Seconds after the strike when the camera flies down to the crater. */
const FOCUS_AFTER_S = 3;
/** Out to this many crater radii the ground is crater or thick ejecta, with nothing left to burn. */
const BARE_REACH = 1.8;
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

  // The ground: the main crater (Collins et al. scaling) and a few smaller
  // dents where pieces that broke off the meteor came down.
  const craters: SculptEdit[] = [
    {
      id: -1, kind: "crater", lon: site.lon, lat: site.lat, radiusM: craterR, heightM: crater.depthM, rimM: crater.rimM, seed: rng() * 10,
      // Rule of thumb for the central peak, not from the scaling paper.
      peakM: crater.complex ? crater.depthM * 0.3 : undefined,
    },
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

  const entry = new MeteorEntry(viewer.scene, {
    impact, up, east, north,
    approachDeg: params.approach,
    angleDeg: params.angle,
    diameterM: params.diameter,
    fragmentTargets: craters.slice(1).map((c) => Cartesian3.fromDegrees(c.lon, c.lat, site.heightM)),
    rng: seededRandom(seed ^ 0x2c1b3c6d),
  });
  const impactS = ENTRY_START_S + Math.min(ENTRY_MAX_S, Math.max(ENTRY_MIN_S, entry.pathM / impactor.speedMs));
  let progress = 0;
  let since = -impactS;

  // The meteorite: the main mass came to rest on the floor a little
  // downrange of the centre, with broken fragments scattered around it,
  // thrown mostly onward the way it was travelling. Its own random stream
  // keeps the fires replaying the same whenever the rocks are built.
  const rockRng = seededRandom(seed ^ 0x5bd1e995);
  const approachRad = (params.approach * Math.PI) / 180;
  const downE = -Math.sin(approachRad);
  const downN = -Math.cos(approachRad);
  const mainOffM = craterR * (crater.complex ? 0.3 : 0.1);
  const remnantR = params.diameter * 0.28;
  const spots = [{ e: downE * mainOffM, n: downN * mainOffM, r: remnantR }];
  const fragmentCount = 6 + Math.floor(rockRng() * 5);
  for (let k = 0; k < fragmentCount; k++) {
    const a = rockRng() * Math.PI * 2;
    const d = remnantR * (2.5 + rockRng() * 6);
    const e = spots[0].e + downE * d * 0.6 + Math.cos(a) * d * 0.7;
    const n = spots[0].n + downN * d * 0.6 + Math.sin(a) * d * 0.7;
    if (Math.hypot(e, n) < craterR * 0.8) spots.push({ e, n, r: remnantR * (0.12 + rockRng() * 0.25) });
  }
  const spotLonLat = spots.map((p) => ({ lon: site.lon + p.e / metresPerLon, lat: site.lat + p.n / 110_540 }));
  let pieces: RockPiece[] | undefined;
  let meteorite: Meteorite | undefined;
  let rockHeat = 0;

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
  let focused = false;

  const cellLonLat = (i: number) => {
    const row = Math.floor(i / FIRE_GRID);
    const col = i % FIRE_GRID;
    return [site.lon - fdLon + ((col + 0.5) / FIRE_GRID) * 2 * fdLon, site.lat + fdLat - ((row + 0.5) / FIRE_GRID) * 2 * fdLat];
  };
  /** Ground height before the impact, at metres east/north of it. */
  const baseAt = (e: number, n: number): number => (ground && gridHeight(ground, FIRE_GRID, fireCellM, e, n)) ?? site.heightM;
  /** Ground height including the crater once it exists. */
  const groundAt = (e: number, n: number): number =>
    impacted ? baseAt(e, n) + craterDelta(site.lon + e / metresPerLon, site.lat + n / 110_540) : baseAt(e, n);

  // The floor under each rock: the real ground there plus the crater's shape,
  // the same sum the reshaped terrain tiles are built from.
  groundHeights(ctx, spotLonLat).then((heights) => {
    if (destroyed) return;
    pieces = spots.map((p, i) => ({
      ...spotLonLat[i],
      radiusM: p.r,
      groundM: (heights[i] ?? baseAt(p.e, p.n)) + craterDelta(spotLonLat[i].lon, spotLonLat[i].lat),
    }));
  });

  loadGround(ctx, fireRect, FIRE_GRID, fireCellM).then((loaded) => {
    if (destroyed) return;
    ground = loaded.ground;
    terrainNote = loaded.note;
    const treeLine = treeLineM(site.lat);
    const fuel = new Uint8Array(FIRE_GRID * FIRE_GRID);
    // Without a terrain token there is no way to tell sea from land, so level ground counts as land.
    const seaLevel = ctx.providerMode === "ion" ? 2 : -Infinity;
    for (let i = 0; i < fuel.length; i++) fuel[i] = ground[i] > seaLevel && ground[i] < treeLine ? 1 : 0;
    // The crater and the thick ejecta around it bury or blast away whatever grew there.
    for (let i = 0; i < fuel.length; i++) {
      const [lon, lat] = cellLonLat(i);
      if (Math.hypot((lon - site.lon) * metresPerLon, (lat - site.lat) * 110_540) < craterR * BARE_REACH) fuel[i] = 0;
    }
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
  const craterHalfM = craterR * 3.2;
  const cdLat = craterHalfM / 110_540;
  const cdLon = craterHalfM / metresPerLon;
  const craterPaint = new GridOverlay(
    viewer.scene, CRATER_GRID,
    Rectangle.fromDegrees(site.lon - cdLon, site.lat - cdLat, site.lon + cdLon, site.lat + cdLat), rng, false,
  );
  craterPaint.show = false;

  // Fresh ejecta: a blanket thinning outward, thrown farther downrange the
  // more oblique the impact, with bright rays streaking out of it. It doesn't
  // change, so it's worked out once.
  const cellDist = new Float32Array(CRATER_GRID * CRATER_GRID);
  /** How much melt pooled in each cell of the floor, 0–1, so it's patchy rather than one sheet. */
  const meltPool = new Float32Array(CRATER_GRID * CRATER_GRID);
  const ejecta = new Float32Array(CRATER_GRID * CRATER_GRID);
  const rayTone = new Float32Array(CRATER_GRID * CRATER_GRID);
  {
    const rays = Array.from({ length: 9 + Math.floor(rockRng() * 6) }, () => ({
      angle: rockRng() * Math.PI * 2,
      width: 0.03 + rockRng() * 0.06,
      reach: 2.2 + rockRng() * 0.9,
    }));
    const downAngle = Math.atan2(downN, downE);
    const oblique = 1 - params.angle / 90;
    const poolPhase = [0, 1, 2, 3].map(() => rockRng() * Math.PI * 2);
    for (let i = 0; i < cellDist.length; i++) {
      const row = Math.floor(i / CRATER_GRID);
      const col = i % CRATER_GRID;
      const dx = ((col + 0.5) / CRATER_GRID - 0.5) * 2 * craterHalfM;
      const dy = (0.5 - (row + 0.5) / CRATER_GRID) * 2 * craterHalfM;
      const d = Math.hypot(dx, dy) / craterR;
      const a = Math.atan2(dy, dx);
      const de = d / (1 + 0.5 * oblique * Math.cos(a - downAngle));
      const blanket = de > 0.85 && de < 2.2 ? (1 - (de - 0.85) / 1.35) ** 1.3 : 0;
      let ray = 0;
      if (de > 0.9) {
        for (const r of rays) {
          const off = Math.abs(Math.atan2(Math.sin(a - r.angle), Math.cos(a - r.angle)));
          if (off < r.width && de < r.reach) ray = Math.max(ray, (1 - off / r.width) * (1 - (de - 0.9) / (r.reach - 0.9)));
        }
      }
      cellDist[i] = d;
      const u = dx / craterR;
      const v = dy / craterR;
      meltPool[i] = Math.min(1, Math.max(0,
        0.55 + 0.3 * Math.sin(u * 7.1 + poolPhase[0]) * Math.sin(v * 6.3 + poolPhase[1])
          + 0.2 * Math.sin((u + v) * 13.7 + poolPhase[2]) + 0.15 * Math.sin((u - v) * 21.3 + poolPhase[3])));
      ejecta[i] = Math.max(blanket, ray * 0.75);
      rayTone[i] = ray;
    }
  }

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
      const d = cellDist[i];
      if (d < 0.85) {
        // Melt pooled in the floor among broken rock: glowing at first,
        // cooling to dark glassy rock, the thin patches first.
        const pool = meltPool[i];
        const glow = Math.max(0, heat * (1 - d / 0.85) ** 0.5 * (0.35 + 0.9 * pool) - 0.15 * (1 - pool));
        const shade = 0.75 + 0.35 * pool;
        px[o] = (40 + 215 * glow) * shade;
        px[o + 1] = (36 + 105 * glow * glow) * shade;
        px[o + 2] = (33 + 25 * glow * glow * glow) * shade;
        px[o + 3] = 235;
      } else {
        // Rim and ejecta: shattered grey-brown rock, the rays paler and finer.
        const ray = rayTone[i];
        px[o] = 112 + 45 * ray;
        px[o + 1] = 100 + 42 * ray;
        px[o + 2] = 88 + 38 * ray;
        px[o + 3] = 230 * ejecta[i];
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
      progress = (elapsed - ENTRY_START_S) / (impactS - ENTRY_START_S);
      entry.set(progress, elapsed, budget);
      since = elapsed - impactS;

      if (!impacted && elapsed >= impactS) {
        impacted = true;
        booms++;
        plume.boom(strength);
        sound.boom(1);
        debris.burst(Math.round((160 + crater.diameterM / 20) * budget), 1);
        // Dent the real terrain and start the fires.
        ctx.setGroundDamage(craters);
        craterPaint.show = visible;
        wildfire?.model.ignite(FIRE_GRID / 2, FIRE_GRID / 2, igniteR, craterR * BARE_REACH, true);
      }
      if (impacted && !meteorite && pieces) {
        meteorite = new Meteorite(viewer.scene, pieces, rockRng);
        meteorite.show = visible;
      }
      rockHeat = since < 0 ? 0 : Math.exp(-since / ROCK_COOL_S);
      meteorite?.set(rockHeat, budget);
      // Once the blast has passed, fly down to look into the crater at the meteorite.
      if (impacted && !focused && since >= FOCUS_AFTER_S) {
        focused = true;
        ctx.focus({
          lon: spotLonLat[0].lon,
          lat: spotLonLat[0].lat,
          heightM: pieces?.[0].groundM ?? site.heightM - crater.depthM,
          range: Math.min(15_000, Math.max(500, crater.diameterM * 0.75)),
          heading: (params.approach + 90) % 360,
          pitch: -32,
        });
      }

      // The dust column: a burst after the impact, thinning through the aftermath.
      const dust = since < 0 ? 0 : since < 8 ? 1 : Math.max(0, 1 - (since - 8) / (duration * 0.55));
      // The plume's emitters sit at the old ground height, now in the air
      // above the crater floor, so the dust is one short burst that rises
      // away (leaving the crater in view) and its glow is the fireball only.
      plume.set(
        {
          steam: 0,
          ash: since >= 0 && since < 5 ? 70 : 0,
          ejecta: since >= 0 && since < 4 ? 40 : 0,
          glow: since < 0 ? 0 : Math.max(0, 1 - since / 4),
        },
        budget,
      );
      plume.tick(dt);
      debris.tick(dt);
      if (impacted) wildfire?.tick(dt, budget);
      fires?.tick(dt);
      // The fireball lights up the land as it comes down; then the dust dims it.
      if (baseLayer && visible) baseLayer.brightness = baseBrightness * (1 - 0.25 * dust) * (1 + 0.6 * entry.light);

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

    cameraShot: () => (since < SHOT_HOLD_S ? entry.shot(progress) : undefined),

    setVisible(show) {
      visible = show;
      plume.show = show;
      entry.show = show;
      debris.show = show;
      craterPaint.show = show && impacted;
      if (meteorite) meteorite.show = show;
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
      meteorite?.destroy();
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
        note: `${crater.complex ? "Complex crater with a central peak" : "Bowl-shaped crater"}; Collins et al. (2005) scaling estimate`,
      },
    ];
    if (impacted) {
      list.push({
        label: "Meteorite",
        value: `${Math.round(remnantR * 2)} m main mass, ${spots.length - 1} fragments · ${rockHeat > 0.5 ? "glowing hot" : rockHeat > 0.12 ? "cooling" : "cold"}`,
        note: "Most of a rock this fast would melt or vaporise; the main mass is kept so you can see it",
      });
    }
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
