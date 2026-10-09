import { umschalten, istGewaehlt, beiAenderung, MAX_AUSWAHL } from './auswahl';

/** Bindet die Knöpfe "Zum Vergleich" innerhalb von root (Detailseite). */
export function bindeVergleichsknoepfe(root: ParentNode = document) {
  const hinweis = root.querySelector<HTMLElement>('#vergleichHinweis');
  root.querySelectorAll<HTMLButtonElement>('button.vergleich-toggle').forEach((b) => {
    const skz = b.dataset.skz!;
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
      const r = umschalten(skz);
      if (hinweis) {
        hinweis.hidden = r !== 'voll';
        if (r === 'voll') hinweis.textContent = `Du kannst bis zu ${MAX_AUSWAHL} Schulen vergleichen. Entferne zuerst eine im Vergleich.`;
      }
      zeigen();
    });
  });
}

// Auf der eigenen Detailseite sofort binden
if (document.querySelector('main.detail')) bindeVergleichsknoepfe(document);
