// Zeitachse mit Fristen: Wann ist Schuleinschreibung, wann muss man sich für die nächste Schule anmelden?
// Die Termine sind übliche Zeiträume in Österreich. Genaue Daten legen Bundesland, Gemeinde und Schule fest.

export type Termin = {
  id: string;
  /** erster Tag (JJJJ-MM-TT) */
  von: string;
  /** letzter Tag (inklusive), bei Einzeltagen gleich von */
  bis: string;
  titel: string;
  info: string;
  art: 'frist' | 'tdot' | 'start' | 'ziel' | 'info';
  /** Termin von der Website der Schule (Tag der offenen Tür) */
  quelle?: string;
  zeit?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const tag = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const datum = (j: number, m: number, t: number) => new Date(Date.UTC(j, m - 1, t));
const plus = (d: Date, tage: number) => new Date(d.getTime() + tage * 864e5);

/** n-ter Montag eines Monats */
function montag(j: number, m: number, n: number) {
  const d = datum(j, m, 1);
  const bis = (8 - d.getUTCDay()) % 7; // Tage bis zum ersten Montag
  return plus(d, bis + (n - 1) * 7);
}

/**
 * Semesterferien (eine Woche ab Montag): Wien und Niederösterreich in der ersten Februarwoche,
 * Oberösterreich und Steiermark in der dritten, die übrigen Länder in der zweiten.
 */
export function semesterferien(jahr: number, bundesland: string) {
  const n = bundesland === '9' || bundesland === '3' ? 1 : bundesland === '4' || bundesland === '6' ? 3 : 2;
  return montag(jahr, 2, n);
}

/** Schulbeginn: Wien, Niederösterreich und Burgenland am ersten Montag im September, sonst am zweiten. */
export function schulbeginn(jahr: number, bundesland: string) {
  return montag(jahr, 9, ['9', '3', '1'].includes(bundesland) ? 1 : 2);
}

/** Schulstart: September des Jahres, in dem das Kind bis 31. August sechs Jahre alt wird. */
export function einschulungsjahr(geburt: { jahr: number; monat: number }) {
  return geburt.monat <= 8 ? geburt.jahr + 6 : geburt.jahr + 7;
}

export type Weg = {
  /** Jahr des Schulstarts in der Volksschule */
  start: number;
  bundesland: string;
  /** welche Wechsel noch anstehen */
  ab: 'vs' | 'sek1' | 'sek2';
  sek2: 'bleibt' | 'bhs' | 'ahsO' | 'bms' | 'pts';
  /** Matura nach 12 Schuljahren (AHS) oder 13 (BHS) */
  jahreBisAbschluss: number;
  abschluss: string;
  schulen: { stufe: 'vs' | 'sek1' | 'sek2'; name: string; tdot?: { d: string; z?: string; q: string }[] }[];
};

/** Alle Termine ab heute, chronologisch. */
export function zeitachse(w: Weg, heute = new Date()): Termin[] {
  const t: Termin[] = [];
  const Y = w.start;
  const bl = w.bundesland;
  const anmeldung = (jahr: number, id: string, titel: string, info: string) => {
    const ferien = semesterferien(jahr, bl);
    const zeugnis = plus(ferien, -3);
    t.push({ id: `${id}-zeugnis`, von: tag(zeugnis), bis: tag(zeugnis), titel: 'Schulnachricht (Halbjahreszeugnis)', info: 'Wird für die Anmeldung an der nächsten Schule gebraucht.', art: 'info' });
    const beginn = plus(ferien, 7);
    t.push({ id, von: tag(beginn), bis: tag(plus(beginn, 11)), titel, info, art: 'frist' });
  };
  const tdotFenster = (jahr: number, id: string, wer: string) =>
    t.push({ id, von: tag(datum(jahr, 10, 15)), bis: tag(datum(jahr + 1, 1, 31)), titel: `Tage der offenen Tür: ${wer}`, info: 'Die meisten Schulen laden zwischen Oktober und Jänner ein. Hingehen lohnt sich: Atmosphäre, Lehrkräfte und Schulweg erlebt man nur vor Ort.', art: 'info' });

  if (w.ab === 'vs') {
    tdotFenster(Y - 1, 'vs-tdot', 'Volksschulen');
    t.push({ id: 'vs-einschreibung', von: tag(datum(Y - 1, 11, 1)), bis: tag(datum(Y, 2, 28)), titel: 'Schuleinschreibung Volksschule', info: 'Pflicht für alle Kinder, die bis 31. August sechs Jahre alt werden. Den genauen Termin geben Gemeinde oder Schule bekannt (in Wien meist im Herbst, sonst oft im Jänner oder Februar). Mitbringen: Geburtsurkunde, Meldezettel, e-card, Kind.', art: 'frist' });
    t.push({ id: 'vs-start', von: tag(schulbeginn(Y, bl)), bis: tag(schulbeginn(Y, bl)), titel: 'Erster Schultag in der Volksschule', info: 'Schulbeginn im Bundesland.', art: 'start' });
  }
  if (w.ab !== 'sek2') {
    tdotFenster(Y + 3, 'sek1-tdot', 'Mittelschulen und Gymnasien');
    anmeldung(Y + 4, 'sek1-anmeldung', 'Anmeldung Mittelschule oder Gymnasium', 'Meist in den zwei Wochen nach den Semesterferien, mit der Schulnachricht der 4. Klasse. An Gymnasien zählt der Notenschnitt in Deutsch und Mathematik. Tipp: Erst- und Zweitwunsch angeben.');
    t.push({ id: 'sek1-start', von: tag(schulbeginn(Y + 4, bl)), bis: tag(schulbeginn(Y + 4, bl)), titel: 'Start in der Sekundarstufe (5. Schulstufe)', info: '', art: 'start' });
  }
  if (w.sek2 !== 'bleibt' || w.ab === 'sek2') {
    tdotFenster(Y + 7, 'sek2-tdot', 'weiterführende Schulen');
    if (w.sek2 === 'pts') {
      t.push({ id: 'lehre-orientierung', von: tag(datum(Y + 7, 9, 15)), bis: tag(datum(Y + 8, 6, 30)), titel: 'Berufsorientierung und Schnuppertage', info: 'In der 8. Schulstufe Betriebe kennenlernen. Hilfe: AMS-Berufsinfozentren, Lehrlingsstellen der Wirtschaftskammer.', art: 'info' });
    }
    const was = { bhs: 'HTL, HAK, HLW, BAfEP …', ahsO: 'Oberstufe (AHS/ORG)', bms: 'Fachschule', pts: 'Polytechnische Schule', bleibt: 'Oberstufe' }[w.sek2];
    anmeldung(Y + 8, 'sek2-anmeldung', `Anmeldung ${was}`, 'Mit der Schulnachricht der 8. Schulstufe, meist in den zwei Wochen nach den Semesterferien. Für manche Schulen gibt es Eignungs- oder Aufnahmeprüfungen (z. B. Sport, Musik, Kunst, BAfEP) schon früher.');
    t.push({ id: 'sek2-start', von: tag(schulbeginn(Y + 8, bl)), bis: tag(schulbeginn(Y + 8, bl)), titel: w.sek2 === 'pts' ? 'Start Polytechnische Schule' : 'Start in der Oberstufe (9. Schulstufe)', info: '', art: 'start' });
    if (w.sek2 === 'pts') t.push({ id: 'lehre-start', von: tag(datum(Y + 9, 9, 1)), bis: tag(datum(Y + 9, 9, 1)), titel: 'Lehrbeginn', info: 'Nach der 9. Schulstufe: Lehrvertrag mit dem Betrieb, Berufsschule begleitend.', art: 'start' });
  }
  const abschluss = Y + w.jahreBisAbschluss;
  if (w.sek2 !== 'pts') t.push({ id: 'abschluss', von: tag(datum(abschluss, 5, 1)), bis: tag(datum(abschluss, 6, 30)), titel: w.abschluss, info: 'Schriftliche Klausuren im Mai, mündliche Prüfungen im Juni.', art: 'ziel' });
  else t.push({ id: 'abschluss', von: tag(datum(Y + 12, 6, 1)), bis: tag(datum(Y + 12, 9, 30)), titel: 'Lehrabschlussprüfung', info: 'Je nach Lehrberuf nach 3 bis 4 Lehrjahren.', art: 'ziel' });

  // Tage der offenen Tür, die auf den Websites der gewählten Schulen gefunden wurden
  for (const s of w.schulen) {
    // höchstens zwei kommende Termine je Schule (manche Websites nennen viele Daten)
    for (const d of (s.tdot ?? []).filter((x) => x.d >= tag(heute)).slice(0, 2)) {
      t.push({ id: `tdot-${s.stufe}-${d.d}-${s.name}`, von: d.d, bis: d.d, zeit: d.z, titel: `Tag der offenen Tür: ${s.name}`, info: 'Laut Website der Schule, bitte vorher prüfen.', art: 'tdot', quelle: d.q });
    }
  }
  const heuteTag = tag(heute);
  return t.filter((x) => x.bis >= heuteTag).sort((a, b) => a.von.localeCompare(b.von) || (a.art === 'tdot' ? 1 : -1));
}

/* ---------- Kalender (iCalendar, RFC 5545) ---------- */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const ics = (d: string) => d.replace(/-/g, '');
/** Zeilen über 75 Zeichen werden gefaltet. */
const falte = (z: string) => (z.length <= 74 ? z : z.match(/.{1,73}/g)!.join('\r\n '));

export function kalender(termine: Termin[], titel = 'SchulFinder: Bildungsweg'): string {
  const jetzt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SchulFinder//Bildungsweg//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(titel)}`];
  for (const t of termine) {
    const ende = new Date(Date.parse(t.bis) + 864e5).toISOString().slice(0, 10);
    zeilen.push(
      'BEGIN:VEVENT',
      `UID:${t.id.replace(/[^\w-]/g, '')}-${ics(t.von)}@schulfinder`,
      `DTSTAMP:${jetzt}`,
      `DTSTART;VALUE=DATE:${ics(t.von)}`,
      `DTEND;VALUE=DATE:${ics(ende)}`,
      `SUMMARY:${esc(t.titel)}`,
      `DESCRIPTION:${esc([t.zeit ? `${t.zeit} Uhr` : '', t.info, t.quelle ? `Quelle: ${t.quelle}` : ''].filter(Boolean).join('\n'))}`,
      'TRANSP:TRANSPARENT',
    );
    if (t.art === 'frist' || t.art === 'tdot') {
      zeilen.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.titel)}`, `TRIGGER:-P${t.art === 'frist' ? 14 : 3}D`, 'END:VALARM');
    }
    zeilen.push('END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  return zeilen.map(falte).join('\r\n') + '\r\n';
}
