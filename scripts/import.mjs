// Lädt Bildungskompass und Statistik Austria (Schulatlas), führt sie über die
// Schulkennzahl zusammen und schreibt public/data/{schulen,uebertritte}.json.
//
//   npm run data                  alles (Übertritte nur, wenn der Cache älter als 90 Tage ist)
//   npm run data -- --offline     nur aus .cache neu zusammenführen
//   npm run data -- --no-uebertritte
//   npm run data -- --no-ergebnisse
//
// Umgebung: UEBERTRITTE_MAX_AGE_DAYS (90), UEBERTRITTE_MAX_MINUTES (40); gelten auch für die Ergebnisse
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getJson, postJson, throttled } from './lib/net.mjs';
import { mergeSources, invertUebertritte, splitKernDetail, KATEGORIEN } from './lib/merge.mjs';
import { parseKpis, hatVolksschule } from './lib/ergebnisse.mjs';

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const withUebertritte = !args.has('--no-uebertritte');
const withErgebnisse = !args.has('--no-ergebnisse');
const MAX_AGE_MS = Number(process.env.UEBERTRITTE_MAX_AGE_DAYS ?? 90) * 864e5;
const MAX_MINUTES = Number(process.env.UEBERTRITTE_MAX_MINUTES ?? 40);

const BK_URL = 'https://www.bildungskompass.gv.at/api/oeffentliche-schulen/search';
const ATLAS = 'https://www.statistik.at/gs-atlas/ATLAS_SCHULE_WFS/ows';
const wfs = (layer, extra = '') =>
  `${ATLAS}?service=WFS&version=1.0.0&request=GetFeature&typeName=ATLAS_SCHULE_WFS:${layer}&outputFormat=application/json${extra}`;

// Schulen, für die der Schulatlas Abgänge nach der 4. bzw. 8. Schulstufe ausweist
const MIT_UEBERTRITT = new Set(['VS', 'NMSH', 'HS', 'AHS', 'NMSA', 'SS', 'ASTAT']);

await mkdir('.cache', { recursive: true });
await mkdir('public/data', { recursive: true });

const readCache = async (name) => JSON.parse(await readFile(`.cache/${name}`, 'utf8'));
const writeCache = (name, data) => writeFile(`.cache/${name}`, JSON.stringify(data));

/** Frisch laden; schlägt das fehl, auf den Zwischenspeicher zurückfallen. */
async function load(name, fetcher) {
  if (!offline) {
    try {
      const data = await fetcher();
      await writeCache(name, data);
      return data;
    } catch (err) {
      console.warn(`! ${name}: Abruf fehlgeschlagen (${err.message}), verwende Zwischenspeicher`);
    }
  }
  return readCache(name);
}

const bk = await load('bk.json', async () => {
  const j = await postJson(BK_URL, { searchPattern: null, pageNumber: 0, pageSize: 10000 });
  if (!Array.isArray(j.schulen) || j.schulen.length < j.totalCount) {
    throw new Error(`Unvollständige Antwort (${j.schulen?.length}/${j.totalCount})`);
  }
  return j.schulen;
});
const atlas = await load('atlas.json', async () => {
  const j = await getJson(wfs('ATLAS_SCHULE', '&srsname=EPSG:4326'));
  if (!Array.isArray(j.features) || j.features.length < 1000) throw new Error('Zu wenige Schulen im Atlas');
  return j.features;
});

const schulen = mergeSources(bk, atlas);
const { kern, details } = splitKernDetail(schulen);
const meta = { abgerufen: new Date().toISOString().slice(0, 10), schuljahr: '2024/25' };
await writeFile('public/data/schulen.json', JSON.stringify({ ...meta, kategorien: KATEGORIEN, schulen: kern }));
await writeFile('public/data/details.json', JSON.stringify(details));
const count = (f) => schulen.filter(f).length;
console.log(
  `${schulen.length} Schulen: ${count((s) => s.quelle === 'beide')} in beiden Quellen, ` +
    `${count((s) => s.quelle === 'bk')} nur Bildungskompass, ${count((s) => s.quelle === 'atlas')} nur Atlas, ` +
    `${count((s) => s.lat === undefined)} ohne Standort`,
);

