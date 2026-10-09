/**
 * Kennzahlen zum Einzugsgebiet aus den Wohnort-Kacheln des Schulatlas (Statistik Austria).
 * Die Kacheln zeigen nur fünf Klassen je 500-m-Zelle. Wir lesen die Farben der Kacheln,
 * die die Karte ohnehin anzeigt, und rechnen daraus Anteile. Das sind Näherungen.
 */

export const EINZUG_FARBEN = ['#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'] as const;
/** Kinder je Zelle als Klassenmitte. "20 und mehr" ist nach oben offen, 25 ist eine Annahme. */
export const KLASSEN_MITTE = [1.5, 4, 8.5, 15.5, 25] as const;

const ERDUMFANG = 40075016.686;
/** Zellen sind 500 m groß */
const ZELLE_M2 = 500 * 500;
/**
 * Zoomstufen der Auswertung, von fein nach grob. Auf jeder Stufe werden 3 × 3 Kacheln gelesen,
 * sie decken mindestens 6,5 km (Stufe 12), 13 km (11) oder 26 km (10) um die Schule ab.
 * Je feiner die Stufe, desto weniger Pixel gehen an die weißen Zellränder verloren.
 * Nur wenn das Gebiet am Rand anstößt, geht es mit der nächsten, gröberen Stufe weiter.
 */
export const ZOOMSTUFEN = [12, 11, 10] as const;
export const AUSWERTUNG_ZOOM = ZOOMSTUFEN[ZOOMSTUFEN.length - 1];
const MAX_FARBABSTAND = 40;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const FARBEN_RGB = EINZUG_FARBEN.map(rgb);

