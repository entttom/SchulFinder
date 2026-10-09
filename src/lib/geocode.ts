export type Treffer = { lon: number; lat: number; label: string };

/**
 * Sucht eine Adresse in Österreich über Nominatim (OpenStreetMap). Der Text wird dabei an openstreetmap.org
 * gesendet. Er wird nur auf Wunsch der Nutzerin oder des Nutzers abgeschickt und von uns nicht gespeichert.
 */
export async function adresseSuchen(text: string, signal?: AbortSignal): Promise<Treffer | null> {
  const q = text.trim();
  if (q.length < 3) return null;
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&accept-language=de&addressdetails=0' +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Adresssuche nicht erreichbar (HTTP ${res.status})`);
  const liste = (await res.json()) as { lon: string; lat: string; display_name: string }[];
  const t = liste[0];
  if (!t) return null;
  const lon = Number(t.lon);
  const lat = Number(t.lat);
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat, label: t.display_name } : null;
}
