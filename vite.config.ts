import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Exact-host allowlist for the cloud preview (never allowHosts: true).
const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  // relative asset base so the production build works from any mount point
  // (GitHub Pages serves the project at /D1/)
  base: './',
  build: {
    rollupOptions: {
      output: {
        // three.js (~480 kB minified) is the only half-megabyte dependency —
        // keep it in its own lazy vendor chunk so neither the initial bundle
        // nor the Viewer3D chunk trips the 500 kB size warning
        manualChunks(id: string) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    allowedHosts: extraHosts.length ? extraHosts : false,
  },
  test: {
    environment: 'node',
    // .tsx files are component tests — they opt into jsdom via their own
    // `@vitest-environment jsdom` docblock; engine tests stay on node
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
