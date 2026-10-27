# Earthbreaker

A browser-based 3D Earth you can explore with real terrain, and a sandbox for triggering cinematic
disasters over that terrain.

Live: <https://matthewleepark.github.io/earthbreaker/>

Terrain and imagery come from real geographic data. Disaster effects are simplified time-lapse
visualisations, **not** scientific forecasts.

## Status

**Milestone 1: globe and navigation (done)**

- A 3D globe (CesiumJS) you can rotate, zoom and tilt
- Place search for anywhere on Earth (OpenStreetMap Nominatim)
- One-click flights to Mount Everest, Mount Rainier and Mount St. Helens
- A details panel showing the place name, coordinates and elevation (only when a real source exists), plus the camera's altitude
- Clear messages for a missing or rejected token, failed searches, and browsers without WebGL
- Direct links: `?place=everest`, `?place=rainier` or `?place=st-helens`

**First disaster: volcanic eruption (done)**

- Pick a vent: the selected place, or any point with **Pick on map**
- Settings: intensity, duration, ash-plume scale, lava amount, wind direction and strength
- The phases:
  - **Warning:** steam, a growing vent glow, a deep rumble, and the camera starting to tremble.
  - **Boom:** a screen flash, a blast-wave ring, a fireball, a pyroclastic surge racing outward and
    down the slopes, the column shooting up, and a hard camera shake.
  - **Debris:** the summit blows apart into hundreds of pieces: rock, glowing lava bombs that cool
    as they fly, and blocks of ice on snowy summits. They tumble on ballistic arcs, the big ones
    trailing smoke, and kick up dust where they land on the terrain.
  - **Main eruption:** a churning ash column with volcanic lightning that lights the cloud, plus
    column collapses that send more surges.
  - **Lava:** breaks out through the lowest notch of the crater and flows downhill over the
    terrain. Big eruptions run 8–10 km, far enough to reach the towns on the lower slopes.
  - **Buildings burn:** when lava reaches a real building, the building glows and flickers orange,
    flames and a column of smoke rise from it, and it chars black. If the lava is deep enough to
    bury it, it collapses in a burst of dust. The details panel counts buildings reached and
    buried.
  - **Aftermath:** the plume thins and the lava crusts over into dark rock.
- Sound, synthesised in the browser (no audio files): rumble, boom, roar, thunder. Toggle it with
  **Sound on/off**; the choice is remembered.
- Controls: Pause/Resume, Reset (calms the eruption and clears it), Replay (same random seed),
  1×/2×/3×/4× speed, Before/After, Orbit camera
- Choosing a volcano only arms it as the vent. Nothing erupts until you press Trigger.
- Lava never travels more than 10 km from the vent.
- Simulation numbers in the details panel: lava-covered area, runout, share still molten
- Every eruption is labelled: **real volcano** (from a built-in list), **fictional** (e.g. Everest),
  or **sandbox** (anywhere else)
- **Volcanoes menu:** 31 famous volcanoes grouped by region, filterable, each with a line on why it's
  famous. Examples: Vesuvius, Etna, Stromboli, Fuji, Kīlauea, Mauna Loa, Krakatau, Tambora,
  Pinatubo, Eyjafjallajökull, Kilimanjaro, Nyiragongo, Popocatépetl, Cotopaxi, Erebus.
  - For peaked volcanoes, the vent snaps to the highest terrain within 1.5 km, so the eruption
    starts at the summit even if the listed coordinates are slightly off.
  - Calderas and lava lakes keep their listed point.
  - Every volcano also works as a link, e.g. `?place=fuji` or `?place=vesuvius`.

**Second disaster: meteor impact (done)**

- Pick an impact point the same way as a vent, then press Trigger. Nothing falls until you do.
- Settings: rock diameter (30–800 m), speed (11–40 km/s), entry angle, approach direction,
  duration, and wind direction and strength.
