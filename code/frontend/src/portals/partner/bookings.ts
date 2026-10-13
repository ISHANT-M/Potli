/** Partner bookings list with filters, search and paging. */
import type { Paginated, PartnerBooking, PartnerListing } from '../../../../shared/types';
import { BOOKING_STATUSES, STATUS_LABEL } from '../../../../shared/bookingStatus';
import { formatINR, formatSlot } from '../../lib/format';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { alert, statusBadge } from '../../ui/components';
import { errorText, showPartner } from './shell';

export const bookingsRoute: RouteDef = {
  path: '/partner/bookings',
  title: 'Bookings',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    const q = ctx.query;
    const page = Number(q.get('page') ?? '1') || 1;
    showPartner(el, me, '#/partner/bookings', 'Bookings', html`<p>Loading...</p>`);
    try {
      const filters = { status: q.get('status') ?? '', listingId: q.get('listingId') ?? '', date: q.get('date') ?? '', q: q.get('q') ?? '' };
      const [list, mine] = await Promise.all([
        api<Paginated<PartnerBooking>>('GET', '/partner/bookings', { query: { ...filters, page }, auth: 'required' }),
        api<{ items: PartnerListing[] }>('GET', '/partner/listings', { auth: 'required' }),
      ]);
      const href = (p: number): string => `#/partner/bookings?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: String(p) })}`;
      const last = Math.max(1, Math.ceil(list.total / list.pageSize));
      showPartner(
        el,
        me,
        '#/partner/bookings',
        'Bookings',
        html`<form class="card filter-bar" id="filters">
          <label>Code<input type="search" name="q" value="${filters.q}" placeholder="PT-ABC234" /></label>
          <label>Status<select name="status"><option value="">All</option>${BOOKING_STATUSES.map((s) => html`<option value="${s}" ${s === filters.status ? html`selected` : ''}>${STATUS_LABEL[s]}</option>`)}</select></label>
          <label>Listing<select name="listingId"><option value="">All</option>${mine.items.map((l) => html`<option value="${l.id}" ${l.id === filters.listingId ? html`selected` : ''}>${l.name}</option>`)}</select></label>
          <label>Date<input type="date" name="date" value="${filters.date}" /></label>
          <button class="button button-small" type="submit">Filter</button></form>
        ${list.items.length === 0 ? html`<section class="card"><p>No bookings match.</p></section>` : ''}
        <div class="booking-list">${list.items.map(
          (b) => html`<article class="card booking-row"><div><a href="#/partner/bookings/${b.id}"><strong>${b.code}</strong></a> ${statusBadge(b.status)} ${b.isOverdue ? html`<span class="badge badge-warning">Overdue</span>` : ''}
            <p>${b.traveler.fullName}${b.traveler.phone ? html` | ${b.traveler.phone}` : ''} | ${b.bagCount} ${b.bagCount === 1 ? 'bag' : 'bags'} | ${b.listing.name}</p>
            <p>${formatSlot(b.slotStart, b.slotEnd)}</p></div>
            <div class="booking-money"><span>${formatINR(b.finalPaise ?? b.quotedPaise + b.overstayPaise)}</span>
            ${b.feePaise !== null ? html`<small>Fee ${formatINR(b.feePaise)} | Yours ${formatINR(b.partnerSharePaise ?? 0)}</small>` : html`<small>${b.paymentMethod.toUpperCase()}, ${b.paymentStatus}</small>`}
            ${b.overstayPaise > 0 ? html`<small>Includes overstay ${formatINR(b.overstayPaise)}</small>` : ''}</div></article>`,
        )}</div>
        <p class="pager">${page > 1 ? html`<a href="${href(page - 1)}">Previous</a>` : ''} Page ${page} of ${last} ${page < last ? html`<a href="${href(page + 1)}">Next</a>` : ''}</p>`,
      );
      const form = el.querySelector<HTMLFormElement>('#filters');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(form).forEach((value, key) => {
          if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
        });
        window.location.hash = `#/partner/bookings${params.size ? `?${params}` : ''}`;
      });
    } catch (err) {
      showPartner(el, me, '#/partner/bookings', 'Bookings', alert('danger', errorText(err)));
    }
  },
};
