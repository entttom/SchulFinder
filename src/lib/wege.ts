// Schulwege aus OpenStreetMap: Geh- und Radzeiten (Routing der FOSSGIS), Haltestellen und
// Hauptstraßen aus den Vektorkacheln von OpenFreeMap. Alles läuft im Browser, ohne eigenen Server.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { distanceM } from './geo';

export type Punkt = { lon: number; lat: number };
type Profil = 'foot' | 'bike';
const OSRM = 'https://routing.openstreetmap.de';
const koord = (p: Punkt) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;

/** Der öffentliche Routing-Server antwortet bei Last manchmal mit Fehlern: bis zu dreimal versuchen. */
async function holeJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let fehler: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      // ohne Antwort nach 12 Sekunden aufgeben (sonst hängt die Planung)
      const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9000)]) : AbortSignal.timeout(9000) });
      if (r.ok) return (await r.json()) as T;
      fehler = new Error(`HTTP ${r.status}`);
    } catch (e) {
      fehler = e;
    }
    // 429: der Server bremst, dann länger warten
    await new Promise((res) => setTimeout(res, (String(fehler).includes('429') ? 1800 : 700) * (i + 1)));
  }
  throw fehler;
}

/* ---------- Ersatz: Valhalla (ebenfalls FOSSGIS, OpenStreetMap), falls das OSRM-Routing ausfällt ---------- */
const VALHALLA = 'https://valhalla1.openstreetmap.de';
/** Nach dem ersten Ausfall von OSRM gleich Valhalla fragen (spart lange Wartezeiten). */
let osrmAus = false;
const kosten = (p: Profil) => (p === 'foot' ? 'pedestrian' : 'bicycle');
const ll = (p: Punkt) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) });

async function valhallaZeiten(profil: Profil, von: Punkt, ziele: Punkt[], signal?: AbortSignal) {
  const raus: (number | null)[] = [];
  for (let i = 0; i < ziele.length; i += 40) {
    const teil = ziele.slice(i, i + 40);
    const q = { sources: [ll(von)], targets: teil.map(ll), costing: kosten(profil) };
    const j = await holeJson<{ sources_to_targets: { time: number | null }[][] }>(`${VALHALLA}/sources_to_targets?json=${encodeURIComponent(JSON.stringify(q))}`, signal);
    raus.push(...j.sources_to_targets[0].map((x) => (x.time === null ? null : x.time / 60)));
  }
  return raus;
}

/** Polyline mit 6 Nachkommastellen (Valhalla) dekodieren. */
function polyline6(str: string): [number, number][] {
  const raus: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  const zahl = () => {
    let r = 0, s = 0, b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << s;
      s += 5;
    } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) {
    lat += zahl();
    lon += zahl();
    raus.push([lon / 1e6, lat / 1e6]);
  }
  return raus;
}

async function valhallaRoute(profil: Profil, von: Punkt, nach: Punkt, signal?: AbortSignal): Promise<Route | null> {
  const q = { locations: [ll(von), ll(nach)], costing: kosten(profil), directions_type: 'none' };
  const j = await holeJson<{ trip?: { summary: { time: number; length: number }; legs: { shape: string }[] } }>(`${VALHALLA}/route?json=${encodeURIComponent(JSON.stringify(q))}`, signal);
  if (!j.trip) return null;
  return { linie: j.trip.legs.flatMap((l) => polyline6(l.shape)), min: j.trip.summary.time / 60, m: j.trip.summary.length * 1000 };
}

/* ---------- Routing ---------- */
/** Bereits berechnete Zeiten bleiben für die Dauer des Tabs gespeichert (schont den öffentlichen Server). */
function zwischenspeicher(profil: Profil, von: Punkt) {
  const key = `schulfinder.zeiten.${profil}.${koord(von)}`;
  let daten: Record<string, number | null> = {};
  try {
    daten = JSON.parse(sessionStorage.getItem(key) ?? '{}');
  } catch { /* leer */ }
  return {
    daten,
    sichern: () => {
      try {
        sessionStorage.setItem(key, JSON.stringify(daten));
      } catch { /* voll oder gesperrt */ }
    },
  };
}

