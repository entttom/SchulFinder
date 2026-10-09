// Zuletzt gewählter Ort (Suche oder Standort). Bleibt nur im Browser, damit der Vergleich
// nicht bei jedem Öffnen erneut nach dem Standort fragt.
export type Ort = { lon: number; lat: number; label: string };
const KEY = 'schulfinder.ort';

export function ladeOrt(): Ort | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && Number.isFinite(v.lon) && Number.isFinite(v.lat) && typeof v.label === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function speichereOrt(o: Ort) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignorieren */
  }
}

/** Text im Suchfeld: "deinen Standort" und "den Kartenausschnitt" lesen sich dort anders als im Satz. */
export const anzeigeText = (label: string) =>
  label === 'deinen Standort' || label === 'meinem Standort' ? 'Mein Standort' : label === 'den Kartenausschnitt' ? 'Kartenausschnitt' : label;
