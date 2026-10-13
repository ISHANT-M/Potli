/** #/app/book/:listingId: review the price and confirm with Cash on pickup. */
import type { Booking, ListingDetail } from '../../../../shared/types';
import { ApiRequestError } from '../../lib/api';
import { formatDateTime, formatDuration, formatINR } from '../../lib/format';
import { html, mount } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { setBusy } from '../../lib/forms';
import { clampBags, errorBox, hoursLabel, portalPage, skeleton, toast, validDate } from './common';
import { breakdown, quoteMessage, type QuoteResult } from './listing';

export const checkoutRoute: RouteDef = {
  path: '/app/book/:listingId',
  title: 'Checkout',
  guard: { roles: ['traveler'], verified: true },
  async mount(el, ctx) {
    if (!ctx.me) return;
    const body = portalPage(el, ctx.me, '#/search', 'Checkout');
    mount(body, skeleton(3));
    const listingId = ctx.params.listingId ?? '';
    const start = validDate(ctx.query.get('start'));
    const end = validDate(ctx.query.get('end'));
    const bags = clampBags(ctx.query.get('bags'));
    if (!start || !end) {
      mount(body, html`<div class="card"><p>Pick a time first.</p><a class="button" href="#/listing/${listingId}">Choose a time</a></div>`);
      return;
    }
    // One key per visit: a retry after a network error returns the same booking instead of a second one.
    const idempotencyKey = crypto.randomUUID();

    try {
      const [{ listing }, q] = await Promise.all([
        api<{ listing: ListingDetail }>('GET', `/listings/${encodeURIComponent(listingId)}`, { auth: 'none' }),
        api<QuoteResult>('GET', `/listings/${encodeURIComponent(listingId)}/quote`, { query: { start, end, bags }, auth: 'none' }),
      ]);
      const back = `#/listing/${listing.id}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&bags=${bags}`;
      if (!q.available) {
        mount(body, html`<div class="card"><div class="alert alert-warning" role="alert">${quoteMessage(q)}</div><p><a class="button" href="${back}">Choose another time</a></p></div>`);
        return;
      }
      mount(
        body,
        html`<form class="cx-checkout" novalidate>
          <section class="card"><h2>${listing.name}</h2>
            <p class="cx-muted">${listing.address}, ${listing.city} · open ${hoursLabel(listing.openTime, listing.closeTime)}</p>
            <dl class="cx-dl"><dt>Drop-off</dt><dd>${formatDateTime(start)}</dd><dt>Pick-up</dt><dd>${formatDateTime(end)}</dd>
              <dt>Duration</dt><dd>${formatDuration(new Date(end).getTime() - new Date(start).getTime())}</dd><dt>Bags</dt><dd>${bags}</dd></dl>
            <p><a href="${back}">Change</a></p></section>
          <section class="card"><h2>Price</h2>
            <p class="cx-price">${formatINR(q.quotedPaise)}</p><p class="cx-muted">${breakdown(listing, bags, q.hours)}</p>
            <p class="cx-muted">The final amount may increase if you collect your bags after the end time.</p></section>
          <fieldset class="card cx-pay"><legend>Payment method</legend>
            <label class="cx-radio is-on"><input type="radio" name="pay" value="cod" checked /><span><strong>Cash on pickup</strong><br /><span class="cx-muted">Pay the partner when you collect your bags.</span></span></label>
            <label class="cx-radio is-off"><input type="radio" name="pay" value="upi" disabled /><span><strong>UPI</strong> <span class="badge">Coming soon</span></span></label>
            <label class="cx-radio is-off"><input type="radio" name="pay" value="card" disabled /><span><strong>Card</strong> <span class="badge">Coming soon</span></span></label>
          </fieldset>
          <div id="co-error" role="alert"></div>
          <button class="button" type="submit">Confirm booking</button>
        </form>`,
      );
      const form = body.querySelector<HTMLFormElement>('form')!;
      const errorBoxEl = body.querySelector<HTMLElement>('#co-error')!;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
        setBusy(button, true, 'Booking…');
        mount(errorBoxEl, html``);
        let searchStartedAt: string | undefined;
        try {
          searchStartedAt = sessionStorage.getItem('potli.searchStartedAt') ?? undefined;
        } catch {
          /* optional */
        }
        try {
          const { booking } = await api<{ booking: Booking }>('POST', '/bookings', {
            auth: 'required',
            idempotencyKey,
            body: { listingId: listing.id, bags, slotStart: start, slotEnd: end, paymentMethod: 'cod', ...(searchStartedAt ? { searchStartedAt } : {}) },
          });
          try {
            sessionStorage.removeItem('potli.searchStartedAt');
          } catch {
            /* optional */
          }
          toast('Booking confirmed. Show your code at drop-off.');
          window.location.hash = `#/app/bookings/${booking.id}`;
        } catch (err) {
          setBusy(button, false);
          const code = err instanceof ApiRequestError ? err.code : '';
          if (code === 'CAPACITY_UNAVAILABLE') {
            mount(errorBoxEl, html`<div class="alert alert-danger">Those spaces were just taken. <a href="${back}">Choose another time.</a></div>`);
          } else if (code === 'EMAIL_NOT_VERIFIED') {
            mount(errorBoxEl, html`<div class="alert alert-danger">Verify your email first. <a href="#/verify-email">Go to verification</a></div>`);
          } else {
            mount(errorBoxEl, errorBox(err));
          }
        }
      });
    } catch (err) {
      mount(body, errorBox(err));
    }
  },
};
