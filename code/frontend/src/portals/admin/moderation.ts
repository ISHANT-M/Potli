/** Listings (flag/unflag), disputes (resolve) and the audit log. */
import type { AuditEntry, Paginated, PartnerListing } from '../../../../shared/types';
import { formatDateTime, formatINR } from '../../lib/format';
import { html, mount } from '../../lib/html';
import { api } from '../../lib/session';
import { alert, badge } from '../../ui/components';
import { adminRoute, confirmDialog, errorText, showAdmin } from './shell';

const filterBar = (fields: [string, string, string][], selects: [string, string, string, string[]][]) => html`<form id="filters" class="card filter-bar">
  ${fields.map(([name, label, value]) => html`<label>${label}<input type="search" name="${name}" value="${value}" /></label>`)}
  ${selects.map(([name, label, value, options]) => html`<label>${label}<select name="${name}"><option value="">All</option>${options.map((o) => html`<option value="${o}" ${o === value ? html`selected` : ''}>${o}</option>`)}</select></label>`)}
  <button class="button button-small" type="submit">Filter</button></form>`;

function wireFilters(el: HTMLElement, base: string): void {
  const form = el.querySelector<HTMLFormElement>('#filters');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    new FormData(form).forEach((v, k) => { if (typeof v === 'string' && v.trim()) params.set(k, v.trim()); });
    window.location.hash = `${base}${params.size ? `?${params}` : ''}`;
  });
}
const pager = (base: string, q: Record<string, string>, page: number, total: number, size: number) => {
  const last = Math.max(1, Math.ceil(total / size));
  const link = (p: number): string => `${base}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), page: String(p) })}`;
  return html`<p class="pager">${page > 1 ? html`<a href="${link(page - 1)}">Previous</a>` : ''} Page ${page} of ${last} (${total}) ${page < last ? html`<a href="${link(page + 1)}">Next</a>` : ''}</p>`;
};

export const listingsRoute = adminRoute('/admin/listings', 'Listings', async (el, ctx) => {
  const f = { q: ctx.query.get('q') ?? '', status: ctx.query.get('status') ?? '', city: ctx.query.get('city') ?? '' };
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  const load = async (message = ''): Promise<void> => {
    try {
      const list = await api<Paginated<PartnerListing>>('GET', '/admin/listings', { query: { ...f, page }, auth: 'required' });
      showAdmin(el, ctx.me, '#/admin/listings', 'Listings', html`${message ? alert('info', message) : ''}${filterBar([['q', 'Name', f.q], ['city', 'City', f.city]], [['status', 'Status', f.status, ['active', 'paused', 'flagged']]])}
        <table class="table"><thead><tr><th>Listing</th><th>Partner</th><th>Capacity</th><th>Rate</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.items.map((l) => html`<tr><td data-label="Listing">${l.name}<br><small>${l.address}, ${l.city}</small></td><td data-label="Partner">${l.businessName}</td><td data-label="Capacity">${l.capacity}</td><td data-label="Rate">${formatINR(l.hourlyRatePaise)}/h</td>
          <td data-label="Status">${badge(l.status, l.status === 'active' ? 'success' : l.status === 'flagged' ? 'danger' : 'neutral')}${l.flagReason ? html`<br><small>${l.flagReason}</small>` : ''}</td>
          <td><button class="button button-small ${l.status === 'flagged' ? '' : 'button-danger'}" type="button" data-listing="${l.id}" data-flagged="${l.status === 'flagged'}">${l.status === 'flagged' ? 'Unflag' : 'Flag'}</button></td></tr>`)}</tbody></table>
        ${list.items.length === 0 ? html`<p class="empty">No listings match.</p>` : ''}${pager('#/admin/listings', f, page, list.total, list.pageSize)}`);
      wireFilters(el, '#/admin/listings');
      el.querySelectorAll<HTMLButtonElement>('[data-listing]').forEach((button) =>
        button.addEventListener('click', async () => {
          const flagging = button.dataset.flagged !== 'true';
          const reason = await confirmDialog(flagging
            ? { title: 'Flag this listing?', text: 'It is hidden from search until unflagged.', confirmLabel: 'Flag', reason: true, danger: true }
            : { title: 'Unflag this listing?', text: 'It becomes active again.', confirmLabel: 'Unflag' });
          if (reason === null) return;
          try {
            await api('POST', `/admin/listings/${button.dataset.listing}/${flagging ? 'flag' : 'unflag'}`, { body: flagging ? { reason } : {}, auth: 'required' });
            await load(flagging ? 'Listing flagged.' : 'Listing unflagged.');
          } catch (err) {
            await load(errorText(err));
          }
        }),
      );
    } catch (err) {
      showAdmin(el, ctx.me, '#/admin/listings', 'Listings', alert('danger', errorText(err)));
    }
  };
  showAdmin(el, ctx.me, '#/admin/listings', 'Listings', html`<p>Loading...</p>`);
  await load();
});

