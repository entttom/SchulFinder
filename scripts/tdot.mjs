// Sammelt Termine für Tage der offenen Tür von den Websites der Schulen.
// Aufruf: npm run tdot (nach npm run data). Ergebnis: public/data/tdot.json
// Je Schule werden höchstens die Startseite und drei Unterseiten gelesen, mit eigenem User-Agent.
import { readFile, writeFile } from 'node:fs/promises';
import { USER_AGENT, throttled } from './lib/net.mjs';
import { htmlZuText, interessanteLinks, termineIn } from './lib/tdot.mjs';

const ARTEN = new Set(['vs', 'ms', 'ahs', 'bmhs', 'ps', 'lf']);
const kern = JSON.parse(await readFile('public/data/schulen.json', 'utf8'));
const details = JSON.parse(await readFile('public/data/details.json', 'utf8'));
const heute = new Date();

async function seite(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
  if (!r.ok || !/html/i.test(r.headers.get('content-type') ?? '')) return null;
  const html = (await r.text()).slice(0, 1_500_000);
  return { html, url: r.url };
}

const ziele = kern.schulen
  .filter((s) => ARTEN.has(s.kat) && details[s.skz]?.web)
  .map((s) => ({ skz: s.skz, web: /^https?:/i.test(details[s.skz].web) ? details[s.skz].web : `https://${details[s.skz].web}` }));

const ergebnis = {};
let fertig = 0;
let treffer = 0;
await throttled(
  ziele,
  async ({ skz, web }) => {
    try {
      const start = await seite(web);
      if (!start) return;
      const gefunden = new Map();
      const sammle = (html, url) => {
        for (const t of termineIn(htmlZuText(html), heute)) if (!gefunden.has(t.d)) gefunden.set(t.d, { ...t, q: url });
      };
      sammle(start.html, start.url);
      for (const link of interessanteLinks(start.html, start.url).slice(0, 3)) {
        const s = await seite(link).catch(() => null);
        if (s) sammle(s.html, s.url);
      }
      if (gefunden.size) {
        ergebnis[skz] = [...gefunden.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-6);
        treffer++;
      }
    } catch {
      /* Website nicht erreichbar: keine Termine */
    } finally {
      if (++fertig % 200 === 0) console.log(`  ${fertig}/${ziele.length}, Termine bei ${treffer} Schulen`);
    }
  },
  { concurrency: 16, gapMs: 20 },
);

await writeFile('public/data/tdot.json', JSON.stringify({ stand: heute.toISOString().slice(0, 10), schulen: ergebnis }));
console.log(`Tage der offenen Tür: ${treffer} von ${ziele.length} Schulwebsites mit Terminen`);
