import { type Schule, fmtKurz, hatKategorie, hatStandort, adresse } from '../lib/types';
import { distanceM, fmtDist } from '../lib/geo';
import { EINZUG_FARBEN, KLASSEN_TEXT, einzugMoeglich, klassenAmPunkt } from '../lib/einzug';
import { adresseSuchen } from '../lib/geocode';
import { $, base, el, loadKern, standortErmitteln } from './shared';

/** So viele der nächsten Schulen der gewählten Schulart werden geprüft (je eine kleine Abfrage). */
const MAX_SCHULEN = 15;
const MAX_ENTFERNUNG_M = 20000;
const GLEICHZEITIG = 4;

const form = $<HTMLFormElement>('ezForm');
const eingabe = $<HTMLInputElement>('ezAdresse');
const artEl = $('ezArt');
const statusEl = $('ezStatus');
const listeEl = $('ezListe');
const hinweisEl = $('ezHinweis');
const go = $<HTMLButtonElement>('ezGo');

let schulen: (Schule & { lon: number; lat: number })[] = [];
let art = 'vs';
let lauf = 0;

function setStatus(text: string, fehler = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text;
  statusEl.classList.toggle('fehler', fehler);
}

function baueArten(kategorien: { id: string; label: string }[]) {
  artEl.replaceChildren();
  // Berufs- und Gesundheitsschulen haben im Atlas keine Wohnorte
  for (const k of kategorien.filter((k) => k.id !== 'gk' && k.id !== 'bs')) {
    const b = el('button', { class: 'chip', type: 'button', textContent: k.label });
    b.setAttribute('aria-pressed', String(k.id === art));
    b.addEventListener('click', () => {
      art = k.id;
      artEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    });
    artEl.append(b);
  }
}

function zeile(s: Schule, abstand: number, c: number, nah = false) {
  const swatch = el('i', { class: 'ez-swatch', style: `background:${EINZUG_FARBEN[c]}` });
  return el(
    'li',
    { class: 'vg-row ez-row' },
    el(
      'a',
      { class: 'ez-link', href: `${base}?skz=${s.skz}&ez=1` },
      el('span', { class: 'ez-name', textContent: s.name }),
      el(
        'span',
        { class: 'ez-treffer' },
        swatch,
        el(
          'span',
          {},
          el('strong', { textContent: `${KLASSEN_TEXT[c]} Kinder` }),
          nah ? ' dieser Schule wohnen in einer Zelle in deiner Nähe' : ' dieser Schule wohnen in deiner 500-m-Zelle',
        ),
      ),
      el('span', { class: 'ez-sub', textContent: `${fmtKurz(s.kat)} · ${adresse(s)} · ${fmtDist(abstand)} entfernt` }),
    ),
  );
}

