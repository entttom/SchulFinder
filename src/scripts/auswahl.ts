// Gemerkte Schulen für den Vergleich. Liegt im Browser (localStorage), ohne Anmeldung.
// Fällt auf den Arbeitsspeicher zurück, wenn der Browser das Speichern blockiert (z. B. privates Fenster).
export const MAX_AUSWAHL = 4;
const KEY = 'schulfinder.vergleich';
let speicher: string[] = [];

export function lade(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(v)) speicher = v.filter((x) => typeof x === 'string').slice(0, MAX_AUSWAHL);
  } catch {
    /* Speicher nicht verfügbar: Arbeitsspeicher verwenden */
  }
  return [...speicher];
}

export function speichere(liste: string[]) {
  speicher = [...new Set(liste)].slice(0, MAX_AUSWAHL);
  try {
    localStorage.setItem(KEY, JSON.stringify(speicher));
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new CustomEvent('auswahl'));
}

export const istGewaehlt = (skz: string) => lade().includes(skz);

/** Schaltet eine Schule um. "voll", wenn schon MAX_AUSWAHL gewählt sind. */
export function umschalten(skz: string): 'hinzugefuegt' | 'entfernt' | 'voll' {
  const l = lade();
  if (l.includes(skz)) {
    speichere(l.filter((x) => x !== skz));
    return 'entfernt';
  }
  if (l.length >= MAX_AUSWAHL) return 'voll';
  speichere([...l, skz]);
  return 'hinzugefuegt';
}

export function beiAenderung(cb: () => void) {
  window.addEventListener('auswahl', cb);
  window.addEventListener('storage', (e) => e.key === KEY && cb());
  window.addEventListener('pageshow', cb); // Zurück-Navigation aus dem Seitencache
}