/** Dauer in Minuten von einem Punkt zu vielen Zielen (null: keine Route gefunden). */
export async function zeiten(profil: Profil, von: Punkt, ziele: Punkt[], signal?: AbortSignal): Promise<(number | null)[]> {
  const cache = zwischenspeicher(profil, von);
  const fehlt = ziele.filter((z) => !(koord(z) in cache.daten));
  for (let i = 0; i < fehlt.length; i += 90) {
    const teil = fehlt.slice(i, i + 90);
    const url = `${OSRM}/routed-${profil}/table/v1/driving/${[von, ...teil].map(koord).join(';')}?sources=0&annotations=duration`;
    let werte: (number | null)[];
    try {
      if (osrmAus) throw new Error('OSRM aus');
      const j = await holeJson<{ code: string; durations?: (number | null)[][] }>(url, signal);
      if (j.code !== 'Ok' || !j.durations) throw new Error(`Routing: ${j.code}`);
      werte = j.durations[0].slice(1).map((d) => (d === null ? null : d / 60));
    } catch {
      osrmAus = true;
      werte = await valhallaZeiten(profil, von, teil, signal);
    }
    werte.forEach((d, k) => (cache.daten[koord(teil[k])] = d));
    cache.sichern();
  }
  return ziele.map((z) => cache.daten[koord(z)] ?? null);
}

export type Route = { linie: [number, number][]; min: number; m: number };
const routenSpeicher = new Map<string, Promise<Route | null>>();
/** Weg mit Linienführung (für die Karte und den Sicherheits-Check). */
export function route(profil: Profil, von: Punkt, nach: Punkt, signal?: AbortSignal): Promise<Route | null> {
  const key = `${profil}|${koord(von)}|${koord(nach)}`;
  const alt = routenSpeicher.get(key);
  if (alt) return alt;
  try {
    const gemerkt = sessionStorage.getItem(`schulfinder.route.${key}`);
    if (gemerkt) return Promise.resolve(JSON.parse(gemerkt) as Route);
  } catch { /* nicht verfügbar */ }
  const osrm = osrmAus
    ? Promise.resolve(null)
    : holeJson<Parameters<typeof auswerten>[0]>(`${OSRM}/routed-${profil}/route/v1/driving/${koord(von)};${koord(nach)}?overview=full&geometries=geojson`, signal).catch(() => {
        osrmAus = true;
        return null;
      });
  const p = osrm
    .then(auswerten)
    .catch(() => null)
    .then((r) => r ?? valhallaRoute(profil, von, nach, signal).catch(() => null))
    .then((r) => {
      try {
        if (r) sessionStorage.setItem(`schulfinder.route.${key}`, JSON.stringify(r));
      } catch { /* voll */ }
      return r;
    });
  routenSpeicher.set(key, p);
  return p;
}
const auswerten = (j: { code: string; routes?: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[] } | null): Route | null => {
  const r = j?.code === 'Ok' ? j.routes?.[0] : undefined;
  return r ? { linie: r.geometry.coordinates, min: r.duration / 60, m: r.distance } : null;
};

/* ---------- Vektorkacheln (OpenFreeMap, OpenMapTiles-Schema) ---------- */
const Z = 14;
let vorlage: Promise<string> | null = null;
const kachelVorlage = () =>
  (vorlage ??= fetch('https://tiles.openfreemap.org/planet')
    .then((r) => r.json())
    .then((j: { tiles: string[] }) => j.tiles[0]));

const kacheln = new Map<string, Promise<VectorTile | null>>();
function kachel(x: number, y: number): Promise<VectorTile | null> {
  const key = `${x}/${y}`;
  const alt = kacheln.get(key);
  if (alt) return alt;
  const p = kachelVorlage()
    .then((t) => fetch(t.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y))))
    .then(async (r) => (r.ok ? new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer()))) : null))
    .catch(() => null);
  kacheln.set(key, p);
  return p;
}

