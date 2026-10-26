# Earthbreaker

A browser-based 3D Earth you can explore with real terrain, and, in later milestones, a sandbox for
cinematic disaster simulations over that terrain.

Terrain and imagery come from real geographic data. Disaster effects (when they arrive) will be
approximate visualisations, **not** scientific forecasts.

## Status

**Milestone 1: globe and navigation (done)**

- A 3D globe (CesiumJS) you can rotate, zoom and tilt
- Place search for anywhere on Earth (OpenStreetMap Nominatim)
- One-click flights to Mount Everest and Mount Rainier, framed to show the surrounding landscape
- A details panel showing the place name, coordinates and elevation (only when a real source exists), plus the camera's altitude
- Clear messages for a missing or rejected token, failed searches, and browsers without WebGL
- Direct links: `?place=everest` or `?place=rainier`

Not started yet: buildings, disasters, and simulation controls. See [Roadmap](#roadmap).

## Setup

You need [Node.js](https://nodejs.org/) 20 or newer (built and tested with Node 25.9).

```sh
npm install
```

### Cesium ion token (free, recommended)

Without a token the app still runs, but the ground is flat and the imagery is a street map. With one
you get Cesium World Terrain (real elevation) and Bing Maps satellite imagery.

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
| `npm run typecheck` | Type-check only |

## Controls

| Input | Action |
| --- | --- |
| Left-drag | Rotate the globe, or pan when close to the ground |
| Scroll / right-drag | Zoom |
| Ctrl + left-drag, or middle-drag | Tilt and turn the camera |
| Esc | Close menus |

## How it's built

| Piece | Choice |
| --- | --- |
| UI | React 19 + TypeScript |
| Globe, camera, terrain | CesiumJS 1.146 |
| Terrain and imagery | Cesium ion (World Terrain, Bing aerial); OpenStreetMap tiles as the no-token fallback |
| Place search | OpenStreetMap Nominatim |
| Build | Vite 8 (plus `vite-plugin-static-copy` for Cesium's workers and assets) |

```
src/
  App.tsx              UI: top bar, search, presets, details panel, help
  globe/createGlobe.ts Map-provider setup, camera flights, marker, terrain sampling
  globe/GlobeView.tsx  Mounts the Cesium viewer and cleans it up
  services/geocode.ts  Nominatim search
  data/places.ts       Preset places and camera framing
```

Map-provider code (`globe/`) is kept separate from UI state (`App.tsx`), so the disaster system can
be added as its own module without touching the map setup.

## Data sources and attribution

- **Cesium World Terrain** and **Bing Maps imagery** via Cesium ion: subject to the
  [Cesium ion terms](https://cesium.com/legal/terms-of-service/). Credits show in the bottom-left corner.
- **OpenStreetMap** tiles and **Nominatim** search: © OpenStreetMap contributors, under the
  [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and the
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) (no more than
  one search per second; heavy use is not allowed). Search only runs when you press Search, never on
  every keystroke.
- Preset elevations: Everest 8,849 m (Nepal–China joint survey, 2020); Rainier 4,392 m (USGS).

## Known limitations

- **Real terrain has not been checked here yet.** The no-token path, search, flights, and the
  bad-token error were tested in headless Chrome. The ion terrain/imagery path needs a real token
  to check.
- Without a token, the ground is a smooth ellipsoid. Mountains are flat, and elevations for search
  results show "Not available" rather than a made-up number.
- Search-result elevations come from sampling the terrain model, so they're the ground height at the
  result's pin, not an official survey figure.
- The sun is fixed at about 10:30 local time at each destination, so terrain is always lit. It's not
  the real current time of day.
- No 3D buildings yet (Milestone 3).
- Desktop first. It works on narrow screens, but the globe controls are built for a mouse.
- The production bundle is large (~4.4 MB, ~1.2 MB gzipped), almost all of it CesiumJS.

## Roadmap

Taken from the project blueprint, one milestone at a time:

1. ~~Foundation and globe~~
2. ~~Real-world navigation (search, Everest, Rainier)~~, combined with step 1 above
3. Environment: 3D buildings where data exists (Cesium OSM Buildings / Google Photorealistic 3D Tiles), procedural settlements where it doesn't
4. First disaster: volcanic eruption (plume, ejecta, terrain-following lava, aftermath)
5. Simulation controls: pause, resume, reset, timeline, before/after
6. Polish: lighting, camera work, performance
7. More disasters: meteor impact, earthquake, landslide
