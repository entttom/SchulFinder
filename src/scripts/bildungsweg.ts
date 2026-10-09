import type { Map as KarteTyp, GeoJSONSource, Marker } from 'maplibre-gl';
import { type Schule, type Uebertritte, adresse, bundeslandOf, hatStandort, katFarbe, kurzName } from '../lib/types';
import { distanceM, fmtDist } from '../lib/geo';
import { adresseSuchen } from '../lib/geocode';
import { SuchIndex } from '../lib/search';
import {
  type Bewertet, type Eingabe, type Interesse, type Kandidat, type Kontext, type Messung, type Messwerte, type Start,
  type Szenario, type Wunsch, type Ziel, FORM_LABEL, STUFE_ALTER, benoetigteFormen, bestenWeg, kandidaten, rangliste,
  setzeKleineWechsel, stufeVon, szenarien, formenVon, KINDER_FAKTOR,
} from '../lib/planer';
import { type Route, naechsterHalt, route, schulwegCheck, zeiten } from '../lib/wege';
import { klassenAmPunkt, einzugMoeglich } from '../lib/einzug';
import { stroeme, stroemeSvg } from '../lib/stroeme';
import { type Termin, einschulungsjahr, kalender, zeitachse } from '../lib/fristen';
import { $, base, el, loadErgebnisse, loadKern, loadUebertritte, loadUebertritteKlein, loadDetails, sucheAnbinden, standortErmitteln } from './shared';
import { speichere, MAX_AUSWAHL } from './auswahl';
import { beiThemeWechsel, istDunkel } from './theme';

type S = Schule & { lon: number; lat: number };
type TdotDaten = { stand: string; schulen: Record<string, { d: string; z?: string; t: string; q: string }[]> };

const form = $<HTMLFormElement>('bwForm');
const adresseEl = $<HTMLInputElement>('bwAdresse');
const goBtn = $<HTMLButtonElement>('bwGo');
const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Daten ---------- */
const daten = Promise.all([loadKern(), loadUebertritte(), loadErgebnisse(), loadUebertritteKlein()]).then(([kern, ue, erg, klein]) => {
  const zu: Record<string, Record<string, string[]>> = {};
  // Namen der kleinen Wechsel liegen je Schulstufe vor: { von: { stufe: [skz] } }
  for (const [von, je] of Object.entries(klein.aus)) zu[von] = je;
  setzeKleineWechsel(zu);
  const schulen = kern.schulen.filter(hatStandort) as S[];
  return { kern, ue: ue as Uebertritte, erg, schulen, byId: new Map(kern.schulen.map((s) => [s.skz, s])), index: new SuchIndex(kern.schulen) };
});
let tdot: Promise<TdotDaten | null> | null = null;
const ladeTdot = () => (tdot ??= fetch(`${base}data/tdot.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

/* ---------- Formular ---------- */
let gewaehlterOrt: { lon: number; lat: number; label: string } | null = null;
let aktuelleSchule: Schule | undefined;
let wunschSchulen: Schule[] = [];

const wert = (name: string) => (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '');
const werte = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);

function eingabe(): Eingabe {
  return {
    start: wert('start') as Start,
    ziel: wert('ziel') as Ziel,
    wuensche: new Set(werte('wunsch') as Wunsch[]),
    interessen: new Set(werte('interesse') as Interesse[]),
    privat: werte('rahmen').includes('privat'),
    ohneBonus: werte('rahmen').includes('ohneBonus'),
    wunsch: [...wunschSchulen],
    aktuell: wert('start') === 'vs' ? undefined : aktuelleSchule,
  };
}

const aktuellFeld = $('bwAktuellFeld');
form.addEventListener('change', (e) => {
  if ((e.target as HTMLInputElement).name === 'start') aktuellFeld.hidden = wert('start') === 'vs';
});

daten.then((d) => {
  sucheAnbinden({
    input: $<HTMLInputElement>('bwAktuell'),
    list: $('bwAktuellListe'),
    index: () => d.index,
    onPick: (v) => {
      if (v.kind === 'schule') aktuelleSchule = v.schule;
    },
  });
  document.querySelectorAll('[data-schuljahr]').forEach((n) => (n.textContent = d.kern.schuljahr));
  // Nur Schulen vorschlagen; gängige Kürzel, die nicht im amtlichen Namen stehen, werden übersetzt
  const KUERZEL: [RegExp, string][] = [[/\bkph\b/i, 'Kirchlichen Pädagogischen Hochschule'], [/\bphw?\b/i, 'Pädagogischen Hochschule']];
  const nurSchulen = {
    vorschlaege: (q: string) => {
      let t = q;
      for (const [re, ersatz] of KUERZEL) t = t.replace(re, ersatz);
      // Treffer, bei denen ein Wort mit der Eingabe beginnt (z. B. "TGM"), stehen vorne
      const wort = new RegExp(`(^|[^\\p{L}\\d])${t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
      const l = d.index.vorschlaege(t).filter((v) => v.kind === 'schule');
      // je früher das Wort im Namen steht, desto weiter vorne ("TGM …" vor "… Kooperationen (TU, TGM)")
      const pos = (v: (typeof l)[number]) => v.label.search(wort);
      return l.map((v, i) => ({ v, i, p: pos(v) < 0 ? 1e6 : pos(v) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.v);
    },
  } as unknown as SuchIndex;
  const wunschInput = $<HTMLInputElement>('bwWunsch');
  sucheAnbinden({
    input: wunschInput,
    list: $('bwWunschListe'),
    index: () => nurSchulen,
    adresse: false,
    onPick: (v) => {
      if (v.kind !== 'schule' || wunschSchulen.some((w) => w.skz === v.schule.skz)) return;
      wunschSchulen.push(v.schule);
      wunschInput.value = '';
      zeigeWunschChips();
    },
  });
});
$<HTMLInputElement>('bwAktuell').addEventListener('input', () => (aktuelleSchule = undefined));

/** Gewählte Wunschschulen als Chips mit Schulart und Entfernen-Knopf. */
function zeigeWunschChips() {
  void daten.then((d) => {
    $('bwWunschChips').replaceChildren(
      ...wunschSchulen.map((w) => {
        const formen = [...formenVon(w, d.ue)].map((f) => FORM_LABEL[f]).join(', ') || 'Schulart ohne Planer-Stufe';
        const x = el('button', { type: 'button', class: 'bw-wunsch-x', textContent: '×' });
        x.setAttribute('aria-label', `${w.name} entfernen`);
        x.addEventListener('click', () => {
          wunschSchulen = wunschSchulen.filter((y) => y.skz !== w.skz);
          zeigeWunschChips();
        });
        const chip = el('span', { class: 'bw-wunsch-chip' }, el('span', {}, el('b', { textContent: kurzName(w.name, 50) }), el('small', { textContent: formen })), x);
        chip.style.setProperty('--kat', katFarbe(w.kat));
        return chip;
      }),
    );
  });
}

const standortEl = $('bwStandort');
$('bwLocate').addEventListener('click', async () => {
  standortEl.hidden = false;
  standortEl.textContent = 'Standort wird ermittelt …';
  try {
    const p = await standortErmitteln();
    gewaehlterOrt = { ...p, label: 'Euer Standort' };
    adresseEl.value = '';
    adresseEl.placeholder = 'Euer Standort (GPS)';
    standortEl.textContent = '✓ Standort übernommen. Ihr könnt auch eine Adresse eingeben.';
  } catch (err) {
    standortEl.textContent = (err as Error).message;
  }
});
adresseEl.addEventListener('input', () => {
  gewaehlterOrt = null;
  adresseEl.placeholder = 'Straße, Hausnummer, Ort';
  standortEl.hidden = true;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = adresseEl.value.trim();
  if (!gewaehlterOrt && text.length < 3) {
    adresseEl.focus();
    standortEl.hidden = false;
    standortEl.textContent = 'Bitte gebt eure Adresse ein, zum Beispiel „Mozartstraße 5, Linz“, oder verwendet den Standort-Knopf.';
    return;
  }
  goBtn.disabled = true;
  try {
    let ort = gewaehlterOrt;
    if (!ort) {
      standortEl.hidden = false;
      standortEl.textContent = 'Adresse wird gesucht …';
      const t = await adresseSuchen(text);
      if (!t) {
        standortEl.textContent = 'Diese Adresse wurde nicht gefunden. Prüft Schreibweise und Ort.';
        return;
      }
      ort = { lon: t.lon, lat: t.lat, label: text };
      standortEl.hidden = true;
    }
    await planen(ort);
  } catch {
    standortEl.hidden = false;
    standortEl.textContent = 'Die Adresssuche ist gerade nicht erreichbar. Versucht es später noch einmal.';
  } finally {
    goBtn.disabled = false;
  }
});

/* ---------- Fortschritt ---------- */
const SCHRITTE = [
  'Schulen in eurer Umgebung finden',
  'Echte Geh- und Radzeiten berechnen',
  'Haltestellen an den Schulen suchen',
  'Schulwege auf Hauptstraßen prüfen',
  'Kinder aus eurer Nachbarschaft zählen',
  'Wege zusammenstellen',
] as const;
function zeigeFortschritt(i: number, info?: string) {
  const ol = $('bwSchritte');
  if (!ol.children.length) ol.replaceChildren(...SCHRITTE.map((t) => el('li', {}, el('span', { class: 'bw-haken' }), el('span', { class: 't', textContent: t }), el('small', {}))));
  [...ol.children].forEach((li, j) => {
    li.classList.toggle('fertig', j < i);
    li.classList.toggle('aktiv', j === i);
    if (j === i && info !== undefined) li.querySelector('small')!.textContent = info;
  });
}

/** Führt Aufgaben mit begrenzter Parallelität aus. */
async function parallel<T>(liste: T[], n: number, fn: (x: T) => Promise<void>) {
  const it = liste[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => {
    for (let r = it.next(); !r.done; r = it.next()) await fn(r.value).catch(() => undefined);
  }));
}

