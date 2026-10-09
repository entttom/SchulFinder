// Bildungsweg-Planer: Aus einer Wohnadresse und den Wünschen der Eltern werden realistische Schulwege
// von der Volksschule bis zum Abschluss gebaut. Hier steht nur die Logik (ohne Netz und Oberfläche).
import type { Drittel, Schule, Uebertritte } from './types';
import { klassengroesse } from './types';
import { distanceM, fmtDist, fmtNum } from './geo';

/* ---------- Eingaben ---------- */
/** Wo steht das Kind gerade? */
export type Start = 'vs' | 'sek1' | 'sek2';
export type Ziel = 'offen' | 'matura' | 'beruf' | 'lehre';
export type Wunsch = 'kurz' | 'sicher' | 'oeffi' | 'nachbarn' | 'klein' | 'leistung';
export type Interesse = 'technik' | 'wirtschaft' | 'sprachen' | 'mint' | 'sport' | 'musik' | 'sozial' | 'tourismus' | 'natur';

export const WUENSCHE: { id: Wunsch; label: string; info: string }[] = [
  { id: 'kurz', label: 'Kurzer Schulweg', info: 'Echte Geh- und Radzeiten' },
  { id: 'sicher', label: 'Sicherer Schulweg', info: 'Wenige Hauptstraßen zu queren' },
  { id: 'oeffi', label: 'Gute Öffi-Anbindung', info: 'Haltestelle nahe der Schule' },
  { id: 'nachbarn', label: 'Freunde aus der Nachbarschaft', info: 'Kinder aus eurer Gegend gehen hin' },
  { id: 'klein', label: 'Kleine Klassen', info: 'Wenige Kinder pro Klasse' },
  { id: 'leistung', label: 'Starke Lese- und Mathe-Ergebnisse', info: 'Volksschule, im Vergleich zu ähnlichen Schulen' },
];

export const INTERESSEN: { id: Interesse; label: string }[] = [
  { id: 'technik', label: 'Technik & IT' },
  { id: 'mint', label: 'Naturwissenschaften' },
  { id: 'wirtschaft', label: 'Wirtschaft' },
  { id: 'sprachen', label: 'Sprachen' },
  { id: 'sport', label: 'Sport' },
  { id: 'musik', label: 'Musik, Kunst & Design' },
  { id: 'sozial', label: 'Soziales & Pädagogik' },
  { id: 'tourismus', label: 'Tourismus, Mode & Ernährung' },
  { id: 'natur', label: 'Natur & Landwirtschaft' },
];

export type Eingabe = {
  start: Start;
  ziel: Ziel;
  wuensche: Set<Wunsch>;
  interessen: Set<Interesse>;
  /** Privatschulen gleichwertig berücksichtigen (sonst nur öffentliche Schulen) */
  privat: boolean;
  /** Schulen mit Chancenbonus ausschließen */
  ohneBonus: boolean;
  /** Wunschschulen: werden fest eingeplant, davor werden Schulen bevorzugt, von denen Kinder dorthin wechseln */
  wunsch: Schule[];
  /** Aktuelle Schule (optional): dann zählen die echten Übertritte von dort */
  aktuell?: Schule;
};

/* ---------- Schulformen ---------- */
export type Form = 'vs' | 'ms' | 'ahsU' | 'ahsO' | 'bhs' | 'bms' | 'pts';
export const FORM_LABEL: Record<Form, string> = {
  vs: 'Volksschule',
  ms: 'Mittelschule',
  ahsU: 'Gymnasium (AHS)',
  ahsO: 'Oberstufe (AHS/ORG)',
  bhs: 'Höhere berufsbildende Schule',
  bms: 'Fachschule',
  pts: 'Polytechnische Schule',
};

const HOEHER = /höhere|\bHTL|HTBL|\bHAK\b|handelsakademie|\bHLW|\bHLT|\bHLA|HBLA|HBLVA|HBLFA|BAfEP|BAKIP|bildungsanstalt|kolleg|aufbaulehrgang|\bHLFS|\bHLM/i;
const MITTLERE = /fachschule|handelsschule|\bHAS\b|\bFS\b/i;
const NUR_OBERSTUFE = /oberstufen|\bORG\b/i;
const OBERSTUFE_CODES = ['02a', '05', '05a'];

