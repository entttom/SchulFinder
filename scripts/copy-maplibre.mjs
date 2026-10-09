// MapLibre sucht seinen Worker neben dem eigenen Skript. Nach dem Bündeln liegt dort nichts,
// deshalb liefern wir die Datei selbst aus (public/maplibre/) und geben die Adresse in map.ts an.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/maplibre', { recursive: true });
copyFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/maplibre/maplibre-gl-worker.mjs');
