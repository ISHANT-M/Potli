/** The counter screen: scan or type a code, check in, photograph the bags, collect cash at pickup. */
import QrScanner from 'qr-scanner';
import type { HandoffType, PartnerBooking } from '../../../../shared/types';
import { OTP_PATTERN } from '../../../../shared/validation';
import { ApiRequestError } from '../../lib/api';
import { formatINR, formatSlot } from '../../lib/format';
import { html, type SafeHtml } from '../../lib/html';
import { compressImage } from '../../lib/image';
import type { RouteDef } from '../../lib/router';
import { api, imageUrl } from '../../lib/session';
import { alert, statusBadge } from '../../ui/components';
import { parseQrPayload } from './qr';
import { showPartner } from './shell';

type Step = 'entry' | 'review' | 'photos' | 'pickup' | 'done';
const MAX_PHOTOS = 4;

function friendly(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'OTP_INVALID') return "That code isn't correct. Check the traveller's screen and try again.";
    if (err.code === 'OTP_LOCKED') return 'Too many wrong codes. Try again in 15 minutes or contact support.';
    if (err.code === 'NETWORK') return 'No connection. Your photos are kept; tap retry when you are back online.';
    return err.fields.cashCollectedPaise ?? err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const handoffRoute: RouteDef = {
  path: '/partner/handoff',
  title: 'Handoff',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;

    let step: Step = 'entry';
    let mode: 'scan' | 'manual' = 'scan';
    let booking: PartnerBooking | null = null;
    let qrType: HandoffType | null = null;
    let method: 'qr' | 'otp' = 'otp';
    let otp = '';
    let code = '';
    let notice = '';
    let busy = false;
    let doneText = '';
    let bagCount = 1;
    let note = '';
    let confirmed = false;
    let photos: { blob: Blob; url: string }[] = [];
    let scanner: QrScanner | null = null;
    let leaving = false;
    const shown: string[] = [];

    const stopScanner = (): void => {
      scanner?.stop();
      scanner?.destroy();
      scanner = null;
    };
    const dropPhotos = (): void => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      photos = [];
    };
    const reset = (): void => {
      dropPhotos();
      booking = null;
      qrType = null;
      otp = '';
      code = '';
      notice = '';
      confirmed = false;
      note = '';
      step = 'entry';
      render();
    };

    async function lookup(): Promise<void> {
      busy = true;
      notice = '';
      render();
      try {
        const res = await api<{ booking: PartnerBooking; expected: HandoffType | null }>('POST', '/partner/handoffs/lookup', { body: { code }, auth: 'required' });
        booking = res.booking;
        bagCount = res.booking.bagCount;
        step = res.booking.status === 'dropped' ? 'photos' : res.booking.status === 'stored' ? 'pickup' : 'review';
      } catch (err) {
        notice = err instanceof ApiRequestError && err.status === 404 ? 'No booking with that code at your locations.' : friendly(err);
        step = 'entry';
        mode = 'manual';
      }
      busy = false;
      render();
    }

    function onScan(text: string): void {
      const parsed = parseQrPayload(text);
      if (!parsed) {
        notice = 'That QR code is not a Potli booking code.';
        const node = el.querySelector('#notice');
        if (node) node.textContent = notice;
        return;
      }
      stopScanner();
      code = parsed.code;
      otp = parsed.otp;
      qrType = parsed.type;
      method = 'qr';
      void lookup();
    }

    async function checkIn(): Promise<void> {
      if (!booking) return;
      busy = true;
      notice = '';
      render();
      try {
        const res = await api<{ booking: PartnerBooking }>('POST', `/partner/bookings/${booking.id}/check-in`, { body: { otp, method }, auth: 'required' });
        booking = res.booking;
        step = 'photos';
      } catch (err) {
        notice = friendly(err);
      }
      busy = false;
      render();
    }

    async function storeBags(): Promise<void> {
      if (!booking || photos.length === 0) return;
      busy = true;
      notice = '';
      render();
      try {
        const form = new FormData();
        photos.forEach((p, i) => form.append('photos', p.blob, `bag-${i + 1}.jpg`));
        form.append('bagCount', String(bagCount));
        if (note.trim()) form.append('note', note.trim());
        await api('POST', `/partner/bookings/${booking.id}/drop-off`, { form, auth: 'required' });
        dropPhotos();
        doneText = 'Bags stored';
        step = 'done';
      } catch (err) {
        notice = friendly(err);
      }
      busy = false;
      render();
    }

    async function completePickup(): Promise<void> {
      if (!booking) return;
      const due = booking.quotedPaise + booking.overstayPaise;
      busy = true;
      notice = '';
      render();
      try {
        await api('POST', `/partner/bookings/${booking.id}/pickup`, { body: { otp, method, cashCollectedPaise: due }, auth: 'required' });
        doneText = 'Handed back';
        step = 'done';
      } catch (err) {
        notice = friendly(err);
        if (err instanceof ApiRequestError && err.fields.cashCollectedPaise) {
          confirmed = false;
          const res = await api<{ booking: PartnerBooking }>('POST', '/partner/handoffs/lookup', { body: { code: booking.code }, auth: 'required' }).catch(() => null);
          if (res) booking = res.booking; // the overstay moved on; show the new amount
        }
      }
      busy = false;
      render();
    }

    const card = (b: PartnerBooking): SafeHtml => html`<div class="handoff-card"><h2>${b.code} ${statusBadge(b.status)}</h2>
      <p><strong>${b.traveler.fullName.split(' ')[0]}</strong> | ${b.bagCount} ${b.bagCount === 1 ? 'bag' : 'bags'} | ${b.listing.name}</p><p>${formatSlot(b.slotStart, b.slotEnd)}</p></div>`;

    function body(): SafeHtml {
      const error = notice ? alert('danger', html`<span id="notice">${notice}</span>`) : html`<span id="notice"></span>`;
      if (step === 'entry') {
        return html`<section class="card handoff">
          <div class="auth-tabs" role="tablist"><button class="auth-tab ${mode === 'scan' ? 'active' : ''}" type="button" data-mode="scan" role="tab">Scan QR</button><button class="auth-tab ${mode === 'manual' ? 'active' : ''}" type="button" data-mode="manual" role="tab">Enter code</button></div>
          ${mode === 'scan'
            ? html`<video class="scan-video" playsinline muted></video><p class="field-hint">Point the camera at the traveller's QR code.</p>`
            : html`<form id="entry" class="partner-form" novalidate><label>Booking code<input class="big-input" type="text" name="code" value="${code}" placeholder="PT-ABC234" autocapitalize="characters" autocomplete="off" required /></label>
              <label>6-digit code<input class="big-input" type="text" name="otp" value="${otp}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required /></label>
              <button class="button big-button" type="submit" ${busy ? html`disabled` : ''}>${busy ? 'Looking up...' : 'Find booking'}</button></form>`}
          ${error}</section>`;
      }
      if (step === 'done') {
        return html`<section class="card handoff handoff-done"><h2>${doneText} ✓</h2><p>${booking?.code ?? ''}</p><button class="button big-button" type="button" id="next">Next handoff</button></section>`;
      }
      if (!booking) return html``;
      if (step === 'review') {
        const mismatch = qrType && ((qrType === 'drop_off') !== (booking.status === 'booked'));
        return html`<section class="card handoff">${card(booking)}
          ${mismatch ? alert('warning', 'This QR code does not match the next step for this booking. Check the traveller is showing the right screen.') : ''}
          ${booking.status === 'booked'
            ? html`<p>Next step: check the bags in.</p>${otp.length === 6 ? '' : alert('warning', 'Enter the traveller\'s 6-digit code first.')}<button class="button big-button" type="button" id="checkin" ${busy || otp.length !== 6 ? html`disabled` : ''}>${busy ? 'Checking in...' : 'Confirm check-in'}</button>`
            : alert('info', 'Nothing left to do for this booking.')}
          ${error}<button class="button button-secondary" type="button" id="next">Back</button></section>`;
      }
      if (step === 'photos') {
        return html`<section class="card handoff">${card(booking)}<h3>Photograph the bags (${photos.length}/${MAX_PHOTOS})</h3>
          <div class="thumbs">${photos.map((p, i) => html`<figure><img src="${p.url}" alt="Bag photo ${i + 1}" /><button type="button" class="button button-secondary button-small" data-remove="${i}">Remove</button></figure>`)}</div>
          ${photos.length < MAX_PHOTOS ? html`<label class="button button-secondary">Take a photo<input type="file" id="photo" accept="image/*" capture="environment" hidden /></label>` : ''}
          <label>Bags received<input type="number" id="bags" min="1" max="10" value="${bagCount}" inputmode="numeric" /></label>
          <label>Note ${bagCount !== booking.bagCount ? '(required: the count differs from the booking)' : '(optional)'}<textarea id="note" rows="2" maxlength="300">${note}</textarea></label>
          ${error}<button class="button big-button" type="button" id="store" ${busy || photos.length === 0 ? html`disabled` : ''}>${busy ? `Uploading ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}...` : notice ? 'Retry upload' : 'Mark as stored'}</button></section>`;
      }
      const due = booking.quotedPaise + booking.overstayPaise;
      return html`<section class="card handoff">${card(booking)}<h3>Check this is the same luggage</h3>
        <div class="thumbs" id="stored-photos">${booking.dropOffPhotoUrls.map(() => html`<figure><img alt="Photo taken at drop-off" /></figure>`)}</div>
        <p class="amount-label">Amount to collect</p><p class="big-amount">${formatINR(due)}</p>
        ${booking.overstayPaise > 0 ? html`<p class="field-hint">${formatINR(booking.quotedPaise)} booked plus ${formatINR(booking.overstayPaise)} for staying past the booked end time.</p>` : ''}
        ${otp.length === 6 ? '' : alert('warning', 'Enter the traveller\'s 6-digit pickup code.')}
        <label class="checkbox"><input type="checkbox" id="cash" ${confirmed ? html`checked` : ''} /> <span>I collected ${formatINR(due)} in cash</span></label>
        ${error}<button class="button big-button" type="button" id="complete" ${busy || !confirmed || otp.length !== 6 ? html`disabled` : ''}>${busy ? 'Completing...' : 'Complete handback'}</button>
        <button class="button button-secondary" type="button" id="next">Cancel</button></section>`;
    }

    function wire(): void {
      el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((tab) => tab.addEventListener('click', () => {
        mode = tab.dataset.mode === 'manual' ? 'manual' : 'scan';
        notice = '';
        render();
      }));
      const entry = el.querySelector<HTMLFormElement>('#entry');
      entry?.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(entry);
        code = String(data.get('code') ?? '').trim().toUpperCase();
        otp = String(data.get('otp') ?? '').trim();
        method = 'otp';
        qrType = null;
        if (!code) { notice = 'Enter the booking code.'; render(); return; }
        if (!OTP_PATTERN.test(otp)) { notice = 'Enter the 6-digit code from the traveller.'; render(); return; }
        void lookup();
      });
      el.querySelector('#next')?.addEventListener('click', reset);
      el.querySelector('#checkin')?.addEventListener('click', () => void checkIn());
      el.querySelector('#store')?.addEventListener('click', () => void storeBags());
      el.querySelector('#complete')?.addEventListener('click', () => void completePickup());
      el.querySelector<HTMLInputElement>('#cash')?.addEventListener('change', (e) => {
        confirmed = (e.target as HTMLInputElement).checked;
        render();
      });
      el.querySelector<HTMLInputElement>('#bags')?.addEventListener('change', (e) => {
        bagCount = Math.min(10, Math.max(1, Number((e.target as HTMLInputElement).value) || 1));
        note = el.querySelector<HTMLTextAreaElement>('#note')?.value ?? note;
        render();
      });
      el.querySelector<HTMLTextAreaElement>('#note')?.addEventListener('input', (e) => { note = (e.target as HTMLTextAreaElement).value; });
      el.querySelector<HTMLInputElement>('#photo')?.addEventListener('change', async (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
          const blob = await compressImage(file);
          photos.push({ blob, url: URL.createObjectURL(blob) });
          notice = '';
        } catch (err) {
          notice = err instanceof Error ? err.message : 'Could not use that photo.';
        }
        render();
      });
      el.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
        const [removed] = photos.splice(Number(btn.dataset.remove), 1);
        if (removed) URL.revokeObjectURL(removed.url);
        render();
      }));

      if (step === 'entry' && mode === 'scan') {
        const video = el.querySelector<HTMLVideoElement>('.scan-video');
        if (video) {
          scanner = new QrScanner(video, (result) => onScan(result.data), { preferredCamera: 'environment', returnDetailedScanResult: true, maxScansPerSecond: 5, highlightScanRegion: true });
          scanner.start().catch(() => {
            if (leaving) return;
            mode = 'manual';
            notice = 'The camera is not available. Enter the code instead.';
            render();
          });
        }
      }
      if (step === 'pickup' && booking) {
        const images = el.querySelectorAll<HTMLImageElement>('#stored-photos img');
        booking.dropOffPhotoUrls.forEach((url, i) => {
          imageUrl(url).then((objectUrl) => {
            shown.push(objectUrl);
            if (leaving) URL.revokeObjectURL(objectUrl);
            else if (images[i]) images[i].src = objectUrl;
          }).catch(() => undefined);
        });
      }
    }

    function render(): void {
      if (leaving) return;
      stopScanner();
      showPartner(el, me!, '#/partner/handoff', 'Handoff', body());
      wire();
    }

    render();
    return () => {
      leaving = true;
      stopScanner();
      dropPhotos();
      shown.forEach((url) => URL.revokeObjectURL(url));
    };
  },
};
