import { type Schule, hatStandort, BUNDESLAENDER } from './types';

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

export type Ort = { kind: 'ort'; label: string; sub: string; lon: number; lat: number; schulen: Schule[] };
export type PlzTreffer = { kind: 'plz'; label: string; sub: string; lon: number; lat: number; schulen: Schule[] };
export type SchulTreffer = { kind: 'schule'; label: string; sub: string; schule: Schule };
/** Freitext als Adresse: wird erst bei Auswahl über OpenStreetMap (Nominatim) gesucht, nicht beim Tippen. */
export type AdressTreffer = { kind: 'adresse'; label: string; sub: string; text: string };
export type Vorschlag = Ort | PlzTreffer | SchulTreffer | AdressTreffer;

type Gruppe = { label: string; norm: string; schulen: Schule[] };

function mittelpunkt(schulen: Schule[]) {
  const mit = schulen.filter(hatStandort);
  if (!mit.length) return null;
  return {
    lon: mit.reduce((a, s) => a + s.lon!, 0) / mit.length,
    lat: mit.reduce((a, s) => a + s.lat!, 0) / mit.length,
  };
}

/** Suchindex über Orte, Postleitzahlen und Schulnamen. */
export class SuchIndex {
  private orte: Gruppe[] = [];
  private plz = new Map<string, Gruppe>();
  private hay: { s: Schule; h: string }[];

  constructor(private schulen: Schule[]) {
    const orte = new Map<string, Gruppe>();
    for (const s of schulen) {
      const label = s.gemeinde ?? s.ort;
      if (label) {
        const key = `${s.skz[0]}|${label}`;
        const g = orte.get(key) ?? { label, norm: norm(label), schulen: [] };
        g.schulen.push(s);
        orte.set(key, g);
      }
      if (s.plz) {
        const g = this.plz.get(s.plz) ?? { label: `${s.plz} ${s.ort ?? s.gemeinde ?? ''}`.trim(), norm: s.plz, schulen: [] };
        g.schulen.push(s);
        this.plz.set(s.plz, g);
      }
    }
    this.orte = [...orte.values()];
    this.hay = schulen.map((s) => ({ s, h: norm(`${s.name} ${s.gemeinde ?? ''} ${s.ort ?? ''} ${s.strasse ?? ''}`) }));
  }

  vorschlaege(q: string, max = { orte: 4, schulen: 5 }): Vorschlag[] {
    const qn = norm(q.trim());
    if (qn.length < 2) return [];
    const out: Vorschlag[] = [];

    if (/^\d{2,4}$/.test(qn)) {
      const treffer = [...this.plz.values()]
        .filter((g) => g.norm.startsWith(qn))
        .sort((a, b) => a.norm.localeCompare(b.norm))
        .slice(0, max.orte);
      for (const g of treffer) {
        const c = mittelpunkt(g.schulen);
        if (c) out.push({ kind: 'plz', label: g.label, sub: `Postleitzahl · ${g.schulen.length} Schulen`, ...c, schulen: g.schulen });
      }
    } else {
      const treffer = this.orte
        .filter((g) => g.norm.includes(qn))
        .sort((a, b) => Number(b.norm.startsWith(qn)) - Number(a.norm.startsWith(qn)) || b.schulen.length - a.schulen.length)
        .slice(0, max.orte);
      for (const g of treffer) {
        const c = mittelpunkt(g.schulen);
        if (c) {
          const bl = BUNDESLAENDER[g.schulen[0].skz[0]];
          out.push({ kind: 'ort', label: g.label, sub: `${bl} · ${g.schulen.length} Schulen`, ...c, schulen: g.schulen });
        }
      }
    }

    const tokens = qn.split(/\s+/);
    for (const { s, h } of this.hay) {
      if (out.length >= max.orte + max.schulen) break;
      if (tokens.every((t) => h.includes(t))) {
        out.push({ kind: 'schule', label: s.name, sub: [s.strasse, s.gemeinde ?? s.ort].filter(Boolean).join(', '), schule: s });
      }
    }
    return out;
  }
}
