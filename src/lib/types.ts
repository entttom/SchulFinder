export type Kategorie = { id: string; label: string };

/** Kerndaten: werden auf Karte, Suche und im Vergleich verwendet. */
export type Schule = {
  skz: string;
  name: string;
  kat: string;
  /** Schulart-ID des Bildungskompass (feiner als kat, z. B. HTL und HAK getrennt) */
  artId?: string;
  weitere?: string[];
  privat?: true;
  erhalter?: string;
  gemeinde?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  bonus?: true;
  lon?: number;
  lat?: number;
  klassen?: number;
  schueler?: number;
  sw?: number;
  sm?: number;
};

export type Daten = {
  abgerufen: string;
  schuljahr: string;
  kategorien: Kategorie[];
  schulen: Schule[];
};

export type Detail = {
  art?: string;
  bezirk?: string;
  gmnr?: string;
  tel?: string;
  mail?: string;
  web?: string;
  quelle: 'beide' | 'bk' | 'atlas';
};

/** [Schulkennzahl der Gegenseite, Anzahl, Schulstufen-Code] */
export type Uebertritt = [string, number, string];
export type Uebertritte = { aus: Record<string, Uebertritt[]>; zu: Record<string, Uebertritt[]> };

export const BUNDESLAENDER: Record<string, string> = {
  '1': 'Burgenland', '2': 'Kärnten', '3': 'Niederösterreich', '4': 'Oberösterreich', '5': 'Salzburg',
  '6': 'Steiermark', '7': 'Tirol', '8': 'Vorarlberg', '9': 'Wien',
};
export const bundeslandOf = (s: Pick<Schule, 'skz'>) => BUNDESLAENDER[s.skz[0]] ?? '';

export const hatStandort = (s: Schule): s is Schule & { lon: number; lat: number } =>
  s.lon !== undefined && s.lat !== undefined;

/** Durchschnittliche Klassengröße, auf eine Nachkommastelle gerundet. */
export const klassengroesse = (s: Schule) =>
  s.klassen && s.schueler ? Math.round((s.schueler / s.klassen) * 10) / 10 : undefined;

/** Mädchenanteil in Prozent (ganzzahlig). */
export const maedchenAnteil = (s: Schule) =>
  s.schueler && s.sw !== undefined ? Math.round((s.sw / s.schueler) * 100) : undefined;

export const adresse = (s: Schule) =>
  [s.strasse, [s.plz, s.ort ?? s.gemeinde].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Schulart gehört zur Kategorie, auch über "weitere Schularten" (z. B. Volks- und Mittelschule an einem Standort). */
export const hatKategorie = (s: Schule, ids: ReadonlySet<string>) =>
  ids.size === 0 || ids.has(s.kat) || (s.weitere?.some((k) => ids.has(k)) ?? false);

const KURZ: Record<string, string> = {
  vs: 'VS', ms: 'MS', ahs: 'AHS', ps: 'PTS', bs: 'BS', bmhs: 'BHS', ss: 'SS',
  lf: 'LFS', gk: 'GK', ph: 'PH', musik: 'MU', sonst: '·',
};
export const fmtKurz = (kat: string) => KURZ[kat] ?? '·';

/** Schulstufen-Code der Abgangsschule im Schulatlas -> Beschriftung. */
export const stufeLabel = (code: string) =>
  code === '01' ? 'Nach der 4. Schulstufe' : ['02a', '05', '05a'].includes(code) ? 'Nach der 8. Schulstufe' : 'Weitere Abgänge';

/** Kurzer Name für Kartenbeschriftungen: Zusätze nach Gedankenstrich, Doppelpunkt, Klammer oder Anführungszeichen entfallen. */
export function kurzName(name: string, max = 32) {
  let t = name.split(/\s[-–]\s|:\s|\s\(|\s"/)[0].trim();
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return t || name;
}

/** Position einer Volksschule im Vergleich zu ähnlichen Schulen: oberes, mittleres oder unteres Drittel. */
export type Drittel = 'o' | 'm' | 'u';
export type Ergebnisse = { zyklus: string; daten: Record<string, [Drittel | null, Drittel | null]> };

/** "im oberen Drittel" (Satz) bzw. "oberes Drittel" (Tabelle) */
export const drittelImSatz = (d: Drittel) => ({ o: 'oberen', m: 'mittleren', u: 'unteren' })[d] + ' Drittel';
export const drittelKurz = (d: Drittel | null | undefined) => (d ? ({ o: 'oberes', m: 'mittleres', u: 'unteres' })[d] + ' Drittel' : 'nicht verfügbar');

/** Der vorsichtige Hinweis, der überall bei Kennzahlen steht. */
export const HINWEIS_AUSSCHNITT = 'Einzelne Kennzahlen zeigen nur einen Ausschnitt und sagen für sich allein nichts über die Qualität einer Schule.';
