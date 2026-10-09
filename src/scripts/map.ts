import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type Daten, type Schule, adresse, fmtKurz, hatStandort, kurzName } from '../lib/types';
import { distanceM, fmtDist, fmtNum } from '../lib/geo';
import { EINZUG_FARBEN, KLASSEN_TEXT, einzugKennzahlen, einzugMoeglich, wohnortUrl, type EinzugKennzahlen } from '../lib/einzug';
import { umschalten, istGewaehlt, beiAenderung, MAX_AUSWAHL } from './auswahl';
import { ladeAnsicht, speichereAnsicht } from './ansicht';
import { speichereOrt } from './ort';
import { adresseSuchen } from '../lib/geocode';
import { beiThemeWechsel, istDunkel } from './theme';
import { SuchIndex } from '../lib/search';
import {
  $, base, el, loadKern, baueFilterChips, neuerFilter, filterFromParams, filterToParams, passt,
  sucheAnbinden, standortErmitteln, type FilterState,
} from './shared';

type S = Schule & { lon: number; lat: number };

const app = $('app');
const qInput = $<HTMLInputElement>('q');
const sheet = $('sheet');
const countEl = $('count');
const listEl = $('list');
const cardEl = $('card');
const compareLink = $<HTMLAnchorElement>('compareLink');
const desktop = window.matchMedia('(min-width: 900px)');

const state = {
  daten: null as Daten | null,
  mitStandort: [] as S[],
  byId: new Map<string, Schule>(),
  filter: neuerFilter() as FilterState,
  selected: null as Schule | null,
  user: null as null | { lon: number; lat: number; label?: string },
  einzug: false, // Einzugsgebiet der gewählten Schule auf der Karte zeigen
  index: undefined as SuchIndex | undefined,
};
let mapReady = false;

/* ---------- Karte ---------- */
const mapPadding = () =>
  desktop.matches
    ? { top: 40, bottom: 40, left: 40, right: 40 }
    : { top: 150, bottom: Math.round(window.innerHeight * 0.38), left: 30, right: 30 };

const gemerkt = new URLSearchParams(location.search).has('skz') ? null : ladeAnsicht();

// Der Worker wird von scripts/copy-maplibre.mjs nach public/maplibre/ kopiert
maplibregl.setWorkerUrl(`${base}maplibre/maplibre-gl-worker.mjs`);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/fonts/{fontstack}/{range}.pbf',
    sources: {
      bm: {
        type: 'raster',
        tiles: ['https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Grundkarte: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a>',
      },
    },
    layers: [{
      id: 'bm', type: 'raster', source: 'bm',
      paint: { 'raster-brightness-min': istDunkel() ? 1 : 0, 'raster-brightness-max': istDunkel() ? 0.12 : 1 },
    }],
  },
  ...(gemerkt
    ? { center: [gemerkt.lon, gemerkt.lat] as [number, number], zoom: gemerkt.zoom }
    : { bounds: [[9.4, 46.3], [17.3, 49.1]] as [[number, number], [number, number]], fitBoundsOptions: { padding: mapPadding() } }),
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
if (import.meta.env.DEV) (window as unknown as { __map: unknown }).__map = map;
map.touchZoomRotate.disableRotation();
if (gemerkt) map.jumpTo({ center: [gemerkt.lon, gemerkt.lat], zoom: gemerkt.zoom, padding: gemerkt.padding });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const empty = { type: 'FeatureCollection', features: [] } as const;
const COLOR = '#1f5fbf';

/** Karte hell oder dunkel: die graue Grundkarte wird umgekehrt, Punkte und Beschriftungen bekommen passende Farben. */
const FARBEN = {
  hell: { punkt: COLOR, rand: '#fff', zahl: '#fff', text: '#14171f', halo: 'rgba(255,255,255,0.95)', auswahlText: '#b34100', auswahlHalo: 'rgba(255,255,255,0.97)' },
  dunkel: { punkt: '#6ea2ff', rand: '#171a21', zahl: '#0b1220', text: '#eef0f4', halo: 'rgba(23,26,33,0.95)', auswahlText: '#ffa94d', auswahlHalo: 'rgba(23,26,33,0.97)' },
};
let kartenDunkel = false;
function kartenFarben() {
  const f = kartenDunkel ? FARBEN.dunkel : FARBEN.hell;
  if (map.getLayer('bm')) {
    map.setPaintProperty('bm', 'raster-brightness-min', kartenDunkel ? 1 : 0);
    map.setPaintProperty('bm', 'raster-brightness-max', kartenDunkel ? 0.12 : 1);
  }
  if (!mapReady) return;
  map.setPaintProperty('clusters', 'circle-color', f.punkt);
  map.setPaintProperty('clusters', 'circle-stroke-color', f.rand);
  map.setPaintProperty('cluster-count', 'text-color', f.zahl);
  map.setPaintProperty('points', 'circle-color', f.punkt);
  map.setPaintProperty('points', 'circle-stroke-color', f.rand);
  map.setPaintProperty('labels', 'text-color', f.text);
  map.setPaintProperty('labels', 'text-halo-color', f.halo);
  map.setPaintProperty('sel-label', 'text-color', f.auswahlText);
  map.setPaintProperty('sel-label', 'text-halo-color', f.auswahlHalo);
}
beiThemeWechsel((dunkel) => {
  kartenDunkel = dunkel;
  if (map.isStyleLoaded() || mapReady) kartenFarben();
  else map.once('load', kartenFarben);
});

