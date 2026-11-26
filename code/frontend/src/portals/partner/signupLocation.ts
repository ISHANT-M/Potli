import { html } from '../../lib/html';
import { inIndia } from './geo';
import { mountLocationPicker } from './locationPicker';

export function signupLocationFields() {
  return html`<div class="map-field signup-map-field">
    <span class="label-text" id="signup-map-label">Pin your store entrance (required)</span>
    <p class="field-hint">Find a nearby landmark, then tap the store entrance or use the map centre. You can drag the pin to adjust it.</p>
    <div class="map-search"><input type="search" data-location-search placeholder="City, street or landmark" aria-label="Search for your store’s location" /><button class="button button-secondary button-small" type="button" data-location-find>Find place</button></div>
    <div id="signup-pin-map" class="pin-map" role="application" aria-labelledby="signup-map-label"></div>
    <div class="map-actions"><button class="button button-secondary button-small" type="button" data-location-centre>Pin map centre</button><button class="button button-secondary button-small" type="button" data-location-use>Use my current location</button></div>
    <p class="field-hint" data-location-status role="status" tabindex="-1">No pin selected. We’ll reuse this pin when you create your first listing after approval.</p>
    <p class="field-hint" data-basemap-warning role="status" hidden>Map background unavailable. Enter the store coordinates below.</p>
    <details data-location-coordinates><summary>Enter coordinates instead</summary>
      <p class="field-hint">If the map doesn’t load, copy the latitude and longitude of the entrance from your maps app.</p>
      <div class="two-col"><label>Latitude<input type="text" inputmode="decimal" name="latitude" /></label><label>Longitude<input type="text" inputmode="decimal" name="longitude" /></label></div>
    </details>
  </div>
  <label>Business address<input type="text" name="address" placeholder="Building and street" autocomplete="street-address" maxlength="200" required /></label>
  <label>City<input type="text" name="city" autocomplete="address-level2" maxlength="60" required /></label>`;
}

export function readStorePin(data: FormData): { latitude: number; longitude: number } | null {
  const latitude = Number(data.get('latitude'));
  const longitude = Number(data.get('longitude'));
  return inIndia(latitude, longitude) ? { latitude, longitude } : null;
}

export async function mountSignupLocation(form: HTMLFormElement) {
  const map = form.querySelector<HTMLElement>('#signup-pin-map');
  if (!map) return;
  try {
    return await mountLocationPicker(form, map);
  } catch {
    if (!map.isConnected) return;
    map.hidden = true;
    const field = map.closest('.map-field');
    field?.querySelectorAll<HTMLElement>('.map-search, .map-actions').forEach((control) => { control.hidden = true; });
    const status = field?.querySelector<HTMLElement>('[data-location-status]');
    if (status) status.textContent = 'Map unavailable. Enter your store coordinates below.';
    const coordinates = field?.querySelector<HTMLDetailsElement>('[data-location-coordinates]');
    if (coordinates) coordinates.open = true;
  }
}