/** Welche Schulformen bietet eine Schule an? Die Übertritte zeigen, ob sie Kinder mit 10 oder mit 14 aufnimmt. */
export function formenVon(s: Schule, ue: Uebertritte): Set<Form> {
  const f = new Set<Form>();
  const kats = new Set([s.kat, ...(s.weitere ?? [])]);
  if (kats.has('vs')) f.add('vs');
  if (kats.has('ms')) f.add('ms');
  if (kats.has('ps')) f.add('pts');
  if (kats.has('ahs')) {
    const zu = ue.zu[s.skz] ?? [];
    const klein = ue.kleinZu?.[s.skz] ?? {};
    const nimmt = (codes: string[]) => zu.some((u) => codes.includes(u[2])) || codes.some((c) => (klein[c] ?? 0) > 0);
    const mit10 = nimmt(['01']) || s.artId === '9';
    const mit14 = nimmt(OBERSTUFE_CODES);
    if (NUR_OBERSTUFE.test(s.name) && !mit10) f.add('ahsO');
    else {
      if (mit10 || (!mit14 && !zu.length)) f.add('ahsU');
      if (mit14 || NUR_OBERSTUFE.test(s.name)) f.add('ahsO');
    }
  }
  if (kats.has('bmhs') || s.artId === '15' || s.artId === '16') {
    const hoeher = HOEHER.test(s.name) || s.artId === '16' || s.artId === '17';
    if (hoeher) f.add('bhs');
    if (MITTLERE.test(s.name) || s.artId === '15' || !hoeher) f.add('bms');
  }
  return f;
}

/** Schwerpunkte laut Schulart und Schulname. */
export function schwerpunkte(s: Schule): Set<Interesse> {
  const n = s.name;
  const r = new Set<Interesse>();
  if (s.artId === '10' || /informatik|technik|technisch|\bHTL|HTBL|elektro|maschinen|mechatron|\bIT\b|digital|robotik|coding/i.test(n)) r.add('technik');
  if (/naturwiss|realgymnasium|informatik|\bMINT\b|science|mathemat|forscher/i.test(n)) r.add('mint');
  if (s.artId === '11' || /handelsakademie|\bHAK\b|handelsschule|wirtschaftskundl|business|wirtschaft(?!liche berufe)/i.test(n)) r.add('wirtschaft');
  if (/sprach|bilingual|english|englisch|europa|international|französisch|italienisch|spanisch|latein|humanist/i.test(n)) r.add('sprachen');
  if (/sport|\bski/i.test(n)) r.add('sport');
  if (/musik|kunst|kreativ|design|grafik|theater|tanz|medien|gestaltung/i.test(n)) r.add('musik');
  if (s.artId === '13' || s.artId === '17' || /sozial|elementarpäd|BAfEP|BAKIP|pädagog|gesundheit|pflege/i.test(n)) r.add('sozial');
  if (s.artId === '12' || /tourismus|mode|wirtschaftliche berufe|\bHLW|gastro|hotel|ernährung|lebensmittel/i.test(n)) r.add('tourismus');
  if (s.artId === '15' || s.artId === '16' || /land- und forst|landwirtschaft|forst|garten|umwelt|ökolog|agrar/i.test(n)) r.add('natur');
  return r;
}

/* ---------- Messwerte je Schule (kommen aus dem Netz) ---------- */
export type Messung = {
  luftM: number;
  fussMin?: number;
  radMin?: number;
  /** Nächste Haltestelle (Bus, Straßenbahn, Bahn) an der Schule */
  halt?: { m: number; art: string; name?: string } | null;
  /** Schulweg zu Fuß: gequerte Hauptstraßen und Meter entlang von Hauptstraßen */
  sicher?: { querungen: number; entlangM: number } | null;
  /** Kinder dieser Schule in eurer 500-m-Zelle: Klasse 0–4, -1 keine; umgebung: nur in der Nähe */
  nachbarn?: { klasse: number; umgebung: boolean } | null;
};

export type Kontext = {
  heim: { lon: number; lat: number };
  heimHalt?: { m: number; art: string } | null;
  ue: Uebertritte;
  ergebnisse: Record<string, [Drittel | null, Drittel | null]>;
};

