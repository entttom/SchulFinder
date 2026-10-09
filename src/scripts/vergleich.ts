import {
  type Daten, type Schule, type Uebertritt, adresse, hatStandort, klassengroesse, maedchenAnteil, stufeLabel, drittelKurz, HINWEIS_AUSSCHNITT,
} from '../lib/types';
import { distanceM, fmtDist, fmtNum } from '../lib/geo';
import { SuchIndex } from '../lib/search';
import { adresseSuchen } from '../lib/geocode';
import { profilOf, profilLabel } from '../lib/profil';
import { lade, speichere, MAX_AUSWAHL } from './auswahl';
import { ladeOrt, speichereOrt, anzeigeText } from './ort';
import { ladeAnsicht } from './ansicht';
import {
  $, base, el, loadKern, loadDetails, loadUebertritte, loadErgebnisse, baueFilterChips, neuerFilter, filterFromParams, filterToParams,
  passt, sucheAnbinden, standortErmitteln, type FilterState,
} from './shared';

type SortKey = 'dist' | 'schueler' | 'klasse' | 'maedchen' | 'name';
type Zeile = { s: Schule & { lon: number; lat: number }; d: number };

const MAX_ZEILEN = 300;
const RADIEN = [2, 5, 10, 20];

const countEl = $('count');
const rowsEl = $('rows');
const colsEl = $('cols');
const hintEl = $('hint');
const barEl = $('bar');
const qInput = $<HTMLInputElement>('q');
const sortEl = $<HTMLSelectElement>('sort');
const dlg = $<HTMLDialogElement>('cmp');

const state = {
  daten: null as Daten | null,
  byId: new Map<string, Schule>(),
  index: undefined as SuchIndex | undefined,
  center: null as null | { lon: number; lat: number; label?: string },
  r: 5,
  filter: neuerFilter() as FilterState,
  sel: [] as string[],
  sort: { key: 'dist' as SortKey, dir: 1 as 1 | -1 },
};

/* ---------- URL ---------- */
function zuUrl() {
  const p = new URLSearchParams();
  if (state.center) {
    p.set('lon', state.center.lon.toFixed(5));
    p.set('lat', state.center.lat.toFixed(5));
    if (state.center.label) p.set('o', state.center.label);
  }
  p.set('r', String(state.r));
  filterToParams(state.filter, p);
  if (state.sel.length) p.set('sel', state.sel.join(','));
  if (state.sort.key !== 'dist') p.set('s', state.sort.key);
  if (dlg.open) p.set('cmp', '1');
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

/* ---------- Sortierung und Auswertung ---------- */
const wert = (z: Zeile, key: SortKey): number | string | undefined => {
  switch (key) {
    case 'dist': return z.d;
    case 'schueler': return z.s.schueler;
    case 'klasse': return klassengroesse(z.s);
    case 'maedchen': return maedchenAnteil(z.s);
    case 'name': return z.s.name;
  }
};
// Beim ersten Klick auf eine Spalte: Entfernung/Name aufsteigend, Zahlen absteigend
const standardRichtung = (k: SortKey): 1 | -1 => (k === 'dist' || k === 'name' ? 1 : -1);

function sortiere(rows: Zeile[]) {
  const { key, dir } = state.sort;
  return rows.sort((a, b) => {
    const x = wert(a, key);
    const y = wert(b, key);
    if (x === undefined && y === undefined) return a.d - b.d;
    if (x === undefined) return 1; // fehlende Werte immer zuletzt
    if (y === undefined) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string, 'de') : x - (y as number);
    return c * dir || a.d - b.d;
  });
}

function ergebnis(): Zeile[] {
  if (!state.daten || !state.center) return [];
  const { lon, lat } = state.center;
  const rows: Zeile[] = [];
  for (const s of state.daten.schulen) {
    if (!hatStandort(s) || !passt(s, state.filter)) continue;
    const d = distanceM(lon, lat, s.lon, s.lat);
    if (d <= state.r * 1000) rows.push({ s: s as Zeile['s'], d });
  }
  return sortiere(rows);
}

