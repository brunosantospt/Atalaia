import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Cesium loads its workers, widgets CSS and assets at runtime from CESIUM_BASE_URL,
// so they are served as static files instead of being bundled.
const cesiumBuild = 'node_modules/cesium/Build/Cesium'
const cesiumBaseUrl = 'cesium'
// The API (api/serve.sh, docs/contracts.md) answers under /api, on its own port.
const proxy = { '/api': 'http://127.0.0.1:5181' }

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  build: {
    chunkSizeWarningLimit: 5000, // Cesium alone is ~4 MB minified
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    cors: true,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    cors: true,
    proxy,
  },
  plugins: [
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumBuild}/${dir}`,
        dest: cesiumBaseUrl,
        rename: { stripBase: 4 }, // drop node_modules/cesium/Build/Cesium
      })),
    }),
  ],
})
