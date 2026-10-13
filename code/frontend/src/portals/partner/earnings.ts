/** Partner earnings: gross, 15% platform fee, share, dues outstanding and settlement history. */
import type { Paginated } from '../../../../shared/types';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { alert, badge } from '../../ui/components';
import { errorText, showPartner } from './shell';

interface Earnings extends Paginated<{ bookingId: string; code: string; completedAt: string | null; amountPaise: number; feePaise: number; sharePaise: number; settled: boolean }> {
  summary: { grossPaise: number; feePaise: number; sharePaise: number; feesDuePaise: number; feesSettledPaise: number };
}
interface Settlements { items: { id: string; amountPaise: number; paymentCount: number; reference: string; createdAt: string }[] }

export const earningsRoute: RouteDef = {
  path: '/partner/earnings',
  title: 'Earnings',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    const from = ctx.query.get('from') ?? '';
    const to = ctx.query.get('to') ?? '';
    const page = Number(ctx.query.get('page') ?? '1') || 1;
    showPartner(el, me, '#/partner/earnings', 'Earnings', html`<p>Loading...</p>`);
    try {
      const [e, s] = await Promise.all([
        api<Earnings>('GET', '/partner/earnings', {
          query: { page, from: from ? new Date(`${from}T00:00:00+05:30`).toISOString() : undefined, to: to ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString() : undefined },
          auth: 'required',
        }),
        api<Settlements>('GET', '/partner/settlements', { auth: 'required' }),
      ]);
      const last = Math.max(1, Math.ceil(e.total / e.pageSize));
      const link = (p: number): string => `#/partner/earnings?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(p) })}`;
      showPartner(
        el,
        me,
        '#/partner/earnings',
        'Earnings',
        html`<form class="card filter-bar" id="range"><label>From<input type="date" name="from" value="${from}" /></label><label>To<input type="date" name="to" value="${to}" /></label><button class="button button-small" type="submit">Apply</button></form>
        <div class="stat-grid">
          <div class="stat"><span class="stat-label">Gross collected</span><strong>${formatINR(e.summary.grossPaise)}</strong></div>
          <div class="stat"><span class="stat-label">Platform fee (15%)</span><strong>${formatINR(e.summary.feePaise)}</strong></div>
          <div class="stat good"><span class="stat-label">Your share</span><strong>${formatINR(e.summary.sharePaise)}</strong></div>
          <div class="stat ${e.summary.feesDuePaise > 0 ? 'bad' : ''}"><span class="stat-label">Dues outstanding</span><strong>${formatINR(e.summary.feesDuePaise)}</strong><small>Settled ${formatINR(e.summary.feesSettledPaise)}</small></div>
        </div>
        ${alert('info', 'Pay your platform dues to Potli by UPI and share the reference with the admin. Online settlement is coming soon.')}
        <section class="card"><h2>Completed bookings</h2>${e.items.length === 0 ? html`<p>Nothing collected in this period.</p>` : html`<table class="table"><thead><tr><th>Code</th><th>Completed</th><th>Collected</th><th>Fee</th><th>Your share</th><th>Dues</th></tr></thead><tbody>
          ${e.items.map((i) => html`<tr><td data-label="Code"><a href="#/partner/bookings/${i.bookingId}">${i.code}</a></td><td data-label="Completed">${i.completedAt ? formatDate(i.completedAt) : ''}</td><td data-label="Collected">${formatINR(i.amountPaise)}</td><td data-label="Fee">${formatINR(i.feePaise)}</td><td data-label="Your share">${formatINR(i.sharePaise)}</td><td data-label="Dues">${i.settled ? badge('Settled', 'success') : badge('Due', 'warning')}</td></tr>`)}</tbody></table>`}
          <p class="pager">${page > 1 ? html`<a href="${link(page - 1)}">Previous</a>` : ''} Page ${page} of ${last} ${page < last ? html`<a href="${link(page + 1)}">Next</a>` : ''}</p></section>
        <section class="card"><h2>Settlements</h2>${s.items.length === 0 ? html`<p>No settlements yet.</p>` : html`<ul class="plain">${s.items.map((x) => html`<li>${formatDateTime(x.createdAt)} | ${formatINR(x.amountPaise)} for ${x.paymentCount} bookings | ref ${x.reference}</li>`)}</ul>`}</section>`,
      );
      const form = el.querySelector<HTMLFormElement>('#range');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(form).forEach((v, k) => { if (typeof v === 'string' && v) params.set(k, v); });
        window.location.hash = `#/partner/earnings${params.size ? `?${params}` : ''}`;
      });
    } catch (err) {
      showPartner(el, me, '#/partner/earnings', 'Earnings', alert('danger', errorText(err)));
    }
  },
};