/* ---------- Darstellung ---------- */
const SPALTEN: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Schule' },
  { key: 'dist', label: 'Entfernung' },
  { key: 'schueler', label: 'Schüler' },
  { key: 'klasse', label: 'Ø Klasse' },
  { key: 'maedchen', label: 'Mädchen' },
];

function baueSpaltenkopf() {
  colsEl.replaceChildren(
    el('span', {}),
    ...SPALTEN.map((c) => {
      const b = el('button', { type: 'button', textContent: c.label });
      b.dataset.key = c.key;
      b.addEventListener('click', () => setSort(c.key));
      return b;
    }),
    el('span', { textContent: 'Erhalter' }),
  );
}

function setSort(key: SortKey) {
  state.sort = state.sort.key === key ? { key, dir: (state.sort.dir * -1) as 1 | -1 } : { key, dir: standardRichtung(key) };
  sortEl.value = key;
  render();
}

const stat = (label: string, value: string, extra = '') =>
  el('div', { class: `cell ${extra}`.trim() }, el('span', { class: 'cl', textContent: label }), el('span', { class: 'cv', textContent: value }));

function zeile({ s, d }: Zeile) {
  const kl = klassengroesse(s);
  const ma = maedchenAnteil(s);
  const gewaehlt = state.sel.includes(s.skz);
  const katLabel = state.daten!.kategorien.find((k) => k.id === s.kat)?.label ?? '';
  const erh = s.privat ? 'privat' : s.erhalter ?? 'öffentlich';

  const cb = el('input', { type: 'checkbox', checked: gewaehlt });
  cb.setAttribute('aria-label', `${s.name} zum Vergleich auswählen`);
  cb.addEventListener('change', () => toggleAuswahl(s.skz, cb));

  const titel = el('a', { class: 't', href: `${base}schule/${s.skz}/`, textContent: s.name });
  const unter = [s.strasse, s.gemeinde ?? s.ort].filter(Boolean).join(', ');
  const tags = el('div', { class: 'tags' }, el('span', { class: 'tag', textContent: katLabel }));
  tags.append(el('span', { class: 'tag tag-erh', textContent: erh }));
  if (s.bonus) tags.append(el('span', { class: 'tag tag-info', textContent: 'Chancenbonus' }));

  // Kompakte Kennzahlen-Zeile für das Handy (der Desktop zeigt stattdessen Spalten)
  const kurz = [
    fmtDist(d),
    s.schueler !== undefined ? `${fmtNum(s.schueler)} Schüler` : 'keine Schülerzahl',
    kl !== undefined ? `Ø ${fmtNum(kl, 1)} pro Klasse` : '',
    ma !== undefined ? `${ma} % Mädchen` : '',
  ].filter(Boolean);
  const mobil = el(
    'div',
    { class: 'mobil' },
    el('div', { class: 'mline', textContent: kurz.join(' · ') }),
    el('div', { class: 'mkat', textContent: `${katLabel} · ${erh}` }),
    ...(s.bonus ? [el('span', { class: 'tag tag-info', textContent: 'Chancenbonus' })] : []),
  );

  const li = el(
    'li',
    { class: 'vg-row' + (gewaehlt ? ' on' : '') },
    el('div', { class: 'name' }, titel, el('div', { class: 's', textContent: unter }), tags, mobil),
    el('label', { class: 'pick' }, cb),
    el(
      'div',
      { class: 'cells' },
      stat('Entfernung', fmtDist(d)),
      stat('Schüler', fmtNum(s.schueler)),
      stat('Ø Klasse', fmtNum(kl, 1)),
      stat('Mädchen', ma === undefined ? '–' : `${ma} %`),
      stat('Erhalter', erh, 'erh'),
    ),
  );
  li.dataset.skz = s.skz;
  return li;
}

function aktualisiereKopf(n: number) {
  $('filterSummary').textContent = filterText();
  $('filterDone').textContent = !state.center ? 'Schließen' : n === 0 ? 'Keine Schulen' : `${fmtNum(n)} ${n === 1 ? 'Schule' : 'Schulen'} anzeigen`;
}