/** Gehzeit ohne Routing: Luftlinie mit Umwegfaktor. */
const schaetzeFuss = (m: number) => (m * 1.3) / 75;
const schaetzeRad = (m: number) => (m * 1.3) / 250;
export const fussMin = (x: Messung) => x.fussMin ?? schaetzeFuss(x.luftM);
export const radMin = (x: Messung) => x.radMin ?? schaetzeRad(x.luftM);
/** Kinder gehen langsamer als Erwachsene (das Routing rechnet mit etwa 5 km/h). */
export const KINDER_FAKTOR = 1.25;

/**
 * Öffi-Zeit, grob geschätzt: zur Haltestelle gehen, warten, fahren (etwa 18 km/h mit Halten), von der Haltestelle gehen.
 * Nur wenn an beiden Enden eine Haltestelle in Gehweite liegt.
 */
export function oeffiMin(x: Messung, heimHalt: Kontext['heimHalt']): number | undefined {
  if (!x.halt || !heimHalt || x.halt.m > 700 || heimHalt.m > 700 || x.luftM < 1200) return undefined;
  return heimHalt.m / 70 + 5 + (x.luftM * 1.35) / 300 + x.halt.m / 70;
}

/* ---------- Bewertung ---------- */
export type Stufe = 'vs' | 'sek1' | 'sek2';
export const STUFE_ALTER: Record<Stufe, string> = { vs: '6–10 Jahre', sek1: '10–14 Jahre', sek2: 'ab 14 Jahren' };
export const stufeVon = (f: Form): Stufe => (f === 'vs' ? 'vs' : f === 'ms' || f === 'ahsU' ? 'sek1' : 'sek2');

export type Grund = { text: string; gut: boolean | null; art: 'weg' | 'sicher' | 'oeffi' | 'nachbarn' | 'klasse' | 'privat' | 'bonus' | 'leistung' | 'interesse' | 'uebergang' | 'wunsch' };
export type Bewertet = {
  s: Schule & { lon: number; lat: number };
  form: Form;
  m: Messung;
  /** 0–100 */
  passung: number;
  gruende: Grund[];
  /** Anteil der Kinder der vorigen Schule, die hierher wechseln (0–1), oder "klein" bei höchstens 6 Kindern */
  uebergang?: number | 'klein';
  /** Zeit, mit der gerechnet wird, und wie das Kind hinkommt */
  weg: { min: number; mittel: 'fuss' | 'rad' | 'oeffi' };
};

const zwischen = (wert: number, gut: number, schlecht: number) => Math.max(0, Math.min(1, (schlecht - wert) / (schlecht - gut)));
const minText = (m: number) => `${Math.max(1, Math.round(m))} min`;

/** Wie kommt ein Kind dieser Stufe am sinnvollsten hin? */
export function bestenWeg(stufe: Stufe, m: Messung, k: Kontext): Bewertet['weg'] {
  const fuss = fussMin(m) * (stufe === 'vs' ? KINDER_FAKTOR : 1.1);
  const rad = radMin(m);
  const oeffi = oeffiMin(m, k.heimHalt);
  const opt: Bewertet['weg'][] = [{ min: fuss, mittel: 'fuss' }];
  if (stufe !== 'vs') opt.push({ min: rad * 1.1, mittel: 'rad' });
  if (oeffi !== undefined) opt.push({ min: oeffi, mittel: 'oeffi' });
  // Zu Fuß bevorzugt, solange es nicht viel länger dauert
  opt.sort((a, b) => a.min * (a.mittel === 'fuss' ? 0.8 : 1) - b.min * (b.mittel === 'fuss' ? 0.8 : 1));
  return opt[0];
}

const GRENZEN: Record<Stufe, [number, number]> = { vs: [10, 35], sek1: [15, 45], sek2: [20, 60] };

