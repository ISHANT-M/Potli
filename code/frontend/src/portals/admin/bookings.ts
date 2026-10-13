/** Admin booking search and detail with timeline, photos (lightbox), payment, rating, disputes and audit trail. */
import type { AdminBooking, AuditEntry, Paginated } from '../../../../shared/types';
import { BOOKING_STATUSES, STATUS_LABEL } from '../../../../shared/bookingStatus';
import { formatDateTime, formatINR, formatSlot } from '../../lib/format';
import { html } from '../../lib/html';
import { api, imageUrl } from '../../lib/session';
import { alert, badge, statusBadge } from '../../ui/components';
import { adminRoute, errorText, showAdmin } from './shell';

interface Handoff { type: string; method: string; bagCount: number; note: string; photoUrls: string[]; verifiedAt: string }
interface Detail {
  booking: AdminBooking;
  handoffs: Handoff[];
  payment: { method: string; status: string; amountPaise: number; platformFeePaise: number; partnerSharePaise: number; collectedAt: string | null; settled: boolean } | null;
  rating: { score: number; comment: string } | null;
  disputes: { id: string; raisedByRole: string; reason: string; status: string; resolution: string | null; createdAt: string }[];
  audit: AuditEntry[];
}

export const bookingsRoute = adminRoute('/admin/bookings', 'Bookings', async (el, ctx) => {
  const f = { q: ctx.query.get('q') ?? '', status: ctx.query.get('status') ?? '', city: ctx.query.get('city') ?? '' };
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  showAdmin(el, ctx.me, '#/admin/bookings', 'Bookings', html`<p>Loading...</p>`);
  try {
    const list = await api<Paginated<AdminBooking>>('GET', '/admin/bookings', { query: { ...f, page }, auth: 'required' });
    const last = Math.max(1, Math.ceil(list.total / list.pageSize));
    const link = (p: number): string => `#/admin/bookings?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(p) })}`;
    showAdmin(
      el,
      ctx.me,
      '#/admin/bookings',
      'Bookings',
      html`<form id="filters" class="card filter-bar"><label>Code or traveller email<input type="search" name="q" value="${f.q}" /></label>
          <label>Status<select name="status"><option value="">All</option>${BOOKING_STATUSES.map((s) => html`<option value="${s}" ${s === f.status ? html`selected` : ''}>${STATUS_LABEL[s]}</option>`)}</select></label>
          <label>City<input type="text" name="city" value="${f.city}" /></label><button class="button button-small" type="submit">Filter</button></form>
        <table class="table"><thead><tr><th>Code</th><th>Traveller</th><th>Partner</th><th>Slot</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        ${list.items.map((b) => html`<tr><td data-label="Code"><a href="#/admin/bookings/${b.id}">${b.code}</a></td><td data-label="Traveller">${b.traveler.fullName}<br><small>${b.traveler.email}</small></td><td data-label="Partner">${b.partner.businessName}<br><small>${b.listing.city}</small></td><td data-label="Slot">${formatSlot(b.slotStart, b.slotEnd)}</td><td data-label="Amount">${formatINR(b.finalPaise ?? b.quotedPaise)}</td><td data-label="Status">${statusBadge(b.status)}</td></tr>`)}
        </tbody></table>${list.items.length === 0 ? html`<p class="empty">No bookings match.</p>` : ''}
        <p class="pager">${page > 1 ? html`<a href="${link(page - 1)}">Previous</a>` : ''} Page ${page} of ${last} (${list.total}) ${page < last ? html`<a href="${link(page + 1)}">Next</a>` : ''}</p>`,
    );
    const form = el.querySelector<HTMLFormElement>('#filters');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      new FormData(form).forEach((value, key) => {
        if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
      });
      window.location.hash = `#/admin/bookings${params.size ? `?${params}` : ''}`;
    });
  } catch (err) {
    showAdmin(el, ctx.me, '#/admin/bookings', 'Bookings', alert('danger', errorText(err)));
  }
});

