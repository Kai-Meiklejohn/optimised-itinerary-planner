import path from 'node:path'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'maplibre-worker-assets',
      apply: 'build',
      // MapLibre loads these sibling modules dynamically. Keep their filenames.
      generateBundle() {
        for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
          this.emitFile({
            type: 'asset',
            fileName: `assets/${name}`,
            source: readFileSync(path.resolve(import.meta.dirname, 'node_modules/maplibre-gl/dist', name)),
          })
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  optimizeDeps: {
    // maplibre-gl v6 loads its worker as a real module URL; Vite's dependency
    // optimizer mishandles that file and fails the dev server with "the file
    // does not exist ... maplibre-gl-worker.mjs" unless it's left alone.
    exclude: ['maplibre-gl'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, 'backend/**'],
  },
})
