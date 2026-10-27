/** Shared map picker for the partner application and the public listing form. */
import { inIndia, reverseStoreAddress, searchStorePlace } from './geo';

export interface LocationPicker {
  destroy(): void;
  refresh(): void;
}

export async function mountLocationPicker(form: HTMLFormElement, mapEl: HTMLElement): Promise<LocationPicker> {
  const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  if (!mapEl.isConnected) return { destroy() {}, refresh() {} };

  const field = mapEl.closest<HTMLElement>('.map-field');
  const lat = form.elements.namedItem('latitude') as HTMLInputElement;
  const lng = form.elements.namedItem('longitude') as HTMLInputElement;
  const address = form.elements.namedItem('address') as HTMLInputElement;
  const city = form.elements.namedItem('city') as HTMLInputElement;
  const area = form.elements.namedItem('area') as HTMLInputElement | null;
  const status = field?.querySelector<HTMLElement>('[data-location-status]');
  const search = field?.querySelector<HTMLInputElement>('[data-location-search]');
  const find = field?.querySelector<HTMLButtonElement>('[data-location-find]');
  const locate = field?.querySelector<HTMLButtonElement>('[data-location-use]');
  const centre = field?.querySelector<HTMLButtonElement>('[data-location-centre]');
  const disabled = () => Boolean(mapEl.closest('fieldset:disabled'));
  const hasPin = lat.value !== '' && lng.value !== '' && inIndia(Number(lat.value), Number(lng.value));
  const map = L.map(mapEl).setView(hasPin ? [Number(lat.value), Number(lng.value)] : [22.9, 79], hasPin ? 16 : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const pin = L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });
  let marker: L.Marker | null = null;
  let request: AbortController | null = null;
  let version = 0;
  let disposed = false;
  const say = (message: string) => { if (status) status.textContent = message; };

  const select = (point: L.LatLng, pan = false, lookup = true): void => {
    if (disabled() && lookup) return;
    if (!inIndia(point.lat, point.lng)) return say('Choose a location in India.');
    request?.abort();
    const selected = ++version;
    lat.value = point.lat.toFixed(6);
    lng.value = point.lng.toFixed(6);
    if (!marker) {
      marker = L.marker(point, { draggable: !disabled(), icon: pin }).addTo(map);
      marker.on('dragend', () => select(marker!.getLatLng()));
    } else marker.setLatLng(point);
    if (pan) map.setView(point, 16);
    if (!lookup) return say(`Pin set at ${lat.value}, ${lng.value}.`);
    say('Finding the address for this pin…');
    request = new AbortController();
    const before = { address: address.value, city: city.value, area: area?.value };
    void reverseStoreAddress(point.lat, point.lng, request.signal).then((found) => {
      if (disposed || selected !== version) return;
      if (!found) return say('Pin set. Address not found; enter the address and city below.');
      if (address.value === before.address) address.value = found.address;
      if (city.value === before.city) city.value = found.city;
      if (area && area.value === before.area) area.value = found.area;
      say('Address filled from the map. Check the building and street details before continuing.');
    }).catch((error: unknown) => {
      if (!disposed && selected === version && !(error instanceof DOMException && error.name === 'AbortError')) {
        say('Pin set, but address lookup is unavailable. Enter the address and city below.');
      }
    });
  };

  if (hasPin) select(L.latLng(Number(lat.value), Number(lng.value)), false, false);
  map.on('click', (e: L.LeafletMouseEvent) => select(e.latlng));
  const findPlace = async (): Promise<void> => {
    const query = search?.value.trim() ?? '';
    if (!query) return say('Enter a city, street or landmark to find it on the map.');
    request?.abort();
    const selected = ++version;
    request = new AbortController();
    say('Searching for that place…');
    try {
      const point = await searchStorePlace(query, request.signal);
      if (disposed || selected !== version) return;
      if (!point) return say('No place found in India. Try a nearby street or landmark.');
      map.setView([point.lat, point.lng], 13);
      say(`Map moved near ${point.label}. Tap the store entrance on the map to place your pin.`);
    } catch (error) {
      if (!disposed && selected === version && !(error instanceof DOMException && error.name === 'AbortError')) say('Place search is unavailable. Zoom in or use your current location instead.');
    }
  };
  find?.addEventListener('click', findPlace);
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void findPlace(); }
  });
  centre?.addEventListener('click', () => select(map.getCenter()));
  locate?.addEventListener('click', () => {
    if (!navigator.geolocation) return say('Location is unavailable on this device. Choose a place on the map instead.');
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!disposed) select(L.latLng(pos.coords.latitude, pos.coords.longitude), true); },
      () => { if (!disposed) say('Location access was denied. Choose a place on the map instead.'); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });

  return {
    destroy() { disposed = true; request?.abort(); map.remove(); },
    refresh() { if (!disposed) map.invalidateSize(); },
  };
}
