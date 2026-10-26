import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// "/" locally; the GitHub Pages workflow sets BASE_PATH=/earthbreaker/ because
// the site is served from matthewleepark.github.io/earthbreaker/.
const base = process.env.BASE_PATH ?? "/";

// CesiumJS loads its web workers, textures and widget CSS at runtime from
// CESIUM_BASE_URL, so those folders are copied next to the app as static files.
const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  base,
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: cesiumBaseUrl,
        // Drop the leading node_modules/cesium/Build/Cesium so files land in cesium/<dir>.
        rename: { stripBase: cesiumSource.split("/").length },
      })),
    }),
  ],
  // CesiumJS alone is about 4 MB minified, so the default 500 kB warning always fires.
  build: { chunkSizeWarningLimit: 5000 },
  define: {
    CESIUM_BASE_URL: JSON.stringify(`${base}${cesiumBaseUrl}/`),
  },
});
