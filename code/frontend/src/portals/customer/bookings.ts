/** Home, My bookings and the booking detail with QR + OTP, photos, cancel and polling. */
import type { Booking, Paginated } from '../../../../shared/types';
import { STATUS_LABEL } from '../../../../shared/bookingStatus';
import { formatDateTime, formatINR } from '../../lib/format';
import { html, mount, type SafeHtml } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, imageUrl } from '../../lib/session';
import { statusBadge } from '../../ui/components';
import { icon } from '../../ui/icons';
import { confirmDialog, directionsUrl, errorBox, onLeave, portalPage, qs, skeleton, toast } from './common';

const PAGE_SIZE = 10;
const POLL_MS = 30_000;
const POLLED = new Set(['booked', 'dropped', 'stored']);

const bookingCard = (b: Booking): SafeHtml => html`<article class="cx-card cx-booking"><div class="cx-card-body">
  <h3><a href="#/app/bookings/${b.id}">${b.listing.name}</a> ${statusBadge(b.status)}</h3>
  <p class="cx-muted">${b.listing.area || b.listing.city} · ${b.bagCount} ${b.bagCount === 1 ? 'bag' : 'bags'}</p>
  <p>${formatDateTime(b.slotStart)} to ${formatDateTime(b.slotEnd)}</p>
  <p><strong>${formatINR(b.finalPaise ?? b.quotedPaise)}</strong> <span class="cx-muted">· ${b.code}</span></p></div></article>`;

const guard = { roles: ['traveler' as const] };

export const homeRoute: RouteDef = {
  path: '/app',
  title: 'Home',
  guard,
  async mount(el, ctx) {
    if (!ctx.me) return;
    const first = ctx.me.fullName.split(' ')[0] || 'there';
    const body = portalPage(el, ctx.me, '#/app', `Namaste, ${first}`);
    mount(body, skeleton(2));
    try {
      const [upcoming, recent] = await Promise.all([
        api<Paginated<Booking>>('GET', '/bookings', { query: { scope: 'upcoming', pageSize: 1 }, auth: 'required' }),
        api<Paginated<Booking>>('GET', '/bookings', { query: { scope: 'all', pageSize: 4 }, auth: 'required' }),
      ]);
      const next = upcoming.items[0];
      const others = recent.items.filter((b) => b.id !== next?.id).slice(0, 3);
      mount(
        body,
        html`${next
          ? html`<section class="card cx-hero"><p class="eyebrow">Next booking</p><h2>${next.listing.name} ${statusBadge(next.status)}</h2>
            <p>${formatDateTime(next.slotStart)} to ${formatDateTime(next.slotEnd)} · ${next.bagCount} ${next.bagCount === 1 ? 'bag' : 'bags'}</p>
            <p><a class="button" href="#/app/bookings/${next.id}">${icon('qr')} Show code</a> <a class="button button-secondary" href="#/app/bookings/${next.id}">Details</a></p></section>`
          : html`<section class="card cx-hero"><h2>No upcoming bookings</h2><p>Find a safe spot for your bags and travel light.</p></section>`}
        ${others.length ? html`<h2 class="cx-h2">Recent</h2><div class="cx-list">${others.map(bookingCard)}</div>` : ''}
        <p class="cx-cta"><a class="button" href="#/search">${icon('search')} Find storage</a></p>`,
      );
    } catch (err) {
      mount(body, errorBox(err));
    }
  },
};

export const bookingsRoute: RouteDef = {
  path: '/app/bookings',
  title: 'My bookings',
  guard,
  async mount(el, ctx) {
    if (!ctx.me) return;
    const body = portalPage(el, ctx.me, '#/app/bookings', 'My bookings');
    const tab = ctx.query.get('tab') === 'past' ? 'past' : 'upcoming';
    const page = Math.max(1, Math.trunc(Number(ctx.query.get('page'))) || 1);
    mount(body, skeleton(3));
    try {
      const data = await api<Paginated<Booking>>('GET', '/bookings', { query: { scope: tab, page, pageSize: PAGE_SIZE }, auth: 'required' });
      const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      mount(
        body,
        html`<div class="cx-toggle" role="tablist" aria-label="Bookings">
          <a role="tab" href="#/app/bookings" aria-selected="${tab === 'upcoming'}">Upcoming</a><a role="tab" href="#/app/bookings?tab=past" aria-selected="${tab === 'past'}">Past</a></div>
        ${data.items.length ? html`<div class="cx-list">${data.items.map(bookingCard)}</div>` : html`<div class="card cx-empty"><h2>Nothing here yet</h2><p>${tab === 'upcoming' ? 'Your upcoming bookings will show up here.' : 'Completed and cancelled bookings will show up here.'}</p><a class="button" href="#/search">Find storage</a></div>`}
        ${pages > 1 ? html`<nav class="cx-pager" aria-label="Pages">${page > 1 ? html`<a class="button button-secondary" href="#/app/bookings${qs({ tab: tab === 'past' ? 'past' : '', page: page - 1 })}">Previous</a>` : ''}<span class="cx-muted">Page ${page} of ${pages}</span>${page < pages ? html`<a class="button button-secondary" href="#/app/bookings${qs({ tab: tab === 'past' ? 'past' : '', page: page + 1 })}">Next</a>` : ''}</nav>` : ''}`,
      );
    } catch (err) {
      mount(body, errorBox(err));
    }
  },
};

