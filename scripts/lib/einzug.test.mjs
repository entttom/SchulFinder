import test from 'node:test';
import assert from 'node:assert/strict';
import { klasse, kachelFuer, kachelBox, mercator, analysiere, AUSWERTUNG_ZOOM } from '../../src/lib/einzug.ts';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('klasse erkennt die fünf Legendenfarben und ignoriert den Rest', () => {
  ['#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'].forEach((h, i) => assert.equal(klasse(...hex(h), 255), i));
  assert.equal(klasse(...hex('#fed976'), 0), -1, 'transparent');
  assert.equal(klasse(255, 255, 255, 255), -1, 'weiß (Rand)');
  assert.equal(klasse(...hex('#fd8d3c').map((v) => v + 10), 255), 2, 'leichte Abweichung');
});

test('Kachel und Box sind zueinander konsistent', () => {
  const z = 10;
  const { x, y } = kachelFuer(16.3836, 48.2659, z);
  const b = kachelBox(z, x, y);
  const m = mercator(16.3836, 48.2659);
  assert.ok(m.x >= b.minx && m.x < b.maxx && m.y > b.miny && m.y <= b.maxy);
});

/** Kachel mit einem Block der Klasse c: Spalten und Zeilen relativ zur Schule in Pixeln (z10: ca. 100 m je Pixel) */
function blockKachel(z, lon, lat, c, spalten, zeilen) {
  const m = kachelFuer(lon, lat, z);
  const box = kachelBox(z, m.x, m.y);
  const s = mercator(lon, lat);
  const pxM = (box.maxx - box.minx) / 256;
  const sx = Math.round((s.x - box.minx) / pxM);
  const sy = Math.round((box.maxy - s.y) / pxM);
  const data = new Uint8ClampedArray(256 * 256 * 4);
  const [r, g, b] = hex(['#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'][c]);
  for (let py = sy + zeilen[0]; py < sy + zeilen[1]; py++)
    for (let px = sx + spalten[0]; px < sx + spalten[1]; px++) data.set([r, g, b, 255], (py * 256 + px) * 4);
  return { x: m.x, y: m.y, data, breite: 256, hoehe: 256 };
}

const mische = (a, b) => {
  const data = new Uint8ClampedArray(a.data);
  for (let i = 0; i < data.length; i += 4) if (b.data[i + 3]) data.set(b.data.subarray(i, i + 4), i);
  return { ...a, data };
};

test('analysiere: nur Kinder in der Nähe → keine Anteile über 2 km, nicht angeschnitten', () => {
  const z = AUSWERTUNG_ZOOM;
  const k = blockKachel(z, 16.3836, 48.2659, 3, [-4, 4], [-4, 4]); // ca. ±400 m
  const r = analysiere([k], z, 16.3836, 48.2659);
  assert.ok(r);
  assert.ok(r.anteilUeber2km < 0.001);
  assert.ok(r.p90M < 600, `p90 ${r.p90M}`);
  assert.equal(r.angeschnitten, false);
});

test('analysiere: 57 % nah und 43 % fern ergeben etwa 43 % über 2 km', () => {
  const z = AUSWERTUNG_ZOOM;
  const nah = blockKachel(z, 16.3836, 48.2659, 2, [-4, 4], [-3, 3]);
  const fern = blockKachel(z, 16.3836, 48.2659, 2, [40, 46], [-3, 3]); // ca. 4 km rechts
  const r = analysiere([mische(nah, fern)], z, 16.3836, 48.2659);
  assert.ok(r);
  assert.ok(Math.abs(r.anteilUeber2km - 36 / 84) < 0.05, `anteil ${r.anteilUeber2km}`);
  assert.ok(r.medianM < 1000, `median ${r.medianM}`);
});

test('analysiere: leere Kacheln ergeben null', () => {
  const k = { x: 0, y: 0, data: new Uint8ClampedArray(256 * 256 * 4), breite: 256, hoehe: 256 };
  assert.equal(analysiere([k], 10, 16.38, 48.26), null);
});
