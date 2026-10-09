import { base } from './shared';

// "Zurück"-Link: führt dorthin, woher man kam (Karte, Vergleich oder andere Schule),
// mit dem Zustand von vorher. Ohne Herkunft bleibt es der normale Link zur Karte.
const link = document.querySelector<HTMLAnchorElement>('a.back[data-zurueck]');
if (link && history.length > 1 && document.referrer) {
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin) {
      const pfad = ref.pathname;
      const text = pfad === base
        ? '← Zur Karte'
        : pfad.startsWith(`${base}vergleich`)
          ? '← Zum Vergleich'
          : pfad.startsWith(`${base}schule/`)
            ? '← Zurück'
            : null;
      if (text) {
        link.textContent = text;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          history.back();
        });
      }
    }
  } catch {
    /* ungültige Herkunft: normaler Link */
  }
}
