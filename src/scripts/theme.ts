// Darstellung: 'auto' folgt dem Gerät, 'light' und 'dark' sind vom Nutzer gewählt (localStorage).
// Der erste Wert wird schon im <head> gesetzt (Base.astro), damit die Seite nicht aufblitzt.
export type Modus = 'auto' | 'light' | 'dark';
const KEY = 'schulfinder-theme';
const NAMEN: Record<Modus, string> = { auto: 'System', light: 'Hell', dark: 'Dunkel' };
const REIHE: Modus[] = ['auto', 'light', 'dark'];
const system = window.matchMedia('(prefers-color-scheme: dark)');

export function modus(): Modus {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* Speicher gesperrt */ }
  return 'auto';
}

/** Was gerade tatsächlich angezeigt wird. */
export const istDunkel = () => {
  const m = modus();
  return m === 'dark' || (m === 'auto' && system.matches);
};

function anwenden() {
  const m = modus();
  if (m === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', m);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    b.dataset.modus = m;
    const t = `Darstellung: ${NAMEN[m]}`;
    b.setAttribute('aria-label', t);
    b.title = t;
  }
  document.dispatchEvent(new CustomEvent('schulfinder:theme', { detail: { dunkel: istDunkel() } }));
}

/** Meldet Änderungen (Schalter, Gerät, anderer Tab). Ruft sofort einmal auf. */
export function beiThemeWechsel(fn: (dunkel: boolean) => void) {
  document.addEventListener('schulfinder:theme', (e) => fn((e as CustomEvent).detail.dunkel));
  fn(istDunkel());
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
  b.addEventListener('click', () => {
    const next = REIHE[(REIHE.indexOf(modus()) + 1) % REIHE.length];
    try {
      if (next === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* Speicher gesperrt: gilt nur für diese Seite */ }
    anwenden();
  });
}
system.addEventListener('change', () => { if (modus() === 'auto') anwenden(); });
window.addEventListener('storage', (e) => { if (e.key === KEY) anwenden(); });
anwenden();
