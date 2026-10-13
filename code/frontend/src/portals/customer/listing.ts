/** #/listing/:id: details, reviews and a live-quote booking widget. */
import type { ListingDetail } from '../../../../shared/types';
import { API_BASE } from '../../lib/api';
import { formatDate, formatINR } from '../../lib/format';
import { html, mount, type SafeHtml } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, getMe } from '../../lib/session';
import { icon } from '../../ui/icons';
import {
  clampBags, daysLabel, defaultWindow, directionsUrl, errorBox, hoursLabel, onLeave, publicPage, qs, skeleton, stars, toLocalInput, validDate,
} from './common';
import { showMap } from './map';

export interface QuoteResult {
  available: boolean;
  remaining: number;
  quotedPaise: number;
  hours: number;
  reason?: 'OUTSIDE_OPENING_HOURS' | 'SLOT_INVALID' | 'CAPACITY_UNAVAILABLE';
  message?: string;
}
interface Review {
  score: number;
  comment: string;
  createdAt: string;
  firstName: string;
}

/** Price breakdown line shared with checkout: "₹50 × 2 bags × 4 h, capped at ₹400/day". */
export const breakdown = (listing: Pick<ListingDetail, 'hourlyRatePaise' | 'dailyCapPaise'>, bags: number, hours: number): string =>
  `${formatINR(listing.hourlyRatePaise)} × ${bags} ${bags === 1 ? 'bag' : 'bags'} × ${hours} h, capped at ${formatINR(listing.dailyCapPaise)}/day`;

export const quoteMessage = (q: QuoteResult): string =>
  q.reason === 'CAPACITY_UNAVAILABLE'
    ? q.remaining > 0
      ? `Only ${q.remaining} ${q.remaining === 1 ? 'space is' : 'spaces are'} free in that window.`
      : 'No space is free in that window. Choose another time.'
    : (q.message ?? 'Choose a different time.');