const STEPS: { label: string; key: keyof Booking['timeline'] }[] = [
  { label: 'Booked', key: 'bookedAt' },
  { label: 'Dropped off', key: 'droppedAt' },
  { label: 'Stored', key: 'storedAt' },
  { label: 'Picked up', key: 'pickedUpAt' },
  { label: 'Completed', key: 'completedAt' },
];

function timeline(b: Booking): SafeHtml {
  if (b.status === 'cancelled' || b.status === 'expired') {
    return html`<div class="alert alert-danger" role="status"><strong>${STATUS_LABEL[b.status]}</strong>${b.timeline.cancelledAt ? ` on ${formatDateTime(b.timeline.cancelledAt)}` : ''}${b.cancelReason ? `: ${b.cancelReason}` : ''}</div>`;
  }
  return html`<ol class="cx-steps">${STEPS.map((s) => html`<li class="${b.timeline[s.key] ? 'is-done' : ''}"><span>${s.label}</span>${b.timeline[s.key] ? html`<small>${formatDateTime(b.timeline[s.key] as string)}</small>` : ''}</li>`)}</ol>`;
}

function handoffCard(b: Booking): SafeHtml {
  const code = b.handoffCode;
  if (!code) return html``;
  const label = code.type === 'drop_off' ? 'Show this at drop-off' : 'Show this at pickup';
  return html`<section class="card cx-handoff" aria-labelledby="hc"><h2 id="hc">${label}</h2>
    <img class="cx-qr" id="qr" width="240" height="240" alt="QR code for booking ${b.code}" />
    <p class="cx-otp" aria-label="One-time code">${code.otp}</p><p class="cx-muted">Booking code <strong>${b.code}</strong></p>
    <p class="cx-muted">Tip: turn your screen brightness up so the partner can scan it.</p></section>`;
}

function ratingCard(b: Booking): SafeHtml {
  if (b.rating) {
    return html`<section class="card"><h2>Your rating</h2><p class="cx-rating" aria-label="${b.rating.score} out of 5 stars">${'★'.repeat(b.rating.score)}${'☆'.repeat(5 - b.rating.score)}</p>${b.rating.comment ? html`<p>${b.rating.comment}</p>` : ''}</section>`;
  }
  if (!b.canRate) return html``;
  return html`<section class="card"><h2>Rate your experience</h2>
    <form id="rate-form"><fieldset class="cx-stars"><legend>Stars</legend>
      ${[1, 2, 3, 4, 5].map((n) => html`<label><input type="radio" name="score" value="${n}" /><span aria-hidden="true">★</span><span class="sr-only">${n} ${n === 1 ? 'star' : 'stars'}</span></label>`)}</fieldset>
      <label>Comment (optional)<textarea name="comment" maxlength="500" rows="3"></textarea></label>
      <button class="button" type="submit">Submit rating</button></form></section>`;
}

