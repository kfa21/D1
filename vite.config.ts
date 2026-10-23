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
  server: {
    host: true,
    port: 3000,
    allowedHosts: extraHosts.length ? extraHosts : false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