map.on('load', () => {
  map.addSource('schulen', { type: 'geojson', data: empty as never, cluster: true, clusterRadius: 48, clusterMaxZoom: 13 });
  map.addSource('sel', { type: 'geojson', data: empty as never });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'schulen', filter: ['has', 'point_count'],
    paint: {
      'circle-color': COLOR, 'circle-opacity': 0.88,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 25, 250, 31],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'schulen', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Arial Bold'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#fff' },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'schulen', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': COLOR, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9],
    },
  });
  // Schulnamen: erscheinen ab mittlerer Zoomstufe und nur dort, wo Platz ist. Größere Schulen haben Vorrang.
  map.addLayer({
    id: 'labels', type: 'symbol', source: 'schulen', minzoom: 13.2, filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Arial Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13.2, 11, 17, 14],
      'text-anchor': 'top',
      'text-offset': ['interpolate', ['linear'], ['zoom'], 13.2, ['literal', [0, 0.85]], 17, ['literal', [0, 1.1]]],
      'text-max-width': 8,
      'text-padding': 3,
      'symbol-sort-key': ['-', ['get', 'rang']],
    },
    paint: { 'text-color': '#14171f', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8, 'text-halo-blur': 0.4 },
  });
  map.addLayer({
    id: 'sel', type: 'circle', source: 'sel',
    paint: { 'circle-radius': 15, 'circle-color': '#e8590c', 'circle-opacity': 0.25, 'circle-stroke-color': '#e8590c', 'circle-stroke-width': 3 },
  });
  map.addLayer({
    id: 'sel-label', type: 'symbol', source: 'sel',
    layout: {
      'text-field': ['get', 'name'], 'text-font': ['Arial Bold'], 'text-size': 14, 'text-anchor': 'top', 'text-offset': [0, 1.5],
      'text-max-width': 10, 'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#b34100', 'text-halo-color': 'rgba(255,255,255,0.97)', 'text-halo-width': 2.2 },
  });

  map.on('click', (e: MapMouseEvent) => {
    const hit = trefferAn(e.point);
    if (!hit) {
      deselect();
      if (!desktop.matches && sheet.dataset.state === 'full') setSheet('peek');
      return;
    }
    if (hit.properties?.cluster) {
      (map.getSource('schulen') as GeoJSONSource)
        .getClusterExpansionZoom(hit.properties.cluster_id)
        .then((zoom) => map.easeTo({ center: (hit.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 }));
    } else {
      select(hit.properties?.skz, false);
    }
  });
  for (const id of ['clusters', 'points', 'labels']) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }
  mapReady = true;
  kartenFarben();
  aktualisieren();
  startAuswahl();
});

/** Trefferfläche um den Tippunkt: am Handy großzügiger als mit der Maus. */
const grobeEingabe = window.matchMedia('(pointer: coarse)');

/**
 * Welche Schule oder welcher Cluster ist gemeint? Erst Beschriftung oder Punkt direkt unter dem Finger,
 * sonst der nächste Punkt in der Umgebung.
 */
function trefferAn(punkt: { x: number; y: number }) {
  const genau = map.queryRenderedFeatures(
    [[punkt.x - 3, punkt.y - 3], [punkt.x + 3, punkt.y + 3]],
    { layers: ['clusters', 'points', 'labels'] },
  );
  if (genau.length) return genau.find((f) => f.layer.id !== 'labels') ?? genau[0];

  const r = grobeEingabe.matches ? 26 : 14;
  const nah = map.queryRenderedFeatures([[punkt.x - r, punkt.y - r], [punkt.x + r, punkt.y + r]], { layers: ['clusters', 'points'] });
  let beste: (typeof nah)[number] | undefined;
  let bestD = Infinity;
  for (const f of nah) {
    const c = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const p = map.project(c);
    const d = Math.hypot(p.x - punkt.x, p.y - punkt.y);
    if (d < bestD) {
      bestD = d;
      beste = f;
    }
  }
  return beste;
}