function reportDialog(id: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'cx-dialog';
  dialog.innerHTML = html`<form method="dialog"><h2>Report a problem</h2>
    <label>What went wrong?<textarea name="reason" minlength="10" maxlength="1000" rows="5" required></textarea></label>
    <p class="form-message" role="alert"></p>
    <div class="cx-actions"><button class="button button-secondary" value="cancel" formnovalidate>Close</button><button class="button" value="send">Send report</button></div></form>`.value;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form')?.addEventListener('submit', async (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'send') return;
    event.preventDefault();
    const reason = dialog.querySelector('textarea')?.value.trim() ?? '';
    const message = dialog.querySelector<HTMLElement>('.form-message');
    if (reason.length < 10) {
      if (message) message.textContent = 'Please tell us a little more (10+ characters).';
      return;
    }
    try {
      await api('POST', `/bookings/${id}/disputes`, { auth: 'required', body: { reason } });
      dialog.close();
      toast('Report sent. Our team will review it.');
    } catch (err) {
      if (message) message.textContent = err instanceof Error ? err.message : 'Could not send your report.';
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}

export const bookingDetailRoute: RouteDef = {
  path: '/app/bookings/:id',
  title: 'Booking',
  guard,
  async mount(el, ctx) {
    if (!ctx.me) return;
    const id = encodeURIComponent(ctx.params.id ?? '');
    const body = portalPage(el, ctx.me, '#/app/bookings', 'Booking');
    mount(body, skeleton(3));
    const leave = onLeave();
    let alive = true;
    leave.add(() => (alive = false));
    const objectUrls: string[] = [];
    leave.add(() => objectUrls.forEach((u) => URL.revokeObjectURL(u)));
    let shown = '';

    async function paint(b: Booking): Promise<void> {
      const signature = JSON.stringify([b.status, b.handoffCode?.otp, b.dropOffPhotoUrls, b.finalPaise, b.rating]);
      if (signature === shown) return;
      shown = signature;
      const phone = b.listing.phone;
      mount(
        body,
        html`<a class="cx-back" href="#/app/bookings">← All bookings</a>
        <div class="cx-bk">
          <section class="card"><h2>${b.listing.name} ${statusBadge(b.status)}</h2>
            <p class="cx-muted">${b.listing.address}, ${b.listing.city} · ${b.code}</p>${timeline(b)}</section>
          ${handoffCard(b)}
          <section class="card"><h2>Details</h2>
            <dl class="cx-dl"><dt>Drop-off</dt><dd>${formatDateTime(b.slotStart)}</dd><dt>Pick-up by</dt><dd>${formatDateTime(b.slotEnd)}</dd><dt>Bags</dt><dd>${b.bagCount}</dd>
              <dt>${b.finalPaise !== null ? 'Final price' : 'Quoted price'}</dt><dd>${formatINR(b.finalPaise ?? b.quotedPaise)}</dd><dt>Payment</dt><dd>Cash on pickup (${b.paymentStatus})</dd></dl>
            <p><a href="${directionsUrl(b.listing.latitude, b.listing.longitude)}" target="_blank" rel="noopener noreferrer">Get directions</a>${phone ? html` · <a href="tel:${phone}">Call ${b.listing.businessName}</a>` : ''}</p>
            ${b.status === 'booked' || b.status === 'dropped' || b.status === 'stored' ? html`<p class="cx-muted">The final amount may increase if you collect your bags after the end time.</p>` : ''}
            ${b.canCancel ? html`<button class="button button-danger" type="button" id="cancel">Cancel booking</button>` : ''}</section>
          ${ratingCard(b)}
          ${b.status !== 'booked' ? html`<p><button class="button button-secondary" type="button" id="report">Report a problem</button></p>` : ''}
          ${b.dropOffPhotoUrls.length ? html`<section class="card"><h2>Photos at drop-off</h2><div class="cx-photos">${b.dropOffPhotoUrls.map((u, i) => html`<button type="button" class="cx-thumb" data-path="${u}" aria-label="Open photo ${i + 1}"></button>`)}</div></section>` : ''}
        </div>`,
      );
      if (b.handoffCode) {
        const { default: QRCode } = await import('qrcode');
        const url = await QRCode.toDataURL(b.handoffCode.qrPayload, { width: 240, margin: 2, errorCorrectionLevel: 'M' });
        const img = body.querySelector<HTMLImageElement>('#qr');
        if (alive && img) img.src = url;
      }
      body.querySelector('#cancel')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Cancel this booking?', 'The space will be released. This cannot be undone.', 'Cancel booking'))) return;
        try {
          const res = await api<{ booking: Booking }>('POST', `/bookings/${id}/cancel`, { auth: 'required', body: {} });
          toast('Booking cancelled.');
          shown = '';
          await paint(res.booking);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Could not cancel.', 'error');
        }
      });
      body.querySelector<HTMLFormElement>('#rate-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const score = Number(data.get('score'));
        if (!score) return toast('Choose a star rating.', 'error');
        try {
          await api('POST', `/bookings/${id}/rating`, { auth: 'required', body: { score, comment: String(data.get('comment') ?? '') } });
          toast('Thanks for your rating.');
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Could not save your rating.', 'error');
        }
        shown = '';
        void load();
      });
      body.querySelector('#report')?.addEventListener('click', () => reportDialog(id));
      body.querySelectorAll<HTMLButtonElement>('.cx-thumb').forEach((button) => {
        void imageUrl(button.dataset.path ?? '')
          .then((src) => {
            if (!alive) return URL.revokeObjectURL(src);
            objectUrls.push(src);
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            button.append(img);
            button.addEventListener('click', () => {
              const dialog = document.createElement('dialog');
              dialog.className = 'cx-dialog cx-lightbox';
              const big = document.createElement('img');
              big.src = src;
              big.alt = 'Drop-off photo';
              const close = document.createElement('button');
              close.className = 'button';
              close.textContent = 'Close';
              close.addEventListener('click', () => dialog.close());
              dialog.addEventListener('close', () => dialog.remove());
              dialog.append(big, close);
              document.body.append(dialog);
              dialog.showModal();
            });
          })
          .catch(() => undefined);
      });
    }

    async function load(): Promise<Booking | null> {
      try {
        const { booking } = await api<{ booking: Booking }>('GET', `/bookings/${id}`, { auth: 'required' });
        if (!alive) return null;
        await paint(booking);
        return booking;
      } catch (err) {
        if (alive && !shown) mount(body, errorBox(err));
        return null;
      }
    }

    let current = await load();
    const tick = async (): Promise<void> => {
      if (document.visibilityState === 'visible' && current && POLLED.has(current.status)) current = (await load()) ?? current;
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    document.addEventListener('visibilitychange', tick);
    leave.add(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    });
    return leave.run;
  },
};