/* ---------- Planen ---------- */
type Plan = {
  heim: { lon: number; lat: number; label: string };
  e: Eingabe;
  k: Kontext;
  kand: Kandidat[];
  mw: Messwerte;
  routen: Map<string, Route>;
  stellen: Map<string, [number, number][]>;
  fest: Record<string, string>;
  liste: Szenario[];
  aktiv: number;
  hinweise: string[];
};
let plan: Plan | null = null;
if (import.meta.env.DEV) (window as unknown as { __bw: () => unknown }).__bw = () => plan;

async function planen(heim: { lon: number; lat: number; label: string }) {
  const d = await daten;
  const e = eingabe();
  $('bwErgebnis').hidden = true;
  $('bwLaden').hidden = false;
  $('bwSchritte').replaceChildren();
  $('bwLaden').scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'start' });
  const hinweise: string[] = [];

  zeigeFortschritt(0);
  const kand = kandidaten(d.schulen, d.ue, heim, benoetigteFormen(e), e);
  const schulen = [...new Map(kand.map((c) => [c.s.skz, c.s])).values()];
  zeigeFortschritt(0, `${schulen.length} Schulen im Umkreis`);
  const mw: Messwerte = new Map(kand.map((c) => [c.s.skz, { luftM: c.luftM } as Messung]));

  // Geh- und Radzeiten
  zeigeFortschritt(1);
  // nacheinander: der öffentliche Server mag keine zwei großen Abfragen gleichzeitig
  try {
    // zu Fuß nur in Gehweite, mit dem Rad bis 20 km (weiter weg zählen Öffis)
    const nahe = schulen.filter((s) => mw.get(s.skz)!.luftM <= 5000);
    const fuss = await zeiten('foot', heim, nahe);
    nahe.forEach((s, i) => fuss[i] !== null && (mw.get(s.skz)!.fussMin = fuss[i]!));
    zeigeFortschritt(1, 'zu Fuß: aus OpenStreetMap');
    const radbar = schulen.filter((s) => mw.get(s.skz)!.luftM <= 20000);
    const rad = await zeiten('bike', heim, radbar).catch(() => null);
    if (rad) radbar.forEach((s, i) => rad[i] !== null && (mw.get(s.skz)!.radMin = rad[i]!));
    zeigeFortschritt(1, rad ? 'zu Fuß und mit dem Rad: aus OpenStreetMap' : 'zu Fuß: aus OpenStreetMap, Rad geschätzt');
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Routing', err);
    hinweise.push('Das Routing war nicht erreichbar, die Zeiten sind aus der Luftlinie geschätzt.');
  }

  const k: Kontext = { heim, ue: d.ue, ergebnisse: d.erg.daten };
  // Die besten Kandidaten je Form genauer prüfen
  const formen = [...new Set(kand.map((c) => c.form))];
  const top = new Map<string, Kandidat>();
  // Wunschschule der nächsten Stufe: davor zählen Schulen, von denen Kinder dorthin wechseln
  const naechste = (f: string) => {
    const ziel = f === 'vs' ? ['ms', 'ahsU'] : f === 'ms' || f === 'ahsU' ? ['ahsO', 'bhs', 'bms', 'pts'] : [];
    return e.wunsch.find((w) => [...formenVon(w, d.ue)].some((x) => ziel.includes(x)));
  };
  for (const f of formen) {
    const n = f === 'vs' ? 4 : f === 'ms' || f === 'ahsU' ? 3 : f === 'bhs' ? 5 : 3;
    for (const b of rangliste(kand, f, mw, e, k, e.aktuell, naechste(f)).slice(0, n)) top.set(b.s.skz, kand.find((c) => c.s.skz === b.s.skz)!);
  }
  for (const c of kand) if (e.wunsch.some((w) => w.skz === c.s.skz)) top.set(c.s.skz, c);

  // Haltestellen
  zeigeFortschritt(2);
  try {
    k.heimHalt = await naechsterHalt(heim);
  } catch { /* ohne Haltestellen */ }
  let mitHalt = 0;
  await parallel([...top.values()], 4, async (c) => {
    const h = await naechsterHalt(c.s);
    mw.get(c.s.skz)!.halt = h;
    if (h) mitHalt++;
    zeigeFortschritt(2, `${mitHalt} Schulen mit Haltestelle in der Nähe`);
  });

  // Schulweg-Check für die Schulen, zu denen Kinder zu Fuß gehen
  zeigeFortschritt(3);
  const routen = new Map<string, Route>();
  const stellen = new Map<string, [number, number][]>();
  const zuFuss = [...top.values()].filter((c) => stufeVon(c.form) !== 'sek2' && (mw.get(c.s.skz)!.fussMin ?? (c.luftM * 1.3) / 75) <= 40);
  let geprueft = 0;
  // Einzeln und mit kurzer Pause (Nutzungsregeln des öffentlichen Servers), höchstens 25 Sekunden.
  // Die Schulen mit der besten Passung kommen zuerst dran.
  const bis = performance.now() + 25000;
  let abgelehnt = false;
  await parallel(zuFuss, 1, async (c) => {
    if (abgelehnt || performance.now() > bis) return;
    const r = await route('foot', heim, c.s);
    await new Promise((res) => setTimeout(res, 250));
    if (!r) {
      abgelehnt = true;
      hinweise.push('Nicht alle Schulwege konnten geprüft werden, der Routing-Server ist gerade ausgelastet.');
      return;
    }
    routen.set(c.s.skz, r);
    const chk = await schulwegCheck(r);
    mw.get(c.s.skz)!.sicher = { querungen: chk.querungen, entlangM: chk.entlangM };
    stellen.set(c.s.skz, chk.stellen);
    zeigeFortschritt(3, `${++geprueft} von ${zuFuss.length} Schulwegen geprüft`);
  });

  // Nachbarschaft
  zeigeFortschritt(4);
  const nachbar = [...top.values()].filter((c) => stufeVon(c.form) !== 'sek2' && einzugMoeglich(c.s));
  let mitKindern = 0;
  await parallel(nachbar, 4, async (c) => {
    const p = await klassenAmPunkt(c.s.skz, heim.lon, heim.lat);
    const n = p.zelle >= 0 ? { klasse: p.zelle, umgebung: false } : p.umgebung >= 0 ? { klasse: p.umgebung, umgebung: true } : { klasse: -1, umgebung: false };
    mw.get(c.s.skz)!.nachbarn = n;
    if (n.klasse >= 0) mitKindern++;
    zeigeFortschritt(4, `${mitKindern} Schulen mit Kindern aus eurer Gegend`);
  });

  zeigeFortschritt(5);
  const liste = szenarien(kand, mw, e, k);
  zeigeFortschritt(6);
  plan = { heim, e, k, kand, mw, routen, stellen, fest: {}, liste, aktiv: 0, hinweise };
  schreibeHash();
  await new Promise((r) => setTimeout(r, reduziert ? 0 : 350));
  $('bwLaden').hidden = true;
  zeigeErgebnis();
}

