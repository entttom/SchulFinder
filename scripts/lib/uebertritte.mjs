// Abgänge einer Schule aus dem Schulatlas (Schicht ATLAS_SCHULE_UEBERTRITT_OUT_WFS).
// Der Atlas gibt Wechsel von höchstens 6 Kindern pro Zielschule aus Datenschutzgründen nicht einzeln an,
// sie stehen als Zeile mit Anzahl 0 in den Daten (die Karte des Atlas zeigt dort "≤ 6").

/**
 * @returns {{ rows: [string, number, string][], klein: [string, string][] }}
 *   rows:  [Zielschule, Anzahl, Schulstufen-Code] mit ausgewiesener Anzahl (mindestens 7)
 *   klein: [Zielschule, Schulstufen-Code] mit höchstens 6 Kindern, Anzahl nicht bekannt
 */
export function parseAbgaenge(features, skz) {
  const gross = new Map();
  const nullen = new Map();
  for (const f of features) {
    const p = f.properties;
    const ziel = String(p.SKZ_LAUFEND);
    if (String(p.SKZ_VJ) !== skz) continue;
    if (ziel === skz && !(p.ANZAHL > 0)) continue; // Weiterbesuch der eigenen Schule zählt nur mit ausgewiesener Zahl
    const key = `${p.IPUB2_TYP_VJ}|${ziel}`;
    if (p.ANZAHL > 0) gross.set(key, (gross.get(key) ?? 0) + p.ANZAHL);
    else nullen.set(key, [ziel, p.IPUB2_TYP_VJ]);
  }
  const rows = [...gross].map(([key, n]) => [key.split('|')[1], n, key.split('|')[0]]);
  // Eine Zielschule, die in derselben Stufe schon mit Zahl vorkommt, ist nicht zusätzlich "klein"
  const klein = [...nullen].filter(([key]) => !gross.has(key)).map(([, v]) => v);
  return { rows, klein };
}

/** Zugänge: dieselben kleinen Wechsel aus Sicht der Zielschule. */
export function invertKlein(kleinAus) {
  const zu = {};
  for (const [quelle, liste] of Object.entries(kleinAus)) {
    for (const [ziel, typ] of liste) ((zu[ziel] ??= {})[typ] ??= []).push(quelle);
  }
  return zu;
}

/** { skz: [[ziel, typ], ...] } -> { skz: { typ: anzahl } } */
export function zaehlePerStufe(liste) {
  const out = {};
  for (const [skz, paare] of Object.entries(liste)) {
    const n = {};
    for (const [, typ] of paare) n[typ] = (n[typ] ?? 0) + 1;
    out[skz] = n;
  }
  return out;
}