let bereit = false; // erst nach der Wiederherstellung wird die Ansicht wieder gemerkt

function startAuswahl() {
  if (!mapReady || !state.daten || bereit) return;
  const url = new URLSearchParams(location.search);
  const skz = url.get('skz');
  const mitDetails = url.get('d') === '1'; // vor select() lesen: select() schreibt die Adresse neu
  if (url.get('ez') === '1' || url.get('e') === '1') state.einzug = true; // e=1: ältere Links
  const gemerktSkz = ladeAnsicht()?.skz;
  // Der Standort ist nach einem Besuch von Vergleich oder Details sonst weg, die Seite wird dabei neu geladen
  const gemerkterStandort = ladeAnsicht()?.user;
  if (gemerkterStandort) {
    state.user = gemerkterStandort;
    zeigeStandortMarker(gemerkterStandort);
    aktualisieren(); // die Liste zeigt dann wieder Entfernungen
  }
  if (skz && state.byId.has(skz)) {
    select(skz, 'jump');
    if (mitDetails) void setzeDetails(true, false);
  } else if (!skz && gemerktSkz && state.byId.has(gemerktSkz)) select(gemerktSkz, false);
  bereit = true;
}

/** Speichert Ausschnitt, Filter und Auswahl, damit "Zurück zur Karte" wieder genauso aussieht. */
function merkeAnsicht() {
  if (!bereit) return;
  const c = map.getCenter();
  const p = new URLSearchParams();
  filterToParams(state.filter, p);
  speichereAnsicht({ lon: c.lng, lat: c.lat, zoom: map.getZoom(), padding: map.getPadding(), filter: p.toString(), skz: state.selected?.skz ?? null, user: state.user ?? undefined });
}

/* ---------- Filter und Quelle ---------- */
const gefiltert = () => state.mitStandort.filter((s) => passt(s, state.filter));

function aktualisieren() {
  if (!mapReady || !state.daten) return;
  const features = gefiltert().map((s) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
    properties: { skz: s.skz, name: kurzName(s.name), rang: s.schueler ?? 0 },
  }));
  (map.getSource('schulen') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  refreshList();
  merkeAnsicht();
}

/* ---------- Liste ---------- */
let listRaf = 0;
const refreshList = () => {
  cancelAnimationFrame(listRaf);
  listRaf = requestAnimationFrame(renderList);
};

/** Der eigene Standort ist Bezugspunkt, solange er im Kartenausschnitt liegt, sonst die Kartenmitte. */
function bezugspunkt(): { lon: number; lat: number; label: string; eigen: boolean } {
  const u = state.user;
  if (u && map.getBounds().contains([u.lon, u.lat])) return { lon: u.lon, lat: u.lat, label: u.label ?? 'deinen Standort', eigen: true };
  const c = map.getCenter();
  return { lon: c.lng, lat: c.lat, label: 'den Kartenausschnitt', eigen: false };
}

function renderList() {
  if (!mapReady || !state.daten) return;
  const b = map.getBounds();
  const inView = gefiltert().filter((s) => s.lon >= b.getWest() && s.lon <= b.getEast() && s.lat >= b.getSouth() && s.lat <= b.getNorth());
  const ref = bezugspunkt();
  const n = inView.length;
  const zuViele = n > 300 && !ref.eigen;
  const top = zuViele
    ? []
    : inView
        .map((s) => ({ s, d: distanceM(ref.lon, ref.lat, s.lon, s.lat) }))
        .sort((a, z) => a.d - z.d)
        .slice(0, 40);

  // geschütztes Leerzeichen: "6 181 Schulen" bricht nicht mitten in der Zahl um; am Handy entfällt der Zusatz
  if (n === 0) countEl.replaceChildren('Keine Schulen', el('span', { class: 'rest', textContent: ' im Kartenausschnitt' }));
  else countEl.replaceChildren(`${fmtNum(n)}\u00a0${n === 1 ? 'Schule' : 'Schulen'}`, el('span', { class: 'rest', textContent: ' im Kartenausschnitt' }));
  compareLink.href = vergleichsUrl(ref.lon, ref.lat, 5, ref.label);

  const rows: HTMLElement[] = [];
  if (n === 0) rows.push(el('li', { class: 'empty', textContent: 'Verschiebe die Karte oder ändere die Filter.' }));
  else if (zuViele) rows.push(el('li', { class: 'empty', textContent: 'Suche oben einen Ort oder tippe auf das Standort-Symbol. Die Liste erscheint, sobald höchstens 300 Schulen im Kartenausschnitt sind.' }));
  else {
    for (const { s, d } of top) {
      const btn = el(
        'button',
        { class: 'row', type: 'button' },
        el('span', { class: 'dot', textContent: fmtKurz(s.kat) }),
        el(
          'span',
          { class: 'rtext' },
          el('div', { class: 't', textContent: s.name }),
          el('div', { class: 's', textContent: [s.strasse, s.gemeinde ?? s.ort, s.privat ? 'privat' : ''].filter(Boolean).join(' · ') }),
        ),
        el('span', { class: 'd', textContent: ref.eigen ? fmtDist(d) : s.schueler ? `${fmtNum(s.schueler)} Schüler` : '' }),
      );
      btn.addEventListener('click', () => select(s.skz, true));
      rows.push(el('li', {}, btn));
    }
    if (n > top.length) rows.push(el('li', { class: 'empty', textContent: 'Zoome näher heran, um weitere Schulen zu sehen.' }));
  }
  listEl.replaceChildren(...rows);
}
map.on('moveend', () => {
  refreshList();
  merkeAnsicht();
});