/** Index der Klasse 0–4 oder -1 (transparent, Rand oder unbekannte Farbe). */
export function klasse(r: number, g: number, b: number, a: number): number {
  if (a < 200) return -1;
  let best = -1;
  let bestD = MAX_FARBABSTAND ** 2;
  for (let i = 0; i < FARBEN_RGB.length; i++) {
    const [fr, fg, fb] = FARBEN_RGB[i];
    const d = (r - fr) ** 2 + (g - fg) ** 2 + (b - fb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Web-Mercator-Koordinaten in Metern */
export function mercator(lon: number, lat: number) {
  const r = Math.PI / 180;
  return { x: (lon * r * ERDUMFANG) / (2 * Math.PI), y: (Math.log(Math.tan(Math.PI / 4 + (lat * r) / 2)) * ERDUMFANG) / (2 * Math.PI) };
}

/** Kachelkoordinaten (z/x/y, y von oben) für einen Punkt */
export function kachelFuer(lon: number, lat: number, z: number) {
  const { x, y } = mercator(lon, lat);
  const groesse = ERDUMFANG / 2 ** z;
  return { x: Math.floor((x + ERDUMFANG / 2) / groesse), y: Math.floor((ERDUMFANG / 2 - y) / groesse) };
}

/** Rand einer Kachel in EPSG:3857 (minx,miny,maxx,maxy) */
export function kachelBox(z: number, x: number, y: number) {
  const groesse = ERDUMFANG / 2 ** z;
  const minx = -ERDUMFANG / 2 + x * groesse;
  const maxy = ERDUMFANG / 2 - y * groesse;
  return { minx, miny: maxy - groesse, maxx: minx + groesse, maxy };
}

export type Kachel = { x: number; y: number; data: Uint8ClampedArray; breite: number; hoehe: number };

export type EinzugKennzahlen = {
  /** geschätzte Kinder, nur zur Plausibilisierung gegen die Schülerzahl */
  kinder: number;
  /** Anteil der Kinder, die weiter als 2 km entfernt wohnen (0–1) */
  anteilUeber2km: number;
  /** mittlere Entfernung der Hälfte der Kinder in Metern */
  medianM: number;
  /** Entfernung, innerhalb der 90 % der Kinder wohnen */
  p90M: number;
  /** das Gebiet läuft bis an den Rand des ausgewerteten Ausschnitts */
  angeschnitten: boolean;
  /** erkannte Pixel */
  pixel: number;
  /** angenommene Kinderzahl je Zelle in der Klasse "20 und mehr" */
  obersteKlasse: number;
};

/**
 * Rechnet die Kacheln (3 × 3 um die Schule) in Kennzahlen um.
 *
 * Zwei Korrekturen, weil die Kacheln nur Klassen und Zellränder zeigen:
 * - Pixel auf den weißen Zellrändern haben keine Klassenfarbe. Wir rechnen sie gleichmäßig hoch.
 * - "20 und mehr" ist nach oben offen. Ist die Schülerzahl bekannt, wählen wir die Klassenmitte so,
 *   dass die Summe der Kinder zur Schülerzahl passt (begrenzt auf 20 bis 150).
 */
export function analysiere(kacheln: Kachel[], z: number, lon: number, lat: number, schueler?: number): EinzugKennzahlen | null {
  const schule = mercator(lon, lat);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const kachelM = ERDUMFANG / 2 ** z;
  const xs = kacheln.map((k) => k.x);
  const ys = kacheln.map((k) => k.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const proben: { d: number; c: number; zellen: number }[] = [];
  let gezeichnet = 0;
  let angeschnitten = false;

  for (const k of kacheln) {
    const box = kachelBox(z, k.x, k.y);
    const pxM = kachelM / k.breite;
    const zellen = (pxM * cosLat) ** 2 / ZELLE_M2;
    for (let py = 0; py < k.hoehe; py++) {
      for (let px = 0; px < k.breite; px++) {
        const i = (py * k.breite + px) * 4;
        if (k.data[i + 3] >= 50) gezeichnet++;
        const c = klasse(k.data[i], k.data[i + 1], k.data[i + 2], k.data[i + 3]);
        if (c < 0) continue;
        const mx = box.minx + (px + 0.5) * pxM;
        const my = box.maxy - (py + 0.5) * pxM;
        proben.push({ d: Math.hypot(mx - schule.x, my - schule.y) * cosLat, c, zellen });
        const amRand =
          (k.x === minX && px === 0) || (k.x === maxX && px === k.breite - 1) || (k.y === minY && py === 0) || (k.y === maxY && py === k.hoehe - 1);
        if (amRand) angeschnitten = true;
      }
    }
  }
  if (!proben.length) return null;

  const korrektur = Math.max(1, gezeichnet / proben.length);
  const mitte: number[] = [...KLASSEN_MITTE];
  if (schueler && schueler > 0) {
    let rest = 0;
    let oben = 0;
    for (const p of proben) (p.c === 4 ? (oben += p.zellen) : (rest += p.zellen * mitte[p.c])) ;
    if (oben > 0) mitte[4] = Math.min(150, Math.max(KLASSEN_MITTE[4], (schueler / korrektur - rest) / oben));
  }

  const gewichte = proben.map((p) => p.zellen * korrektur * mitte[p.c]);
  const gesamt = gewichte.reduce((a, b) => a + b, 0);
  if (gesamt <= 0) return null;

  const reihe = proben.map((p, i) => ({ d: p.d, kinder: gewichte[i] })).sort((a, b) => a.d - b.d);
  let summe = 0;
  let median = 0;
  let p90 = 0;
  let ueber2 = 0;
  for (const p of reihe) {
    summe += p.kinder;
    if (!median && summe >= gesamt * 0.5) median = p.d;
    if (!p90 && summe >= gesamt * 0.9) p90 = p.d;
    if (p.d > 2000) ueber2 += p.kinder;
  }
  return { kinder: gesamt, anteilUeber2km: ueber2 / gesamt, medianM: median, p90M: p90, angeschnitten, pixel: proben.length, obersteKlasse: mitte[4] };
}

/* ---------- Abruf im Browser ---------- */

export const kachelUrl = (skz: string, z: number, x: number, y: number) => {
  const b = kachelBox(z, x, y);
  return (
    'https://www.statistik.at/gs-atlas/ATLAS_SCHULE/wms?service=WMS&version=1.1.1&request=GetMap' +
    `&layers=ATLAS_SCHULE:ATLAS_SCHULE_WOHNORT&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256` +
    `&bbox=${b.minx},${b.miny},${b.maxx},${b.maxy}&viewparams=SKZ:${skz}`
  );
};

async function ladeBild(url: string, signal?: AbortSignal): Promise<ImageData> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    const abbruch = () => reject(new DOMException('abgebrochen', 'AbortError'));
    if (signal?.aborted) return abbruch();
    signal?.addEventListener('abort', abbruch, { once: true });
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Kachel nicht ladbar'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas nicht verfügbar');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function ladeKachel(skz: string, z: number, x: number, y: number, signal?: AbortSignal): Promise<Kachel> {
  const d = await ladeBild(kachelUrl(skz, z, x, y), signal);
  return { x, y, data: d.data, breite: d.width, hoehe: d.height };
}

const zwischenspeicher = new Map<string, Promise<EinzugKennzahlen | null>>();

async function auswerten(skz: string, lon: number, lat: number, schueler?: number, signal?: AbortSignal): Promise<EinzugKennzahlen | null> {
  let letzte: EinzugKennzahlen | null = null;
  for (const z of ZOOMSTUFEN) {
    const mitte = kachelFuer(lon, lat, z);
    const lade: Promise<Kachel>[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) lade.push(ladeKachel(skz, z, mitte.x + dx, mitte.y + dy, signal));
    letzte = analysiere(await Promise.all(lade), z, lon, lat, schueler);
    if (!letzte || !letzte.angeschnitten) break;
  }
  return letzte;
}

/** Berechnet die Kennzahlen aus den Kacheln um die Schule. Ergebnisse werden je Schule gemerkt. */
export function einzugKennzahlen(skz: string, lon: number, lat: number, schueler?: number, signal?: AbortSignal): Promise<EinzugKennzahlen | null> {
  const bekannt = zwischenspeicher.get(skz);
  if (bekannt) return bekannt;
  const p = auswerten(skz, lon, lat, schueler, signal);
  zwischenspeicher.set(skz, p);
  p.catch(() => zwischenspeicher.delete(skz));
  return p;
}

/* ---------- Umgekehrt: Zu welchen Einzugsgebieten gehört ein Punkt? ---------- */

export const KLASSEN_TEXT = ['unter 3', '3–5', '6–11', '12–19', '20 und mehr'] as const;

/** Der Atlas hat keine Wohnorte für Schulen ohne Schülerzahlen, Berufsschulen und Gesundheitsschulen. */
export const einzugMoeglich = (s: { schueler?: number; kat: string }) => s.schueler !== undefined && s.kat !== 'gk' && s.kat !== 'bs';

/** Kantenlänge des Kartenbilds um den Punkt und Größe des Kerns, der die eigene Zelle vertritt (ohne die Zellränder). */
const PROBE_PIXEL = 60;
const PROBE_KERN_VON = 27;
const PROBE_KERN_BIS = 33;
/** Halbe Breite des Ausschnitts in Metern (Web Mercator, am Boden etwa 500 m in Österreich) */
const PROBE_HALB_M = 750;
/** So viele Pixel einer Klasse braucht es in der Umgebung, damit Ränder und Rundungen nicht zählen (ca. 1 000 m²). */
const MIN_PIXEL_UMGEBUNG = 12;

export type PunktKlassen = {
  /** Klasse (0–4) der 500-m-Zelle, in der der Punkt liegt, oder -1 */
  zelle: number;
  /** höchste Klasse in den Zellen rundherum (etwa 500 m), oder -1 */
  umgebung: number;
};

/**
 * Wie viele Kinder der Schule wohnen in der Zelle des Punkts und in der Umgebung?
 * Dazu wird ein kleines Kartenbild um den Punkt gelesen, nicht die ganze Kachel.
 */
export async function klassenAmPunkt(skz: string, lon: number, lat: number, signal?: AbortSignal): Promise<PunktKlassen> {
  const { x, y } = mercator(lon, lat);
  const h = PROBE_HALB_M;
  const url =
    'https://www.statistik.at/gs-atlas/ATLAS_SCHULE/wms?service=WMS&version=1.1.1&request=GetMap' +
    `&layers=ATLAS_SCHULE:ATLAS_SCHULE_WOHNORT&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=${PROBE_PIXEL}&height=${PROBE_PIXEL}` +
    `&bbox=${x - h},${y - h},${x + h},${y + h}&viewparams=SKZ:${skz}`;
  const bild = await ladeBild(url, signal);
  const kern = [0, 0, 0, 0, 0];
  const alle = [0, 0, 0, 0, 0];
  for (let py = 0; py < PROBE_PIXEL; py++) {
    for (let px = 0; px < PROBE_PIXEL; px++) {
      const i = (py * bild.width + px) * 4;
      const c = klasse(bild.data[i], bild.data[i + 1], bild.data[i + 2], bild.data[i + 3]);
      if (c < 0) continue;
      alle[c]++;
      if (px >= PROBE_KERN_VON && px < PROBE_KERN_BIS && py >= PROBE_KERN_VON && py < PROBE_KERN_BIS) kern[c]++;
    }
  }
  const maxKern = Math.max(...kern);
  const zelle = maxKern === 0 ? -1 : kern.indexOf(maxKern);
  let umgebung = -1;
  for (let c = 4; c >= 0; c--) {
    if (alle[c] >= MIN_PIXEL_UMGEBUNG) {
      umgebung = c;
      break;
    }
  }
  return { zelle, umgebung: Math.max(umgebung, zelle) };
}
