/**
 * Place search via Open-Meteo geocoding (free, no API key). Resolves an
 * ambiguous typed city ("Winchester") into verified canonical places
 * ("Winchester, Kentucky, United States") with coordinates, so weather
 * and city labels are never left to a first-guess match.
 */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  /** Canonical display label, e.g. "Winchester, Kentucky, United States". */
  label: string;
  name: string;
  state: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

interface GeocodeResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  admin1?: string;
}

export function toPlace(r: GeocodeResult): Place | null {
  if (typeof r.name !== "string" || typeof r.latitude !== "number" || typeof r.longitude !== "number") {
    return null;
  }
  const state = typeof r.admin1 === "string" && r.admin1 ? r.admin1 : null;
  const country = typeof r.country === "string" && r.country ? r.country : null;
  const label = [r.name, state, country].filter(Boolean).join(", ");
  return { label, name: r.name, state, country, lat: r.latitude, lon: r.longitude };
}

export async function searchPlaces(query: string, limit = 6): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(
        `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=${limit}&language=en&format=json`,
        { signal: ctrl.signal },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: GeocodeResult[] };
      return (data.results ?? []).map(toPlace).filter((p): p is Place => p !== null);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}