function vergleichsUrl(lon: number, lat: number, r: number, ort: string) {
  const p = new URLSearchParams({ lon: lon.toFixed(5), lat: lat.toFixed(5), o: ort, r: String(r) });
  filterToParams(state.filter, p);
  return `${base}vergleich/?${p}`;
}

/* ---------- Bottom Sheet ---------- */
type SheetZustand = 'min' | 'peek' | 'full';
const setSheet = (st: SheetZustand) => (sheet.dataset.state = st);
/** Tippen oder Taste am Griff: klein -> mittel -> groß -> mittel */
const naechsterZustand = (): SheetZustand => (sheet.dataset.state === 'peek' ? 'full' : 'peek');
const grab = $('grab');

/** Zielhöhen in Pixel: nur Kopfzeile, mittel (Liste sichtbar), groß. */
function sheetHoehen(): Record<SheetZustand, number> {
  const kopf = (grab.offsetHeight || 28) + ($('count').parentElement?.offsetHeight ?? 52) + 8;
  return { min: Math.round(kopf + 6), peek: Math.round(window.innerHeight * 0.36), full: Math.round(window.innerHeight * 0.82) };
}

// Das Fenster folgt dem Finger. Gezogen wird an Griff und Kopfzeile, die Liste scrollt unabhängig davon.
let zug: { startY: number; startH: number; letzteY: number; letzteZeit: number; v: number; bewegt: boolean } | null = null;
const ziehbereiche = [grab, $('count').parentElement as HTMLElement];

for (const bereich of ziehbereiche) {
  bereich.style.touchAction = 'none';
  bereich.addEventListener('pointerdown', (e) => {
    if (desktop.matches || (e.target as Element).closest('a, .sheet-locate')) return;
    bereich.setPointerCapture(e.pointerId);
    zug = { startY: e.clientY, startH: sheet.offsetHeight, letzteY: e.clientY, letzteZeit: e.timeStamp, v: 0, bewegt: false };
  });
  bereich.addEventListener('pointermove', (e) => {
    if (!zug) return;
    const dy = e.clientY - zug.startY;
    if (!zug.bewegt && Math.abs(dy) < 6) return;
    zug.bewegt = true;
    const dt = Math.max(1, e.timeStamp - zug.letzteZeit);
    zug.v = (e.clientY - zug.letzteY) / dt; // px pro ms, positiv = nach unten
    zug.letzteY = e.clientY;
    zug.letzteZeit = e.timeStamp;
    const h = sheetHoehen();
    sheet.style.transition = 'none';
    sheet.style.height = `${Math.max(h.min * 0.85, Math.min(h.full, zug.startH - dy))}px`;
  });
  const ende = () => {
    if (!zug) return;
    const z = zug;
    zug = null;
    const h = sheetHoehen();
    let ziel: SheetZustand;
    if (!z.bewegt) {
      ziel = naechsterZustand();
    } else {
      // Zielzustand: nächste Höhe, mit dem Schwung des Wischens vorausgerechnet
      const projiziert = sheet.offsetHeight - z.v * 180;
      ziel = (Object.keys(h) as SheetZustand[]).reduce((a, b) => (Math.abs(h[b] - projiziert) < Math.abs(h[a] - projiziert) ? b : a));
    }
    sheet.style.transition = '';
    void sheet.offsetHeight; // aktuelle Höhe festhalten, dann weich zum Ziel
    sheet.style.height = '';
    setSheet(ziel);
  };
  bereich.addEventListener('pointerup', ende);
  bereich.addEventListener('pointercancel', ende);
}
// Tastatur: Enter oder Leertaste am Griff
grab.addEventListener('click', (e) => {
  if (e.detail !== 0) return; // echte Tipps behandelt pointerup
  setSheet(naechsterZustand());
});