interface Dispute { id: string; bookingId: string; bookingCode: string; raisedBy: { name: string; role: string }; reason: string; status: string; resolution: string | null; createdAt: string }

export const disputesRoute = adminRoute('/admin/disputes', 'Disputes', async (el, ctx) => {
  const status = ctx.query.get('status') ?? 'open';
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  const load = async (message = ''): Promise<void> => {
    try {
      const list = await api<Paginated<Dispute>>('GET', '/admin/disputes', { query: { status, page }, auth: 'required' });
      showAdmin(el, ctx.me, '#/admin/disputes', 'Disputes', html`${message ? alert('info', message) : ''}
        <p class="tabs">${['open', 'resolved', 'rejected'].map((s) => html`<a class="button button-small ${s === status ? '' : 'button-secondary'}" href="#/admin/disputes?status=${s}">${s}</a> `)}</p>
        ${list.items.length === 0 ? html`<p class="empty">No ${status} disputes.</p>` : ''}
        ${list.items.map((d) => html`<article class="card"><h2><a href="#/admin/bookings/${d.bookingId}">${d.bookingCode}</a> ${badge(d.status, d.status === 'open' ? 'warning' : 'neutral')}</h2>
          <p><strong>${d.raisedBy.name}</strong> (${d.raisedBy.role.replace('_', ' ')}), ${formatDateTime(d.createdAt)}</p><p>${d.reason}</p>
          ${d.resolution ? html`<p><small>Resolution: ${d.resolution}</small></p>` : html`<button class="button button-small" type="button" data-resolve="${d.id}">Resolve</button>`}</article>`)}
        ${pager('#/admin/disputes', { status }, page, list.total, list.pageSize)}`);
      el.querySelectorAll<HTMLButtonElement>('[data-resolve]').forEach((button) =>
        button.addEventListener('click', () => {
          const dialog = document.createElement('dialog');
          dialog.className = 'confirm-dialog';
          mount(dialog, html`<form method="dialog"><h2>Resolve dispute</h2><label>Outcome<select name="outcome"><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select></label>
            <label>Resolution<textarea name="resolution" rows="3" maxlength="1000" required></textarea></label><p class="field-error" id="err" hidden></p>
            <div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button" type="submit">Save</button></div></form>`);
          const close = (): void => { dialog.close(); dialog.remove(); };
          dialog.querySelector('[data-cancel]')?.addEventListener('click', close);
          dialog.querySelector('form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const value = (n: string): string => (dialog.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? '').trim();
            const err = dialog.querySelector<HTMLElement>('#err');
            if (value('resolution').length < 10) { if (err) { err.textContent = 'Write at least 10 characters.'; err.hidden = false; } return; }
            try {
              await api('POST', `/admin/disputes/${button.dataset.resolve}/resolve`, { body: { outcome: value('outcome'), resolution: value('resolution') }, auth: 'required' });
              close();
              await load('Dispute updated.');
            } catch (e) {
              if (err) { err.textContent = errorText(e); err.hidden = false; }
            }
          });
          document.body.append(dialog);
          dialog.showModal();
        }),
      );
    } catch (err) {
      showAdmin(el, ctx.me, '#/admin/disputes', 'Disputes', alert('danger', errorText(err)));
    }
  };
  showAdmin(el, ctx.me, '#/admin/disputes', 'Disputes', html`<p>Loading...</p>`);
  await load();
});

export const auditRoute = adminRoute('/admin/audit', 'Audit log', async (el, ctx) => {
  const f = { action: ctx.query.get('action') ?? '', entity: ctx.query.get('entity') ?? '', entityId: ctx.query.get('entityId') ?? '' };
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  showAdmin(el, ctx.me, '#/admin/audit', 'Audit log', html`<p>Loading...</p>`);
  try {
    const list = await api<Paginated<AuditEntry>>('GET', '/admin/audit', { query: { ...f, page }, auth: 'required' });
    showAdmin(el, ctx.me, '#/admin/audit', 'Audit log', html`${filterBar([['action', 'Action', f.action], ['entity', 'Entity', f.entity], ['entityId', 'Entity id', f.entityId]], [])}
      <table class="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
      ${list.items.map((a) => html`<tr><td data-label="When">${formatDateTime(a.createdAt)}</td><td data-label="Actor">${a.actor ? `${a.actor.fullName} (${a.actor.role})` : 'system'}</td><td data-label="Action">${a.action}</td><td data-label="Entity">${a.entity}<br><small>${a.entityId}</small></td>
        <td data-label="Details">${Object.keys(a.metadata).length ? html`<details><summary>View</summary><pre>${JSON.stringify(a.metadata, null, 2)}</pre></details>` : ''}</td></tr>`)}</tbody></table>
      ${list.items.length === 0 ? html`<p class="empty">No entries match.</p>` : ''}${pager('#/admin/audit', f, page, list.total, list.pageSize)}`);
    wireFilters(el, '#/admin/audit');
  } catch (err) {
    showAdmin(el, ctx.me, '#/admin/audit', 'Audit log', alert('danger', errorText(err)));
  }
});