- The phases:
  - **Incoming:** the camera eases up to the top of the meteor's path and rides down just ahead
    of it, looking back up at it against the sky. You see:
    - the rock itself, a lumpy, faceted 3D boulder tumbling as it falls, its crust glowing
      through a network of cracks;
    - a flickering blue-white core and a wide orange glow around it;
    - sparks of molten rock shed into its wake;
    - a long ionised trail fading from yellow to red, and a dusty smoke train that hangs in the
      sky afterwards.

    Part-way down it flares as a few pieces break off and fall on their own paths. The camera
    then slows and turns toward the ground, the meteor streaks past it, and the land lights up as
    it comes down. It falls at its real speed: path length ÷ speed, so a shallow or slow entry
    takes longer. Touch the map at any point to take the camera back.
  - **Impact:** a flash, a blast-wave ring, a fireball, a deep boom, a hard camera shake and a
    burst of debris thrown out over the land. Then the camera flies down to look into the crater.
  - **The crater:**
    - The ground is dug into a bowl with a raised, uneven rim. Big impacts make a complex crater:
      a flat floor, steep walls and a central peak where the floor rebounded.
    - Smaller craters mark where the broken-off pieces landed.
    - Melt pools glow among the broken rock of the floor and cool over about 30 s.
    - Grey-brown ejecta covers the land around the crater, streaked with bright rays. For a
      shallow entry it's thrown farther downrange.
  - **The meteorite:** the main mass rests partly buried in the crater floor, a little downrange
    of the centre, with broken fragments scattered beyond it. It glows white-orange, then cools
    until only its cracks glow, with steam rising off it, and ends up dark.
  - **Firestorm:** the heat flash sets patches of land alight in a ring around the impact. The
    fire then spreads across the land, faster uphill and downwind, as glowing embers and flames
    under drifting smoke, leaving black char and ash. The crater and the thick ejecta near it
    don't burn.
  - **Aftermath:** the last fires burn out and the smoke thins.
- Crater size comes from the impact-scaling equations of Collins, Melosh & Marcus (2005), the
  ones behind the Earth Impact Effects Program (`disasters/meteor/scaling.ts`). As a check, a 50 m
  iron rock at 12.8 km/s (roughly what made Meteor Crater in Arizona) gives a crater 1.55 km wide
  with a 44 m rim. The real one is 1.19 km wide with a rim of about 45 m. These formulas are only
  good to tens of percent, and a test keeps the estimate in that range.
- The crater is a real change to the terrain, using the same tile rebuilding as Sculpt mode, so it
  shows at the right depth when you fly down into it. Before/After switches it off and on, and
  Reset fills it back in.
- **Buildings:** buildings near the crater are destroyed outright, ones inside the blast radius
  collapse, and ones the fire reaches burn and char. The details panel counts them.
- **Details panel:**
  - the impact energy in megatons of TNT;
  - the crater's width and depth;
  - the meteorite's size, number of fragments and how hot it still is;
  - the area burned, the area still burning, and buildings hit.

  On real terrain, an impact at or below sea level is marked as an ocean impact.
- Every impact is labelled as hypothetical: no known asteroid is on course to hit anywhere.
- The meteor runs in the terrain view, since Google's 3D mesh can't be reshaped into a crater.

**Time of day (done)**

- The **☀ Noon ▾** menu in the top bar switches the current view between **Dawn**, **Noon**, **Dusk**
  and **Night**.
  - Dawn, Noon and Dusk light the scene from where the real sun is at that moment today, at the
    place you're viewing, using Cesium's solar model. Dawn and dusk are when the sun is 4° above
    the horizon, and noon is when it's highest. The sky and haze take on Cesium's low-sun colours.
  - Night is a dim blue moonlight with a darkened sky.
- The menu shows the local solar time each setting stands for.
- The light is separate from the simulation clock, so you can switch mid-eruption. At night the ash
  column turns dark, and the vent glow, lava, fires and lightning light up the scene.
- Google's photorealistic tiles have lighting baked into them, so a tint matches them to the chosen
  time.

**Sculpt mode (done)**

- The **Sculpt** tab in the left panel has three tools: **Spawn peak**, **Raise land** and
  **Lower land**. Set a height and radius, then click the map, as many times as you like. Undo and
  Clear remove edits.
- Edits are local and visual only: they live in this browser tab and never change the map data.
- How it works (`globe/sculpt.ts`): a terrain provider wraps the real one, and every tile an edit
  touches is rebuilt as an even 65 × 65 mesh of real height plus the edit. The satellite imagery
  drapes over the new shape, and the lava model, vent heights and debris landings all see it, so
  lava flows down a sculpted peak.
- Summit snapping and the volcano catalog read the original terrain (`globe.baseTerrain`), so
  sculpting never moves a named volcano's vent or changes the list (there's a test for this).
