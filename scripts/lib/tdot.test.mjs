import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termineIn, htmlZuText, interessanteLinks, zeitNach } from './tdot.mjs';

const heute = new Date(Date.UTC(2026, 9, 9)); // 9. Oktober 2026

test('Datum mit Jahr und Uhrzeit nach dem Schlüsselwort', () => {
  const t = termineIn('Herzliche Einladung zum Tag der offenen Tür am Freitag, 14.11.2026 von 9:00 – 13:00 Uhr.', heute);
  assert.deepEqual(t.map((x) => [x.d, x.z]), [['2026-11-14', '9:00–13:00']]);
});

test('Monatsnamen und fehlendes Jahr: nächstes Vorkommen', () => {
  const t = termineIn('Infotag: 23. Jänner, 8 bis 12 Uhr', heute);
  assert.equal(t[0].d, '2027-01-23');
  assert.equal(t[0].z, '8:00–12:00');
});

test('Daten weit weg vom Schlüsselwort zählen nicht', () => {
  const lang = 'x'.repeat(600);
  assert.deepEqual(termineIn(`Elternabend am 3.10.2026 ${lang} Tag der offenen Tür folgt`, heute), []);
});

test('Ungültige Daten werden verworfen', () => {
  assert.deepEqual(termineIn('Tag der offenen Tür 31.02.2027', heute), []);
});

test('HTML wird zu Text, Umlaute bleiben', () => {
  assert.equal(htmlZuText('<p>Tag der offenen T&uuml;r</p><script>x=1</script>'), 'Tag der offenen Tür');
});

test('Links: gleiche Website, Termin-Seiten zuerst', () => {
  const html = '<a href="/aktuelles">News</a><a href="/tag-der-offenen-tuer/">Tag der offenen Tür</a><a href="https://andere.at/offen">x</a>';
  assert.deepEqual(interessanteLinks(html, 'https://www.schule.at/'), ['https://www.schule.at/tag-der-offenen-tuer/', 'https://www.schule.at/aktuelles']);
});

test('Uhrzeit fehlt', () => {
  assert.equal(zeitNach(' im Festsaal'), undefined);
});

test('Datum ohne Jahr weit in der Zukunft: gilt als vergangener Termin', () => {
  const t = termineIn('Tag der offenen Tür am 21.2.', heute);
  assert.equal(t[0].d, '2026-02-21');
});
