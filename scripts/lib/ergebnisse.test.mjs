import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKpis, hatVolksschule } from './ergebnisse.mjs';

const kpis = (de, ma) => [
  { wert: '18', cyclelabel: 'Schuljahre 2022/23 - 2024/25', kpiName: 'ANZAHL_KLASSEN' },
  { wert: de, cyclelabel: 'Schuljahre 2022/23 - 2024/25', kpiName: 'BILDUNGSSTANDARDS_DEUTSCH_LESEN' },
  { wert: ma, cyclelabel: 'Schuljahre 2022/23 - 2024/25', kpiName: 'BILDUNGSSTANDARDS_MATHEMATIK' },
];

test('liest Deutsch und Mathematik als Drittel', () => {
  assert.deepEqual(parseKpis(kpis('mittleren Drittel', 'oberen Drittel')), { de: 'm', ma: 'o', zyklus: 'Schuljahre 2022/23 - 2024/25' });
});

test('ein fehlender Wert bleibt leer, beide fehlend ergibt null', () => {
  assert.equal(parseKpis(kpis('unteren Drittel', 'nicht verfügbar')).ma, undefined);
  assert.equal(parseKpis(kpis('nicht verfügbar', 'nicht verfügbar')), null);
  assert.equal(parseKpis([]), null);
  assert.equal(parseKpis(undefined), null);
});

test('Schulen mit Volksschule oder Volksschulklassen werden abgefragt', () => {
  assert.equal(hatVolksschule({ schulart: { id: '1' } }), true);
  assert.equal(hatVolksschule({ schulart: { id: '3' }, weitereSchularten: [{ id: '1' }] }), true);
  assert.equal(hatVolksschule({ schulart: { id: '8' } }), false);
});