/** Kachelkoordinaten (mit Bruchteil) eines Punkts. */
function kachelPos(p: Punkt) {
  const n = 2 ** Z;
  const r = (p.lat * Math.PI) / 180;
  return { x: ((p.lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

/** Die vier Kacheln um einen Punkt (der Punkt liegt dann mindestens eine halbe Kachel, etwa 1 km, vom Rand). */
function kachelnUm(p: Punkt): [number, number][] {
  const { x, y } = kachelPos(p);
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  return [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]];
}

/* ---------- Haltestellen ---------- */
export type Halt = { lon: number; lat: number; art: string; name?: string };
const HALT_ART: Record<string, string> = {
  bus_stop: 'Bushaltestelle', bus_station: 'Busbahnhof', tram_stop: 'Straßenbahn', station: 'Bahnhof', halt: 'Bahnhaltestelle', subway: 'U-Bahn',
};

async function haltestellenIn(x: number, y: number): Promise<Halt[]> {
  const t = await kachel(x, y);
  const poi = t?.layers.poi;
  if (!poi) return [];
  const raus: Halt[] = [];
  for (let i = 0; i < poi.length; i++) {
    const f = poi.feature(i);
    const p = f.properties;
    const sub = String(p.subclass ?? '');
    if ((p.class !== 'bus' && p.class !== 'railway') || !HALT_ART[sub]) continue;
    const g = f.toGeoJSON(x, y, Z).geometry;
    if (g.type !== 'Point') continue;
    const name = (p['name:de'] ?? p.name) as string | undefined;
    raus.push({ lon: g.coordinates[0], lat: g.coordinates[1], art: sub === 'station' && /U\d|U-Bahn/.test(name ?? '') ? 'U-Bahn' : HALT_ART[sub], name });
  }
  return raus;
}

/** Nächste Haltestelle (Bus, Straßenbahn, Bahn) im Umkreis von etwa einem Kilometer. */
export async function naechsterHalt(p: Punkt): Promise<{ m: number; art: string; name?: string } | null> {
  const alle = (await Promise.all(kachelnUm(p).map(([x, y]) => haltestellenIn(x, y)))).flat();
  let best: { m: number; art: string; name?: string } | null = null;
  for (const h of alle) {
    const m = distanceM(p.lon, p.lat, h.lon, h.lat);
    // Bahn und Straßenbahn sind meist dichter getaktet: leicht bevorzugt
    const gewichtet = m * (h.art === 'Bushaltestelle' ? 1 : 0.85);
    if (!best || gewichtet < best.m * (best.art === 'Bushaltestelle' ? 1 : 0.85)) best = { m, art: h.art, name: h.name };
  }
  return best && best.m <= 1200 ? best : null;
}

/* ---------- Schulweg-Check: Hauptstraßen am Fußweg ---------- */
const HAUPT = new Set(['trunk', 'primary', 'secondary']);
type Seg = [number, number, number, number];

/** Liegt der Weg in einem lokalen Meter-Raster (gut genug für ein paar Kilometer). */
function projektor(ref: Punkt) {
  const kx = 111320 * Math.cos((ref.lat * Math.PI) / 180);
  return (lon: number, lat: number): [number, number] => [(lon - ref.lon) * kx, (lat - ref.lat) * 110540];
}

async function hauptstrassen(linie: [number, number][], proj: (lon: number, lat: number) => [number, number]): Promise<Seg[]> {
  const pos = linie.map(([lon, lat]) => kachelPos({ lon, lat }));
  const xs = pos.map((p) => Math.floor(p.x));
  const ys = pos.map((p) => Math.floor(p.y));
  const segs: Seg[] = [];
  const liste: [number, number][] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let y = Math.min(...ys); y <= Math.max(...ys); y++) liste.push([x, y]);
  if (liste.length > 9) return []; // sehr lange Wege: kein Check (betrifft Kinder, die ohnehin nicht zu Fuß gehen)
  for (const [x, y] of liste) {
    const t = await kachel(x, y);
    const tr = t?.layers.transportation;
    if (!tr) continue;
    for (let i = 0; i < tr.length; i++) {
      const f = tr.feature(i);
      if (!HAUPT.has(String(f.properties.class)) || f.properties.brunnel) continue;
      const g = f.toGeoJSON(x, y, Z).geometry;
      const linien = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of linien) {
        for (let k = 1; k < l.length; k++) {
          const a = proj(l[k - 1][0], l[k - 1][1]);
          const b = proj(l[k][0], l[k][1]);
          segs.push([a[0], a[1], b[0], b[1]]);
        }
      }
    }
  }
  return segs;
}

const kreuz = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function schnitt(s: Seg, r: Seg): [number, number] | null {
  const d1 = kreuz(r[0], r[1], r[2], r[3], s[0], s[1]);
  const d2 = kreuz(r[0], r[1], r[2], r[3], s[2], s[3]);
  const d3 = kreuz(s[0], s[1], s[2], s[3], r[0], r[1]);
  const d4 = kreuz(s[0], s[1], s[2], s[3], r[2], r[3]);
  if (d1 * d2 >= 0 || d3 * d4 >= 0) return null;
  const t = d1 / (d1 - d2);
  return [s[0] + t * (s[2] - s[0]), s[1] + t * (s[3] - s[1])];
}

function abstand(px: number, py: number, r: Seg) {
  const dx = r[2] - r[0];
  const dy = r[3] - r[1];
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - r[0]) * dx + (py - r[1]) * dy) / l));
  return Math.hypot(px - (r[0] + t * dx), py - (r[1] + t * dy));
}