function render() {
  const rows = state.center ? ergebnis() : [];
  aktualisiereKopf(rows.length);
  const sichtbar = rows.slice(0, MAX_ZEILEN);

  // Spaltenkopf (Desktop): Sortierung anzeigen
  colsEl.hidden = rows.length === 0;
  colsEl.querySelectorAll('button').forEach((b) => {
    const aktiv = b.dataset.key === state.sort.key;
    b.setAttribute('aria-sort', aktiv ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
    b.classList.toggle('on', aktiv);
  });

  if (!state.center) {
    countEl.textContent = 'Wähle einen Ort';
    const standort = el('button', { type: 'button', class: 'btn primary', textContent: 'Meinen Standort verwenden' });
    standort.addEventListener('click', () => $('locate').click());
    rowsEl.replaceChildren(
      el(
        'li',
        { class: 'empty' },
        el('p', { textContent: 'Suche oben nach einem Ort oder einer Postleitzahl. Dann siehst du alle Schulen im Umkreis nebeneinander oder als Überblick in Prozent.' }),
        standort,
      ),
    );
  } else if (rows.length === 0) {
    countEl.textContent = 'Keine Schulen gefunden';
    rowsEl.replaceChildren(el('li', { class: 'empty' }, 'Im gewählten Umkreis gibt es keine Schule mit diesen Filtern. Vergrößere den Umkreis oder entferne einen Filter.'));
  } else {
    const wo = state.center.label ? ` um ${state.center.label}` : '';
    countEl.textContent = `${fmtNum(rows.length)} ${rows.length === 1 ? 'Schule' : 'Schulen'}${wo} (${state.r} km)`;
    rowsEl.replaceChildren(...sichtbar.map(zeile));
    if (rows.length > sichtbar.length) {
      rowsEl.append(el('li', { class: 'empty' }, `Es werden die ersten ${MAX_ZEILEN} angezeigt. Verkleinere den Umkreis oder wähle eine Schulart.`));
    }
  }

  hintEl.hidden = !(state.center && rows.length > 15 && state.filter.kats.size === 0);
  hintEl.textContent = 'Tipp: Wähle eine Schulart, um Gleiches mit Gleichem zu vergleichen.';
  aktualisiereLeiste();
  zuUrl();
}

/* ---------- Auswahl ---------- */
function toggleAuswahl(skz: string, cb: HTMLInputElement) {
  if (cb.checked) {
    if (state.sel.length >= MAX_AUSWAHL) {
      cb.checked = false;
      selInfo.textContent = `Du kannst bis zu ${MAX_AUSWAHL} Schulen vergleichen.`;
      return;
    }
    state.sel.push(skz);
  } else {
    state.sel = state.sel.filter((x) => x !== skz);
  }
  cb.closest('li')?.classList.toggle('on', cb.checked);
  speichere(state.sel);
  aktualisiereLeiste();
  zuUrl();
}

const selPanel = $('selPanel');
const selInfo = $('selInfo');

function setSelPanel(open: boolean) {
  selPanel.hidden = !open;
  selInfo.setAttribute('aria-expanded', String(open));
  if (open) renderSelPanel();
}

function entferne(skz: string) {
  state.sel = state.sel.filter((x) => x !== skz);
  const li = rowsEl.querySelector<HTMLElement>(`li[data-skz="${skz}"]`);
  li?.classList.remove('on');
  const cb = li?.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (cb) cb.checked = false;
  speichere(state.sel);
  aktualisiereLeiste();
  zuUrl();
}

function renderSelPanel() {
  const schulen = state.sel.map((k) => state.byId.get(k)).filter(Boolean) as Schule[];
  selPanel.replaceChildren(
    el('div', { class: 'sel-head', textContent: 'Deine Auswahl' }),
    ...schulen.map((s) => {
      const rm = el('button', { type: 'button', class: 'icon-btn' });
      rm.setAttribute('aria-label', `${s.name} entfernen`);
      rm.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      rm.addEventListener('click', () => entferne(s.skz));
      const kat = state.daten?.kategorien.find((k) => k.id === s.kat)?.label ?? '';
      return el(
        'div',
        { class: 'sel-item' },
        el('div', { class: 'sel-text' }, el('a', { class: 't', href: `${base}schule/${s.skz}/`, textContent: s.name }), el('div', { class: 's', textContent: [kat, s.gemeinde ?? s.ort].filter(Boolean).join(' · ') })),
        rm,
      );
    }),
  );
}

function aktualisiereLeiste() {
  const n = state.sel.length;
  barEl.hidden = n === 0;
  // Gewählte Schulen können durch Umkreis oder Filter aus der Liste fallen
  const ausgeblendet = state.sel.filter((k) => !rowsEl.querySelector(`li[data-skz="${k}"]`)).length;
  selInfo.textContent = n === 1 ? '1 gewählt, wähle noch eine' : `${n} gewählt${ausgeblendet ? ` · ${ausgeblendet} ausgeblendet` : ''}`;
  $<HTMLButtonElement>('openCmp').disabled = n < 2;
  document.body.classList.toggle('has-bar', n > 0);
  if (n === 0) setSelPanel(false);
  else if (!selPanel.hidden) renderSelPanel();
}

selInfo.addEventListener('click', () => setSelPanel(selPanel.hidden));

$('clearSel').addEventListener('click', () => {
  state.sel = [];
  rowsEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => (c.checked = false));
  rowsEl.querySelectorAll('li.on').forEach((li) => li.classList.remove('on'));
  speichere(state.sel);
  aktualisiereLeiste();
  zuUrl();
});

