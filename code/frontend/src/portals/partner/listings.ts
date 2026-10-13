/** Listings: list, create and edit with a Leaflet pin picker and a live price preview. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PartnerListing } from '../../../../shared/types';
import { quote } from '../../../../shared/pricing';
import { formatClock, formatINR } from '../../lib/format';
import { clearFieldErrors, readForm, setBusy, setMessage, showFieldErrors } from '../../lib/forms';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { ApiRequestError } from '../../lib/api';
import { alert, badge } from '../../ui/components';
import { errorText, showPartner } from './shell';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INDIA_CENTRE: L.LatLngTuple = [22.9, 79];
const toPaise = (rupees: string): number => Math.round(Number(rupees) * 100);

const statusBadge = (listing: PartnerListing) =>
  badge(listing.status === 'active' ? 'Active' : listing.status === 'paused' ? 'Paused' : 'Flagged', listing.status === 'active' ? 'success' : listing.status === 'paused' ? 'neutral' : 'danger');

const listRoute: RouteDef = {
  path: '/partner/listings',
  title: 'Listings',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    showPartner(el, me, '#/partner/listings', 'Listings', html`<p>Loading...</p>`);
    try {
      const { items } = await api<{ items: PartnerListing[] }>('GET', '/partner/listings', { auth: 'required' });
      const create = me.partner?.status === 'approved' ? html`<a class="button" href="#/partner/listings/new">Add a listing</a>` : '';
      showPartner(
        el,
        me,
        '#/partner/listings',
        'Listings',
        html`<p class="partner-actions">${create}</p>
        ${items.length === 0 ? html`<section class="card"><p>No listings yet. Add your first storage location to start receiving bookings.</p></section>` : ''}
        <div class="listing-grid">${items.map(
          (l) => html`<article class="card listing-card"><h2>${l.name} ${statusBadge(l)}</h2><p>${l.address}, ${l.city}</p>
            <p>${l.capacity} bags | ${formatINR(l.hourlyRatePaise)}/bag/hour | cap ${formatINR(l.dailyCapPaise)}/day</p>
            <p>${formatClock(l.openTime)} to ${formatClock(l.closeTime)} | ${l.openDays.map((d) => DAYS[d]).join(', ')}</p>
            ${l.status === 'flagged' ? alert('danger', html`Flagged by Potli: ${l.flagReason ?? 'no reason given'}`) : ''}
            <a class="button button-secondary button-small" href="#/partner/listings/${l.id}">${l.status === 'flagged' ? 'View' : 'Edit'}</a></article>`,
        )}</div>`,
      );
    } catch (err) {
      showPartner(el, me, '#/partner/listings', 'Listings', alert('danger', errorText(err)));
    }
  },
};

function formView(listing: PartnerListing | null) {
  const l = listing;
  const days = l?.openDays ?? [0, 1, 2, 3, 4, 5, 6];
  const readOnly = l?.status === 'flagged';
  const lock = readOnly ? html`disabled` : '';
  return html`${readOnly ? alert('danger', html`This listing was flagged by Potli${l?.flagReason ? html`: ${l.flagReason}` : ''}. Contact support to have it reviewed.`) : ''}
  <form class="card partner-form" id="listing-form" novalidate>
    <fieldset ${lock}>
      <label>Name<input type="text" name="name" maxlength="80" value="${l?.name ?? ''}" required /></label>
      <label>Description<textarea name="description" maxlength="600" rows="3">${l?.description ?? ''}</textarea></label>
      <label>Address<input type="text" name="address" value="${l?.address ?? ''}" required /></label>
      <div class="two-col"><label>Area or landmark<input type="text" name="area" value="${l?.area ?? ''}" /></label>
      <label>City<input type="text" name="city" value="${l?.city ?? ''}" required /></label></div>
      <div class="map-field"><span class="label-text">Pin the exact location (tap the map or drag the pin)</span>
        <div id="pin-map" class="pin-map" role="application" aria-label="Map to place the location pin"></div>
        <button class="button button-secondary button-small" type="button" id="locate">Use my current location</button>
        <small class="field-hint" id="coords"></small>
        <input type="hidden" name="latitude" value="${l?.latitude ?? ''}" /><input type="hidden" name="longitude" value="${l?.longitude ?? ''}" /></div>
      <div class="two-col"><label>Capacity (bags)<input type="number" name="capacity" min="1" max="200" step="1" value="${l?.capacity ?? 10}" required /></label>
      <label>Status<select name="status"><option value="active" ${l?.status !== 'paused' ? html`selected` : ''}>Active</option><option value="paused" ${l?.status === 'paused' ? html`selected` : ''}>Paused</option></select></label></div>
      <div class="two-col"><label>Rate per bag per hour (₹)<input type="number" name="hourlyRatePaise" min="10" max="1000" step="1" value="${l ? l.hourlyRatePaise / 100 : 50}" required /></label>
      <label>Daily cap per bag (₹)<input type="number" name="dailyCapPaise" min="10" max="24000" step="1" value="${l ? l.dailyCapPaise / 100 : 300}" required /></label></div>
      <p class="field-hint" id="preview" aria-live="polite"></p>
      <div class="two-col"><label>Opens<input type="time" name="openTime" value="${l?.openTime ?? '08:00'}" required /></label>
      <label>Closes<input type="time" name="closeTime" value="${l?.closeTime ?? '20:00'}" required /></label></div>
      <div class="day-toggles" role="group" aria-label="Open days">${DAYS.map((d, i) => html`<label class="day"><input type="checkbox" name="day" value="${i}" ${days.includes(i) ? html`checked` : ''} /><span>${d}</span></label>`)}</div>
    </fieldset>
    ${readOnly ? '' : html`<button class="button" type="submit">${l ? 'Save changes' : 'Create listing'}</button>`}
    <p class="form-message" role="status"></p>
  </form>`;
}

function pinPicker(form: HTMLFormElement, mapEl: HTMLElement): () => void {
  const lat = form.elements.namedItem('latitude') as HTMLInputElement;
  const lng = form.elements.namedItem('longitude') as HTMLInputElement;
  const coords = form.querySelector<HTMLElement>('#coords');
  const has = lat.value !== '' && lng.value !== '';
  const map = L.map(mapEl).setView(has ? [Number(lat.value), Number(lng.value)] : INDIA_CENTRE, has ? 15 : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const pin = L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });
  let marker: L.Marker | null = null;
  const place = (point: L.LatLng, pan = false): void => {
    lat.value = point.lat.toFixed(6);
    lng.value = point.lng.toFixed(6);
    if (coords) coords.textContent = `Pin at ${lat.value}, ${lng.value}`;
    if (!marker) {
      marker = L.marker(point, { draggable: true, icon: pin }).addTo(map);
      marker.on('dragend', () => place(marker!.getLatLng()));
    } else marker.setLatLng(point);
    if (pan) map.setView(point, 16);
  };
  if (has) place(L.latLng(Number(lat.value), Number(lng.value)));
  map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng));
  form.querySelector('#locate')?.addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => place(L.latLng(pos.coords.latitude, pos.coords.longitude), true),
      () => setMessage(form, 'Location access was denied. Tap the map to place the pin instead.', 'error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
  return () => map.remove();
}

function formRoute(path: string, title: string): RouteDef {
  return {
    path,
    title,
    guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
    async mount(el, ctx) {
      const me = ctx.me;
      if (!me) return;
      let listing: PartnerListing | null = null;
      if (ctx.params.id) {
        try {
          listing = (await api<{ listing: PartnerListing }>('GET', `/partner/listings/${ctx.params.id}`, { auth: 'required' })).listing;
        } catch (err) {
          showPartner(el, me, '#/partner/listings', 'Listing', alert('danger', errorText(err)));
          return;
        }
      }
      const suspended = me.partner?.status === 'suspended';
      showPartner(el, me, '#/partner/listings', listing ? 'Edit listing' : 'New listing', html`<p><a href="#/partner/listings">Back to listings</a></p>${suspended ? alert('warning', 'Your account is suspended, so listings are read-only.') : ''}${formView(listing)}`);
      const form = el.querySelector<HTMLFormElement>('#listing-form');
      const mapEl = el.querySelector<HTMLElement>('#pin-map');
      if (!form || !mapEl) return;
      const destroyMap = pinPicker(form, mapEl);
      if (suspended) form.querySelector('fieldset')?.setAttribute('disabled', '');

      const preview = form.querySelector<HTMLElement>('#preview');
      const updatePreview = (): void => {
        const v = readForm(form);
        const hourly = toPaise(v.hourlyRatePaise ?? '');
        const daily = toPaise(v.dailyCapPaise ?? '');
        if (preview && hourly > 0 && daily > 0) preview.textContent = `4 h for 2 bags = ${formatINR(quote({ hourlyRatePaise: hourly, dailyCapPaise: daily }, 2, new Date(0), new Date(4 * 3_600_000)).totalPaise)}`;
      };
      form.addEventListener('input', updatePreview);
      updatePreview();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        const v = readForm(form);
        const openDays = [...form.querySelectorAll<HTMLInputElement>('input[name="day"]:checked')].map((box) => Number(box.value));
        if (v.latitude === '' || v.longitude === '') return setMessage(form, 'Place the pin on the map first.', 'error');
        const body = {
          name: v.name, description: v.description ?? '', address: v.address, area: v.area ?? '', city: v.city,
          latitude: Number(v.latitude), longitude: Number(v.longitude), capacity: Number(v.capacity),
          hourlyRatePaise: toPaise(v.hourlyRatePaise ?? ''), dailyCapPaise: toPaise(v.dailyCapPaise ?? ''),
          openTime: v.openTime, closeTime: v.closeTime, openDays, status: v.status,
        };
        const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
        setBusy(submit, true, 'Saving...');
        try {
          await (listing
            ? api('PATCH', `/partner/listings/${listing.id}`, { body, auth: 'required' })
            : api('POST', '/partner/listings', { body, auth: 'required' }));
          window.location.hash = '#/partner/listings';
        } catch (err) {
          if (err instanceof ApiRequestError) showFieldErrors(form, err.fields);
          setMessage(form, errorText(err), 'error');
          setBusy(submit, false);
        }
      });
      return destroyMap;
    },
  };
}

export const listingRoutes: RouteDef[] = [listRoute, formRoute('/partner/listings/new', 'New listing'), formRoute('/partner/listings/:id', 'Edit listing')];