/* ---------- Ergebnis ---------- */
const ICON = {
  fuss: '<svg class="ico" viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 3"/></svg>',
  rad: '<svg class="ico" viewBox="0 0 24 24"><circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16 10 8h5l3 8M10 8 9 5H7M12 16l3-8"/></svg>',
  oeffi: '<svg class="ico" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l1.5-4M16 21l-1.5-4"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/></svg>',
  gut: '<svg class="ico" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  warn: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  info: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></svg>',
  ziel: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M6 10.5V16c2 2 10 2 12 0v-5.5"/><path d="M22 8v6"/></svg>',
  kalender: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  play: '<svg class="ico" viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
};
const span = (cls: string, html: string) => Object.assign(el('span', { class: cls }), { innerHTML: html });
const minText = (m: number) => `${Math.max(1, Math.round(m))} min`;

function zeigeErgebnis() {
  if (!plan) return;
  const p = plan;
  $('bwErgebnis').hidden = false;
  $('bwResOrt').textContent = p.heim.label === 'Euer Standort' ? 'Ab eurem Standort' : `Ab ${p.heim.label}`;
  $('bwResTitel').textContent = p.liste.length
    ? `${p.liste.length} realistische ${p.liste.length === 1 ? 'Weg' : 'Wege'} für euer Kind`
    : 'Keine passenden Wege gefunden';
  zeigeWahl();
  zeigeWeg();
  void zeigeKarte();
  $('bwErgebnis').scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'start' });
}

function ring(prozent: number) {
  const r = 20;
  const u = 2 * Math.PI * r;
  return `<svg class="bw-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="${r}" class="bw-ring-bg"/><circle cx="24" cy="24" r="${r}" class="bw-ring-fg" stroke-dasharray="${u}" stroke-dashoffset="${u * (1 - prozent / 100)}" style="--u:${u}"/></svg><b>${prozent}</b>`;
}