/* ---------- Nebeneinander ---------- */
const prozent = (rows: Uebertritt[]) => {
  const summe = rows.reduce((a, r) => a + r[1], 0);
  return rows.map((r) => ({ r, pct: Math.round((r[1] / summe) * 100) }));
};

function uebertrittListe(rows: Uebertritt[] | undefined, klein: Record<string, number> | undefined) {
  if (!rows?.length && !klein) return el('span', { class: 'muted', textContent: '–' });
  const ul = el('ul', { class: 'cmp-ue' });
  const gruppen = new Map<string, Uebertritt[]>();
  for (const r of rows ?? []) (gruppen.get(r[2]) ?? gruppen.set(r[2], []).get(r[2])!).push(r);
  for (const code of Object.keys(klein ?? {})) if (!gruppen.has(code)) gruppen.set(code, []);
  for (const [code, z] of gruppen) {
    const summe = z.reduce((a, r) => a + r[1], 0);
    const proTyp = new Map<string, number>();
    for (const r of z) {
      const ziel = state.byId.get(r[0]);
      if (ziel) proTyp.set(profilOf(ziel), (proTyp.get(profilOf(ziel)) ?? 0) + r[1]);
    }
    if (gruppen.size > 1) ul.append(el('li', { class: 'ue-h', textContent: stufeLabel(code) }));
    for (const [id, n] of [...proTyp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      ul.append(el('li', {}, `${profilLabel(id)} `, el('b', { textContent: `${Math.round((n / summe) * 100)}\u00a0%` })));
    }
    const k = klein?.[code] ?? 0;
    ul.append(
      el('li', {
        class: 'ue-h',
        textContent: `${summe > 0 ? `${summe} erfasste Wechsel` : 'keine einzeln ausgewiesenen Wechsel'}${k ? `, dazu ${k} ${k === 1 ? 'Schule' : 'Schulen'} mit bis zu 6 Kindern` : ''}`,
      }),
    );
  }
  return ul;
}

async function zeigeVergleich() {
  setSelPanel(false);
  const schulen = state.sel.map((k) => state.byId.get(k)).filter(Boolean) as Schule[];
  if (schulen.length < 2) return;
  const body = $('cmpBody');
  body.replaceChildren(el('p', { class: 'empty', textContent: 'Lade Details …' }));
  dlg.showModal();
  dlg.tabIndex = -1;
  dlg.focus(); // Fokus auf den Dialog statt auf den Schließen-Knopf
  zuUrl();

  const [det, ue, erg] = await Promise.all([
    loadDetails(),
    loadUebertritte().catch(() => ({ aus: {}, zu: {} })),
    loadErgebnisse().catch(() => ({ zyklus: '', daten: {} as Record<string, [null, null]> })),
  ]);
  const istVs = (s: Schule) => s.kat === 'vs' || (s.weitere ?? []).includes('vs');
  const ergebnisZelle = (s: Schule, i: 0 | 1) => (erg.daten[s.skz] ? drittelKurz(erg.daten[s.skz][i]) : istVs(s) ? 'nicht verfügbar' : '–');

  const link = (href: string, text: string, ext = false) => {
    const a = el('a', { href, textContent: text });
    if (ext) Object.assign(a, { target: '_blank', rel: 'noopener noreferrer' });
    return a;
  };
  const ZEILEN: { label: string; cell: (s: Schule) => Node | string }[] = [
    { label: 'Schulart', cell: (s) => det[s.skz]?.art ?? state.daten!.kategorien.find((k) => k.id === s.kat)?.label ?? '–' },
    { label: 'Erhalter', cell: (s) => (s.privat ? 'privat' : '') + (s.privat && s.erhalter ? ', ' : '') + (s.erhalter ?? (s.privat ? '' : 'öffentlich')) },
    { label: 'Adresse', cell: (s) => adresse(s) || '–' },
    { label: 'Entfernung', cell: (s) => (state.center && hatStandort(s) ? fmtDist(distanceM(state.center.lon, state.center.lat, s.lon, s.lat)) : '–') },
    { label: 'Schüler', cell: (s) => fmtNum(s.schueler) },
    { label: 'Klassen', cell: (s) => fmtNum(s.klassen) },
    { label: 'Ø pro Klasse', cell: (s) => fmtNum(klassengroesse(s), 1) },
    { label: 'Mädchen', cell: (s) => (maedchenAnteil(s) === undefined ? '–' : `${maedchenAnteil(s)} %`) },
    { label: 'Chancen\u00adbonus', cell: (s) => (s.bonus ? 'Ja' : 'Nein') },
    { label: 'Deutsch (Lesen)', cell: (s) => ergebnisZelle(s, 0) },
    { label: 'Mathematik', cell: (s) => ergebnisZelle(s, 1) },
    { label: 'Abgänge zu', cell: (s) => uebertrittListe(ue.aus[s.skz], ue.kleinAus?.[s.skz]) },
    { label: 'Zugänge von', cell: (s) => uebertrittListe(ue.zu[s.skz], ue.kleinZu?.[s.skz]) },
    {
      label: 'Kontakt',
      cell: (s) => {
        const d = det[s.skz];
        const box = el('div', { class: 'cmp-kontakt' });
        if (d?.tel) box.append(link(`tel:${d.tel.replace(/[^+\d]/g, '')}`, d.tel));
        if (d?.mail) box.append(link(`mailto:${d.mail}`, d.mail.replace('@', '@\u200b')));
        if (d?.web) box.append(link(d.web, d.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), true));
        return box.childNodes.length ? box : '–';
      },
    },
  ];

  const table = el('table', { class: 'cmp-table' });
  const head = el('tr', {}, el('th', { scope: 'col', class: 'corner' }));
  for (const s of schulen) {
    head.append(el('th', { scope: 'col' }, link(`${base}schule/${s.skz}/`, s.name)));
  }
  table.append(el('thead', {}, head));
  const tb = el('tbody');
  let i = 0;
  for (const z of ZEILEN) {
    const tr = el('tr', {}, el('th', { scope: 'row', textContent: z.label }));
    tr.style.setProperty('--i', String(i++));
    for (const s of schulen) tr.append(el('td', {}, z.cell(s)));
    tb.append(tr);
  }
  table.append(tb);
  body.replaceChildren(
    table,
    el('p', { class: 'credit', textContent: `Deutsch und Mathematik: Schulmittelwert (iKMPLUS, 4. Schulstufe) im Vergleich zu ähnlichen Schulen, nur für Volksschulen. ${HINWEIS_AUSSCHNITT}` }),
  );
}