export function bewerte(
  s: Schule & { lon: number; lat: number },
  form: Form,
  m: Messung,
  e: Eingabe,
  k: Kontext,
  vorher?: Schule,
  nachher?: Schule,
): Bewertet {
  const stufe = stufeVon(form);
  const w = (id: Wunsch, basis: number) => (e.wuensche.has(id) ? basis * 3 + 1 : basis);
  const teile: { wert: number; gewicht: number }[] = [];
  const gruende: Grund[] = [];
  const add = (wert: number, gewicht: number) => gewicht > 0 && teile.push({ wert, gewicht });

  // Schulweg
  const weg = bestenWeg(stufe, m, k);
  const [gut, schlecht] = GRENZEN[stufe];
  add(zwischen(weg.min, gut, schlecht), w('kurz', 2));
  const mittel = { fuss: 'zu Fuß', rad: 'mit dem Rad', oeffi: 'mit Öffis (geschätzt)' }[weg.mittel];
  gruende.push({ art: 'weg', gut: weg.min <= gut + 3 ? true : weg.min >= schlecht ? false : null, text: `${minText(weg.min)} ${mittel}` });

  // Sicherheit des Fußwegs (vor allem für jüngere Kinder)
  if (m.sicher && stufe !== 'sek2' && weg.mittel === 'fuss') {
    const q = m.sicher.querungen;
    add(q === 0 ? 1 : q === 1 ? 0.6 : q === 2 ? 0.35 : 0.1, w('sicher', stufe === 'vs' ? 1.5 : 0.7));
    gruende.push({
      art: 'sicher',
      gut: q === 0 ? true : q >= 2 ? false : null,
      text: q === 0 ? 'Keine Hauptstraße zu queren' : `Quert ${q} ${q === 1 ? 'Hauptstraße' : 'Hauptstraßen'}`,
    });
  } else if (e.wuensche.has('sicher') && stufe === 'vs') {
    add(0.5, 1);
  }

  // Öffis
  if (m.halt !== undefined && stufe !== 'vs') {
    const wert = m.halt ? zwischen(m.halt.m, 250, 900) : 0;
    add(wert, w('oeffi', stufe === 'sek2' ? 1 : 0.5));
    if (m.halt && m.halt.m <= 900) gruende.push({ art: 'oeffi', gut: m.halt.m <= 350, text: `${m.halt.art} ${fmtDist(m.halt.m)} von der Schule` });
    else gruende.push({ art: 'oeffi', gut: false, text: 'Keine Haltestelle in der Nähe' });
  }

  // Nachbarschaft
  if (m.nachbarn !== undefined && stufe !== 'sek2') {
    const n = m.nachbarn;
    const wert = !n || n.klasse < 0 ? 0 : (n.umgebung ? 0.35 : 0.55) + n.klasse * 0.11;
    add(Math.min(1, wert), w('nachbarn', 1));
    if (n && n.klasse >= 0) {
      const anz = ['bis zu 2', '3–5', '6–11', '12–19', '20+'][n.klasse];
      gruende.push({ art: 'nachbarn', gut: true, text: n.umgebung ? `${anz} Kinder aus eurer Umgebung` : `${anz} Kinder aus eurer Nachbarschaft` });
    }
  }

  // Klassengröße
  const kl = klassengroesse(s);
  if (kl !== undefined) {
    add(zwischen(kl, 17, 26), w('klein', 0.7));
    gruende.push({ art: 'klasse', gut: kl <= 19 ? true : kl >= 24 ? false : null, text: `Ø ${fmtNum(kl, 1).replace(',0', '')} Kinder pro Klasse` });
  }

  // Privat (Schulgeld)
  // Privatschulen kommen nur vor, wenn die Eltern sie einbeziehen: dann gleichwertig, nur mit Hinweis
  if (s.privat) gruende.push({ art: 'privat', gut: null, text: `Privatschule${s.erhalter ? ` (${s.erhalter})` : ''}, meist mit Schulgeld` });
  if (s.bonus) gruende.push({ art: 'bonus', gut: null, text: 'Chancenbonus-Schule (zusätzliches Personal vom Bildungsministerium)' });

  // Lese- und Mathe-Ergebnisse (nur Volksschulen)
  if (form === 'vs') {
    const erg = k.ergebnisse[s.skz];
    const punkte = { o: 1, m: 0.6, u: 0.25 } as const;
    const werte = (erg ?? []).filter((d): d is Drittel => !!d).map((d) => punkte[d]);
    if (werte.length) {
      const wert = werte.reduce((a, b) => a + b, 0) / werte.length;
      add(wert, w('leistung', 0.6));
      const oben = (erg ?? []).filter((d) => d === 'o').length;
      const unten = (erg ?? []).filter((d) => d === 'u').length;
      gruende.push({
        art: 'leistung',
        gut: oben > 0 && unten === 0 ? true : unten > 0 && oben === 0 ? false : null,
        text: oben === 2 ? 'Lesen und Mathe im oberen Drittel' : oben === 1 && unten === 0 ? 'Teils im oberen Drittel (Lesen/Mathe)' : unten === 2 ? 'Lesen und Mathe im unteren Drittel' : unten ? 'Teils im unteren Drittel (Lesen/Mathe)' : 'Lesen und Mathe im Mittelfeld',
      });
    } else if (e.wuensche.has('leistung')) add(0.5, 1);
  }

  // Interessen
  if (e.interessen.size && stufe !== 'vs') {
    const sp = schwerpunkte(s);
    const treffer = [...e.interessen].filter((i) => sp.has(i));
    const gewicht = stufe === 'sek2' && (form === 'bhs' || form === 'bms') ? 3 : 1.2;
    add(treffer.length ? Math.min(1, 0.7 + treffer.length * 0.3) : 0, gewicht);
    if (treffer.length) gruende.push({ art: 'interesse', gut: true, text: `Schwerpunkt ${treffer.map((t) => INTERESSEN.find((i) => i.id === t)!.label).join(', ')}` });
  }

  // Bewährter Übergang: Wechseln Kinder der vorigen Schule hierher?
  let uebergang: Bewertet['uebergang'];
  if (vorher && vorher.skz !== s.skz) {
    const aus = k.ue.aus[vorher.skz] ?? [];
    const summe = aus.reduce((a, u) => a + u[1], 0);
    const hier = aus.filter((u) => u[0] === s.skz).reduce((a, u) => a + u[1], 0);
    const klein = Object.values(k.ue.kleinAus?.[vorher.skz] ?? {}).length > 0 && !hier && kleinNach(k.ue, vorher.skz, s.skz);
    if (hier && summe) {
      uebergang = hier / summe;
      add(Math.min(1, 0.55 + uebergang * 1.5), 1.5);
      gruende.push({ art: 'uebergang', gut: true, text: `${Math.round(uebergang * 100)} % der Kinder von „${kurz(vorher.name)}“ wechseln hierher` });
    } else if (klein) {
      uebergang = 'klein';
      add(0.5, 1);
      gruende.push({ art: 'uebergang', gut: null, text: `Einige Kinder von „${kurz(vorher.name)}“ wechseln hierher` });
    } else if (summe) add(0.2, 0.8);
  }

  // Weg zur Wunschschule: Wechseln Kinder von hier an die Wunschschule der nächsten Stufe?
  if (nachher && nachher.skz !== s.skz) {
    const aus = k.ue.aus[s.skz] ?? [];
    const summe = aus.reduce((a, u) => a + u[1], 0);
    const hin = aus.filter((u) => u[0] === nachher.skz).reduce((a, u) => a + u[1], 0);
    if (hin && summe) {
      add(Math.min(1, 0.6 + (hin / summe) * 1.5), 6);
      gruende.push({ art: 'wunsch', gut: true, text: `${Math.max(1, Math.round((hin / summe) * 100))} % der Kinder wechseln von hier an eure Wunschschule „${kurz(nachher.name)}“` });
    } else if (kleinNach(k.ue, s.skz, nachher.skz)) {
      add(0.5, 4);
      gruende.push({ art: 'wunsch', gut: true, text: `Einige Kinder wechseln von hier an eure Wunschschule „${kurz(nachher.name)}“` });
    } else if (summe) {
      add(0.05, 4);
      gruende.push({ art: 'wunsch', gut: false, text: `Laut Statistik wechselt von hier niemand an eure Wunschschule „${kurz(nachher.name)}“` });
    }
  }

  const summeG = teile.reduce((a, t) => a + t.gewicht, 0) || 1;
  const passung = Math.round((teile.reduce((a, t) => a + t.wert * t.gewicht, 0) / summeG) * 100);
  return { s, form, m, passung, gruende, uebergang, weg };
}

