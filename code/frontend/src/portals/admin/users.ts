/** Users: search, filter, disable and enable. */
import type { Paginated } from '../../../../shared/types';
import { formatDate } from '../../lib/format';
import { html } from '../../lib/html';
import { api } from '../../lib/session';
import { alert, badge } from '../../ui/components';
import { adminRoute, confirmDialog, errorText, showAdmin } from './shell';

interface User { id: string; email: string; fullName: string; phone: string; role: string; isDisabled: boolean; createdAt: string; bookingCount: number }

export const usersRoute = adminRoute('/admin/users', 'Users', async (el, ctx) => {
  const f = { q: ctx.query.get('q') ?? '', role: ctx.query.get('role') ?? '', disabled: ctx.query.get('disabled') ?? '' };
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  const load = async (message = ''): Promise<void> => {
    try {
      const list = await api<Paginated<User>>('GET', '/admin/users', { query: { ...f, page }, auth: 'required' });
      const last = Math.max(1, Math.ceil(list.total / list.pageSize));
      const link = (p: number): string => `#/admin/users?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(p) })}`;
      showAdmin(el, ctx.me, '#/admin/users', 'Users', html`${message ? alert('info', message) : ''}
        <form id="filters" class="card filter-bar"><label>Name or email<input type="search" name="q" value="${f.q}" /></label>
          <label>Role<select name="role"><option value="">All</option>${['traveler', 'storage_partner', 'admin'].map((r) => html`<option value="${r}" ${r === f.role ? html`selected` : ''}>${r.replace('_', ' ')}</option>`)}</select></label>
          <label>Status<select name="disabled"><option value="">All</option><option value="false" ${f.disabled === 'false' ? html`selected` : ''}>Active</option><option value="true" ${f.disabled === 'true' ? html`selected` : ''}>Disabled</option></select></label><button class="button button-small" type="submit">Filter</button></form>
        <table class="table"><thead><tr><th>User</th><th>Role</th><th>Bookings</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.items.map((u) => html`<tr><td data-label="User">${u.fullName || '(no name)'}<br><small>${u.email}</small></td><td data-label="Role">${u.role.replace('_', ' ')}</td><td data-label="Bookings">${u.bookingCount}</td><td data-label="Joined">${formatDate(u.createdAt)}</td>
          <td data-label="Status">${u.isDisabled ? badge('Disabled', 'danger') : badge('Active', 'success')}</td>
          <td>${u.role === 'admin' || u.id === ctx.me.id ? '' : html`<button class="button button-small ${u.isDisabled ? '' : 'button-danger'}" type="button" data-user="${u.id}" data-disabled="${u.isDisabled}">${u.isDisabled ? 'Enable' : 'Disable'}</button>`}</td></tr>`)}</tbody></table>
        ${list.items.length === 0 ? html`<p class="empty">No users match.</p>` : ''}
        <p class="pager">${page > 1 ? html`<a href="${link(page - 1)}">Previous</a>` : ''} Page ${page} of ${last} (${list.total}) ${page < last ? html`<a href="${link(page + 1)}">Next</a>` : ''}</p>`);
      const form = el.querySelector<HTMLFormElement>('#filters');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(form).forEach((v, k) => { if (typeof v === 'string' && v.trim()) params.set(k, v.trim()); });
        window.location.hash = `#/admin/users${params.size ? `?${params}` : ''}`;
      });
      el.querySelectorAll<HTMLButtonElement>('[data-user]').forEach((button) =>
        button.addEventListener('click', async () => {
          const disabling = button.dataset.disabled !== 'true';
          const reason = await confirmDialog(disabling
            ? { title: 'Disable this user?', text: 'They are signed out of the API and cannot log in until re-enabled.', confirmLabel: 'Disable', reason: true, danger: true }
            : { title: 'Enable this user?', text: 'They can log in again.', confirmLabel: 'Enable' });
          if (reason === null) return;
          try {
            await api('POST', `/admin/users/${button.dataset.user}/${disabling ? 'disable' : 'enable'}`, { body: disabling ? { reason } : {}, auth: 'required' });
            await load(disabling ? 'User disabled.' : 'User enabled.');
          } catch (err) {
            await load(errorText(err));
          }
        }),
      );
    } catch (err) {
      showAdmin(el, ctx.me, '#/admin/users', 'Users', alert('danger', errorText(err)));
    }
  };
  showAdmin(el, ctx.me, '#/admin/users', 'Users', html`<p>Loading...</p>`);
  await load();
});
