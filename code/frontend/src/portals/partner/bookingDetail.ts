/** Partner booking detail: timeline, handoff photos, payment line, cancel and report a problem. */
import type { PartnerBooking } from '../../../../shared/types';
import { formatDateTime, formatINR, formatSlot } from '../../lib/format';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, imageUrl } from '../../lib/session';
import { alert, statusBadge } from '../../ui/components';
import { confirmDialog } from '../admin/shell';
import { errorText, showPartner } from './shell';

interface Handoff { type: string; method: string; bagCount: number; note: string; photoUrls: string[]; verifiedAt: string }

export const bookingDetailRoute: RouteDef = {
  path: '/partner/bookings/:id',
  title: 'Booking',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    const urls: string[] = [];
    const load = async (): Promise<void> => {
      try {
        const d = await api<{ booking: PartnerBooking; handoffs: Handoff[] }>('GET', `/partner/bookings/${ctx.params.id}`, { auth: 'required' });
        const b = d.booking;
        const t = b.timeline;
        const steps: [string, string | null][] = [['Booked', t.bookedAt], ['Dropped off', t.droppedAt], ['Stored', t.storedAt], ['Picked up', t.pickedUpAt], ['Completed', t.completedAt], ['Cancelled', t.cancelledAt]];
        const canReport = !['booked', 'pending_payment'].includes(b.status);
        showPartner(
          el,
          me,
          '#/partner/bookings',
          b.code,
          html`<p><a href="#/partner/bookings">Back to bookings</a></p><p class="notice" id="notice" role="status"></p>
          <section class="card"><h2>${b.code} ${statusBadge(b.status)} ${b.isOverdue ? html`<span class="badge badge-warning">Overdue</span>` : ''}</h2>
            <dl class="facts"><dt>Traveller</dt><dd>${b.traveler.fullName}${b.traveler.phone ? html`, ${b.traveler.phone}` : ''}</dd><dt>Bags</dt><dd>${b.bagCount}</dd><dt>Slot</dt><dd>${formatSlot(b.slotStart, b.slotEnd)}</dd><dt>Listing</dt><dd>${b.listing.name}</dd>
            ${b.cancelReason ? html`<dt>Cancel reason</dt><dd>${b.cancelReason}</dd>` : ''}</dl>
            <p>${b.status === 'booked' ? html`<button class="button button-danger button-small" type="button" id="cancel">Cancel booking</button> ` : ''}${canReport ? html`<button class="button button-secondary button-small" type="button" id="report">Report a problem</button>` : ''}</p></section>
          <section class="card"><h2>Timeline</h2><ol class="timeline">${steps.filter(([, at]) => at).map(([label, at]) => html`<li><strong>${label}</strong> ${formatDateTime(at ?? '')}</li>`)}</ol></section>
          <section class="card"><h2>Payment</h2><dl class="facts"><dt>Method</dt><dd>${b.paymentMethod.toUpperCase()} (cash at counter), ${b.paymentStatus}</dd><dt>Amount</dt><dd>${formatINR(b.finalPaise ?? b.quotedPaise + b.overstayPaise)}${b.overstayPaise > 0 ? html` (includes overstay ${formatINR(b.overstayPaise)})` : ''}</dd>
            ${b.feePaise !== null ? html`<dt>Platform fee</dt><dd>${formatINR(b.feePaise)}</dd><dt>Your share</dt><dd>${formatINR(b.partnerSharePaise ?? 0)}</dd>` : ''}</dl></section>
          <section class="card"><h2>Handoffs</h2>${d.handoffs.length === 0 ? html`<p>None yet.</p>` : d.handoffs.map((h) => html`<p><strong>${h.type === 'drop_off' ? 'Drop-off' : 'Pickup'}</strong> by ${h.method === 'qr' ? 'QR' : 'code'}, ${h.bagCount} bags, ${formatDateTime(h.verifiedAt)}${h.note ? html`. Note: ${h.note}` : ''}</p>
            <div class="thumbs">${h.photoUrls.map((u) => html`<img alt="Handoff photo" data-photo="${u}" width="96" height="96" />`)}</div>`)}</section>`,
        );
        el.querySelectorAll<HTMLImageElement>('img[data-photo]').forEach((img) => {
          imageUrl(img.dataset.photo ?? '').then((u) => { urls.push(u); img.src = u; }).catch(() => undefined);
        });
        const act = (selector: string, options: Parameters<typeof confirmDialog>[0], path: string, done: string): void => {
          el.querySelector(selector)?.addEventListener('click', async () => {
            const reason = await confirmDialog(options);
            if (!reason) return;
            const notice = el.querySelector<HTMLElement>('#notice');
            try {
              await api('POST', `/partner/bookings/${b.id}/${path}`, { body: { reason }, auth: 'required' });
              if (path === 'cancel') await load();
              if (notice) notice.textContent = done;
            } catch (err) {
              if (notice) notice.textContent = errorText(err);
            }
          });
        };
        act('#cancel', { title: 'Cancel this booking?', text: 'The traveller will see it as cancelled. Only booked items can be cancelled.', confirmLabel: 'Cancel booking', reason: true, danger: true }, 'cancel', 'Booking cancelled.');
        act('#report', { title: 'Report a problem', text: 'Describe what went wrong. Potli will review it.', confirmLabel: 'Send report', reason: true }, 'disputes', 'Report sent to Potli.');
      } catch (err) {
        showPartner(el, me, '#/partner/bookings', 'Booking', alert('danger', errorText(err)));
      }
    };
    await load();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  },
};