export const bookingDetailRoute = adminRoute('/admin/bookings/:id', 'Booking', async (el, ctx) => {
  const objectUrls: string[] = [];
  showAdmin(el, ctx.me, '#/admin/bookings', 'Booking', html`<p>Loading...</p>`);
  try {
    const d = await api<Detail>('GET', `/admin/bookings/${ctx.params.id}`, { auth: 'required' });
    const b = d.booking;
    const t = b.timeline;
    const steps: [string, string | null][] = [['Booked', t.bookedAt], ['Dropped off', t.droppedAt], ['Stored', t.storedAt], ['Picked up', t.pickedUpAt], ['Completed', t.completedAt], ['Cancelled', t.cancelledAt]];
    showAdmin(
      el,
      ctx.me,
      '#/admin/bookings',
      b.code,
      html`<p><a href="#/admin/bookings">Back to bookings</a></p>
        <section class="card"><h2>${b.code} ${statusBadge(b.status)}</h2>
          <dl class="facts"><dt>Slot</dt><dd>${formatSlot(b.slotStart, b.slotEnd)}</dd><dt>Bags</dt><dd>${b.bagCount}</dd><dt>Location</dt><dd>${b.listing.name}, ${b.listing.address}, ${b.listing.city}</dd>
          <dt>Traveller</dt><dd>${b.traveler.fullName}, ${b.traveler.email}${b.traveler.phone ? html`, ${b.traveler.phone}` : ''}</dd>
          <dt>Partner</dt><dd><a href="#/admin/partners/${b.partner.id}">${b.partner.businessName}</a> (${b.partner.fullName})</dd>
          ${b.cancelReason ? html`<dt>Cancel reason</dt><dd>${b.cancelReason}</dd>` : ''}</dl></section>
        <section class="card"><h2>Timeline</h2><ol class="timeline">${steps.filter(([, at]) => at).map(([label, at]) => html`<li><strong>${label}</strong> ${formatDateTime(at ?? '')}</li>`)}</ol></section>
        <section class="card"><h2>Payment</h2>${d.payment
          ? html`<dl class="facts"><dt>Method</dt><dd>${d.payment.method.toUpperCase()} (cash at counter)</dd><dt>Status</dt><dd>${badge(d.payment.status, d.payment.status === 'captured' ? 'success' : 'neutral')}</dd>
            <dt>Amount</dt><dd>${formatINR(d.payment.amountPaise)}${b.overstayPaise > 0 ? html` (includes ${formatINR(b.overstayPaise)} overstay)` : ''}</dd><dt>Platform fee</dt><dd>${formatINR(d.payment.platformFeePaise)} ${d.payment.status === 'captured' ? (d.payment.settled ? '(settled)' : '(due)') : ''}</dd>
            <dt>Partner share</dt><dd>${formatINR(d.payment.partnerSharePaise)}</dd></dl>`
          : html`<p>No payment record.</p>`}</section>
        <section class="card"><h2>Handoffs</h2>${d.handoffs.length === 0 ? html`<p>None yet.</p>` : d.handoffs.map((h) => html`<div class="handoff-record"><p><strong>${h.type === 'drop_off' ? 'Drop-off' : 'Pickup'}</strong> by ${h.method === 'qr' ? 'QR' : 'code'}, ${h.bagCount} bags, ${formatDateTime(h.verifiedAt)}${h.note ? html`. Note: ${h.note}` : ''}</p>
          <div class="thumbs">${h.photoUrls.map((u) => html`<button type="button" class="thumb" data-photo="${u}" aria-label="Open photo"><img alt="Handoff photo" /></button>`)}</div></div>`)}</section>
        <section class="card"><h2>Rating and disputes</h2><p>${d.rating ? html`${d.rating.score}/5${d.rating.comment ? html`: ${d.rating.comment}` : ''}` : 'Not rated.'}</p>
          ${d.disputes.map((x) => html`<p>${badge(x.status, x.status === 'open' ? 'warning' : 'neutral')} ${x.raisedByRole}: ${x.reason}${x.resolution ? html`<br><small>Resolution: ${x.resolution}</small>` : ''}</p>`)}</section>
        <section class="card"><h2>Audit trail</h2>${d.audit.length === 0 ? html`<p>No audited actions yet.</p>` : html`<ul class="plain">${d.audit.map((a) => html`<li>${formatDateTime(a.createdAt)} <strong>${a.action}</strong> by ${a.actor ? `${a.actor.fullName} (${a.actor.role})` : 'system'}</li>`)}</ul>`}</section>`,
    );
    const thumbs = [...el.querySelectorAll<HTMLButtonElement>('[data-photo]')];
    const dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.innerHTML = '<button type="button" class="button button-secondary button-small" aria-label="Close">Close</button><img alt="Handoff photo, enlarged" />';
    dialog.querySelector('button')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    el.append(dialog);
    thumbs.forEach((thumb) => {
      imageUrl(thumb.dataset.photo ?? '').then((url) => {
        objectUrls.push(url);
        const img = thumb.querySelector('img');
        if (img) img.src = url;
        thumb.addEventListener('click', () => {
          const big = dialog.querySelector('img');
          if (big) big.src = url;
          dialog.showModal();
        });
      }).catch(() => undefined);
    });
  } catch (err) {
    showAdmin(el, ctx.me, '#/admin/bookings', 'Booking', alert('danger', errorText(err)));
  }
  return () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
});