export const listingRoute: RouteDef = {
  path: '/listing/:id',
  title: 'Storage details',
  async mount(el, ctx) {
    const id = ctx.params.id ?? '';
    const leave = onLeave();
    let alive = true;
    leave.add(() => (alive = false));
    const main = publicPage(el, html`<a class="cx-back" href="#/search${qs({ start: ctx.query.get('start'), end: ctx.query.get('end'), bags: ctx.query.get('bags') })}">← Back to results</a>${skeleton(4)}`);

    let data: { listing: ListingDetail; recentRatings: Review[] };
    try {
      data = await api('GET', `/listings/${encodeURIComponent(id)}`, { auth: 'none' });
    } catch (err) {
      mount(main, html`<a class="cx-back" href="#/search">← Back to search</a>${errorBox(err)}`);
      return;
    }
    if (!alive) return;
    const { listing, recentRatings } = data;
    document.title = `${listing.name} · Potli`;
    const defaults = defaultWindow();
    const start = validDate(ctx.query.get('start')) ?? defaults.start;
    const end = validDate(ctx.query.get('end')) ?? defaults.end;
    let bags = clampBags(ctx.query.get('bags'));

    const reviews: SafeHtml = recentRatings.length
      ? html`<ul class="cx-reviews">${recentRatings.map((r) => html`<li><strong>${r.firstName}</strong> <span aria-label="${r.score} out of 5">${'★'.repeat(r.score)}${'☆'.repeat(5 - r.score)}</span> <span class="cx-muted">${formatDate(r.createdAt)}</span>${r.comment ? html`<p>${r.comment}</p>` : ''}</li>`)}</ul>`
      : html`<p class="cx-muted">No reviews yet.</p>`;

    mount(
      main,
      html`<a class="cx-back" href="#/search${qs({ start: ctx.query.get('start'), end: ctx.query.get('end'), bags: ctx.query.get('bags') })}">← Back to results</a>
      <div class="cx-detail">
        <section>
          ${listing.coverUrl ? html`<img class="cx-hero-img" alt="" src="${API_BASE}${listing.coverUrl}" />` : ''}
          <h1 class="cx-title">${listing.name}</h1>
          <p class="cx-muted">${listing.address}${listing.area ? `, ${listing.area}` : ''}, ${listing.city}</p>
          <p>${stars(listing.ratingAverage, listing.ratingCount)} · Run by ${listing.businessName}</p>
          ${listing.description ? html`<p>${listing.description}</p>` : ''}
          <ul class="cx-facts">
            <li>${icon('rupee')} <strong>${formatINR(listing.hourlyRatePaise)}</strong> per bag per hour, capped at ${formatINR(listing.dailyCapPaise)} per bag per day</li>
            <li>${icon('clock')} ${daysLabel(listing.openDays)}, ${hoursLabel(listing.openTime, listing.closeTime)}</li>
            <li>${icon('bag')} Space for up to ${listing.capacity} bags at a time</li>
          </ul>
          <div id="static-map" class="cx-map cx-map-small" role="img" aria-label="Map showing ${listing.name}"></div>
          <p><a href="${directionsUrl(listing.latitude, listing.longitude)}" target="_blank" rel="noopener noreferrer">Get directions</a></p>
          <h2>Reviews</h2>${reviews}
        </section>
        <aside class="card cx-widget" aria-labelledby="book-h">
          <h2 id="book-h">Book storage</h2>
          <label>From<input id="w-start" type="datetime-local" value="${toLocalInput(new Date(start))}" /></label>
          <label>Until<input id="w-end" type="datetime-local" value="${toLocalInput(new Date(end))}" /></label>
          <label>Bags<span class="cx-stepper"><button type="button" data-step="-1" aria-label="Fewer bags">−</button><output id="w-bags" aria-live="polite">${bags}</output><button type="button" data-step="1" aria-label="More bags">+</button></span></label>
          <div id="w-quote" class="cx-quote" aria-live="polite"></div>
          <a id="w-go" class="button" href="#/search" aria-disabled="true">Continue</a>
        </aside>
      </div>`,
    );

    void showMap(main.querySelector<HTMLElement>('#static-map')!, [{ id: listing.id, lat: listing.latitude, lng: listing.longitude, label: formatINR(listing.hourlyRatePaise) }], { interactive: false })
      .then((stop) => (alive ? leave.add(stop) : stop()))
      .catch(() => undefined);

    const startInput = main.querySelector<HTMLInputElement>('#w-start')!;
    const endInput = main.querySelector<HTMLInputElement>('#w-end')!;
    const quoteBox = main.querySelector<HTMLElement>('#w-quote')!;
    const go = main.querySelector<HTMLAnchorElement>('#w-go')!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    leave.add(() => clearTimeout(timer));

    const refresh = (): void => {
      clearTimeout(timer);
      go.setAttribute('aria-disabled', 'true');
      go.removeAttribute('href');
      timer = setTimeout(async () => {
        const s = validDate(startInput.value);
        const e = validDate(endInput.value);
        if (!s || !e) {
          mount(quoteBox, html`<p class="cx-bad">Choose a start and end time.</p>`);
          return;
        }
        const mine = (seq += 1);
        mount(quoteBox, html`<p class="cx-muted">Checking price…</p>`);
        try {
          const q = await api<QuoteResult>('GET', `/listings/${encodeURIComponent(id)}/quote`, { query: { start: s, end: e, bags }, auth: 'none' });
          if (!alive || mine !== seq) return;
          if (q.available) {
            const book = `#/app/book/${listing.id}${qs({ start: s, end: e, bags })}`;
            mount(quoteBox, html`<p class="cx-price">${formatINR(q.quotedPaise)}</p><p class="cx-muted">${breakdown(listing, bags, q.hours)}</p><p class="cx-ok">${q.remaining} ${q.remaining === 1 ? 'space' : 'spaces'} free</p>`);
            go.href = getMe() ? book : `#/login?next=${encodeURIComponent(book)}`;
            go.removeAttribute('aria-disabled');
          } else {
            mount(quoteBox, html`<p class="cx-bad" role="alert">${quoteMessage(q)}</p>`);
          }
        } catch (err) {
          if (alive && mine === seq) mount(quoteBox, errorBox(err));
        }
      }, 300);
    };

    main.querySelector('.cx-widget')!.addEventListener('click', (event) => {
      const step = (event.target as HTMLElement).closest<HTMLElement>('[data-step]');
      if (step) {
        bags = clampBags(bags + Number(step.dataset.step));
        main.querySelector('#w-bags')!.textContent = String(bags);
        refresh();
      }
    });
    go.addEventListener('click', (event) => {
      if (go.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    startInput.addEventListener('input', refresh);
    endInput.addEventListener('input', refresh);
    refresh();
    return leave.run;
  },
};