$('openCmp').addEventListener('click', zeigeVergleich);
$('closeCmp').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', zuUrl);
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) dlg.close(); // Klick auf den Hintergrund
});

/* ---------- Ort, Umkreis, Filter ---------- */
function setCenter(c: { lon: number; lat: number; label?: string }) {
  state.center = c;
  if (c.label) speichereOrt({ lon: c.lon, lat: c.lat, label: c.label }); // beim nächsten Öffnen nicht erneut fragen
  render();
}

sucheAnbinden({
  input: qInput,
  list: $('suggest'),
  index: () => state.index,
  onPick: (v) => {
    if (v.kind === 'adresse') {
      countEl.textContent = 'Adresse wird gesucht …';
      adresseSuchen(v.text)
        .then((t) => (t ? setCenter({ lon: t.lon, lat: t.lat, label: v.text }) : (countEl.textContent = 'Diese Adresse wurde nicht gefunden.')))
        .catch(() => (countEl.textContent = 'Die Adresssuche ist gerade nicht erreichbar.'));
      return;
    }
    if (v.kind === 'schule') {
      if (hatStandort(v.schule)) setCenter({ lon: v.schule.lon, lat: v.schule.lat, label: v.schule.name });
      return;
    }
    setCenter({ lon: v.lon, lat: v.lat, label: v.label });
  },
});
$('searchForm').addEventListener('submit', (e) => e.preventDefault());

