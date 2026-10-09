// Schulmittelwerte aus den Bildungsstandards (iKMPLUS): Position einer Volksschule im Vergleich zu
// ähnlichen Schulen, eingeteilt in Drittel. Quelle: Bildungskompass, /api/kpis/{Schulkennzahl}.

const DRITTEL = { 'oberen Drittel': 'o', 'mittleren Drittel': 'm', 'unteren Drittel': 'u' };

/** Liest die Antwort von /api/kpis/{skz}. Gibt null zurück, wenn kein Wert für Deutsch oder Mathematik vorliegt. */
export function parseKpis(kpis) {
  if (!Array.isArray(kpis)) return null;
  const wert = (name) => DRITTEL[kpis.find((k) => k.kpiName === name)?.wert];
  const de = wert('BILDUNGSSTANDARDS_DEUTSCH_LESEN');
  const ma = wert('BILDUNGSSTANDARDS_MATHEMATIK');
  if (!de && !ma) return null;
  const zyklus = kpis.find((k) => k.kpiName.startsWith('BILDUNGSSTANDARDS'))?.cyclelabel;
  return { de, ma, zyklus };
}

/** Schulen, für die der Bildungskompass Bildungsstandards ausweist: Volksschulen und Schulen mit Volksschulklassen. */
export const hatVolksschule = (bkSchule) =>
  String(bkSchule.schulart?.id) === '1' || (bkSchule.weitereSchularten ?? []).some((w) => String(w.id) === '1');
