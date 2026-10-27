/** Listings: list, create and edit with a Leaflet pin picker and a live price preview. */
import type { PartnerListing } from '../../../../shared/types';
import { quote } from '../../../../shared/pricing';
import { formatClock, formatINR } from '../../lib/format';
import { clearFieldErrors, readForm, setBusy, setMessage, showFieldErrors } from '../../lib/forms';
import { compressImage } from '../../lib/image';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { ApiRequestError } from '../../lib/api';
import { alert, badge } from '../../ui/components';
import { errorText, showPartner } from './shell';
import { mountLocationPicker } from './locationPicker';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

function coverCard(l: PartnerListing) {
  return html`<form class="card partner-form" id="cover-form"><h2>Cover photo</h2>${l.coverUrl ? html`<p class="field-hint">A cover photo is set. Choose a new one to replace it.</p>` : ''}
    <label>Photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label><button class="button button-secondary" type="submit">Upload cover photo</button><p class="form-message" role="status"></p></form>`;
}

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
      <div class="map-field"><span class="label-text" id="listing-map-label">Pin the exact location</span>
        <p class="field-hint">Search for a place, then tap the map, drag the pin or choose the map centre. Check the address we fill below.</p>
        <div class="map-search"><input type="search" data-location-search placeholder="City, street or landmark" aria-label="Search for the listing location" /><button class="button button-secondary button-small" type="button" data-location-find>Find place</button></div>
        <div id="pin-map" class="pin-map" role="application" aria-labelledby="listing-map-label"></div>
        <div class="map-actions"><button class="button button-secondary button-small" type="button" data-location-centre>Pin map centre</button><button class="button button-secondary button-small" type="button" data-location-use>Use my current location</button></div>
        <p class="field-hint" data-location-status role="status">${l ? 'Move the pin if the location has changed.' : 'Choose a pin to place your listing on the public map.'}</p>
        <input type="hidden" name="latitude" value="${l?.latitude ?? ''}" /><input type="hidden" name="longitude" value="${l?.longitude ?? ''}" /></div>
      <label>Address<input type="text" name="address" value="${l?.address ?? ''}" maxlength="200" required /></label>
      <div class="two-col"><label>Area or landmark<input type="text" name="area" value="${l?.area ?? ''}" maxlength="80" /></label>
      <label>City<input type="text" name="city" value="${l?.city ?? ''}" maxlength="60" required /></label></div>
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
      showPartner(el, me, '#/partner/listings', listing ? 'Edit listing' : 'New listing', html`<p><a href="#/partner/listings">Back to listings</a></p>${suspended ? alert('warning', 'Your account is suspended, so listings are read-only.') : ''}${formView(listing)}${listing && listing.status !== 'flagged' && !suspended ? coverCard(listing) : ''}`);
      const form = el.querySelector<HTMLFormElement>('#listing-form');
      const mapEl = el.querySelector<HTMLElement>('#pin-map');
      if (!form || !mapEl) return;
      if (suspended) form.querySelector('fieldset')?.setAttribute('disabled', '');
      const picker = await mountLocationPicker(form, mapEl);
      const cover = el.querySelector<HTMLFormElement>('#cover-form');
      cover?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const file = cover.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0];
        if (!file || !listing) return setMessage(cover, 'Choose a photo first.', 'error');
        const submit = cover.querySelector<HTMLButtonElement>('[type="submit"]');
        setBusy(submit, true, 'Uploading...');
        try {
          const data = new FormData();
          data.append('photo', await compressImage(file), 'cover.jpg');
          await api('POST', `/partner/listings/${listing.id}/cover`, { form: data, auth: 'required' });
          setMessage(cover, 'Cover photo saved.', 'success');
        } catch (err) {
          setMessage(cover, errorText(err), 'error');
        }
        setBusy(submit, false);
      });

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
      return () => picker.destroy();
    },
  };
}

export const listingRoutes: RouteDef[] = [listRoute, formRoute('/partner/listings/new', 'New listing'), formRoute('/partner/listings/:id', 'Edit listing')];