- Buildings standing on sculpted ground are hidden, since they would float or sink.
- Sculpting switches to the terrain view, because Google's 3D mesh can't be reshaped. It's
  disabled while an eruption is running.

**Photorealistic 3D (done)**

- **Photoreal 3D** (default when available): Google Photorealistic 3D Tiles, a textured 3D mesh of the
  whole world like Google Earth, streamed through your Cesium ion token. The top-bar button switches
  back to terrain + satellite imagery, and the choice is remembered in this browser.
- **3D buildings** appear when you zoom below about 25 km.
  - In terrain mode they're Cesium OSM Buildings, real OpenStreetMap footprints extruded to their
    heights and tinted by type (homes, commercial, churches).
  - In Photoreal mode, Google's mesh already contains the buildings. The OSM data stays hidden and
    is only used to know where buildings are for the lava.
- **Overview / Close-up** buttons in the details panel. The camera can get down to 15 m from the
  ground, and collision stops it from passing into mountains.
- Sharper rendering in both modes: finer terrain tiles, full pixel density on high-DPI screens, and
  anti-aliasing.

Not started yet: earthquake and landslide. See [Roadmap](#roadmap).

## Setup

You need [Node.js](https://nodejs.org/) 22 or newer (built and tested with Node 25.9).

```sh
npm install
```

### Cesium ion token (free, recommended)

Without a token the app still runs, but the ground is flat and the imagery is a street map. With one
you get Cesium World Terrain (real elevation) and Bing Maps satellite imagery, and lava follows the
real ridges and valleys.

1. Create a free account at <https://ion.cesium.com/signup>.
2. Open **Access Tokens** (<https://ion.cesium.com/tokens>) and copy the **Default** token, or create
   one with the `assets:read` scope.
3. Copy `.env.example` to `.env.local` in the project root, and paste the token:

   ```sh
   VITE_CESIUM_ION_TOKEN=eyJhbGciOi...
   ```

4. Restart `npm run dev`. Vite only reads `.env.local` when it starts.

`.env.local` is git-ignored. Don't put the token in any file that gets committed.

> The token ends up in the JavaScript sent to the browser, which is how Cesium ion tokens are
> designed to work. Before you deploy publicly, open the token's settings on ion and limit it to
> your site's URL under **Allowed URLs**.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server at <http://localhost:5173> |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the built `dist/` at <http://localhost:4173> |
| `npm test` | Run the lava-model and sculpt tests (Node's built-in test runner) |
| `npm run typecheck` | Type-check only |

Add `?debug` to the URL to expose the Cesium viewer in the browser console as `earthbreaker.viewer`.

## Deployment

Every push to `main` runs the tests, builds the app and publishes it to GitHub Pages at
<https://matthewleepark.github.io/earthbreaker/> (`.github/workflows/deploy.yml`). If a test fails,
nothing is deployed.

One-time setup:

1. Turn on Pages with GitHub Actions as the source:
   `gh api -X POST repos/matthewleepark/earthbreaker/pages -f build_type=workflow`
   (or **Settings → Pages → Source: GitHub Actions**).
2. Optional, for real terrain on the live site: add the token as a repository secret named
   `VITE_CESIUM_ION_TOKEN` (`gh secret set VITE_CESIUM_ION_TOKEN`). Add
   `https://matthewleepark.github.io` to the token's **Allowed URLs** on Cesium ion first.

To build for Pages locally: `BASE_PATH=/earthbreaker/ npm run build`. In PowerShell, run
`$env:BASE_PATH="/earthbreaker/"; npm run build` instead.

## Controls

| Input | Action |
| --- | --- |
| Left-drag | Rotate the globe, or pan when close to the ground |
| Scroll / right-drag | Zoom |
| Ctrl + left-drag, or middle-drag | Tilt and turn the camera |
| Esc | Close menus, or cancel picking a vent |

## Performance

- **Render on demand.** Cesium only draws a frame when something changes: the camera moves, tiles
  load, or a disaster's clock runs. A still view costs almost nothing.
- **Power modes** (details panel → Rendering):
  - **Smooth:** up to 60 fps.
  - **Balanced:** capped at 30 fps, about half the GPU work, so laptops stay cooler and quieter.
    While you drag, scroll or the camera is still gliding afterwards, the cap lifts so moving
    around is as smooth as the screen allows.
  - **Saver:** 30 fps with lower resolution and fewer particles.

  The mode is picked automatically on first visit: Balanced when the computer looks low-powered
  (integrated or software graphics, 4 or fewer CPU threads, 4 GB or less of memory) or runs on
  battery, otherwise Smooth. Choosing one yourself is remembered.
- The audio engine suspends itself a few seconds after an eruption ends, so it doesn't use CPU in the
  background.
- **Automatic quality** (`globe/performance.ts`). While the scene is animating, the frame rate is
  measured every 1.5 s. Below about 28 fps it steps down a level, and above about 52 fps it steps
  back up. Each level lowers render resolution (down to 60%), map tile detail, and the number of
  smoke particles (down to 45%).
  The details panel shows the current frame rate and quality level under **Rendering**.
  A quality change waits until you stop moving the camera, so the picture doesn't suddenly blur
  or sharpen mid-drag.
- **Smooth navigation:**
  - Each scroll notch zooms a smaller step.
  - Drags and zooms glide to a stop instead of stopping dead.
  - Cesium keeps up to 1,000 terrain tiles in memory (10 times its default) and 768 MB of
    photorealistic tiles, and loads the tiles next to the visible ones early. Panning, turning
    and coming back to a place show ground that's already loaded, instead of tiles popping in.
- The plume uses fewer, larger smoke puffs. Overlapping see-through sprites are the main GPU cost.
- Debris and dust use fixed pools of billboards that are reused, so nothing is allocated mid-eruption.
- The lava texture is 512 px and repaints about 5 times a second.
- The lava model gets at most 6 ms of each frame. When it falls behind (on a slow computer, or at
  4×), it takes longer steps to catch up instead of drifting behind the clock.
- Every sprite is shared by URL, so the thousands of smoke particles use one copy of the puff
  image instead of thousands.
- Buildings only load below about 25 km, and their detail level follows the automatic quality.
- **UI:**
  - The panels don't use a backdrop blur. Re-blurring behind them every frame over a live 3D view
    was what made scrolling stutter.
  - The camera, tile-loading and frame-rate readouts update themselves a few times a second,
    instead of re-rendering the whole app on every camera move.
  - The disaster panel is memoised, so simulation updates don't re-render it.

## How the eruption works

Everything runs on Cesium's clock. Cesium's particle systems already move with that clock, so
pausing it freezes every effect at once, and the speed buttons are just the clock's multiplier.
`disasters/controller.ts` owns the clock. Each disaster gets `update(elapsed)` every frame and has to
clean up all of its own effects in `destroy()`.

**Ash plume** (`volcano/plume.ts`): about 1,500 smoke sprites (Cesium `ParticleSystem`), plus
surges, ejecta, a blast ring, a fireball and lightning bolts (`PolylineCollection`).

- Each puff rises quickly at first and slows as it nears the set column height.
- The column widens as it climbs, spreads into an umbrella cloud at the top, and bends with the wind,
  more so the higher it gets.
- Colour goes from dark brown-grey at the vent to lighter grey above, lit orange from below by the
  vent glow.
- Ejecta are glowing sprites on ballistic arcs.

**Lava** (`volcano/lavaSim.ts`, `lavaLayer.ts`): a cellular automaton on a 176 × 176 grid of real
terrain heights, sampled from Cesium World Terrain around the vent. The grid covers 10–26 km across,
depending on the lava setting.

- **Breach vent:** lava erupts from a short fissure running from the summit to the lowest point on a
  ring about 700 m out, like a notch in the crater rim. Without this, lava on a round summit spreads
  as a sheet in every direction and never travels far.

- Every 0.1 s of simulated time, molten lava moves from each cell to its lower neighbours. It's
  weighted heavily toward the steepest way down, which is what forms channels and lobes.
- Lava carries its heat with it. Everything cools, and thin edges cool fastest. Below a set
  temperature, lava stops moving and stays as rock.
- The grid is painted onto a canvas and draped on the terrain as a texture, so it follows every gully:
  yellow-white cores, orange channels, dark red edges, black crust.

What this model is and isn't:

- The rules have the right shape (downhill, heat-dependent stiffness, cooling), but the numbers are
  tuned so a flow travels a few km in about a minute of time-lapse. They aren't measured lava
  properties.
- Area and runout are real outputs of the model, labelled as estimates. The ash column height is a
  setting, not something the model computes.
- In the aftermath, cooling is sped up as part of the time-lapse, so flows finish as rock.
- Particle motion, lightning timing and sound use `Math.random`, so only the lava is exactly
  repeatable with a seed. The rest is only similar each time.
- The blast ring, fireball, surges and shake are cinematic effects, not modelled physics.
- **Building damage** (`disasters/buildingFires.ts`) is a simple rule, not an engineering model:
  - A building is "reached" when the model has at least 0.3 m of lava in its cell.
  - It's "buried" when the lava there is deeper than 2.5 m, or 40% of the building's height.
  - Only buildings in map tiles that have loaded are counted, so zoom in on a town to see all of
    them.
- When the lava model takes longer steps to catch up, the exact flow pattern differs slightly
  between fast and slow computers, even with the same seed.

```
src/
  App.tsx                     UI state: search, presets, vent, details panel
  globe/                      Map provider setup, camera flights and orbit, markers, picking
  disasters/types.ts          The shared Disaster interface every disaster implements
  disasters/controller.ts     Clock-driven run/pause/speed/reset for any disaster
  disasters/registry.ts       Disasters shown in the panel
  disasters/volcano/          Eruption timeline, plume, lava model and lava texture
  disasters/meteor/           Impact timeline, entry and chase camera, meteorite rock, crater scaling, wildfire
  disasters/buildingFires.ts  Building burn/collapse shared by lava and impacts
  disasters/gridOverlay.ts    Ground texture painted from a simulation grid (lava, fire, crater)
  disasters/terrainGrid.ts    Samples terrain heights into a grid for a simulation
  data/places.ts, volcanoes.ts  Presets, and known volcanoes used for the real/fictional label
  ui/                         Disaster panel and simulation bar
tests/                        Lava model, sculpt, fire spread, impact scaling and rock mesh tests
```

## Data sources and attribution

- **Cesium World Terrain** and **Bing Maps imagery** via Cesium ion: subject to the
  [Cesium ion terms](https://cesium.com/legal/terms-of-service/). Credits show in the bottom-left corner.
- **Google Photorealistic 3D Tiles** via Cesium ion (asset 2275207), under
  [Google's Map Tiles API policies](https://developers.google.com/maps/documentation/tile/policies).
  Google requires that these tiles are only used with Google's geocoder, so in photoreal mode search
  goes through the Cesium ion **Google** geocoder, not OpenStreetMap. Google's attribution stays on
  screen (bottom left) and under search results. Streaming counts toward your Cesium ion usage
  allowance.
- **OpenStreetMap** tiles and **Nominatim** search (terrain and no-token modes): © OpenStreetMap contributors, under the
  [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and the
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) (no more than
  one search per second; heavy use is not allowed). Search only runs when you press Search, never on
  every keystroke.
- Preset elevations: Everest 8,849 m (Nepal–China joint survey, 2020); Rainier 4,392 m (USGS);
  St. Helens 2,549 m (USGS).
- The volcano list (`data/volcanoes.ts`) uses approximate summit or crater coordinates, good to about
  a kilometre. Elevations for these come from the terrain model on arrival, not from a published
  figure.

## Known limitations

- **Lava on real terrain hasn't been checked in a browser yet.** The eruption was tested locally
  without a token (flat ground), and the lava model was tested on synthetic slopes and valleys
  (`npm test`).
- In photoreal mode, lava heights still come from Cesium World Terrain, which is smoother than
  Google's mesh. The lava texture itself drapes on Google's mesh, but small gullies the terrain model
  misses won't steer the flow.
- Photorealistic tiles are much heavier than terrain. On a slow connection or GPU, switch to terrain.
- Without a token the ground is flat, so lava pools in a disc instead of running down valleys.
- The volcano list has 31 famous volcanoes, not all of the world's ~1,300 active ones. A real
  volcano that isn't on it, like Mount Adams, is labelled "sandbox".
- The automatic power mode is a guess from what the browser reveals. Browsers hide some hardware
  details, so if it guesses wrong, pick the mode yourself.
- Lava is modelled only inside a square around the vent (about 7–20 km across, depending on the
  lava setting). The details panel says when a flow reaches the edge.
- Time of day uses today's date, so dawn and dusk times change with the seasons. Near the poles,
  where the sun may not rise or set today, the closest moment is used. The drawn sun and moon discs
  are hidden, because they follow the clock rather than the chosen light.
- See [Verified on the deployed site](#verified-on-the-deployed-site) for what has been checked
  with real terrain. Anything not listed there hasn't been verified in a live browser.
- Sculpted edits disappear when you reload the page.
- **Meteor impact:**
  - It hasn't been checked on the deployed site with real terrain yet. It was tested locally on the
    flat no-token globe: the phases, crater depth (552 m deep with a 98 m rim for the default
    150 m rock), fire spread, Before/After and Reset. Building damage needs a token, so it hasn't
    been seen working.
  - Only the crater size comes from published formulas. The entry fireball, blast ring, ejecta,
    fire spread and building damage are simplified effects. The central peak's height (30% of the
    crater depth) is a rule of thumb.
  - A rock this fast would mostly melt or vaporise on impact. The main mass, about half the
    meteor's width, is kept in the crater so you can see it. The details panel says so.
  - The chase camera, the meteorite and the reworked fire were seen working in the local test
    (flat no-token globe, software rendering at 5–13 fps), not yet on real terrain.
  - Fires spread on a 128 × 128 grid up to 80 km across. Land counts as fuel when it's above sea
    level and below a tree line that drops with latitude. There's no land-cover data, so deserts,
    bare rock and cities burn like forest.
  - Ocean impacts dig a crater on the sea floor, but there's no tsunami or water displacement.
  - When the crater appears, every terrain tile reloads. Under the impact fireball this is usually
    hidden, but on a slow computer the ground can flash blank for a moment.
  - Rocks bigger than about 800 m, and air bursts that never reach the ground, aren't modelled.
- **Buildings and fires:**
  They're built on Cesium OSM Buildings' `cesium#latitude`, `cesium#longitude` and
  `cesium#estimatedHeight` properties. If those are missing, the console says so, and buildings
  still show but won't burn.
- In Photoreal mode, burning buildings show flames and smoke, but Google's mesh can't be recoloured
  or removed, so they don't visibly char or collapse.
- Desktop first. It works on phones, but the globe controls are built for a mouse.
- The production bundle is large (~4.4 MB, ~1.2 MB gzipped), almost all of it CesiumJS.

## Verified on the deployed site

These were checked on <https://matthewleepark.github.io/earthbreaker/> with the Cesium ion token
(real terrain) on 27 October 2026, in headless Chrome with software rendering (about 5 fps). Only
checks that passed are listed. Sound wasn't checked, because the test browser had no audio output.

- **Vent on the real summit:** Mount Fuji's vent sits exactly on the highest terrain within 1.5 km
  (0 m off, 0 m above the ground).
- **Arming doesn't erupt:** after selecting Mount Rainier and waiting, nothing started. There was no
  simulation bar, the clock stayed stopped, and no effects were added.
- **The eruption on Mount Rainier:**
  - It runs warning → main eruption → aftermath → ended.
  - Volcanic lightning appeared in the plume.
  - Up to 121 debris pieces were resting on the terrain at once.
  - The lava ran 6.7 km down a valley on the north-north-east flank, under the 10 km cap, and
    ended 0% molten (black crust).
  - Reset removed every effect and stopped the clock.
- **Buildings burn, then are buried** (Mount Vesuvius, lava setting 5): real OpenStreetMap houses
  in the flow's path turned orange with smoke rising, then were hidden under the lava. The count
  read 6 reached and 2 buried, and the house that was zoomed in on was gone.
- **Time of day mid-eruption:**
  - Switching Dawn → Noon → Dusk → Night didn't make the eruption clock jump, in both terrain and
    photorealistic views.
  - At Night, lightning reads clearly against the dark sky.
  - Google's photorealistic tiles take the dark night tint.
- **Sculpt:**
  - It's unavailable while an eruption runs, and available again after Reset.
  - Spawn peak, raise and lower changed the real terrain heights. Undo and Clear removed them,
    and the satellite imagery draped over the new shapes (not a white sheet).

## Roadmap

Taken from the project blueprint. The eruption was moved ahead of buildings on request:

1. ~~Foundation and globe~~
2. ~~Real-world navigation (search, Everest, Rainier)~~
3. ~~First disaster: volcanic eruption~~
4. ~~Simulation controls: pause, resume, reset, timeline, before/after~~
5. ~~Environment: 3D buildings (Cesium OSM Buildings / Google Photorealistic 3D Tiles)~~; procedural settlements where there's no building data are still to do
6. Polish: lighting, camera work, performance
7. More disasters: ~~meteor impact~~, earthquake, landslide
