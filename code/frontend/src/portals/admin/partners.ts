/** Partner review: tabs and search, detail with listings map, and the four status actions. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Paginated, PartnerListing, PartnerStatus } from '../../../../shared/types';
import { formatDate, formatINR } from '../../lib/format';
import { html, type SafeHtml } from '../../lib/html';
import { api } from '../../lib/session';
import { alert, partnerStatusBadge } from '../../ui/components';
import { adminRoute, confirmDialog, errorText, showAdmin } from './shell';

interface PartnerRow {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  businessName: string;
  businessType: string;
  city: string;
  status: PartnerStatus;
  submittedAt: string;
  listingCount: number;
}
interface PartnerDetail extends PartnerRow {
  address: string;
  rejectionReason: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; fullName: string } | null;
}
interface Stats { completed: number; cancelled: number; disputes: number; ratingAverage: number | null; feesDuePaise: number; upcomingBookings: number }

const TABS: PartnerStatus[] = ['pending', 'approved', 'rejected', 'suspended'];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const partnersRoute = adminRoute('/admin/partners', 'Partners', async (el, ctx) => {
  const status = (TABS.find((t) => t === ctx.query.get('status')) ?? 'pending') as PartnerStatus;
  const q = ctx.query.get('q') ?? '';
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  showAdmin(el, ctx.me, '#/admin/partners', 'Partners', html`<p>Loading...</p>`);
  try {
    const list = await api<Paginated<PartnerRow>>('GET', '/admin/partners', { query: { status, q, page }, auth: 'required' });
    const last = Math.max(1, Math.ceil(list.total / list.pageSize));
    const link = (params: Record<string, string>): string => `#/admin/partners?${new URLSearchParams({ status, ...(q ? { q } : {}), ...params })}`;
    showAdmin(
      el,
      ctx.me,
      '#/admin/partners',
      'Partners',
      html`<div class="tabs" role="tablist">${TABS.map((t) => html`<a role="tab" class="chip ${t === status ? 'on' : ''}" aria-selected="${t === status}" href="#/admin/partners?status=${t}">${cap(t)}</a>`)}</div>
        <form id="search" class="filter-bar"><input type="search" name="q" value="${q}" placeholder="Search business, owner or email" aria-label="Search partners" /><button class="button button-small" type="submit">Search</button></form>
        <table class="table"><thead><tr><th>Business</th><th>Owner</th><th>City</th><th>Listings</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
        ${list.items.map((p) => html`<tr><td data-label="Business"><a href="#/admin/partners/${p.userId}">${p.businessName}</a> <small>${cap(p.businessType)}</small></td><td data-label="Owner">${p.fullName}<br><small>${p.email}</small></td><td data-label="City">${p.city}</td><td data-label="Listings">${p.listingCount}</td><td data-label="Submitted">${formatDate(p.submittedAt)}</td><td data-label="Status">${partnerStatusBadge(p.status)}</td></tr>`)}
        </tbody></table>${list.items.length === 0 ? html`<p class="empty">No ${status} partners${q ? ' match that search' : ''}.</p>` : ''}
        <p class="pager">${page > 1 ? html`<a href="${link({ page: String(page - 1) })}">Previous</a>` : ''} Page ${page} of ${last} ${page < last ? html`<a href="${link({ page: String(page + 1) })}">Next</a>` : ''}</p>`,
    );
    el.querySelector<HTMLFormElement>('#search')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = String(new FormData(event.currentTarget as HTMLFormElement).get('q') ?? '').trim();
      window.location.hash = `#/admin/partners?${new URLSearchParams({ status, ...(value ? { q: value } : {}) })}`;
    });
  } catch (err) {
    showAdmin(el, ctx.me, '#/admin/partners', 'Partners', alert('danger', errorText(err)));
  }
});

export const partnerDetailRoute = adminRoute('/admin/partners/:id', 'Partner', async (el, ctx) => {
  const id = ctx.params.id ?? '';
  let map: L.Map | null = null;
  const draw = async (notice: SafeHtml | '' = ''): Promise<void> => {
    map?.remove();
    map = null;
    try {
      const data = await api<{ partner: PartnerDetail; listings: PartnerListing[]; stats: Stats }>('GET', `/admin/partners/${id}`, { auth: 'required' });
      const { partner: p, listings, stats } = data;
      const actions: { name: string; label: string; show: boolean; danger?: boolean }[] = [
        { name: 'approve', label: 'Approve', show: p.status === 'pending' },
        { name: 'reject', label: 'Reject', show: p.status === 'pending', danger: true },
        { name: 'suspend', label: 'Suspend', show: p.status === 'approved', danger: true },
        { name: 'reinstate', label: 'Reinstate', show: p.status === 'suspended' },
      ];
      showAdmin(
        el,
        ctx.me,
        '#/admin/partners',
        p.businessName,
        html`<p><a href="#/admin/partners?status=${p.status}">Back to partners</a></p>${notice}
          <section class="card"><h2>${p.businessName} ${partnerStatusBadge(p.status)}</h2>
            <dl class="facts"><dt>Type</dt><dd>${cap(p.businessType)}</dd><dt>Owner</dt><dd>${p.fullName}</dd><dt>Email</dt><dd>${p.email}</dd><dt>Phone</dt><dd>${p.phone}</dd>
            <dt>Address</dt><dd>${p.address}, ${p.city}</dd><dt>Submitted</dt><dd>${formatDate(p.submittedAt)}</dd>
            ${p.reviewedAt ? html`<dt>Reviewed</dt><dd>${formatDate(p.reviewedAt)}${p.reviewedBy ? html` by ${p.reviewedBy.fullName}` : ''}</dd>` : ''}
            ${p.rejectionReason ? html`<dt>Reason</dt><dd>${p.rejectionReason}</dd>` : ''}</dl>
            <div class="action-row">${actions.filter((a) => a.show).map((a) => html`<button class="button ${a.danger ? 'button-danger' : ''}" type="button" data-action="${a.name}">${a.label}</button>`)}</div></section>
          <section class="card"><h2>Stats</h2><dl class="facts"><dt>Completed</dt><dd>${stats.completed}</dd><dt>Cancelled</dt><dd>${stats.cancelled}</dd><dt>Upcoming</dt><dd>${stats.upcomingBookings}</dd><dt>Disputes</dt><dd>${stats.disputes}</dd>
            <dt>Rating</dt><dd>${stats.ratingAverage === null ? 'No ratings' : stats.ratingAverage.toFixed(1)}</dd><dt>Fees due</dt><dd>${formatINR(stats.feesDuePaise)}</dd></dl></section>
          <section class="card"><h2>Listings (${listings.length})</h2>${listings.length ? html`<div id="mini-map" class="mini-map"></div>` : html`<p>No listings yet.</p>`}
            <ul class="plain">${listings.map((l) => html`<li><strong>${l.name}</strong> ${l.status}, ${l.capacity} bags, ${formatINR(l.hourlyRatePaise)}/hour, ${l.address}, ${l.city}</li>`)}</ul></section>`,
      );
      const mapEl = el.querySelector<HTMLElement>('#mini-map');
      if (mapEl && listings.length) {
        map = L.map(mapEl, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
        const points = listings.map((l) => L.latLng(l.latitude, l.longitude));
        listings.forEach((l, i) => L.circleMarker(points[i]!, { radius: 8, color: '#454078', fillColor: '#ef7f68', fillOpacity: 0.9 }).bindTooltip(l.name).addTo(map!));
        map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 });
      }
      el.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => button.addEventListener('click', async () => {
        const name = button.dataset.action ?? '';
        const effect: Record<string, string> = {
          approve: 'They will be able to create listings and take bookings.',
          reject: 'They will see the reason and can edit and resubmit.',
          suspend: `Their ${listings.length} listings will disappear from search. ${stats.upcomingBookings} upcoming bookings are not cancelled.`,
          reinstate: `Their ${listings.length} listings will appear in search again.`,
        };
        const reason = await confirmDialog({
          title: `${cap(name)} ${p.businessName}?`,
          text: effect[name] ?? '',
          confirmLabel: cap(name),
          reason: name === 'reject' || name === 'suspend',
          danger: name === 'reject' || name === 'suspend',
        });
        if (reason === null) return;
        button.disabled = true;
        try {
          await api('POST', `/admin/partners/${id}/${name}`, { body: reason ? { reason } : {}, auth: 'required' });
          await draw(alert('success', `Partner ${name === 'reinstate' ? 'reinstated' : `${name}${name.endsWith('e') ? 'd' : 'ed'}`}.`));
        } catch (err) {
          button.disabled = false;
          await draw(alert('danger', errorText(err)));
        }
      }));
    } catch (err) {
      showAdmin(el, ctx.me, '#/admin/partners', 'Partner', alert('danger', errorText(err)));
    }
  };
  await draw();
  return () => map?.remove();
});
