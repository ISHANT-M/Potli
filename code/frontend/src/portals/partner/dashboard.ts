/** Partner dashboard: today's work, storage, overdue, 30-day earnings and platform dues. */
import { formatINR, formatTime } from '../../lib/format';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { alert } from '../../ui/components';
import { errorText, showPartner } from './shell';

interface Item { id: string; code: string; bagCount: number; at: string; travelerName: string }
interface Stats {
  today: { dropOffs: number; pickups: number; inStorage: number; dropOffList: Item[]; pickupList: Item[] };
  overdue: number;
  upcoming7d: number;
  completed30d: number;
  earnings30dPaise: number;
  feesDuePaise: number;
}

const rows = (items: Item[], empty: string) =>
  items.length === 0
    ? html`<p>${empty}</p>`
    : html`<ul class="plain">${items.map((i) => html`<li><a href="#/partner/bookings/${i.id}">${i.code}</a> ${formatTime(i.at)} | ${i.travelerName} | ${i.bagCount} ${i.bagCount === 1 ? 'bag' : 'bags'}</li>`)}</ul>`;

export const dashboardRoute: RouteDef = {
  path: '/partner/dashboard',
  title: 'Dashboard',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    showPartner(el, me, '#/partner/dashboard', 'Dashboard', html`<p>Loading...</p>`);
    try {
      const s = await api<Stats>('GET', '/partner/stats', { auth: 'required' });
      showPartner(
        el,
        me,
        '#/partner/dashboard',
        'Dashboard',
        html`<p class="partner-actions"><a class="button big-button" href="#/partner/handoff">Start a handoff</a></p>
        ${s.overdue > 0 ? alert('warning', `${s.overdue} ${s.overdue === 1 ? 'booking is' : 'bookings are'} past the pickup time. Overstay is charged at pickup.`) : ''}
        <div class="stat-grid">
          <div class="stat"><span class="stat-label">Bags in storage</span><strong>${s.today.inStorage}</strong></div>
          <div class="stat ${s.overdue > 0 ? 'bad' : ''}"><span class="stat-label">Overdue</span><strong>${s.overdue}</strong></div>
          <div class="stat"><span class="stat-label">Earnings, 30 days</span><strong>${formatINR(s.earnings30dPaise)}</strong><small>${s.completed30d} completed</small></div>
          <a class="stat" href="#/partner/earnings"><span class="stat-label">Platform dues</span><strong>${formatINR(s.feesDuePaise)}</strong><small>See earnings</small></a>
        </div>
        <section class="card"><h2>Drop-offs today (${s.today.dropOffs})</h2>${rows(s.today.dropOffList, 'None expected today.')}</section>
        <section class="card"><h2>Pickups today (${s.today.pickups})</h2>${rows(s.today.pickupList, 'None expected today.')}</section>
        <p class="field-hint">${s.upcoming7d} bookings in the next 7 days.</p>`,
      );
    } catch (err) {
      showPartner(el, me, '#/partner/dashboard', 'Dashboard', alert('danger', errorText(err)));
    }
  },
};
