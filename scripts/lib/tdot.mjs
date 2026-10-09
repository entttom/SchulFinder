// Tage der offenen Tür: Termine aus dem Text von Schulwebsites lesen.
// Es gibt dafür keine amtliche Quelle. Gefunden wird, was auf der Startseite oder einer verlinkten
// Unterseite in der Nähe von "Tag der offenen Tür" (oder ähnlich) als Datum steht.

export const SCHLUESSEL = /tag(?:e|en)?\s+der\s+offenen\s+t(?:ü|ue|u)r(?:en)?|\btdot\b|\bt\.d\.o\.t\b|informationstag|infotag|info-tag|schnuppertag|tag\s+der\s+offenen\s+schule|open\s+day|offene\s+schule|infoabend|informationsabend/gi;

const MONATE = {
  jänner: 1, jaenner: 1, januar: 1, jan: 1, februar: 2, feber: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};
const MONAT_RE = Object.keys(MONATE).sort((a, b) => b.length - a.length).join('|');

/** HTML zu lesbarem Text (ohne Skripte, Stile und Navigation zu ändern). */
export function htmlZuText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü').replace(/&szlig;/g, 'ß')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&#\d+;|&\w+;/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (j, m, t) => `${j}-${pad(m)}-${pad(t)}`;
const gueltig = (j, m, t) => {
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
};

/**
 * Jahr für ein Datum ohne Jahresangabe: dieses Jahr, außer der Termin läge dann lange zurück und
 * im nächsten Jahr in den kommenden vier Monaten (z. B. "23. Jänner" auf einer Seite vom Herbst).
 * Sonst bleibt es ein vergangener Termin, der nur als Anhaltspunkt dient.
 */
function jahrFuer(m, t, heute) {
  const j = heute.getUTCFullYear();
  const tage = (Date.UTC(j, m - 1, t) - heute.getTime()) / 864e5;
  const naechstes = (Date.UTC(j + 1, m - 1, t) - heute.getTime()) / 864e5;
  return tage < -30 && naechstes <= 120 ? j + 1 : j;
}

/** Alle Daten in einem Textstück. */
export function datenIn(text, heute) {
  const raus = [];
  const re = new RegExp(
    String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})?(?!\d)|(\d{1,2})\.\s?(${MONAT_RE})\.?\s*(\d{4})?`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    let t, mon, j;
    if (m[1]) {
      t = +m[1];
      mon = +m[2];
      j = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
    } else {
      t = +m[4];
      mon = MONATE[m[5].toLowerCase()];
      j = m[6] ? +m[6] : undefined;
    }
    if (!mon || mon > 12 || t < 1 || t > 31) continue;
    j ??= jahrFuer(mon, t, heute);
    if (!gueltig(j, mon, t)) continue;
    raus.push({ datum: iso(j, mon, t), index: m.index, ende: m.index + m[0].length });
  }
  return raus;
}

/** Uhrzeit nach dem Datum, z. B. "9:00 – 13:00 Uhr" oder "von 8 bis 12 Uhr". */
export function zeitNach(text) {
  const m = text.slice(0, 80).match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\s*(?:–|-|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*uhr/i);
  if (!m || +m[1] > 23 || +m[3] > 23) return undefined;
  return `${m[1]}:${m[2] ?? '00'}–${m[3]}:${m[4] ?? '00'}`;
}

/**
 * Termine rund um die Schlüsselwörter. Ein Datum zählt, wenn es höchstens 220 Zeichen vor oder 320 nach
 * dem Schlüsselwort steht. Behalten werden Termine von vor 13 Monaten bis 13 Monate in die Zukunft.
 */
export function termineIn(text, heute = new Date()) {
  const gefunden = new Map();
  const min = heute.getTime() - 400 * 864e5;
  const max = heute.getTime() + 400 * 864e5;
  for (const k of text.matchAll(SCHLUESSEL)) {
    const von = Math.max(0, k.index - 220);
    const stueck = text.slice(von, k.index + k[0].length + 320);
    for (const d of datenIn(stueck, heute)) {
      const zeit = Date.parse(d.datum);
      if (zeit < min || zeit > max || gefunden.has(d.datum)) continue;
      const a = Math.max(0, d.index - 90);
      const snippet = stueck.slice(a, d.ende + 110).replace(/\s+/g, ' ').trim();
      gefunden.set(d.datum, { d: d.datum, z: zeitNach(stueck.slice(d.ende)), t: snippet });
    }
  }
  return [...gefunden.values()].sort((a, b) => a.d.localeCompare(b.d));
}

/** Links auf derselben Website, die wahrscheinlich Termine enthalten, die besten zuerst. */
export function interessanteLinks(html, basis) {
  const raus = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(m[1], basis);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, '') !== new URL(basis).hostname.replace(/^www\./, '')) continue;
    if (/\.(pdf|jpe?g|png|gif|docx?|zip|mp4)$/i.test(url.pathname)) continue;
    const text = htmlZuText(m[2]).toLowerCase();
    const s = `${decodeURIComponent(url.pathname).toLowerCase()} ${text}`;
    const punkte = /offen|tdot|infotag|informationstag|schnupper|open-day/.test(s) ? 3 : /anmeld|aufnahme|einschreib/.test(s) ? 2 : /termin|aktuell|news|veranstalt|kalender/.test(s) ? 1 : 0;
    if (!punkte) continue;
    url.hash = '';
    const key = url.href;
    raus.set(key, Math.max(raus.get(key) ?? 0, punkte));
  }
  return [...raus.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}
