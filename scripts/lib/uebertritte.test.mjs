import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbgaenge, invertKlein, zaehlePerStufe } from './uebertritte.mjs';

const f = (ziel, anzahl, typ = '01', vj = 'A') => ({ properties: { SKZ_VJ: vj, SKZ_LAUFEND: ziel, ANZAHL: anzahl, IPUB2_TYP_VJ: typ } });

test('ausgewiesene Wechsel und kleine Wechsel (Anzahl 0) werden getrennt', () => {
  const { rows, klein } = parseAbgaenge([f('B', 26), f('C', 0), f('D', 0)], 'A');
  assert.deepEqual(rows, [['B', 26, '01']]);
  assert.deepEqual(klein, [['C', '01'], ['D', '01']]);
});

test('Zeilen anderer Schulen zählen nicht, die eigene Schule nur mit ausgewiesener Zahl', () => {
  const { rows, klein } = parseAbgaenge([f('A', 0), f('X', 5, '01', 'Z'), f('A', 12, '05')], 'A');
  assert.deepEqual(rows, [['A', 12, '05']]);
  assert.deepEqual(klein, []);
});

test('doppelte Zeilen derselben Zielschule werden zusammengezählt, mit Zahl schlägt klein', () => {
  const { rows, klein } = parseAbgaenge([f('B', 4), f('B', 3), f('B', 0), f('C', 0), f('C', 0)], 'A');
  assert.deepEqual(rows, [['B', 7, '01']]);
  assert.deepEqual(klein, [['C', '01']]);
});

test('Zugänge sind die umgekehrten kleinen Abgänge', () => {
  const zu = invertKlein({ A: [['X', '01']], B: [['X', '01'], ['Y', '02a']] });
  assert.deepEqual(zu, { X: { '01': ['A', 'B'] }, Y: { '02a': ['B'] } });
});

test('Anzahl kleiner Zielschulen je Schulstufe', () => {
  assert.deepEqual(zaehlePerStufe({ A: [['X', '01'], ['Y', '01'], ['Z', '05']] }), { A: { '01': 2, '05': 1 } });
});
