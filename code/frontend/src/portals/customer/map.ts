/** Leaflet (OpenStreetMap) loaded on demand; one pin per point. */
import { escapeHtml } from '../../lib/html';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export async function showMap(
  container: HTMLElement,
  points: MapPoint[],
  options: { interactive?: boolean; onSelect?: (id: string) => void } = {},
): Promise<() => void> {
  const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  const interactive = options.interactive ?? true;
  const map = L.map(container, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: false, doubleClickZoom: interactive, touchZoom: interactive, keyboard: interactive });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const bounds = L.latLngBounds([]);
  for (const point of points) {
    const marker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({ className: 'cx-pin', html: `<span>${escapeHtml(point.label)}</span>`, iconSize: [60, 26], iconAnchor: [30, 26] }),
      keyboard: interactive,
      title: point.label,
    }).addTo(map);
    marker.on('click', () => options.onSelect?.(point.id));
    bounds.extend([point.lat, point.lng]);
  }
  if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 15);
  else if (points.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  else map.setView([22.5, 79], 4);
  return () => map.remove();
}