/** Steht die Zielschule unter den kleinen Wechseln (höchstens 6 Kinder)? Die Namensliste liegt nur je Schulart vor, daher hier nur ein Hinweis über die Anzahl. */
let kleinNamen: Record<string, Record<string, string[]>> | null = null;
export const setzeKleineWechsel = (k: Record<string, Record<string, string[]>>) => (kleinNamen = k);
function kleinNach(_ue: Uebertritte, von: string, nach: string) {
  const l = kleinNamen?.[von];
  return !!l && Object.values(l).some((ids) => ids.includes(nach));
}

const kurz = (name: string) => {
  const t = name.split(/\s[-–]\s|:\s|\s\(|\s"/)[0].trim();
  return t.length > 34 ? `${t.slice(0, 33).replace(/\s+\S*$/, '')}…` : t;
};

/* ---------- Kandidaten ---------- */
type MitStandort = Schule & { lon: number; lat: number };
export type Kandidat = { s: MitStandort; form: Form; luftM: number };

const ANZAHL: Record<Form, [number, number]> = {
  // [höchstens so viele, im Umkreis von km]
  vs: [12, 12], ms: [10, 20], ahsU: [10, 30], ahsO: [10, 40], bhs: [28, 50], bms: [10, 50], pts: [6, 40],
};

/** Die nächsten Schulen jeder Form (nach Luftlinie), als Ausgangsmenge für die Messungen. */
export function kandidaten(schulen: MitStandort[], ue: Uebertritte, heim: { lon: number; lat: number }, formen: Form[], e: Eingabe): Kandidat[] {
  const je = new Map<Form, Kandidat[]>();
  const wunsch = new Set(e.wunsch.map((w) => w.skz));
  for (const s of schulen) {
    if (!s.schueler) continue; // ohne Schülerzahlen keine Aussage (z. B. Expositur, Kolleg)
    if (wunsch.has(s.skz)) continue; // Wunschschulen kommen unten dazu, unabhängig von Entfernung und Filtern
    if (!e.privat && s.privat) continue;
    if (e.ohneBonus && s.bonus) continue;
    const luftM = distanceM(heim.lon, heim.lat, s.lon, s.lat);
    for (const f of formenVon(s, ue)) {
      if (!formen.includes(f) || luftM > ANZAHL[f][1] * 1000) continue;
      (je.get(f) ?? je.set(f, []).get(f)!).push({ s, form: f, luftM });
    }
  }
  const raus: Kandidat[] = [];
  for (const [f, l] of je) {
    l.sort((a, b) => a.luftM - b.luftM);
    let wahl = l.slice(0, ANZAHL[f][0]);
    // Bei Interessen auch passende Schulen etwas weiter weg aufnehmen
    if (e.interessen.size && f !== 'vs') {
      const passend = l.filter((k) => [...schwerpunkte(k.s)].some((i) => e.interessen.has(i))).slice(0, f === 'bhs' ? 12 : 5);
      wahl = [...new Map([...wahl, ...passend].map((k) => [k.s.skz, k])).values()];
    }
    raus.push(...wahl);
  }
  const drin = new Set(raus.map((k) => `${k.s.skz}|${k.form}`));
  const dazu = (s: MitStandort, f: Form) => {
    if (drin.has(`${s.skz}|${f}`)) return;
    drin.add(`${s.skz}|${f}`);
    raus.push({ s, form: f, luftM: distanceM(heim.lon, heim.lat, s.lon, s.lat) });
  };
  const byId = new Map(schulen.map((s) => [s.skz, s]));
  for (const w of e.wunsch) {
    if (w.lon === undefined || w.lat === undefined) continue;
    const s = w as MitStandort;
    for (const f of formenVon(s, ue)) if (formen.includes(f)) dazu(s, f);
    // Zubringer: Schulen, von denen Kinder an die Wunschschule wechseln (im Umkreis von 15 km um die Wohnung).
    // So entsteht ein realistischer Weg dorthin, nicht nur die nächstgelegene Schule davor.
    const zubringer = [...(ue.zu[w.skz] ?? [])].sort((x, y) => y[1] - x[1]);
    for (const [skz] of zubringer) {
      const z = byId.get(skz);
      if (!z || !z.schueler || distanceM(heim.lon, heim.lat, z.lon, z.lat) > 15000) continue;
      if (!e.privat && z.privat && !wunsch.has(z.skz)) continue;
      if (e.ohneBonus && z.bonus && !wunsch.has(z.skz)) continue;
      for (const f of formenVon(z, ue)) if (formen.includes(f) && f !== 'vs') dazu(z, f);
    }
  }
  return raus;
}

/* ---------- Szenarien ---------- */
export type SzenarioId = 'gym' | 'bhs' | 'ober' | 'fach' | 'lehre';
export type Schritt = {
  stufe: Stufe;
  form: Form;
  titel: string;
  /** Bleibt an der Schule der vorigen Stufe (AHS-Langform: Unter- und Oberstufe) */
  bleibt?: boolean;
  wahl?: Bewertet;
  alternativen: Bewertet[];
};
export type Szenario = {
  id: SzenarioId;
  titel: string;
  untertitel: string;
  abschluss: string;
  abschlussInfo: string;
  /** Alter beim Abschluss */
  alterEnde: string;
  schritte: Schritt[];
  passung: number;
  /** enthält mindestens eine Wunschschule */
  mitWunsch?: boolean;
  /** Anzahl der enthaltenen Wunschschulen (Wege mit mehr Wunschschulen stehen vorne) */
  wuensche?: number;
};

type Vorlage = { id: SzenarioId; titel: string; untertitel: string; abschluss: string; abschlussInfo: string; alterEnde: string; sek1: Form; sek2: Form | 'bleibt' };
const VORLAGEN: Vorlage[] = [
  { id: 'gym', titel: 'Gymnasium bis zur Matura', untertitel: '8 Jahre an einer AHS, breite Allgemeinbildung', abschluss: 'Matura', abschlussInfo: 'Zugang zu Universität, Fachhochschule und Kolleg', alterEnde: '18', sek1: 'ahsU', sek2: 'bleibt' },
  { id: 'bhs', titel: 'Matura mit Beruf', untertitel: 'Mittelschule, dann 5 Jahre HTL, HAK, HLW oder BAfEP', abschluss: 'Matura + Berufsabschluss', abschlussInfo: 'Reife- und Diplomprüfung: studieren oder direkt in den Beruf', alterEnde: '19', sek1: 'ms', sek2: 'bhs' },
  { id: 'ober', titel: 'Mittelschule, dann Oberstufe', untertitel: 'Mittelschule, ab 14 an ein Oberstufen-Gymnasium', abschluss: 'Matura', abschlussInfo: 'Zugang zu Universität, Fachhochschule und Kolleg', alterEnde: '18', sek1: 'ms', sek2: 'ahsO' },
  { id: 'fach', titel: 'Fachschule', untertitel: 'Mittelschule, dann 3–4 Jahre berufsbildende Fachschule', abschluss: 'Fachschulabschluss', abschlussInfo: 'Berufsausbildung, später Aufbaulehrgang zur Matura möglich', alterEnde: '17–18', sek1: 'ms', sek2: 'bms' },
  { id: 'lehre', titel: 'Lehre', untertitel: 'Mittelschule, Polytechnische Schule, dann Lehre im Betrieb', abschluss: 'Lehrabschluss', abschlussInfo: 'Ausbildung im Betrieb und an der Berufsschule, Lehre mit Matura möglich', alterEnde: '18', sek1: 'ms', sek2: 'pts' },
];

const REIHENFOLGE: Record<Ziel, SzenarioId[]> = {
  offen: ['gym', 'bhs', 'ober', 'lehre'],
  matura: ['gym', 'ober', 'bhs'],
  beruf: ['bhs', 'fach', 'lehre'],
  lehre: ['lehre', 'fach', 'bhs'],
};

/** Formen, die für die gewählten Szenarien gemessen werden müssen. */
export function benoetigteFormen(e: Eingabe): Form[] {
  const f = new Set<Form>();
  if (e.start === 'vs') f.add('vs');
  for (const id of REIHENFOLGE[e.ziel]) {
    const v = VORLAGEN.find((x) => x.id === id)!;
    if (e.start !== 'sek2') f.add(v.sek1);
    if (v.sek2 !== 'bleibt') f.add(v.sek2);
    else if (e.start === 'sek2') f.add('ahsO');
  }
  return [...f];
}

/** Wunschschule für eine Form (falls angegeben und passend). */
export const wunschFuer = (e: Eingabe, ue: Uebertritte, form: Form) => e.wunsch.find((w) => formenVon(w, ue).has(form));

export type Messwerte = Map<string, Messung>; // Schlüssel: Schulkennzahl

const bester = (l: Bewertet[]) => [...l].sort((a, b) => b.passung - a.passung);

/** Bewertet alle Kandidaten einer Form (optional mit Übergang von der vorigen Schule). */
export function rangliste(kand: Kandidat[], form: Form, mw: Messwerte, e: Eingabe, k: Kontext, vorher?: Schule, nachher?: Schule): Bewertet[] {
  return bester(
    kand
      .filter((c) => c.form === form)
      .map((c) => bewerte(c.s, form, mw.get(c.s.skz) ?? { luftM: c.luftM }, e, k, vorher, nachher)),
  );
}

/** Baut die Szenarien. "fest" erlaubt, einzelne Schulen festzulegen (Alternativen tauschen). */
export function szenarien(
  kand: Kandidat[],
  mw: Messwerte,
  e: Eingabe,
  k: Kontext,
  fest: Partial<Record<string, string>> = {}, // `${szenario}:${stufe}` -> skz
): Szenario[] {
  const raus: Szenario[] = [];
  for (const id of REIHENFOLGE[e.ziel]) {
    const v = VORLAGEN.find((x) => x.id === id)!;
    const schritte: Schritt[] = [];
    let vorher: Schule | undefined = e.aktuell;
    // Wunschschulen dieses Wegs je Stufe
    const w1 = e.start !== 'sek2' ? wunschFuer(e, k.ue, v.sek1) : undefined;
    const w2 = v.sek2 === 'bleibt' ? (e.start === 'sek2' ? wunschFuer(e, k.ue, 'ahsO') : undefined) : wunschFuer(e, k.ue, v.sek2);

    const waehle = (stufe: Stufe, form: Form, titel: string, liste: Bewertet[]) => {
      const key = `${id}:${stufe}`;
      const w = e.wunsch.find((x) => liste.some((b) => b.s.skz === x.skz));
      const wahl = liste.find((b) => b.s.skz === fest[key]) ?? (w && liste.find((b) => b.s.skz === w.skz)) ?? liste[0];
      if (w && wahl?.s.skz === w.skz) wahl.gruende.unshift({ art: 'wunsch', gut: true, text: 'Eure Wunschschule' });
      schritte.push({ stufe, form, titel, wahl, alternativen: liste.filter((b) => b !== wahl).slice(0, 4) });
      if (wahl) vorher = wahl.s;
    };

    if (e.start === 'vs') waehle('vs', 'vs', 'Volksschule', rangliste(kand, 'vs', mw, e, k, undefined, w1));
    if (e.start !== 'sek2') {
      waehle('sek1', v.sek1, v.sek1 === 'ahsU' ? 'Gymnasium, Unterstufe' : 'Mittelschule', rangliste(kand, v.sek1, mw, e, k, vorher, w2));
    }
    if (v.sek2 === 'bleibt') {
      if (e.start === 'sek2') waehle('sek2', 'ahsO', 'Gymnasium, Oberstufe', rangliste(kand, 'ahsO', mw, e, k, vorher));
      else {
        const u = schritte[schritte.length - 1];
        schritte.push({ stufe: 'sek2', form: 'ahsU', titel: 'Gymnasium, Oberstufe', bleibt: true, wahl: u?.wahl, alternativen: [] });
      }
    } else {
      const titel = { bhs: 'HTL, HAK, HLW, BAfEP …', ahsO: 'Oberstufe (AHS/ORG)', bms: 'Fachschule', pts: 'Polytechnische Schule' }[v.sek2 as 'bhs' | 'ahsO' | 'bms' | 'pts'];
      waehle('sek2', v.sek2, titel, rangliste(kand, v.sek2, mw, e, k, vorher));
    }

    // Ohne passende Schule im Umkreis entfällt das Szenario
    if (schritte.some((s) => !s.wahl)) continue;
    const zaehlen = schritte.filter((s) => !s.bleibt && s.stufe !== 'vs' && s.wahl);
    // Die Volksschule ist allen Wegen gemeinsam, sie entscheidet nicht über die Reihenfolge
    const passung = Math.round(zaehlen.reduce((a, s) => a + s.wahl!.passung, 0) / Math.max(1, zaehlen.length));
    const wuensche = new Set(schritte.filter((st) => e.wunsch.some((w) => w.skz === st.wahl!.s.skz)).map((st) => st.wahl!.s.skz)).size;
    raus.push({ ...v, schritte, passung, mitWunsch: wuensche > 0, wuensche });
  }
  // Das Wunschziel zählt mehr als ein paar Punkte Passung: Reihenfolge bleibt, außer ein Weg passt deutlich besser
  const ziel = REIHENFOLGE[e.ziel];
  // Wege mit Wunschschule kommen zuerst
  const wert = (x: Szenario) => x.passung - ziel.indexOf(x.id) * 4 + (x.wuensche ?? 0) * 1000;
  return raus.sort((a, b) => wert(b) - wert(a));
}
