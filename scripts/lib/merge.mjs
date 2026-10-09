import { gkToWgs84 } from './geo.mjs';

/** Eigene Schulkategorien (Filter in der Oberfläche). */
export const KATEGORIEN = [
  { id: 'vs', label: 'Volksschule' },
  { id: 'ms', label: 'Mittelschule' },
  { id: 'ahs', label: 'Gymnasium (AHS)' },
  { id: 'ps', label: 'Polytechnische Schule' },
  { id: 'bs', label: 'Berufsschule' },
  { id: 'bmhs', label: 'HTL, HAK, HLW u. a.' },
  { id: 'ss', label: 'Sonderschule' },
  { id: 'lf', label: 'Land- und Forstwirtschaft' },
  { id: 'gk', label: 'Gesundheit und Pflege' },
  { id: 'ph', label: 'Pädagogische Hochschule' },
  { id: 'musik', label: 'Musikschule' },
  { id: 'sonst', label: 'Sonstige' },
];

// Bildungskompass-Schulart-ID -> Kategorie
const BK_ART = {
  1: 'vs', 3: 'ms', 4: 'ss', 5: 'ps', 6: 'bs', 7: 'bs', 8: 'ahs', 9: 'ahs',
  10: 'bmhs', 11: 'bmhs', 12: 'bmhs', 13: 'bmhs', 17: 'bmhs',
  15: 'lf', 16: 'lf', 18: 'ph', 20: 'gk', 21: 'musik', 22: 'sonst', 23: 'sonst',
};

// Atlas-Kartentyp -> Kategorie (nur Fallback, wenn der Bildungskompass die Schule nicht kennt)
const ATLAS_TYP = {
  VS: 'vs', NMSH: 'ms', HS: 'ms', AHS: 'ahs', NMSA: 'ahs', PS: 'ps', BS: 'bs', SS: 'ss',
  BMHST: 'bmhs', BMHSK: 'bmhs', BMHSW: 'bmhs', BMHSP: 'bmhs', BMHSS: 'bmhs',
  LFMS: 'lf', LFHS: 'lf', GKS: 'gk', ASTAT: 'sonst', BSTAT: 'sonst', LMS: 'sonst',
};

export const ERHALTER = {
  BUND: 'Bund', LAND: 'Land', GEMEINDE: 'Gemeinde', MEHRERE_GEBIETSKOERPERSCHAFTEN: 'Mehrere Gebietskörperschaften',
  VEREIN: 'Verein', STIFTUNG: 'Stiftung', PRIVATPERSON: 'Privatperson', MEHRERE_PRIVATPERSONEN: 'Privatpersonen',
  ROEM_KATH_KIRCHE: 'Römisch-katholische Kirche', EVANGELISCHE_KIRCHE: 'Evangelische Kirche',
  ISRAELITISCHE_KULTUSGEMEINDE: 'Israelitische Kultusgemeinde', ISLAMISCHE_GLAUBENSGEMEINSCHAFT: 'Islamische Glaubensgemeinschaft',
  WIFI: 'WIFI', BERUFSFOERDERUNGSINSTITUT: 'BFI', INNUNG: 'Innung', LANDWIRTSCHAFTSKAMMER: 'Landwirtschaftskammer',
  KAMMER_ARBEITER_ANGESTELLTE: 'Arbeiterkammer', FONDS_D_KAUFMANNSCHAFT: 'Fonds der Kaufmannschaft',
  HANDELS_PRODUKTIONSBETRIEB: 'Handels- oder Produktionsbetrieb', SONSTIGE_RECHTSTRAEGER: 'Sonstiger Rechtsträger',
};

// Erste Ziffer der Schulkennzahl = Bundesland
export const BUNDESLAENDER = {
  1: 'Burgenland', 2: 'Kärnten', 3: 'Niederösterreich', 4: 'Oberösterreich', 5: 'Salzburg',
  6: 'Steiermark', 7: 'Tirol', 8: 'Vorarlberg', 9: 'Wien',
};

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '') || undefined;

