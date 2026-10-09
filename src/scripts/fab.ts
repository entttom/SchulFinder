import { base } from './shared';
import { lade, beiAenderung } from './auswahl';

// Schwebender Knopf "Vergleich": zeigt die Zahl der gemerkten Schulen und führt zum Vergleich.
const fab = document.getElementById('fab') as HTMLAnchorElement | null;
if (fab) {
  const zahl = document.getElementById('fabCount')!;
  const aktualisieren = () => {
    const l = lade();
    fab.href = `${base}vergleich/${l.length ? `?sel=${l.join(',')}` : ''}`;
    zahl.hidden = l.length === 0;
    zahl.textContent = String(l.length);
    fab.classList.toggle('hat-auswahl', l.length > 0);
    fab.setAttribute('aria-label', l.length ? `Zum Vergleich, ${l.length} ${l.length === 1 ? 'Schule' : 'Schulen'} gemerkt` : 'Zum Vergleich');
  };
  aktualisieren();
  beiAenderung(aktualisieren);
}
