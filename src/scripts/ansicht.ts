// Merkt sich die Kartenansicht (Ausschnitt, Filter, gewählte Schule) für die Dauer des Tabs,
// damit "Zurück zur Karte" genau dort ankommt, wo man war.
export type Kartenansicht = {
  lon: number;
  lat: number;
  zoom: number;
  padding: { top: number; bottom: number; left: number; right: number };
  filter: string; // Filter als URL-Parameter (k, e, b)
  skz: string | null;
  /** Standort, falls er auf der Karte angezeigt wird (nur für die Dauer des Tabs) */
  user?: { lon: number; lat: number };
};

const KEY = 'schulfinder.karte';

export function ladeAnsicht(): Kartenansicht | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (!(v && Number.isFinite(v.lon) && Number.isFinite(v.lat) && Number.isFinite(v.zoom))) return null;
    if (v.user && !(Number.isFinite(v.user.lon) && Number.isFinite(v.user.lat))) delete v.user;
    return v;
  } catch {
    return null;
  }
}

export function speichereAnsicht(a: Kartenansicht) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* Speicher blockiert: dann startet die Karte eben wieder ganz Österreich */
  }
}
