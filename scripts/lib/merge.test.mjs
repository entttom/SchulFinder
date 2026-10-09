import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSources, invertUebertritte, normalizeWeb, splitKernDetail } from './merge.mjs';
import { gkToWgs84 } from './geo.mjs';

const bk = (o) => ({ kennzahl: '101011', titel: 'Volksschule', name: 'Volksschule Eisenstadt', strasse: 'Bahnstraße 16-18 Stg. 2', ort: 'Eisenstadt', plz: '7000', bezirk: 'Eisenstadt(Stadt)', schulart: { id: '1', name: 'Volksschule' }, privatSchule: false, schulerhalter: 'GEMEINDE', ...o });
const atlas = (o) => ({ geometry: { coordinates: [16.5236, 47.8444] }, properties: { SKZ: '101011', GMNR: '10101', GEMNAME: 'Eisenstadt', BEZEICHNUNG: 'Volksschule', STR: 'Bahnstraße 2-4', PLZ: '7000', ORT: 'Eisenstadt', ERHALTER: 'öffentl.', KARTO_TYP: 'VS', KLASSEN: 18, SCHUELER_INSG: 395, SCHUELER_M: 193, SCHUELER_W: 202, ...o } });

test('Schule in beiden Quellen: beste Felder aus beiden', () => {
  const [s] = mergeSources([bk()], [atlas()]);
  assert.equal(s.name, 'Volksschule Eisenstadt');
  assert.equal(s.strasse, 'Bahnstraße 2-4');
  assert.equal(s.erhalter, 'Gemeinde');
  assert.equal(s.kat, 'vs');
  assert.equal(s.schueler, 395);
  assert.equal(s.klassen, 18);
  assert.equal(s.quelle, 'beide');
  assert.equal(s.lon, 16.5236);
});

test('nur im Bildungskompass: Koordinaten aus Gauß-Krüger, keine Statistik', () => {
  const [s] = mergeSources([bk({ gbdMeridian: 'M34', gbdRw: 5252.27, gbdHw: 348143.52 })], []);
  assert.equal(s.quelle, 'bk');
  assert.equal(s.schueler, undefined);
  assert.ok(Math.abs(s.lat - 48.27) < 0.05 && Math.abs(s.lon - 16.4) < 0.05);
});

test('ohne Koordinaten bleibt die Schule erhalten, aber ohne Standort', () => {
  const [s] = mergeSources([bk()], []);
  assert.equal(s.lat, undefined);
});

test('nur im Atlas: Kategorie aus dem Kartentyp, Name Fallback', () => {
  const [s] = mergeSources([], [atlas({ KARTO_TYP: 'BMHSK' })]);
  assert.equal(s.kat, 'bmhs');
  assert.equal(s.name, 'Volksschule');
  assert.equal(s.quelle, 'atlas');
});

test('Name fällt auf den Titel zurück, wenn der Name fehlt', () => {
  const [s] = mergeSources([bk({ name: undefined, titel: 'Titel der Schule' })], []);
  assert.equal(s.name, 'Titel der Schule');
});

test('feine Schulart-ID steht im Kern', () => {
  const { kern } = splitKernDetail(mergeSources([bk({ schulart: { id: '10', name: 'Technische und gewerbliche mittlere oder höhere Schule' } })], []));
  assert.equal(kern[0].artId, '10');
});

test('weitere Schularten werden als Kategorien geführt, ohne die Hauptkategorie', () => {
  const [s] = mergeSources([bk({ weitereSchularten: [{ id: '1' }, { id: '3' }, { id: '5' }] })], []);
  assert.deepEqual(s.weitere, ['ms', 'ps']);
});

test('Website bekommt ein Schema', () => {
  assert.equal(normalizeWeb('www.trinity.co.at'), 'https://www.trinity.co.at');
  assert.equal(normalizeWeb('http://a.at'), 'http://a.at');
  assert.equal(normalizeWeb('  '), undefined);
});

test('Zugänge sind die umgekehrten Abgänge, absteigend sortiert', () => {
  const zu = invertUebertritte({ A: [['X', 5, '01']], B: [['X', 9, '01'], ['Y', 1, '01']] });
  assert.deepEqual(zu.X, [['B', 9, '01'], ['A', 5, '01']]);
  assert.deepEqual(zu.Y, [['B', 1, '01']]);
});

test('Kern und Details sind getrennt', () => {
  const { kern, details } = splitKernDetail(mergeSources([bk({ telefonnummer: '+43 1' })], [atlas()]));
  assert.equal(kern[0].tel, undefined);
  assert.equal(details['101011'].tel, '+43 1');
});

test('Gauß-Krüger M31 (Linz) wird richtig umgerechnet', () => {
  const p = gkToWgs84('M31', 70110, 351480);
  assert.ok(Math.abs(p.lat - 48.3) < 0.05 && Math.abs(p.lon - 14.29) < 0.05, JSON.stringify(p));
});