function zeigeWahl() {
  const p = plan!;
  const wahl = $('bwWahl');
  wahl.replaceChildren(
    ...p.liste.map((sz, i) => {
      const b = el('button', { type: 'button', class: 'bw-tab' + (i === p.aktiv ? ' on' : '') });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === p.aktiv));
      const kette = sz.schritte.filter((s) => !s.bleibt).map((s) => kurzName(s.wahl!.s.name, 22));
      b.append(
        ...(i === 0
          ? [el('span', { class: 'bw-tab-tipp', textContent: sz.wuensche === p.e.wunsch.length && sz.wuensche ? (sz.wuensche > 1 ? 'Mit allen Wunschschulen' : 'Mit eurer Wunschschule') : 'Unser Vorschlag' })]
          : []),
        span('bw-tab-ring', ring(sz.passung)),
        el('span', { class: 'bw-tab-t', textContent: sz.titel }),
        el('span', { class: 'bw-tab-s', textContent: `${sz.abschluss} mit ${sz.alterEnde}` }),
        el('span', { class: 'bw-tab-kette', textContent: kette.join(' → ') }),
      );
      b.style.setProperty('--i', String(i));
      b.addEventListener('click', () => {
        p.aktiv = i;
        zeigeWahl();
        zeigeWeg();
        void zeigeKarte();
      });
      return b;
    }),
  );
  if (!p.liste.length) {
    wahl.replaceChildren(el('p', { class: 'hint', textContent: 'Im Umkreis gibt es keine Schulen für diese Auswahl. Wählt einen anderen Abschluss, bezieht Privatschulen ein oder lasst Chancenbonus-Schulen zu.' }));
  }
}

function wegChips(b: Bewertet) {
  const p = plan!;
  const stufe = stufeVon(b.form);
  const m = b.m;
  const chips: HTMLElement[] = [];
  const fuss = (m.fussMin ?? (m.luftM * 1.3) / 75) * (stufe === 'vs' ? KINDER_FAKTOR : 1);
  const chip = (icon: string, text: string, aktiv: boolean, title: string) => {
    const c = span('bw-chip' + (aktiv ? ' an' : ''), icon);
    c.append(text);
    c.title = title;
    return c;
  };
  chips.push(chip(ICON.fuss, minText(fuss), b.weg.mittel === 'fuss', m.fussMin !== undefined ? 'Gehzeit laut OpenStreetMap' : 'Gehzeit geschätzt'));
  if (stufe !== 'vs') chips.push(chip(ICON.rad, minText(m.radMin ?? (m.luftM * 1.3) / 250), b.weg.mittel === 'rad', 'Radzeit laut OpenStreetMap'));
  if (b.weg.mittel === 'oeffi') chips.push(chip(ICON.oeffi, `ca. ${minText(b.weg.min)}`, true, 'Öffi-Zeit grob geschätzt'));
  else if (m.halt && stufe !== 'vs') chips.push(chip(ICON.oeffi, fmtDist(m.halt.m), false, `${m.halt.art}${m.halt.name ? ` ${m.halt.name}` : ''}`));
  void p;
  return el('div', { class: 'bw-chips' }, ...chips);
}

function gruendeListe(b: Bewertet) {
  return el(
    'ul',
    { class: 'bw-gruende' },
    ...b.gruende
      .filter((g) => g.art !== 'weg')
      .map((g) => {
        const li = el('li', { class: g.gut === true ? 'gut' : g.gut === false ? 'schlecht' : 'neutral' });
        li.innerHTML = g.gut === true ? ICON.gut : g.gut === false ? ICON.warn : ICON.info;
        li.append(g.text);
        return li;
      }),
  );
}