/* ---------- Auswahl ---------- */
const detailCache = new Map<string, string>();

/** Holt den Inhalt der Detailseite (ohne die Teile, die nur auf der eigenen Seite Sinn ergeben). */
async function ladeDetailHtml(skz: string): Promise<string> {
  const hit = detailCache.get(skz);
  if (hit !== undefined) return hit;
  const res = await fetch(`${base}schule/${skz}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const main = doc.querySelector('main.detail');
  if (!main) throw new Error('Keine Details gefunden');
  main.querySelectorAll('[data-nur-seite]').forEach((n) => n.remove());
  detailCache.set(skz, main.innerHTML);
  return main.innerHTML;
}

const chevron = '<svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/* ---------- Einzugsgebiet (Wohnort der Kinder, 500-m-Zellen) ---------- */
// Kartenbilder des Schulatlas der Statistik Austria. Für Schulen ohne Schülerzahlen gibt es keine Zellen.
// MapLibre setzt den Ausschnitt jeder Kachel selbst ein
const einzugUrl = (skz: string) => wohnortUrl(skz, '{bbox-epsg-3857}');

function entferneEinzug() {
  if (map.getLayer('einzug')) map.removeLayer('einzug');
  if (map.getSource('einzug')) map.removeSource('einzug');
}

// auf 5 % gerundet: die Klassen der Karte erlauben keine genauere Angabe
const fmtProzent = (anteil: number) => `${Math.max(5, Math.round(anteil * 20) * 5)} %`;

function einzugText(k: EinzugKennzahlen) {
  const rest = `Die Hälfte wohnt innerhalb von ${fmtDist(k.medianM)}, 90 % innerhalb von ${fmtDist(k.p90M)}.`;
  const weit = `${k.anteilUeber2km < 0.03 ? 'Weniger als 3 %' : `Etwa ${fmtProzent(k.anteilUeber2km)}`} der Kinder wohnen weiter als 2 km entfernt.`;
  const hinweis = k.angeschnitten ? ' Das Gebiet reicht über den ausgewerteten Ausschnitt hinaus.' : '';
  return `${weit} ${rest}${hinweis}`;
}

/** Entfernungen aus den Farbklassen der Kacheln, nur eine Näherung (Klassenmitten). */
function zeigeEinzugKennzahlen(s: Schule, box: HTMLElement | null | undefined) {
  if (!box || s.lon === undefined || s.lat === undefined) return;
  box.textContent = 'Entfernungen werden berechnet …';
  einzugKennzahlen(s.skz, s.lon, s.lat, s.schueler)
    .then((k) => {
      if (state.selected?.skz !== s.skz) return;
      box.textContent = k ? einzugText(k) : 'Für diese Schule liegen keine Wohnortdaten vor.';
      if (k) box.append(el('small', { textContent: 'Näherung aus den Farbklassen der Karte, nicht aus Einzelwerten.' }));
    })
    .catch(() => {
      if (state.selected?.skz === s.skz) box.textContent = 'Die Entfernungen konnten nicht berechnet werden.';
    });
}

function aktualisiereEinzug() {
  const s = state.selected;
  const an = state.einzug && s && einzugMoeglich(s);
  cardEl.querySelector('.einzug-chip')?.setAttribute('aria-pressed', String(Boolean(an)));
  const legende = cardEl.querySelector<HTMLElement>('.einzug-legende');
  if (legende) legende.hidden = !an;
  if (!an || !s) return entferneEinzug();
  zeigeEinzugKennzahlen(s, legende?.querySelector<HTMLElement>('.el-kennzahlen'));
  const src = map.getSource('einzug') as maplibregl.RasterTileSource | undefined;
  if (src) src.setTiles([einzugUrl(s.skz)]);
  else {
    map.addSource('einzug', { type: 'raster', tiles: [einzugUrl(s.skz)], tileSize: 256, attribution: 'Wohnorte: Statistik Austria' });
    map.addLayer({ id: 'einzug', type: 'raster', source: 'einzug', paint: { 'raster-opacity': 0.78 } }, 'clusters');
  }
}

function baueEinzugsteil(s: Schule) {
  if (!einzugMoeglich(s)) return [];
  const chip = el('button', { type: 'button', class: 'chip einzug-chip', textContent: 'Einzugsgebiet' });
  chip.setAttribute('aria-pressed', String(state.einzug));
  chip.addEventListener('click', () => {
    state.einzug = !state.einzug;
    // ein Stück herauszoomen, damit das Gebiet sichtbar wird
    if (state.einzug && map.getZoom() > 13) map.easeTo({ zoom: 12.8, duration: 500 });
    aktualisiereEinzug();
    schreibeUrl();
  });
  const legende = el(
    'div',
    { class: 'einzug-legende' },
    el('div', { class: 'el-titel', textContent: 'Wohnort der Kinder, Anzahl pro 500-m-Zelle' }),
    el('div', { class: 'el-stufen' }, ...EINZUG_FARBEN.map((farbe, i) => el('span', {}, el('i', { style: `background:${farbe}` }), KLASSEN_TEXT[i]))),
    el('div', { class: 'el-kennzahlen' }),
  );
  legende.hidden = !state.einzug;
  return [chip, legende];
}

function select(skz: string, fly: boolean | 'jump') {
  const s = state.byId.get(skz);
  if (!s || !hatStandort(s)) return;
  state.selected = s;
  (map.getSource('sel') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { name: kurzName(s.name, 40) } }],
  });
  const close = el('button', { class: 'close', type: 'button' });
  close.setAttribute('aria-label', 'Schließen');
  close.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.addEventListener('click', deselect);

  const detailsBtn = el('button', { type: 'button', class: 'btn primary details-btn' });
  detailsBtn.setAttribute('aria-expanded', 'false');
  detailsBtn.setAttribute('aria-controls', 'cardDetail');
  detailsBtn.innerHTML = `<span>Details</span>${chevron}`;
  detailsBtn.addEventListener('click', () => void setzeDetails(!cardEl.classList.contains('offen')));

  const einzug = baueEinzugsteil(s);
  const fakten = [s.schueler ? `${fmtNum(s.schueler)} Schüler` : '', s.klassen ? `${s.klassen} Klassen` : '', s.privat ? 'privat' : s.erhalter ?? ''].filter(Boolean);
  const body = el('div', { class: 'card-detail', id: 'cardDetail' });
  body.tabIndex = -1;
  body.addEventListener('click', (e) => {
    // Schulen in den Übertritten öffnen sich als Karte hier, nicht als neue Seite
    const a = (e.target as Element).closest<HTMLAnchorElement>(`a[href^="${base}schule/"]`);
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const ziel = a.getAttribute('href')!.slice(`${base}schule/`.length).replace(/\/$/, '');
    const z = state.byId.get(ziel);
    if (z && hatStandort(z)) {
      e.preventDefault();
      select(ziel, true);
      void setzeDetails(true);
    }
  });

  cardEl.classList.remove('offen');
  cardEl.style.height = '';
  app.classList.remove('detail-offen');
  cardEl.replaceChildren(
    close,
    el(
      'div',
      { class: 'card-head' },
      Object.assign(el('h2', { textContent: kurzName(s.name, 70) }), { title: s.name }),
      el('p', { textContent: adresse(s) }),
      ...(fakten.length ? [el('p', { class: 'facts', textContent: fakten.join(' · ') })] : []),
    ),
    el('div', { class: 'card-actions' }, detailsBtn, waehlKnopf(s.skz)),
    el(
      'div',
      { class: 'card-extras' },
      el('a', { class: 'card-link', href: vergleichsUrl(s.lon, s.lat, 5, s.name), textContent: 'Umgebung vergleichen →' }),
      ...einzug.slice(0, 1),
    ),
    ...einzug.slice(1),
    body,
  );
  cardEl.hidden = false;
  app.classList.add('has-card');
  aktualisiereEinzug();
  document.documentElement.style.setProperty('--card-h', `${cardEl.offsetHeight}px`); // schwebender Knopf steht darüber
  if (fly) {
    (fly === 'jump' ? map.jumpTo.bind(map) : map.easeTo.bind(map))({
      center: [s.lon, s.lat],
      zoom: Math.max(map.getZoom(), 14.5),
      padding: desktop.matches ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 100, bottom: 200, left: 0, right: 0 },
    });
  }
  setzeLabelFilter(s.skz);
  schreibeUrl();
  merkeAnsicht();
}

// Der schwebende Vergleichs-Knopf steht immer über der Karte, auch wenn sie wächst (Legende, langer Name, Details)
new ResizeObserver(() => {
  if (!cardEl.hidden) document.documentElement.style.setProperty('--card-h', `${cardEl.offsetHeight}px`);
}).observe(cardEl);

/** Die gewählte Schule hat ihre eigene Beschriftung, die normale entfällt dort. */
function setzeLabelFilter(skz: string | null) {
  if (map.getLayer('labels')) map.setFilter('labels', ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'skz'], skz ?? '']]);
}

function schreibeUrl() {
  const s = state.selected;
  if (!s) return history.replaceState(null, '', location.pathname);
  history.replaceState(null, '', `${location.pathname}?skz=${s.skz}${cardEl.classList.contains('offen') ? '&d=1' : ''}${state.einzug && einzugMoeglich(s) ? '&ez=1' : ''}`);
}

/** Karte wachsen lassen und die Details darin zeigen (oder wieder einklappen). */
async function setzeDetails(will: boolean, animiert = true) {
  const s = state.selected;
  if (!s || will === cardEl.classList.contains('offen')) return;
  const body = cardEl.querySelector<HTMLElement>('#cardDetail')!;
  const btn = cardEl.querySelector<HTMLElement>('.details-btn')!;
  btn.setAttribute('aria-expanded', String(will));
  const reduziert = !animiert || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const von = cardEl.offsetHeight;
  let bis: number;
  if (will) {
    body.style.display = '';
    cardEl.classList.add('offen');
    cardEl.style.height = 'auto';
    bis = Math.min(window.innerHeight * (desktop.matches ? 0.8 : 0.82), 760);
    cardEl.style.height = `${von}px`;
  } else {
    cardEl.classList.remove('offen');
    // Höhe der geschlossenen Karte ohne die Detailfläche messen (sie würde sonst mit ihrem Inhalt mitzählen)
    body.style.display = 'none';
    cardEl.style.height = 'auto';
    bis = cardEl.offsetHeight;
    body.style.display = '';
    cardEl.style.height = `${von}px`;
  }
  app.classList.toggle('detail-offen', will);
  void cardEl.offsetHeight; // Ausgangshöhe festschreiben, dann zur Zielhöhe animieren
  cardEl.style.height = `${bis}px`;
  if (will) document.documentElement.style.setProperty('--card-h', `${bis}px`);

  const fertig = () => {
    cardEl.style.height = '';
    if (!will) {
      body.style.display = 'none'; // geschlossen trägt die Detailfläche nichts zur Höhe bei
      document.documentElement.style.setProperty('--card-h', `${cardEl.offsetHeight}px`);
    }
  };
  if (reduziert) fertig();
  else {
    const t = setTimeout(fertig, 600); // Rückfall, falls kein transitionend kommt
    cardEl.addEventListener('transitionend', function ende(e) {
      if (e.target !== cardEl || e.propertyName !== 'height') return;
      clearTimeout(t);
      cardEl.removeEventListener('transitionend', ende);
      fertig();
    });
  }
  schreibeUrl();

  if (will && !body.dataset.skz) {
    body.dataset.skz = s.skz;
    body.innerHTML = '<p class="card-laden">Details werden geladen …</p>';
    try {
      body.innerHTML = await ladeDetailHtml(s.skz);
    } catch {
      body.innerHTML = `<p class="card-laden">Die Details konnten nicht geladen werden. <a href="${base}schule/${s.skz}/">Als eigene Seite öffnen</a></p>`;
    }
    if (kurzName(s.name, 70) !== s.name) body.prepend(el('p', { class: 'volltitel', textContent: s.name }));
    body.scrollTop = 0;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cardEl.classList.contains('offen')) void setzeDetails(false);
});

/** Knopf "Zum Vergleich" in der Auswahlkarte. */
function waehlKnopf(skz: string) {
  const b = el('button', { type: 'button', class: 'btn vergleich-toggle' });
  b.innerHTML = '<svg class="ico vt-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><svg class="ico vt-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><span class="vt-text"></span>';
  const text = b.querySelector('.vt-text')!;
  const zeigen = () => {
    const an = istGewaehlt(skz);
    b.setAttribute('aria-pressed', String(an));
    b.classList.toggle('on', an);
    text.textContent = an ? 'Im Vergleich' : 'Zum Vergleich';
  };
  zeigen();
  beiAenderung(zeigen);
  b.addEventListener('click', () => {
    if (umschalten(skz) === 'voll') text.textContent = `Max. ${MAX_AUSWAHL} Schulen`;
    else zeigen();
  });
  return b;
}

function deselect() {
  if (!state.selected) return;
  state.selected = null;
  cardEl.hidden = true;
  cardEl.classList.remove('offen');
  cardEl.style.height = '';
  app.classList.remove('has-card', 'detail-offen');
  (map.getSource('sel') as GeoJSONSource).setData(empty as never);
  entferneEinzug();
  setzeLabelFilter(null);
  schreibeUrl();
  merkeAnsicht();
}

/* ---------- Suche und Standort ---------- */
sucheAnbinden({
  input: qInput,
  list: $('suggest'),
  index: () => state.index,
  onPick: (v) => {
    if (v.kind === 'adresse') return void zurAdresse(v.text);
    deselect();
    if (v.kind === 'schule') {
      if (hatStandort(v.schule)) select(v.schule.skz, true);
      return;
    }
    const mit = v.schulen.filter(hatStandort);
    if (mit.length === 1) return select(mit[0].skz, true);
    const bounds = new maplibregl.LngLatBounds();
    mit.forEach((s) => bounds.extend([s.lon!, s.lat!]));
    map.fitBounds(bounds, { padding: mapPadding(), maxZoom: 15 });
    setSheet('peek');
  },
});
$('searchForm').addEventListener('submit', (e) => e.preventDefault());

let meMarker: maplibregl.Marker | null = null;
function zeigeStandortMarker(p: { lon: number; lat: number }) {
  meMarker?.remove();
  meMarker = new maplibregl.Marker({ element: el('div', { class: 'me-dot' }) }).setLngLat([p.lon, p.lat]).addTo(map);
}
let adressLauf = 0;
/** Eigene Adresse suchen: Punkt auf die Karte, die Liste zeigt dann die nächsten Schulen. */
async function zurAdresse(text: string) {
  const lauf = ++adressLauf;
  countEl.textContent = 'Adresse wird gesucht …';
  const fehler = (msg: string, kurz: string) => {
    countEl.textContent = kurz;
    listEl.replaceChildren(el('li', { class: 'empty', textContent: msg }));
    if (sheet.dataset.state === 'min') setSheet('peek');
  };
  let t;
  try {
    t = await adresseSuchen(text);
  } catch {
    if (lauf === adressLauf) fehler('Die Adresssuche ist gerade nicht erreichbar. Versuche es später noch einmal.', 'Adresse nicht erreichbar');
    return;
  }
  if (lauf !== adressLauf) return;
  if (!t) return fehler('Diese Adresse wurde nicht gefunden. Prüfe Schreibweise und Ort.', 'Adresse nicht gefunden');
  state.user = { lon: t.lon, lat: t.lat, label: text };
  speichereOrt({ lon: t.lon, lat: t.lat, label: text }); // der Vergleich startet dann gleich dort
  zeigeStandortMarker(state.user);
  deselect();
  merkeAnsicht();
  setSheet('peek');
  map.easeTo({ center: [t.lon, t.lat], zoom: 15, padding: mapPadding() });
}
async function zumStandort() {
  countEl.textContent = 'Standort wird ermittelt …';
  try {
    state.user = { ...(await standortErmitteln()), label: 'deinen Standort' };
  } catch (err) {
    // Die lange Erklärung steht im Listenbereich, die Kopfzeile bleibt kurz
    countEl.textContent = 'Kein Standort';
    listEl.replaceChildren(el('li', { class: 'empty', textContent: (err as Error).message }));
    if (sheet.dataset.state === 'min') setSheet('peek');
    return;
  }
  speichereOrt({ lon: state.user.lon, lat: state.user.lat, label: 'deinen Standort' }); // der Vergleich startet dann gleich dort
  zeigeStandortMarker(state.user);
  deselect();
  merkeAnsicht(); // sonst ist der Standort nach dem Vergleich wieder weg
  setSheet('peek');
  map.easeTo({ center: [state.user.lon, state.user.lat], zoom: 14, padding: mapPadding() });
}
// Zwei Wege zum Standort: Suchleiste oben und der Knopf in der Kopfzeile der Liste (Daumenreichweite am Handy)
$('locate').addEventListener('click', () => void zumStandort());
$('locateSheet').addEventListener('click', () => void zumStandort());

/* ---------- Start ---------- */
loadKern()
  .then((d) => {
    state.daten = d;
    state.byId = new Map(d.schulen.map((s) => [s.skz, s]));
    state.mitStandort = d.schulen.filter(hatStandort) as S[];
    state.index = new SuchIndex(d.schulen);
    // Filter aus dem Link, sonst die zuletzt gemerkten
    const url = new URLSearchParams(location.search);
    // e=1 ist kein Erhalter, sondern stammt aus älteren Links zum Einzugsgebiet
    const mitFilter = url.has('k') || url.has('b') || (url.has('e') && url.get('e') !== '1');
    state.filter = filterFromParams(mitFilter ? url : new URLSearchParams(ladeAnsicht()?.filter ?? ''), d.kategorien);
    baueFilterChips($('chips'), d.kategorien, state.filter, aktualisieren);
    $('schuljahr').textContent = `Schuljahr ${d.schuljahr}`;
    aktualisieren();
    startAuswahl();
  })
  .catch(() => {
    countEl.textContent = 'Die Schulen konnten nicht geladen werden. Bitte Seite neu laden.';
  });
