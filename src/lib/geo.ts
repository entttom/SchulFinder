/** Entfernung in Metern (Haversine). */
export function distanceM(aLon: number, aLat: number, bLon: number, bLat: number) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

export const fmtDist = (m: number) =>
  m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;

export const fmtNum = (n: number | undefined, digits = 0) =>
  n === undefined ? '–' : n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
