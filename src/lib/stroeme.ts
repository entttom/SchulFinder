// Übertritts-Ströme als Grafik (Sankey): Schule -> Schulart -> Zielschulen.
// Liefert reines SVG als Text, damit es auf der statischen Detailseite und im Planer gleich aussieht.
import type { Schule } from './types';
import { katFarbe, kurzName } from './types';
import { profilLabel, profilOf } from './profil';

export type Strom = { id: string; label: string; farbe: string; n: number; ziele: { name: string; n: number; href?: string; skz?: string }[] };

const PROFIL_FARBE: Record<string, string> = { bhs: katFarbe('bmhs') };

/** Wechsel (Zielschule, Anzahl Kinder) nach Schulart gruppieren, größte zuerst. Je Schulart die größten Ziele, der Rest als "weitere". */
export function stroeme(wechsel: { ziel: Schule; n: number }[], href: (s: Schule) => string, quelle?: string, proArt = 3): Strom[] {
  const g = new Map<string, { ziel: Schule; n: number }[]>();
  for (const w of wechsel) (g.get(profilOf(w.ziel)) ?? g.set(profilOf(w.ziel), []).get(profilOf(w.ziel))!).push(w);
  return [...g.entries()]
    .map(([id, l]) => {
      l.sort((a, b) => b.n - a.n);
      const n = l.reduce((a, w) => a + w.n, 0);
      const ziele: Strom['ziele'] = l.slice(0, proArt).map((w) => ({ name: w.ziel.skz === quelle ? 'Bleibt hier (Oberstufe)' : kurzName(w.ziel.name, 30), n: w.n, href: href(w.ziel), skz: w.ziel.skz }));
      const rest = l.slice(proArt);
      if (rest.length) ziele.push({ name: `${rest.length} weitere ${rest.length === 1 ? 'Schule' : 'Schulen'}`, n: rest.reduce((a, w) => a + w.n, 0), href: undefined, skz: undefined });
      return { id, label: profilLabel(id).replace(' (HTL, HAK, HLW u. a.)', ''), farbe: PROFIL_FARBE[id] ?? katFarbe(id), n, ziele };
    })
    .sort((a, b) => b.n - a.n);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG der Ströme. quelle: Beschriftung links (Name der Schule). */
export function stroemeSvg(quelle: string, liste: Strom[], opts: { breite?: number } = {}): string {
  const N = liste.reduce((a, s) => a + s.n, 0);
  if (!N) return '';
  const B = opts.breite ?? 640;
  const xQ = 0;
  const xA = Math.round(B * 0.3);
  const xZ = Math.round(B * 0.58);
  const W = 12;
  const rechts = liste.reduce((a, s) => a + s.ziele.length, 0);
  // Maßstab: kleine Ströme bleiben sichtbar, die Grafik wird nicht zu hoch
  const k = Math.max(1.2, Math.min(9, 320 / N));
  const lueckeA = 18;
  const lueckeZ = 8;
  const hoeheZ = liste.reduce((a, s) => a + s.ziele.reduce((b, z) => b + Math.max(4, z.n * k), 0), 0) + (rechts - 1) * lueckeZ;
  const hoeheA = liste.reduce((a, s) => a + Math.max(4, s.n * k), 0) + (liste.length - 1) * lueckeA;
  const H = Math.ceil(Math.max(hoeheZ, hoeheA, 120)) + 30;
  const top = 22;

  const band = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, farbe: string, cls: string) => {
    const m = (x0 + x1) / 2;
    return `<path class="${cls}" d="M${x0},${y0}C${m},${y0} ${m},${y1} ${x1},${y1}L${x1},${y1 + h1}C${m},${y1 + h1} ${m},${y0 + h0} ${x0},${y0 + h0}Z" fill="${farbe}"/>`;
  };

  const teile: string[] = [];
  // Quelle: ein Balken über die gesamte Höhe der Arten (zentriert)
  const hQ = N * k;
  const yQ0 = top + (H - top - 8 - hQ) / 2;
  let yQ = yQ0;
  let yA = top + (H - top - 8 - hoeheA) / 2;
  let yZ = top + (H - top - 8 - hoeheZ) / 2;
  liste.forEach((s, i) => {
    const hA = Math.max(4, s.n * k);
    const hQs = s.n * k;
    teile.push(band(xQ + W, yQ, hQs, xA, yA, hA, s.farbe, 'sk-band sk-1'));
    teile.push(`<rect class="sk-knoten" x="${xA}" y="${yA}" width="${W}" height="${hA}" rx="3" fill="${s.farbe}"/>`);
    const pct = Math.round((s.n / N) * 100);
    teile.push(
      `<text class="sk-art" x="${xA - 8}" y="${yA + hA / 2}" text-anchor="end" dominant-baseline="middle"><tspan class="sk-pct">${pct} %</tspan> <tspan>${esc(s.label)}</tspan></text>`,
    );
    let yAz = yA;
    s.ziele.forEach((z, j) => {
      const hZ = Math.max(4, z.n * k);
      const hAz = (z.n / s.n) * hA;
      teile.push(band(xA + W, yAz, hAz, xZ, yZ, hZ, s.farbe, `sk-band sk-2${z.href ? '' : ' sk-rest'}`));
      teile.push(`<rect class="sk-knoten" x="${xZ}" y="${yZ}" width="${W}" height="${hZ}" rx="3" fill="${s.farbe}"/>`);
      const name = z.href ? `<a href="${esc(z.href)}"${z.skz ? ` data-skz="${z.skz}"` : ''}><tspan class="sk-name">${esc(z.name)}</tspan></a>` : `<tspan class="sk-name sk-weitere">${esc(z.name)}</tspan>`;
      teile.push(`<text class="sk-ziel" x="${xZ + W + 8}" y="${yZ + hZ / 2}" dominant-baseline="middle">${name}<tspan class="sk-n" dx="6">${z.n}</tspan></text>`);
      yAz += hAz;
      yZ += hZ + lueckeZ;
      void j;
    });
    yQ += hQs;
    yA += hA + lueckeA;
    void i;
  });
  teile.unshift(`<rect class="sk-knoten sk-quelle" x="${xQ}" y="${yQ0}" width="${W}" height="${hQ}" rx="3"/>`);
  const kopf = `<text class="sk-kopf" x="0" y="12">Von hier</text><text class="sk-kopf" x="${xA - 8}" y="12" text-anchor="end">Schulart</text><text class="sk-kopf" x="${xZ + W + 8}" y="12">Zielschule · Kinder</text>`;
  return `<svg class="stroeme" viewBox="0 0 ${B} ${H}" role="img" aria-label="Übertritte von ${esc(quelle)}: ${liste.map((s) => `${Math.round((s.n / N) * 100)} % ${s.label}`).join(', ')}">${kopf}${teile.join('')}</svg>`;
}