const DATUM = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONAT = new Intl.DateTimeFormat('de-AT', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDatum = (d: string) => DATUM.format(new Date(`${d}T00:00:00Z`));

async function tdotZeile(s: Schule, box: HTMLElement) {
  const [t, det] = await Promise.all([ladeTdot(), loadDetails().catch(() => ({}) as Record<string, { web?: string }>)]);
  const liste: TdotDaten['schulen'][string] = (t as TdotDaten | null)?.schulen[s.skz] ?? [];
  const heute = new Date().toISOString().slice(0, 10);
  const kommend = liste.filter((x) => x.d >= heute);
  const web = det[s.skz]?.web;
  const href = web ? (/^https?:/.test(web) ? web : `https://${web}`) : null;
  box.replaceChildren();
  box.innerHTML = ICON.kalender;
  if (kommend.length) {
    const n = kommend[0];
    box.classList.add('an');
    box.append(el('span', {}, el('b', { textContent: 'Tag der offenen Tür: ' }), `${fmtDatum(n.d)}${n.z ? `, ${n.z} Uhr` : ''} `), el('a', { href: n.q, target: '_blank', rel: 'noopener', textContent: 'Quelle' }));
  } else if (liste.length) {
    const n = liste[liste.length - 1];
    box.append(el('span', {}, el('b', { textContent: 'Tag der offenen Tür: ' }), `zuletzt ${fmtDatum(n.d)}, heuer vermutlich ähnlich. `), ...(href ? [el('a', { href, target: '_blank', rel: 'noopener', textContent: 'Website' })] : []));
  } else if (href) {
    box.append(el('span', {}, 'Tag der offenen Tür: '), el('a', { href, target: '_blank', rel: 'noopener', textContent: 'Termin auf der Website prüfen' }));
  } else box.remove();
}

function stufenKarte(sz: Szenario, i: number) {
  const p = plan!;
  const schritt = sz.schritte[i];
  const b = schritt.wahl!;
  const li = el('li', { class: 'bw-stufe' + (schritt.bleibt ? ' bleibt' : '') });
  li.style.setProperty('--kat', katFarbe(b.s.kat));
  li.style.setProperty('--i', String(i));
  li.append(el('div', { class: 'bw-alter', textContent: schritt.bleibt ? '14–18 Jahre' : STUFE_ALTER[schritt.stufe] }), el('div', { class: 'bw-knoten' }));
  const karte = el('div', { class: 'bw-karte-s' });
  if (schritt.bleibt) {
    karte.append(el('p', { class: 'bw-schulart', textContent: schritt.titel }), el('p', { class: 'bw-bleibt', textContent: `Bleibt am ${kurzName(b.s.name, 60)}: Oberstufe an derselben Schule, ohne neue Anmeldung.` }));
    li.append(karte);
    return li;
  }
  const istWunsch = p.e.wunsch.some((w) => w.skz === b.s.skz);
  if (istWunsch) li.classList.add('wunsch');
  const kopf = el('div', { class: 'bw-s-kopf' },
    el('div', {},
      ...(istWunsch ? [el('span', { class: 'bw-wunsch-badge', textContent: '★ Eure Wunschschule' })] : []),
      el('p', { class: 'bw-schulart', textContent: `${schritt.titel}${b.form === 'ahsU' ? '' : ''}` }),
      el('h3', {}, el('a', { href: `${base}schule/${b.s.skz}/`, textContent: kurzName(b.s.name, 80) })),
      el('p', { class: 'bw-adr', textContent: `${adresse(b.s)} · ${fmtDist(b.m.luftM)} Luftlinie` }),
    ),
    span('bw-match', ring(b.passung)),
  );
  karte.append(kopf, wegChips(b), gruendeListe(b));

  const aktionen = el('div', { class: 'bw-s-aktionen' });
  if (p.routen.has(b.s.skz)) {
    const ab = span('btn small bw-play', ICON.play);
    ab.append('Schulweg ansehen');
    ab.setAttribute('role', 'button');
    ab.tabIndex = 0;
    ab.addEventListener('click', () => void spieleSchulweg(b.s));
    aktionen.append(ab);
  }
  const oeffi = el('a', {
    class: 'btn small',
    href: `https://www.google.com/maps/dir/?api=1&origin=${p.heim.lat.toFixed(5)},${p.heim.lon.toFixed(5)}&destination=${b.s.lat},${b.s.lon}&travelmode=transit`,
    target: '_blank',
    rel: 'noopener',
    textContent: 'Öffi-Verbindung prüfen',
  });
  aktionen.append(oeffi);
  karte.append(aktionen);
  const tdotBox = el('p', { class: 'bw-tdot' });
  karte.append(tdotBox);
  void tdotZeile(b.s, tdotBox);

  if (schritt.alternativen.length) {
    const det = el('details', { class: 'bw-alt' }, el('summary', { textContent: `${schritt.alternativen.length} Alternativen` }));
    const ul = el('ul', {});
    for (const a of schritt.alternativen) {
      const w = bestenWeg(stufeVon(a.form), a.m, p.k);
      const btn = el('button', { type: 'button', class: 'btn small', textContent: 'Wählen' });
      btn.addEventListener('click', () => {
        p.fest[`${sz.id}:${schritt.stufe}`] = a.s.skz;
        // spätere Stufen neu wählen lassen (die Übertritte ändern sich)
        for (const k of Object.keys(p.fest)) if (k.startsWith(`${sz.id}:`) && stufenRang(k.split(':')[1]) > stufenRang(schritt.stufe)) delete p.fest[k];
        const id = sz.id;
        p.liste = szenarien(p.kand, p.mw, p.e, p.k, p.fest);
        p.aktiv = Math.max(0, p.liste.findIndex((x) => x.id === id));
        zeigeWahl();
        zeigeWeg();
        void zeigeKarte();
      });
      ul.append(
        el('li', { style: `--kat:${katFarbe(a.s.kat)}` },
          el('span', { class: 'bw-alt-p', textContent: `${a.passung}` }),
          el('span', { class: 'bw-alt-t' }, el('a', { href: `${base}schule/${a.s.skz}/`, textContent: kurzName(a.s.name, 60) }), el('small', { textContent: `${minText(w.min)} ${{ fuss: 'zu Fuß', rad: 'mit dem Rad', oeffi: 'Öffis' }[w.mittel]} · ${a.gruende.filter((g) => g.gut === true && g.art !== 'weg').map((g) => g.text).slice(0, 2).join(' · ')}` })),
          btn,
        ),
      );
    }
    det.append(ul);
    karte.append(det);
  }
  li.append(karte);
  return li;
}
const stufenRang = (s: string) => ['vs', 'sek1', 'sek2'].indexOf(s);

function zeigeWeg() {
  const p = plan!;
  const ol = $('bwWeg');
  const sz = p.liste[p.aktiv];
  if (!sz) {
    ol.replaceChildren();
    return;
  }
  const ziel = el('li', { class: 'bw-stufe bw-ziel' });
  ziel.style.setProperty('--i', String(sz.schritte.length));
  ziel.append(
    el('div', { class: 'bw-alter', textContent: `mit ${sz.alterEnde}` }),
    span('bw-knoten', ICON.ziel),
    el('div', { class: 'bw-karte-s' }, el('p', { class: 'bw-schulart', textContent: 'Abschluss' }), el('h3', { textContent: sz.abschluss }), el('p', { class: 'bw-adr', textContent: sz.abschlussInfo })),
  );
  const kopf = el('li', { class: 'bw-weg-kopf' },
    el('h3', { textContent: sz.titel }),
    el('p', { class: 'muted', textContent: sz.untertitel }),
  );
  const vergleich = el('button', { type: 'button', class: 'btn small', textContent: 'Schulen dieses Wegs vergleichen' });
  vergleich.addEventListener('click', () => {
    const skz = [...new Set(sz.schritte.filter((s) => !s.bleibt).map((s) => s.wahl!.s.skz))].slice(0, MAX_AUSWAHL);
    speichere(skz);
    location.href = `${base}vergleich/?sel=${skz.join(',')}&cmp=1`;
  });
  kopf.append(vergleich);
  const fehlend = p.e.wunsch.filter((w) => !p.liste.some((x) => x.schritte.some((st) => st.wahl?.s.skz === w.skz)));
  const fehlText = fehlend.map((w) => `„${kurzName(w.name, 50)}“ passt zu keinem der Wege für diese Ausgangslage (Schulart oder Stufe).`);
  ol.replaceChildren(kopf, ...sz.schritte.map((_, i) => stufenKarte(sz, i)), ziel, ...[...p.hinweise, ...fehlText].map((h) => el('li', { class: 'hint', textContent: h })));
  zeigeStroeme(sz);
  void zeigeZeitachse(sz);
}

/* ---------- Übertritts-Ströme ---------- */
async function zeigeStroeme(sz: Szenario) {
  const d = await daten;
  const box = $('bwStroemeInhalt');
  const teile: HTMLElement[] = [];
  const quellen: [Schule, Schule | undefined][] = [];
  const schritte = sz.schritte.filter((s) => !s.bleibt);
  if (plan!.e.aktuell) quellen.push([plan!.e.aktuell, schritte[0]?.wahl?.s]);
  schritte.forEach((s, i) => quellen.push([s.wahl!.s, schritte[i + 1]?.wahl?.s]));
  for (const [von, nach] of quellen) {
    const aus = d.ue.aus[von.skz] ?? [];
    const wechsel = aus.flatMap((u) => (d.byId.has(u[0]) ? [{ ziel: d.byId.get(u[0])!, n: u[1] }] : []));
    // je Zielschule zusammenfassen (mehrere Schulstufen)
    const je = new Map<string, { ziel: Schule; n: number }>();
    for (const w of wechsel) je.set(w.ziel.skz, { ziel: w.ziel, n: (je.get(w.ziel.skz)?.n ?? 0) + w.n });
    if (!je.size) continue;
    const svg = stroemeSvg(kurzName(von.name, 34), stroeme([...je.values()], (s) => `${base}schule/${s.skz}/`, von.skz));
    const fig = el('figure', { class: 'bw-strom' });
    fig.innerHTML = svg;
    if (nach) fig.querySelector(`a[data-skz="${nach.skz}"]`)?.closest('text')?.classList.add('sk-wahl');
    const summe = [...je.values()].reduce((a, w) => a + w.n, 0);
    fig.prepend(el('figcaption', {}, el('b', { textContent: kurzName(von.name, 60) }), ` · ${summe} Kinder mit ausgewiesenem Wechsel`));
    teile.push(fig);
  }
  $('bwStroeme').hidden = teile.length === 0;
  box.replaceChildren(...teile);
}

/* ---------- Zeitachse ---------- */
let termine: Termin[] = [];
function startJahr(e: Eingabe): { jahr: number; annahme: boolean } {
  const g = $<HTMLInputElement>('bwGeburt').value;
  if (/^\d{4}-\d{2}$/.test(g)) {
    const [j, m] = g.split('-').map(Number);
    return { jahr: einschulungsjahr({ jahr: j, monat: m }), annahme: false };
  }
  const jetzt = new Date();
  const naechster = jetzt.getMonth() + 1 <= 8 ? jetzt.getFullYear() : jetzt.getFullYear() + 1;
  return { jahr: e.start === 'vs' ? naechster : e.start === 'sek1' ? naechster - 4 : naechster - 8, annahme: true };
}

async function zeigeZeitachse(sz: Szenario) {
  const p = plan!;
  const t = await ladeTdot();
  const { jahr, annahme } = startJahr(p.e);
  const erste = sz.schritte[0].wahl!.s;
  const sek2 = sz.schritte.find((s) => s.stufe === 'sek2');
  const art = sek2?.bleibt ? 'bleibt' : (sek2?.form as 'bhs' | 'ahsO' | 'bms' | 'pts') ?? 'bleibt';
  termine = zeitachse({
    start: jahr,
    bundesland: erste.skz[0],
    ab: p.e.start,
    sek2: art === ('ahsU' as string) ? 'bleibt' : art,
    jahreBisAbschluss: sz.id === 'bhs' ? 13 : sz.id === 'fach' ? 11 : 12,
    abschluss: sz.abschluss,
    schulen: sz.schritte.filter((s) => !s.bleibt).map((s) => ({ stufe: s.stufe, name: kurzName(s.wahl!.s.name, 40), tdot: t?.schulen[s.wahl!.s.skz] })),
  });
  const bl = bundeslandOf(erste);
  $('bwZeitInfo').textContent = annahme
    ? `Angenommen: nächster Wechsel im Herbst ${p.e.start === 'vs' ? jahr : p.e.start === 'sek1' ? jahr + 4 : jahr + 8}. Mit Geburtsmonat im Formular wird es genau. Ferien und Schulbeginn für ${bl}.`
    : `Schulstart ${jahr}. Ferien und Schulbeginn für ${bl}.`;
  const ol = $('bwZeitachse');
  let letztesJahr = '';
  const items: HTMLElement[] = [];
  for (const x of termine) {
    const j = x.von.slice(0, 4);
    if (j !== letztesJahr) {
      items.push(el('li', { class: 'bw-jahr', textContent: j }));
      letztesJahr = j;
    }
    const wann = x.von === x.bis ? fmtDatum(x.von) : `${MONAT.format(new Date(`${x.von}T00:00:00Z`))} – ${MONAT.format(new Date(`${x.bis}T00:00:00Z`))}`;
    const plusK = el('button', { type: 'button', class: 'icon-btn bw-plus', title: 'In den Kalender' });
    plusK.innerHTML = ICON.kalender;
    plusK.setAttribute('aria-label', `${x.titel} in den Kalender`);
    plusK.addEventListener('click', () => ladeKalender([x], x.titel));
    items.push(
      el('li', { class: `bw-termin ${x.art}` },
        el('span', { class: 'bw-t-punkt' }),
        el('div', { class: 'bw-t-text' },
          el('span', { class: 'bw-t-wann', textContent: `${wann}${x.zeit ? `, ${x.zeit} Uhr` : ''}` }),
          el('b', { textContent: x.titel }),
          ...(x.info ? [el('small', { textContent: x.info })] : []),
          ...(x.quelle ? [el('a', { href: x.quelle, target: '_blank', rel: 'noopener', textContent: 'Quelle: Website der Schule' })] : []),
        ),
        plusK,
      ),
    );
  }
  ol.replaceChildren(...items);
}

function ladeKalender(liste: Termin[], name: string) {
  const blob = new Blob([kalender(liste)], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${name.replace(/[^\wäöüÄÖÜß -]/g, '').slice(0, 40) || 'termine'}.ics` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
$('bwIcs').addEventListener('click', () => ladeKalender(termine, 'Bildungsweg'));

/* ---------- Karte mit Schulweg-Animation ---------- */
let karte: KarteTyp | null = null;
let maplibre: typeof import('maplibre-gl') | null = null;
let marker: Marker[] = [];
let laufAnimation = 0;

async function karteBereit(): Promise<KarteTyp> {
  if (karte) return karte;
  maplibre = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  maplibre.setWorkerUrl(`${base}maplibre/maplibre-gl-worker.mjs`);
  const dunkel = istDunkel();
  const k = new maplibre.Map({
    container: 'bwKarte',
    style: {
      version: 8,
      sources: { bm: { type: 'raster', tiles: ['https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png'], tileSize: 256, maxzoom: 19, attribution: 'Grundkarte: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a> · Wege: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
      layers: [{ id: 'bm', type: 'raster', source: 'bm', paint: { 'raster-brightness-min': dunkel ? 1 : 0, 'raster-brightness-max': dunkel ? 0.12 : 1, 'raster-saturation': dunkel ? -1 : -0.35 } }],
    },
    center: [plan!.heim.lon, plan!.heim.lat],
    zoom: 13,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
  });
  k.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
  beiThemeWechsel((d) => {
    if (!k.getLayer('bm')) return;
    k.setPaintProperty('bm', 'raster-brightness-min', d ? 1 : 0);
    k.setPaintProperty('bm', 'raster-brightness-max', d ? 0.12 : 1);
    k.setPaintProperty('bm', 'raster-saturation', d ? -1 : -0.35);
  });
  await new Promise<void>((r) => k.on('load', () => r()));
  const leer = { type: 'FeatureCollection', features: [] } as never;
  k.addSource('verbindungen', { type: 'geojson', data: leer });
  k.addSource('route', { type: 'geojson', data: leer });
  k.addSource('route-fertig', { type: 'geojson', data: leer });
  k.addLayer({ id: 'verbindungen', type: 'line', source: 'verbindungen', paint: { 'line-color': ['get', 'farbe'], 'line-width': 2.5, 'line-dasharray': [1.5, 2], 'line-opacity': 0.8 } });
  k.addLayer({ id: 'route-schatten', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d7a62', 'line-width': 9, 'line-opacity': 0.16 } });
  k.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d7a62', 'line-width': 3, 'line-opacity': 0.45, 'line-dasharray': [0.5, 2] } });
  k.addLayer({ id: 'route-fertig', type: 'line', source: 'route-fertig', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d7a62', 'line-width': 5.5 } });
  karte = k;
  return k;
}

function markerEl(cls: string, html = '') {
  const d = el('div', { class: cls });
  d.innerHTML = html;
  return d;
}

async function zeigeKarte() {
  const p = plan!;
  const sz = p.liste[p.aktiv];
  const k = await karteBereit();
  const ml = maplibre!;
  cancelAnimationFrame(laufAnimation);
  marker.forEach((m) => m.remove());
  marker = [];
  (k.getSource('route') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
  (k.getSource('route-fertig') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
  $('bwHud').hidden = true;
  marker.push(new ml.Marker({ element: markerEl('bw-heim', '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>') }).setLngLat([p.heim.lon, p.heim.lat]).addTo(k));
  if (!sz) return;
  const bounds = new ml.LngLatBounds([p.heim.lon, p.heim.lat], [p.heim.lon, p.heim.lat]);
  const linien: GeoJSON.Feature[] = [];
  sz.schritte.filter((s) => !s.bleibt).forEach((s, i) => {
    const b = s.wahl!;
    const farbe = katFarbe(b.s.kat);
    const m = markerEl('bw-schule', `<span>${i + 1}</span>`);
    m.style.setProperty('--kat', farbe);
    m.title = b.s.name;
    marker.push(new ml.Marker({ element: m }).setLngLat([b.s.lon, b.s.lat]).setPopup(new ml.Popup({ offset: 18, closeButton: false }).setText(`${FORM_LABEL[b.form]}: ${b.s.name}`)).addTo(k));
    linien.push({ type: 'Feature', properties: { farbe }, geometry: { type: 'LineString', coordinates: [[p.heim.lon, p.heim.lat], [b.s.lon, b.s.lat]] } });
    bounds.extend([b.s.lon, b.s.lat]);
  });
  (k.getSource('verbindungen') as GeoJSONSource).setData({ type: 'FeatureCollection', features: linien });
  k.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: reduziert ? 0 : 900 });
  // Der erste Schulweg zu Fuß wird gleich abgespielt
  const erste = sz.schritte.find((s) => !s.bleibt && p.routen.has(s.wahl!.s.skz));
  const knopf = $('bwAbspielen');
  knopf.hidden = !erste;
  if (erste) {
    knopf.onclick = () => void spieleSchulweg(erste.wahl!.s);
    setTimeout(() => void spieleSchulweg(erste.wahl!.s), reduziert ? 0 : 1100);
  }
}

/** Kumulierte Länge entlang der Linie (Meter). */
function laengen(linie: [number, number][]) {
  const l = [0];
  for (let i = 1; i < linie.length; i++) l.push(l[i - 1] + distanceM(linie[i - 1][0], linie[i - 1][1], linie[i][0], linie[i][1]));
  return l;
}

async function spieleSchulweg(s: S) {
  const p = plan!;
  const r = p.routen.get(s.skz);
  if (!r) return;
  const k = await karteBereit();
  const ml = maplibre!;
  cancelAnimationFrame(laufAnimation);
  marker.filter((m) => m.getElement().classList.contains('bw-geher') || m.getElement().classList.contains('bw-querung')).forEach((m) => m.remove());
  marker = marker.filter((m) => !m.getElement().classList.contains('bw-geher') && !m.getElement().classList.contains('bw-querung'));
  document.getElementById('bwKarte')!.scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'nearest' });

  (k.getSource('route') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.linie } });
  const b = new ml.LngLatBounds(r.linie[0], r.linie[0]);
  r.linie.forEach((c) => b.extend(c));
  k.fitBounds(b, { padding: { top: 70, bottom: 90, left: 50, right: 50 }, maxZoom: 17, duration: reduziert ? 0 : 800 });

  const stellen = p.stellen.get(s.skz) ?? [];
  const kum = laengen(r.linie);
  const gesamt = kum[kum.length - 1];
  // Wo auf dem Weg liegen die Querungen? (nächster Linienpunkt)
  const querungen = stellen.map((q) => {
    let best = 0;
    let bd = Infinity;
    r.linie.forEach((c, i) => {
      const d0 = distanceM(c[0], c[1], q[0], q[1]);
      if (d0 < bd) {
        bd = d0;
        best = i;
      }
    });
    const m = new ml.Marker({ element: markerEl('bw-querung', '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>') }).setLngLat(q);
    return { bei: kum[best] / gesamt, m, gezeigt: false };
  });
  const geher = new ml.Marker({ element: markerEl('bw-geher', '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.4"/><path d="M8 21l2.5-6.5L13 17v4M8.5 12 11 8.5h3.5l2.5 3"/><rect x="12.5" y="9" width="4" height="5" rx="1.2"/></svg>') })
    .setLngLat(r.linie[0])
    .addTo(k);
  marker.push(geher, ...querungen.map((q) => q.m));

  const stufe = s.kat === 'vs' ? 'vs' : 'sek1';
  const echteMin = r.min * (stufe === 'vs' ? KINDER_FAKTOR : 1);
  const hud = $('bwHud');
  hud.hidden = false;
  const schreibe = (anteil: number) => {
    const n = querungen.filter((q) => q.gezeigt).length;
    hud.innerHTML = `${ICON.fuss}<span><b>${minText(echteMin * anteil)}</b> von ${minText(echteMin)} · ${fmtDist(gesamt * anteil)}</span><span class="bw-hud-q ${querungen.length ? 'warn' : 'gut'}">${querungen.length === 0 ? `${ICON.gut} keine Hauptstraße` : `${ICON.warn} ${n} von ${querungen.length} ${querungen.length === 1 ? 'Hauptstraße' : 'Hauptstraßen'}`}</span>`;
  };
  const dauer = Math.min(9000, Math.max(4500, echteMin * 450));
  const t0 = performance.now() + (reduziert ? 0 : 850);
  const schritt = (t: number) => {
    const a = reduziert ? 1 : Math.max(0, Math.min(1, (t - t0) / dauer));
    const ziel = a * gesamt;
    let i = 1;
    while (i < kum.length - 1 && kum[i] < ziel) i++;
    const f = kum[i] === kum[i - 1] ? 0 : (ziel - kum[i - 1]) / (kum[i] - kum[i - 1]);
    const pos: [number, number] = [r.linie[i - 1][0] + (r.linie[i][0] - r.linie[i - 1][0]) * f, r.linie[i - 1][1] + (r.linie[i][1] - r.linie[i - 1][1]) * f];
    geher.setLngLat(pos);
    (k.getSource('route-fertig') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...r.linie.slice(0, i), pos] } });
    for (const q of querungen) {
      if (!q.gezeigt && a >= q.bei) {
        q.gezeigt = true;
        q.m.addTo(k);
      }
    }
    schreibe(a);
    if (a < 1) laufAnimation = requestAnimationFrame(schritt);
    else geher.getElement().classList.add('angekommen');
  };
  laufAnimation = requestAnimationFrame(schritt);
}

/* ---------- Teilen (Link ohne Adresse, Koordinaten auf etwa 100 m gerundet) ---------- */
function schreibeHash() {
  const p = plan!;
  const h = new URLSearchParams({
    p: `${p.heim.lat.toFixed(3)},${p.heim.lon.toFixed(3)}`,
    s: p.e.start,
    z: p.e.ziel,
    w: [...p.e.wuensche].join(','),
    i: [...p.e.interessen].join(','),
    r: [p.e.privat ? 'privat' : '', p.e.ohneBonus ? 'ohneBonus' : ''].filter(Boolean).join(','),
  });
  const g = $<HTMLInputElement>('bwGeburt').value;
  if (g) h.set('g', g);
  if (p.e.aktuell) h.set('a', p.e.aktuell.skz);
  if (p.e.wunsch.length) h.set('ws', p.e.wunsch.map((w) => w.skz).join(','));
  history.replaceState(null, '', `#${h}`);
}

$('bwTeilen').addEventListener('click', async () => {
  const btn = $('bwTeilen').querySelector('span')!;
  try {
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Bildungsweg', url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Link kopiert';
      setTimeout(() => (btn.textContent = 'Link teilen'), 2000);
    }
  } catch { /* abgebrochen */ }
});
$('bwNeu').addEventListener('click', () => form.scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth' }));

/** Formular aus dem Link (oder von der Startseite) vorbelegen und gleich rechnen. */
async function start() {
  const h = new URLSearchParams(location.hash.slice(1));
  const setze = (name: string, v: string | null) => {
    if (!v) return;
    const set = new Set(v.split(','));
    form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((i) => (i.checked = i.type === 'radio' ? i.value === v : set.has(i.value)));
  };
  let vonStartseite: string | null = null;
  try {
    vonStartseite = sessionStorage.getItem('schulfinder.bw-adresse');
    sessionStorage.removeItem('schulfinder.bw-adresse');
  } catch { /* egal */ }
  if (vonStartseite) {
    adresseEl.value = vonStartseite;
    form.querySelector('.bw-step:nth-of-type(2)')?.scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  const pos = h.get('p')?.split(',').map(Number);
  if (!pos || pos.length !== 2 || !pos.every(Number.isFinite)) return;
  setze('start', h.get('s'));
  setze('ziel', h.get('z'));
  if (h.has('w')) setze('wunsch', h.get('w') || ' ');
  if (h.has('i')) setze('interesse', h.get('i') || ' ');
  if (h.has('r')) setze('rahmen', h.get('r') || ' ');
  if (h.get('g')) $<HTMLInputElement>('bwGeburt').value = h.get('g')!;
  aktuellFeld.hidden = wert('start') === 'vs';
  const d = await daten;
  wunschSchulen = (h.get('ws') ?? '').split(',').flatMap((skz) => (d.byId.has(skz) ? [d.byId.get(skz)!] : []));
  zeigeWunschChips();
  if (h.get('a')) {
    aktuelleSchule = d.byId.get(h.get('a')!);
    if (aktuelleSchule) $<HTMLInputElement>('bwAktuell').value = aktuelleSchule.name;
  }
  gewaehlterOrt = { lat: pos[0], lon: pos[1], label: 'Geteilter Ort' };
  adresseEl.placeholder = 'Geteilter Ort (etwa 100 m genau)';
  await planen(gewaehlterOrt);
}
void start();