export type Sicherheit = { querungen: number; entlangM: number; stellen: [number, number][] };

/**
 * Wie oft quert der Fußweg eine Hauptstraße (Bundes- oder Landesstraße), und wie lange führt er an einer entlang?
 * Querungen im Abstand von weniger als 40 m zählen einmal (z. B. zwei Fahrbahnen).
 */
export async function schulwegCheck(r: Route): Promise<Sicherheit> {
  const [lon0, lat0] = r.linie[0];
  const proj = projektor({ lon: lon0, lat: lat0 });
  const strassen = await hauptstrassen(r.linie, proj);
  const weg = r.linie.map(([lon, lat]) => proj(lon, lat));
  const treffer: [number, number][] = [];
  let entlangM = 0;
  for (let i = 1; i < weg.length; i++) {
    const s: Seg = [weg[i - 1][0], weg[i - 1][1], weg[i][0], weg[i][1]];
    const laenge = Math.hypot(s[2] - s[0], s[3] - s[1]);
    if (laenge < 0.5) continue;
    const mx = (s[0] + s[2]) / 2;
    const my = (s[1] + s[3]) / 2;
    let nah = false;
    for (const st of strassen) {
      // Grobe Vorauswahl über das umgebende Rechteck
      if (Math.max(st[0], st[2]) < Math.min(s[0], s[2]) - 20 || Math.min(st[0], st[2]) > Math.max(s[0], s[2]) + 20) continue;
      if (Math.max(st[1], st[3]) < Math.min(s[1], s[3]) - 20 || Math.min(st[1], st[3]) > Math.max(s[1], s[3]) + 20) continue;
      if (!nah && abstand(mx, my, st) < 14) nah = true;
      const p = schnitt(s, st);
      if (!p) continue;
      // Spitzer Winkel: der Weg läuft eher an der Straße entlang, als sie zu queren
      const a = Math.atan2(s[3] - s[1], s[2] - s[0]);
      const b = Math.atan2(st[3] - st[1], st[2] - st[0]);
      const w = Math.abs(Math.sin(a - b));
      if (w < 0.45) continue;
      treffer.push(p);
    }
    if (nah) entlangM += laenge;
  }
  const stellen: [number, number][] = [];
  for (const p of treffer) if (!stellen.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 40)) stellen.push(p);
  // Zurück in Längen- und Breitengrade (für die Karte)
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return { querungen: stellen.length, entlangM: Math.round(entlangM), stellen: stellen.map(([x, y]) => [lon0 + x / kx, lat0 + y / 110540]) };
}
