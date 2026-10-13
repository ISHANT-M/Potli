/** Overview metrics with a date range, stat cards and bookings-by-status bars. */
import { BOOKING_STATUSES, STATUS_LABEL } from '../../../../shared/bookingStatus';
import type { BookingStatus } from '../../../../shared/types';
import { formatINR } from '../../lib/format';
import { html } from '../../lib/html';
import { api } from '../../lib/session';
import { alert } from '../../ui/components';
import { adminRoute, errorText, showAdmin } from './shell';

interface Overview {
  users: { travelers: number; partners: number; admins: number };
  partners: { pending: number; approved: number; rejected: number; suspended: number };
  bookings: { byStatus: Record<BookingStatus, number>; created: number; completed: number };
  revenue: { grossPaise: number; feesEarnedPaise: number; feesDuePaise: number; feesSettledPaise: number };
  bft: { medianSeconds: number | null; sampleSize: number };
  handoffSuccessRate: number | null;
  utilization: number | null;
  openDisputes: number;
  averageRating: number | null;
}

const BFT_TARGET_SECONDS = 180;
const pct = (value: number | null): string => (value === null ? 'No data' : `${Math.round(value * 100)}%`);
const dayInput = (d: Date): string => d.toISOString().slice(0, 10);

function bft(seconds: number | null): string {
  if (seconds === null) return 'No data';
  return seconds < 90 ? `${Math.round(seconds)} s` : `${(seconds / 60).toFixed(1)} min`;
}

export const overviewRoute = adminRoute('/admin', 'Overview', async (el, ctx) => {
  const days = ctx.query.get('days') ?? '30';
  const customFrom = ctx.query.get('from');
  const customTo = ctx.query.get('to');
  const to = customTo ? new Date(`${customTo}T23:59:59.999+05:30`) : new Date();
  const from = customFrom ? new Date(`${customFrom}T00:00:00+05:30`) : new Date(to.getTime() - (Number(days) || 30) * 86_400_000);
  const active = customFrom || customTo ? 'custom' : String(Number(days) || 30);
  showAdmin(el, ctx.me, '#/admin', 'Overview', html`<p>Loading...</p>`);
  try {
    const data = await api<Overview>('GET', '/admin/overview', { query: { from: from.toISOString(), to: to.toISOString() }, auth: 'required' });
    const max = Math.max(1, ...BOOKING_STATUSES.map((s) => data.bookings.byStatus[s]));
    const card = (label: string, value: string, extra?: string, tone = '') => html`<div class="stat ${tone}"><span class="stat-label">${label}</span><strong>${value}</strong>${extra ? html`<small>${extra}</small>` : ''}</div>`;
    const met = data.bft.medianSeconds !== null && data.bft.medianSeconds <= BFT_TARGET_SECONDS;
    showAdmin(
      el,
      ctx.me,
      '#/admin',
      'Overview',
      html`<div class="range-bar" role="group" aria-label="Date range">
          ${[7, 30, 90].map((d) => html`<a class="chip ${active === String(d) ? 'on' : ''}" href="#/admin?days=${d}">${d} days</a>`)}
          <form id="range" class="range-custom"><input type="date" name="from" value="${customFrom ?? dayInput(from)}" aria-label="From" /><input type="date" name="to" value="${customTo ?? dayInput(to)}" aria-label="To" /><button class="button button-small button-secondary" type="submit">Apply</button></form></div>
        <div class="stat-grid">
          ${card('Bookings created', String(data.bookings.created))}${card('Bookings completed', String(data.bookings.completed))}
          ${card('Gross collected', formatINR(data.revenue.grossPaise))}
          ${card('Fees earned', formatINR(data.revenue.feesEarnedPaise), `${formatINR(data.revenue.feesDuePaise)} due, ${formatINR(data.revenue.feesSettledPaise)} settled (all time)`)}
          ${card('Median booking time', bft(data.bft.medianSeconds), data.bft.medianSeconds === null ? 'No searches recorded' : `${met ? 'Target met' : 'Above target'} (target 3 min or less), ${data.bft.sampleSize} bookings`, data.bft.medianSeconds === null ? '' : met ? 'good' : 'bad')}
          ${card('Handoff success', pct(data.handoffSuccessRate), 'Completed with no dispute')}
          ${card('Utilization', pct(data.utilization))}${card('Average rating', data.averageRating === null ? 'No ratings' : data.averageRating.toFixed(1))}
          ${card('Open disputes', String(data.openDisputes), undefined, data.openDisputes > 0 ? 'bad' : '')}${card('Pending partners', String(data.partners.pending), undefined, data.partners.pending > 0 ? 'bad' : '')}
        </div>
        <section class="card"><h2>Bookings by status</h2>
          <div class="bars">${BOOKING_STATUSES.map((s) => html`<div class="bar-row"><span>${STATUS_LABEL[s]}</span><div class="bar"><i style="width:${(data.bookings.byStatus[s] / max) * 100}%"></i></div><b>${data.bookings.byStatus[s]}</b></div>`)}</div></section>
        <p class="quick-links"><a class="button button-secondary" href="#/admin/partners?status=pending">Review ${data.partners.pending} pending partners</a>
        <a class="button button-secondary" href="#/admin/disputes">${data.openDisputes} open disputes</a></p>
        <p class="field-hint">Users: ${data.users.travelers} travellers, ${data.users.partners} partners, ${data.users.admins} admins.</p>`,
    );
    el.querySelector<HTMLFormElement>('#range')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget as HTMLFormElement);
      window.location.hash = `#/admin?from=${f.get('from')}&to=${f.get('to')}`;
    });
  } catch (err) {
    showAdmin(el, ctx.me, '#/admin', 'Overview', alert('danger', errorText(err)));
  }
});
