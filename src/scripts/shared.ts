import type { Daten, Detail, Ergebnisse, Kategorie, Schule, Uebertritte } from '../lib/types';
import { hatKategorie } from '../lib/types';
import type { AdressTreffer, SuchIndex, Vorschlag } from '../lib/search';

export const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
) {
  const { class: cls, ...rest } = props as Record<string, unknown>;
  const node = Object.assign(document.createElement(tag), rest);
  if (cls) node.className = cls as string;
  node.append(...kids);
  return node;
}

/* ---------- Daten ---------- */
const cached = <T>(file: string) => {
  let p: Promise<T> | undefined;
  return () =>
    (p ??= fetch(`${base}data/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    }));
};
export const loadKern = cached<Daten>('schulen.json');
export const loadDetails = cached<Record<string, Detail>>('details.json');
export const loadUebertritte = cached<Uebertritte>('uebertritte.json');
export const loadErgebnisse = cached<Ergebnisse>('ergebnisse.json');

/* ---------- Filter ---------- */
export type FilterState = {
  kats: Set<string>;
  erhalter: null | 'oeffentlich' | 'privat';
  bonus: boolean;
};
export const neuerFilter = (): FilterState => ({ kats: new Set(), erhalter: null, bonus: false });

export const passt = (s: Schule, f: FilterState) =>
  hatKategorie(s, f.kats) &&
  (f.erhalter === null || (f.erhalter === 'privat') === Boolean(s.privat)) &&
  (!f.bonus || Boolean(s.bonus));

export function filterToParams(f: FilterState, p: URLSearchParams) {
  f.kats.size ? p.set('k', [...f.kats].join(',')) : p.delete('k');
  f.erhalter ? p.set('e', f.erhalter) : p.delete('e');
  f.bonus ? p.set('b', '1') : p.delete('b');
}

export function filterFromParams(p: URLSearchParams, kategorien: Kategorie[]): FilterState {
  const gueltig = new Set(kategorien.map((k) => k.id));
  const e = p.get('e');
  return {
    kats: new Set((p.get('k') ?? '').split(',').filter((k) => gueltig.has(k))),
    erhalter: e === 'privat' || e === 'oeffentlich' ? e : null,
    bonus: p.get('b') === '1',
  };
}

/** Baut die Filter-Chips (Schulart mehrfach, Erhalter einfach, Bonus-Kennzeichen). */
export function baueFilterChips(container: HTMLElement, kategorien: Kategorie[], f: FilterState, onChange: () => void) {
  // Elemente mit data-keep (z. B. ein Link vor den Filtern) bleiben stehen
  container.querySelectorAll(':scope > :not([data-keep])').forEach((n) => n.remove());
  const zweiZeilen = container.dataset.rows === '2';
  const zeileA = zweiZeilen ? el('div', { class: 'chips scroll' }) : container;
  const zeileB = zweiZeilen ? el('div', { class: 'chips wrap' }) : container;
  if (zweiZeilen) container.append(zeileA, zeileB);
  const chip = (label: string, pressed: boolean, onToggle: () => boolean) => {
    const b = el('button', { class: 'chip', type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', String(onToggle()));
      onChange();
    });
    return b;
  };
  for (const k of kategorien) {
    zeileA.append(
      chip(k.label, f.kats.has(k.id), () => {
        f.kats.has(k.id) ? f.kats.delete(k.id) : f.kats.add(k.id);
        return f.kats.has(k.id);
      }),
    );
  }
  if (!zweiZeilen) container.append(el('span', { class: 'chip sep' }));
  const erh = [
    ['oeffentlich', 'Öffentlich'],
    ['privat', 'Privat'],
  ] as const;
  const erhChips = erh.map(([val, label]) =>
    chip(label, f.erhalter === val, () => {
      f.erhalter = f.erhalter === val ? null : val;
      erhChips.forEach((c, i) => c.setAttribute('aria-pressed', String(f.erhalter === erh[i][0])));
      return f.erhalter === val;
    }),
  );
  zeileB.append(...erhChips);
  zeileB.append(
    chip('Chancenbonus', f.bonus, () => {
      f.bonus = !f.bonus;
      return f.bonus;
    }),
  );
}

/* ---------- Suchbox mit Vorschlägen ---------- */
function adressVorschlag(eingabe: string): AdressTreffer | null {
  const text = eingabe.trim();
  if (text.length < 3 || /^\d+$/.test(text)) return null;
  return { kind: 'adresse', label: `Adresse suchen: ${text}`, sub: 'Der Text wird dafür an OpenStreetMap gesendet', text };
}

export function sucheAnbinden(opts: {
  input: HTMLInputElement;
  list: HTMLElement;
  form?: HTMLElement;
  index: () => SuchIndex | undefined;
  onPick: (v: Vorschlag) => void;
}) {
  const { input, list } = opts;
  let items: Vorschlag[] = [];
  let aktiv = -1;

  const verbergen = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const pick = (i: number) => {
    const v = items[i];
    if (!v) return;
    verbergen();
    input.blur();
    input.value = v.kind === 'adresse' ? v.text : v.kind === 'schule' ? `${v.label}, ${v.schule.gemeinde ?? v.schule.ort ?? ''}`.replace(/, $/, '') : v.label;
    opts.onPick(v);
  };
  const render = () => {
    items = opts.index()?.vorschlaege(input.value) ?? [];
    const adr = adressVorschlag(input.value);
    if (adr) {
      // Sieht der Text nach einer Adresse aus (Straße mit Hausnummer), steht der Vorschlag oben, sonst unten
      if (/[a-zäöüß]\D*\d/i.test(adr.text)) items.unshift(adr);
      else items.push(adr);
    }
    aktiv = -1;
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    list.replaceChildren(
      ...items.map((v, i) => {
        const li = el('li', {}, el('span', { class: 's1', textContent: v.label }), el('span', { class: 's2', textContent: v.sub }));
        li.setAttribute('role', 'option');
        li.addEventListener('click', () => pick(i));
        return li;
      }),
    );
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      aktiv = (aktiv + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === aktiv)));
    } else if (e.key === 'Escape') {
      verbergen();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!items.length) render();
      pick(aktiv >= 0 ? aktiv : 0);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest(`#${input.id}, #${list.id}`)) verbergen();
  });
}

/* ---------- Standort ---------- */
export function standortErmitteln(): Promise<{ lon: number; lat: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Dieser Browser unterstützt keine Standortabfrage.'));
    if (!window.isSecureContext) {
      return reject(new Error('Die Standortabfrage funktioniert nur auf verschlüsselten Seiten (https).'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Der Standortzugriff ist blockiert. Erlaube ihn in den Browser-Einstellungen für diese Seite.'
              : e.code === e.TIMEOUT
                ? 'Der Standort konnte nicht rechtzeitig ermittelt werden. Versuche es noch einmal.'
                : 'Dein Standort ist gerade nicht verfügbar.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}
