/** Address lookup is a convenience; listings still need an exact pin and editable address. */
export interface StoreAddress {
  address: string;
  area: string;
  city: string;
}

type AddressParts = Record<string, string | undefined>;

export function inIndia(lat: number, lng: number): boolean {
  // Keep the same bounds as the listing API; the precise address is verified separately.
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98;
}

export function formatStoreAddress(data: { address?: AddressParts; display_name?: string }): StoreAddress | null {
  const a = data.address ?? {};
  if (a.country_code?.toLowerCase() !== 'in') return null;
  const city = a.city || a.town || a.village || a.municipality || a.city_district || a.county || a.state_district || '';
  const area = a.neighbourhood || a.suburb || a.quarter || a.locality || '';
  const street = [a.house_number, a.road || a.pedestrian || a.residential || a.amenity || a.building].filter(Boolean).join(' ');
  const address = [street, area].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0, 2).join(',').trim() || '';
  if (address.length < 5 || city.length < 2) return null;
  return { address: address.slice(0, 200), area: area.slice(0, 80), city: city.slice(0, 60) };
}

const BASE = 'https://nominatim.openstreetmap.org';
let nextRequestAt = 0;

/** Nominatim's public service allows at most one request per second per app instance. */
async function lookup<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const pause = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Date.now() + pause + 1100;
  if (pause) await new Promise<void>((resolve) => setTimeout(resolve, pause));
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = new URL(path, BASE);
  url.search = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'en', ...params }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Address lookup is unavailable');
  return response.json() as Promise<T>;
}

export async function searchStorePlace(query: string, signal: AbortSignal): Promise<{ lat: number; lng: number; label: string } | null> {
  const matches = await lookup<Array<{ lat: string; lon: string; display_name: string }>>('/search', { q: query, countrycodes: 'in', limit: '1' }, signal);
  const point = matches[0];
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  return inIndia(lat, lng) ? { lat, lng, label: point.display_name.split(',').slice(0, 3).join(',').trim() } : null;
}

export async function reverseStoreAddress(lat: number, lng: number, signal: AbortSignal): Promise<StoreAddress | null> {
  const data = await lookup<{ address?: AddressParts; display_name?: string }>('/reverse', { lat: String(lat), lon: String(lng), addressdetails: '1', zoom: '18' }, signal);
  return formatStoreAddress(data);
}