$('locate').addEventListener('click', async () => {
  countEl.textContent = 'Standort wird ermittelt …';
  try {
    const p = await standortErmitteln();
    qInput.value = '';
    setCenter({ ...p, label: 'deinen Standort' });
  } catch (err) {
    countEl.textContent = (err as Error).message;
  }
});

function baueRadius() {
  const box = $('radius');
  box.replaceChildren(
    ...RADIEN.map((km) => {
      const b = el('button', { class: 'chip', type: 'button', textContent: `${km} km` });
      b.dataset.km = String(km);
      b.setAttribute('aria-pressed', String(state.r === km));
      b.addEventListener('click', () => {
        state.r = km;
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
      });
      return b;
    }),
  );
}

sortEl.addEventListener('change', () => {
  const key = sortEl.value as SortKey;
  state.sort = { key, dir: standardRichtung(key) };
  render();
});

/* ---------- Filter-Fenster (Handy) ---------- */
const filterPanel = $('filterPanel');
const scrim = $('scrim');
const filterBtn = $('filterBtn');

function setPanel(open: boolean) {
  filterPanel.classList.toggle('open', open);
  scrim.classList.toggle('open', open);
  filterBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('sheet-open', open);
  if (open) filterPanel.focus();
  else if (document.activeElement && filterPanel.contains(document.activeElement)) filterBtn.focus();
}
filterBtn.addEventListener('click', () => setPanel(!filterPanel.classList.contains('open')));
$('filterClose').addEventListener('click', () => setPanel(false));
$('filterDone').addEventListener('click', () => setPanel(false));
scrim.addEventListener('click', () => setPanel(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterPanel.classList.contains('open')) setPanel(false);
});
$('filterReset').addEventListener('click', () => {
  state.filter = neuerFilter();
  state.r = 5;
  baueFilterChips($('chips'), state.daten!.kategorien, state.filter, render);
  baueRadius();
  render();
});

/** Kurztext auf dem Filter-Knopf: was gerade gilt. */
function filterText() {
  const f = state.filter;
  const teile = [`${state.r} km`];
  if (f.kats.size === 1) teile.push(state.daten?.kategorien.find((k) => k.id === [...f.kats][0])?.label ?? '');
  else if (f.kats.size > 1) teile.push(`${f.kats.size} Schularten`);
  if (f.erhalter) teile.push(f.erhalter === 'privat' ? 'privat' : 'öffentlich');
  if (f.bonus) teile.push('Chancenbonus');
  return teile.filter(Boolean).join(' · ');
}