async function pruefe(punkt: { lon: number; lat: number }) {
  const meinLauf = ++lauf;
  go.disabled = true;
  listeEl.replaceChildren();
  hinweisEl.hidden = true;

  const kandidaten = schulen
    .filter((s) => einzugMoeglich(s) && hatKategorie(s, new Set([art])))
    .map((s) => ({ s, d: distanceM(punkt.lon, punkt.lat, s.lon, s.lat) }))
    .filter((x) => x.d <= MAX_ENTFERNUNG_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_SCHULEN);
  if (!kandidaten.length) {
    setStatus('In der Nähe dieser Adresse gibt es keine Schulen dieser Art mit Wohnortdaten.');
    go.disabled = false;
    return;
  }

  const hier: { s: Schule; d: number; c: number }[] = [];
  const nah: { s: Schule; d: number; c: number }[] = [];
  let fertig = 0;
  let fehler = 0;
  const naechste = kandidaten[Symbol.iterator]();
  const arbeiter = async () => {
    for (let n = naechste.next(); !n.done; n = naechste.next()) {
      if (meinLauf !== lauf) return;
      const { s, d } = n.value;
      try {
        const k = await klassenAmPunkt(s.skz, punkt.lon, punkt.lat);
        if (k.zelle >= 0) hier.push({ s, d, c: k.zelle });
        else if (k.umgebung >= 0) nah.push({ s, d, c: k.umgebung });
      } catch {
        fehler++;
      }
      fertig++;
      if (meinLauf === lauf) setStatus(`Prüfe die nächsten Schulen … ${fertig} von ${kandidaten.length}`);
    }
  };
  await Promise.all(Array.from({ length: GLEICHZEITIG }, arbeiter));
  if (meinLauf !== lauf) return;

  const sortiere = (l: typeof hier) => l.sort((a, b) => b.c - a.c || a.d - b.d);
  const abschnitt = (titel: string) => el('li', { class: 'ez-titel', textContent: titel });
  listeEl.replaceChildren(
    ...(hier.length ? [abschnitt('Kinder aus deiner Zelle')] : []),
    ...sortiere(hier).map((t) => zeile(t.s, t.d, t.c)),
    ...(nah.length ? [abschnitt('Kinder aus der Umgebung (etwa 500 m)')] : []),
    ...sortiere(nah).map((t) => zeile(t.s, t.d, t.c, true)),
  );
  go.disabled = false;
  if (fehler === kandidaten.length) {
    setStatus('Die Wohnortdaten konnten nicht abgefragt werden. Versuche es später noch einmal.', true);
    return;
  }
  const geprueft = kandidaten.length - fehler;
  const ohne = geprueft - hier.length - nah.length;
  // Sind Abfragen fehlgeschlagen, beziehen sich die Aussagen nur auf die geprüften Schulen
  const bezug = fehler ? `${geprueft} geprüften` : `${kandidaten.length} nächsten`;
  const hat = (n: number) => (n === 1 ? 'hat' : 'haben');
  const teile = [
    hier.length
      ? `${hier.length} der ${bezug} Schulen ${hat(hier.length)} Kinder aus deiner Zelle.`
      : nah.length
        ? `Keine der ${bezug} Schulen hat Kinder aus deiner Zelle.`
        : `Aus deiner 500-m-Zelle und ihrer Umgebung gehen keine Kinder an die ${bezug} Schulen.`,
    nah.length ? `${nah.length} ${hier.length ? 'weitere ' : ''}${hat(nah.length)} Kinder aus der Umgebung.` : '',
    ohne > 0 && (hier.length || nah.length) ? `${ohne} ${hat(ohne)} in der Nähe keine Kinder.` : '',
    fehler ? `${fehler} ${fehler === 1 ? 'Abfrage ist' : 'Abfragen sind'} fehlgeschlagen, versuche es später noch einmal.` : '',
  ];
  setStatus(teile.filter(Boolean).join(' '), fehler > 0);
  hinweisEl.hidden = false;
  // Auf dem Handy liegt das Ergebnis unter dem Formular
  statusEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = eingabe.value.trim();
  if (text.length < 3) return setStatus('Bitte gib eine Adresse ein, zum Beispiel „Mariahilfer Straße 1, Wien“.', true);
  setStatus('Suche Adresse …');
  go.disabled = true;
  try {
    const t = await adresseSuchen(text);
    if (!t) {
      setStatus('Diese Adresse wurde nicht gefunden. Prüfe Schreibweise und Ort.', true);
      go.disabled = false;
      return;
    }
    await pruefe(t);
  } catch {
    setStatus('Die Adresssuche ist gerade nicht erreichbar. Versuche es später noch einmal.', true);
    go.disabled = false;
  }
});

$('ezLocate').addEventListener('click', async () => {
  setStatus('Ermittle deinen Standort …');
  go.disabled = true;
  try {
    const p = await standortErmitteln();
    eingabe.value = '';
    await pruefe(p);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Dein Standort ist gerade nicht verfügbar.', true);
    go.disabled = false;
  }
});

loadKern()
  .then((daten) => {
    schulen = daten.schulen.filter(hatStandort);
    baueArten(daten.kategorien);
  })
  .catch(() => setStatus('Die Schulen konnten nicht geladen werden.', true));
