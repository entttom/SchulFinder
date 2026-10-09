import { defineConfig } from 'astro/config';

// SITE und BASE kommen aus der Umgebung (GitHub Action), lokal gilt "/".
// DEV_HTTPS=1 startet den Dev-Server mit selbstsigniertem Zertifikat. Nur damit erlaubt
// das Handy im WLAN die Standortabfrage (Browser verlangen dafür https).
const plugins = [];
if (process.env.DEV_HTTPS) plugins.push((await import('@vitejs/plugin-basic-ssl')).default());

export default defineConfig({
  site: process.env.SITE || 'http://localhost:4321',
  base: process.env.BASE || '/',
  trailingSlash: 'always',
  vite: {
    plugins,
    // MapLibre startet seinen Worker über new URL(...); das darf Vite nicht vorbündeln.
    optimizeDeps: { exclude: ['maplibre-gl'] },
  },
});
