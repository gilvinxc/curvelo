/**
 * Weather auto-fill via Open-Meteo (free, no API key). Given a city name and
 * a timestamp, returns the observed temperature + condition, or null when the
 * lookup fails. Never throws — callers treat it as best-effort.
 */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  const data = (await fetchJson(
    `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
  )) as { results?: Array<{ latitude: number; longitude: number }> } | null;
  const first = data?.results?.[0];
  if (!first) return null;
  return { lat: first.latitude, lon: first.longitude };
}

function conditionLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return ["Clear", "Mainly clear", "Partly cloudy", "Overcast"][code];
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 95 || code === 96 || code === 99) return "Thunderstorm";
  return "Unknown";
}

export async function lookupWeather(
  city: string,
  at: Date,
): Promise<{ tempC: number; condition: string } | null> {
  try {
    const geo = await geocodeCity(city);
    if (!geo) return null;
    const day = at.toISOString().slice(0, 10);
    const data = (await fetchJson(
      `${FORECAST_URL}?latitude=${geo.lat}&longitude=${geo.lon}` +
        `&hourly=temperature_2m,weathercode&start_date=${day}&end_date=${day}&timezone=auto`,
    )) as {
      hourly?: { time: string[]; temperature_2m: number[]; weathercode: number[] };
    } | null;
    const hourly = data?.hourly;
    if (!hourly || hourly.time.length === 0) return null;

    const target = at.getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const t = new Date(hourly.time[i]).getTime();
      const diff = Math.abs(t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    const tempC = hourly.temperature_2m[best];
    const code = hourly.weathercode[best];
    if (typeof tempC !== "number" || typeof code !== "number") return null;
    return { tempC: Math.round(tempC * 10) / 10, condition: conditionLabel(code) };
  } catch {
    return null;
  }
}