export function normalizeWeb(url) {
  const u = clean(url);
  if (!u) return undefined;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Führt Bildungskompass- und Atlas-Datensätze über die Schulkennzahl zusammen.
 * @param bkSchulen Array aus /api/oeffentliche-schulen/search
 * @param atlasFeatures GeoJSON-Features der Schicht ATLAS_SCHULE (WGS84)
 */
export function mergeSources(bkSchulen, atlasFeatures) {
  const bk = new Map(bkSchulen.map((s) => [String(s.kennzahl), s]));
  const atlas = new Map(atlasFeatures.map((f) => [String(f.properties.SKZ), f]));
  const skzs = [...new Set([...bk.keys(), ...atlas.keys()])];

  const out = skzs.map((skz) => {
    const b = bk.get(skz);
    const af = atlas.get(skz);
    const a = af?.properties;

    let pos = af?.geometry?.coordinates
      ? { lon: af.geometry.coordinates[0], lat: af.geometry.coordinates[1] }
      : null;
    if (!pos && b) pos = gkToWgs84(b.gbdMeridian, b.gbdRw, b.gbdHw);

    const kat = b ? BK_ART[b.schulart?.id] ?? 'sonst' : ATLAS_TYP[a?.KARTO_TYP] ?? 'sonst';
    const weitere = [...new Set((b?.weitereSchularten ?? []).map((w) => BK_ART[w.id] ?? 'sonst'))].filter((k) => k !== kat);

    const schueler = Number.isFinite(a?.SCHUELER_INSG) ? a.SCHUELER_INSG : undefined;
    const klassen = Number.isFinite(a?.KLASSEN) && a.KLASSEN > 0 ? a.KLASSEN : undefined;

    return {
      skz,
      name: clean(b?.name) ?? clean(b?.titel) ?? clean(a?.BEZEICHNUNG) ?? skz,
      kat,
      ...(weitere.length ? { weitere } : {}),
      art: clean(b?.schulart?.name),
      artId: b?.schulart?.id !== undefined ? String(b.schulart.id) : undefined,
      privat: (b ? Boolean(b.privatSchule) : a?.ERHALTER === 'privat') || undefined,
      erhalter: ERHALTER[b?.schulerhalter] ?? (a?.ERHALTER === 'privat' ? 'Privat' : a ? 'Öffentlich' : undefined),
      bezirk: clean(b?.bezirk),
      gemeinde: clean(a?.GEMNAME) ?? clean(b?.ort),
      gmnr: clean(a?.GMNR),
      strasse: clean(a?.STR) ?? clean(b?.strasse),
      plz: clean(b?.plz) ?? clean(a?.PLZ),
      ort: clean(b?.ort) ?? clean(a?.ORT),
      tel: clean(b?.telefonnummer),
      mail: clean(b?.email),
      web: normalizeWeb(b?.homepage),
      bonus: b?.chancenBonusprogramm ? true : undefined,
      lon: pos ? round(pos.lon, 5) : undefined,
      lat: pos ? round(pos.lat, 5) : undefined,
      klassen,
      schueler,
      sw: Number.isFinite(a?.SCHUELER_W) && schueler ? a.SCHUELER_W : undefined,
      sm: Number.isFinite(a?.SCHUELER_M) && schueler ? a.SCHUELER_M : undefined,
      quelle: b && a ? 'beide' : b ? 'bk' : 'atlas',
    };
  });

  return out.sort((x, y) => x.name.localeCompare(y.name, 'de') || x.skz.localeCompare(y.skz));
}

/** Zugänge aus den Abgängen berechnen: { ziel: [[quelle, anzahl], ...] } */
export function invertUebertritte(out) {
  const inn = {};
  for (const [quelle, rows] of Object.entries(out)) {
    for (const [ziel, n, stufe] of rows) (inn[ziel] ??= []).push([quelle, n, stufe]);
  }
  for (const rows of Object.values(inn)) rows.sort((a, b) => b[1] - a[1]);
  return inn;
}

/** Felder für Karte, Suche und Vergleich (werden beim Start geladen). */
const KERN = ['skz', 'name', 'kat', 'artId', 'weitere', 'privat', 'erhalter', 'gemeinde', 'strasse', 'plz', 'ort', 'bonus', 'lon', 'lat', 'klassen', 'schueler', 'sw', 'sm'];
/** Felder für die Detailseiten (nur im Build und bei Bedarf). */
const DETAIL = ['art', 'bezirk', 'gmnr', 'tel', 'mail', 'web', 'quelle'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

export const splitKernDetail = (schulen) => ({
  kern: schulen.map((s) => pick(s, KERN)),
  details: Object.fromEntries(schulen.map((s) => [s.skz, pick(s, DETAIL)])),
});
