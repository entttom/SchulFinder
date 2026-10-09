// Nur im Build (Astro-Frontmatter) verwenden: liest die von scripts/import.mjs erzeugten Dateien.
import { readFileSync, existsSync } from 'node:fs';
import type { Daten, Detail, Ergebnisse, Uebertritte } from './types';

const read = <T>(file: string, fallback?: T, ordner = 'public/data'): T => {
  const path = `${ordner}/${file}`;
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${path} fehlt. Zuerst "npm run data" ausführen.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
};

export const kern = () => read<Daten>('schulen.json');
export const details = () => read<Record<string, Detail>>('details.json');
export const uebertritte = () => read<Uebertritte>('uebertritte.json', { aus: {}, zu: {} });
/** Namen der Zielschulen mit höchstens 6 Kindern: nur für den Build, nicht im Browser. { skz: { stufe: [skz, ...] } } */
export const uebertritteKlein = () =>
  read<{ aus: Record<string, Record<string, string[]>>; zu: Record<string, Record<string, string[]>> }>('uebertritte-klein.json', { aus: {}, zu: {} }, 'build-data');
export const ergebnisse = () => read<Ergebnisse>('ergebnisse.json', { zyklus: 'Schuljahre 2022/23 - 2024/25', daten: {} });