/* ---------- Scroll-Position beim Zurückgehen ---------- */
const SCROLL_KEY = 'schulfinder.scroll.vergleich';
window.addEventListener('pagehide', () => {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ u: location.search, y: window.scrollY }));
  } catch {
    /* ignorieren */
  }
});
function scrollWiederherstellen() {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null');
    if (nav?.type === 'back_forward' && v && v.u === location.search && v.y > 0) window.scrollTo(0, v.y);
  } catch {
    /* ignorieren */
  }
}

/* ---------- Start ---------- */
baueSpaltenkopf();
baueRadius();

loadKern()
  .then((d) => {
    state.daten = d;
    state.byId = new Map(d.schulen.map((s) => [s.skz, s]));
    state.index = new SuchIndex(d.schulen);
    $('schuljahr').textContent = `Schuljahr ${d.schuljahr}`;

    const p = new URLSearchParams(location.search);
    state.filter = filterFromParams(p, d.kategorien);
    baueFilterChips($('chips'), d.kategorien, state.filter, render);
    const r = Number(p.get('r'));
    if (r > 0 && r <= 50) state.r = r;
    baueRadius();
    const lon = Number(p.get('lon'));
    const lat = Number(p.get('lat'));
    if (p.get('lon') && p.get('lat') && Number.isFinite(lon) && Number.isFinite(lat)) {
      const o = p.get('o') === 'meinem Standort' ? 'deinen Standort' : p.get('o') ?? undefined;
      state.center = { lon, lat, label: o };
      if (o) qInput.value = anzeigeText(o);
    }
    if (location.hash === '#filter') setPanel(true);
    // Ein geteilter Link (sel=...) hat Vorrang vor der gemerkten Auswahl und ersetzt sie
    const urlSel = p.get('sel');
    state.sel = (urlSel !== null ? urlSel.split(',') : lade()).filter((k) => state.byId.has(k)).slice(0, MAX_AUSWAHL);
    if (urlSel !== null) speichere(state.sel);
    // Ohne Ort im Link: sinnvollen Ausgangspunkt wählen, damit man nie erst den Standort drücken muss.
    // 1. erste gewählte Schule, 2. Ausschnitt, den man auf der Karte angesehen hat, 3. zuletzt gewählter Ort
    if (!state.center) {
      const erste = state.sel.map((k) => state.byId.get(k)).find((x) => x && hatStandort(x));
      const ansicht = ladeAnsicht();
      const ort = ladeOrt();
      if (erste && hatStandort(erste)) state.center = { lon: erste.lon, lat: erste.lat, label: erste.gemeinde ?? erste.ort };
      else if (ansicht && ansicht.zoom >= 9) state.center = { lon: ansicht.lon, lat: ansicht.lat, label: 'den Kartenausschnitt' };
      else if (ort) state.center = ort;
      if (state.center?.label) qInput.value = anzeigeText(state.center.label);
    }
    // Noch nichts bekannt, aber der Standort war schon freigegeben: ohne Nachfrage verwenden
    if (!state.center && navigator.permissions) {
      void navigator.permissions
        .query({ name: 'geolocation' })
        .then((r) => (r.state === 'granted' ? standortErmitteln() : null))
        .then((pos) => {
          if (pos && !state.center) {
            qInput.value = anzeigeText('deinen Standort');
            setCenter({ ...pos, label: 'deinen Standort' });
          }
        })
        .catch(() => undefined);
    }
    const s = p.get('s') as SortKey | null;
    if (s && SPALTEN.some((c) => c.key === s)) {
      state.sort = { key: s, dir: standardRichtung(s) };
      sortEl.value = s;
    }
    render();
    if (p.get('cmp') === '1' && state.sel.length >= 2) void zeigeVergleich();
    scrollWiederherstellen();
  })
  .catch(() => {
    countEl.textContent = 'Die Schulen konnten nicht geladen werden. Bitte Seite neu laden.';
  });
