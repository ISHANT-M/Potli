/** Platform-fee ledger: dues per partner, record settlement, history. */
import type { Paginated, Settlement } from '../../../../shared/types';
import { ApiRequestError } from '../../lib/api';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import { html, mount } from '../../lib/html';
import { api } from '../../lib/session';
import { alert } from '../../ui/components';
import { adminRoute, errorText, showAdmin } from './shell';

interface Row { partnerId: string; businessName: string; completedCount: number; grossPaise: number; feesDuePaise: number; feesSettledPaise: number; oldestDueAt: string | null }

function settleDialog(row: Row): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    mount(dialog, html`<form method="dialog"><h2>Record settlement</h2><p>${row.businessName} pays <strong>${formatINR(row.feesDuePaise)}</strong> for all unsettled completed bookings.</p>
      <label>Reference (UPI ref or receipt no.)<input name="reference" minlength="3" maxlength="80" required /></label><label>Note<textarea name="note" rows="2" maxlength="300"></textarea></label>
      <p class="field-error" id="err" hidden></p><div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button" type="submit">Record ${formatINR(row.feesDuePaise)}</button></div></form>`);
    const done = (ok: boolean): void => { dialog.close(); dialog.remove(); resolve(ok); };
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => done(false));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); done(false); });
    dialog.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const field = (name: string): string => (dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();
      const err = dialog.querySelector<HTMLElement>('#err');
      try {
        await api('POST', '/admin/ledger/settlements', { body: { partnerId: row.partnerId, reference: field('reference'), note: field('note'), expectedAmountPaise: row.feesDuePaise }, auth: 'required' });
        done(true);
      } catch (e) {
        if (err) { err.textContent = e instanceof ApiRequestError ? e.message : 'Could not record the settlement.'; err.hidden = false; }
      }
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export const ledgerRoute = adminRoute('/admin/ledger', 'Ledger', async (el, ctx) => {
  const page = Number(ctx.query.get('page') ?? '1') || 1;
  const load = async (): Promise<void> => {
    try {
      const [ledger, history] = await Promise.all([
        api<Paginated<Row>>('GET', '/admin/ledger', { query: { page }, auth: 'required' }),
        api<Paginated<Settlement>>('GET', '/admin/ledger/settlements', { query: { pageSize: 10 }, auth: 'required' }),
      ]);
      const last = Math.max(1, Math.ceil(ledger.total / ledger.pageSize));
      showAdmin(el, ctx.me, '#/admin/ledger', 'Ledger', html`<section class="card"><h2>Dues by partner</h2><table class="table"><thead><tr><th>Partner</th><th>Completed</th><th>Gross</th><th>Dues</th><th>Settled</th><th>Oldest due</th><th></th></tr></thead><tbody>
        ${ledger.items.map((r, i) => html`<tr><td data-label="Partner"><a href="#/admin/partners/${r.partnerId}">${r.businessName}</a></td><td data-label="Completed">${r.completedCount}</td><td data-label="Gross">${formatINR(r.grossPaise)}</td><td data-label="Dues">${formatINR(r.feesDuePaise)}</td><td data-label="Settled">${formatINR(r.feesSettledPaise)}</td><td data-label="Oldest due">${r.oldestDueAt ? formatDate(r.oldestDueAt) : ''}</td>
          <td>${r.feesDuePaise > 0 ? html`<button class="button button-small" type="button" data-settle="${i}">Record settlement</button>` : ''}</td></tr>`)}</tbody></table>
        ${ledger.items.length === 0 ? html`<p class="empty">No collected payments yet.</p>` : ''}
        <p class="pager">${page > 1 ? html`<a href="#/admin/ledger?page=${page - 1}">Previous</a>` : ''} Page ${page} of ${last} ${page < last ? html`<a href="#/admin/ledger?page=${page + 1}">Next</a>` : ''}</p></section>
        <section class="card"><h2>Recent settlements</h2>${history.items.length === 0 ? html`<p>None yet.</p>` : html`<table class="table"><thead><tr><th>When</th><th>Partner</th><th>Amount</th><th>Bookings</th><th>Reference</th><th>By</th></tr></thead><tbody>
        ${history.items.map((s) => html`<tr><td data-label="When">${formatDateTime(s.createdAt)}</td><td data-label="Partner">${s.businessName}</td><td data-label="Amount">${formatINR(s.amountPaise)}</td><td data-label="Bookings">${s.paymentCount}</td><td data-label="Reference">${s.reference}</td><td data-label="By">${s.recordedBy.fullName}</td></tr>`)}</tbody></table>`}</section>`);
      el.querySelectorAll<HTMLButtonElement>('[data-settle]').forEach((button) =>
        button.addEventListener('click', async () => {
          const row = ledger.items[Number(button.dataset.settle)];
          if (row && (await settleDialog(row))) await load();
        }),
      );
    } catch (err) {
      showAdmin(el, ctx.me, '#/admin/ledger', 'Ledger', alert('danger', errorText(err)));
    }
  };
  showAdmin(el, ctx.me, '#/admin/ledger', 'Ledger', html`<p>Loading...</p>`);
  await load();
});