/* ---------- Übertritte ---------- */
if (withUebertritte) {
  let cache = {};
  try {
    cache = await readCache('uebertritte.json');
  } catch {}

  const now = Date.now();
  const todo = atlas
    .map((f) => f.properties)
    .filter((p) => MIT_UEBERTRITT.has(p.KARTO_TYP))
    .map((p) => String(p.SKZ))
    .filter((skz) => offline === false && !(cache[skz] && now - cache[skz].t < MAX_AGE_MS));

  if (todo.length) {
    console.log(`Übertritte: ${todo.length} Schulen abzufragen (Budget ${MAX_MINUTES} min)`);
    const deadline = now + MAX_MINUTES * 60000;
    let done = 0;
    let failed = 0;
    await throttled(
      todo,
      async (skz) => {
        try {
          const j = await getJson(wfs('ATLAS_SCHULE_UEBERTRITT_OUT_WFS', `&viewparams=skz:${skz}`), { retries: 2, timeoutMs: 30000 });
          cache[skz] = {
            t: Date.now(),
            rows: j.features
              .map((f) => f.properties)
              .filter((p) => p.ANZAHL > 0 && String(p.SKZ_VJ) === skz)
              .map((p) => [String(p.SKZ_LAUFEND), p.ANZAHL, p.IPUB2_TYP_VJ]),
          };
        } catch {
          failed++;
        }
        if (++done % 250 === 0) {
          await writeCache('uebertritte.json', cache);
          console.log(`  ${done}/${todo.length}${failed ? `, ${failed} Fehler` : ''}`);
        }
      },
      { concurrency: 4, gapMs: 100, shouldStop: () => Date.now() > deadline },
    );
    await writeCache('uebertritte.json', cache);
    if (done < todo.length) console.warn(`! Zeitbudget erreicht: ${todo.length - done} Schulen folgen beim nächsten Lauf`);
    if (failed) console.warn(`! ${failed} Abfragen fehlgeschlagen (werden beim nächsten Lauf wiederholt)`);
  } else {
    console.log('Übertritte: Zwischenspeicher aktuell');
  }

  const known = new Set(schulen.map((s) => s.skz));
  const out = {};
  for (const [skz, v] of Object.entries(cache)) {
    const rows = v.rows.filter(([ziel]) => known.has(ziel));
    if (rows.length && known.has(skz)) out[skz] = rows.sort((a, b) => b[1] - a[1]);
  }
  await writeFile('public/data/uebertritte.json', JSON.stringify({ aus: out, zu: invertUebertritte(out) }));
  console.log(`Übertritte: ${Object.keys(out).length} Schulen mit Abgängen`);
}

/* ---------- Schulmittelwerte (Bildungsstandards) ---------- */
if (withErgebnisse) {
  let cache = {};
  try {
    cache = await readCache('ergebnisse.json');
  } catch {}

  const now = Date.now();
  const todo = bk
    .filter(hatVolksschule)
    .map((s) => String(s.kennzahl))
    .filter((skz) => offline === false && !(cache[skz] && now - cache[skz].t < MAX_AGE_MS));

  if (todo.length) {
    console.log(`Ergebnisse: ${todo.length} Schulen abzufragen (Budget ${MAX_MINUTES} min)`);
    const deadline = now + MAX_MINUTES * 60000;
    let done = 0;
    let failed = 0;
    await throttled(
      todo,
      async (skz) => {
        try {
          const k = await getJson(`https://www.bildungskompass.gv.at/api/kpis/${skz}`, { retries: 2, timeoutMs: 30000 });
          cache[skz] = { t: Date.now(), e: parseKpis(k) };
        } catch {
          failed++;
        }
        if (++done % 250 === 0) {
          await writeCache('ergebnisse.json', cache);
          console.log(`  ${done}/${todo.length}${failed ? `, ${failed} Fehler` : ''}`);
        }
      },
      { concurrency: 4, gapMs: 100, shouldStop: () => Date.now() > deadline },
    );
    await writeCache('ergebnisse.json', cache);
    if (done < todo.length) console.warn(`! Zeitbudget erreicht: ${todo.length - done} Schulen folgen beim nächsten Lauf`);
    if (failed) console.warn(`! ${failed} Abfragen fehlgeschlagen (werden beim nächsten Lauf wiederholt)`);
  } else {
    console.log('Ergebnisse: Zwischenspeicher aktuell');
  }

  const known = new Set(schulen.map((s) => s.skz));
  const daten = {};
  let zyklus;
  for (const [skz, v] of Object.entries(cache)) {
    if (!v.e || !known.has(skz)) continue;
    daten[skz] = [v.e.de ?? null, v.e.ma ?? null];
    zyklus ??= v.e.zyklus;
  }
  await writeFile('public/data/ergebnisse.json', JSON.stringify({ zyklus: zyklus ?? 'Schuljahre 2022/23 - 2024/25', daten }));
  console.log(`Ergebnisse: ${Object.keys(daten).length} Schulen mit Schulmittelwerten`);
}
