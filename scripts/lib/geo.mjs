import proj4 from 'proj4';

// MGI / Austria GK (Bessel, Rw ohne Falscheasting, Hw = Nordwert - 5.000.000).
// Die Meridianstreifen des Bildungskompass heißen M28, M31 und M34.
const TOWGS = '+towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232';
const def = (lon0) =>
  `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel ${TOWGS} +units=m +no_defs`;

const MERIDIAN = {
  M28: def(10.333333333333334),
  M31: def(13.333333333333334),
  M34: def(16.333333333333332),
};

/** Gauß-Krüger (Bildungskompass) nach WGS84; null, wenn Angaben fehlen. */
export function gkToWgs84(meridian, rw, hw) {
  const d = MERIDIAN[meridian];
  if (!d || !Number.isFinite(rw) || !Number.isFinite(hw)) return null;
  const [lon, lat] = proj4(d, 'WGS84', [rw, hw]);
  return { lon, lat };
}

/** Entfernung in Metern (Haversine). */
export function distanceM(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
