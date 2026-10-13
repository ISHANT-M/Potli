/** Application status card; rejected partners can edit the details and resubmit. */
import type { Me } from '../../../../shared/types';
import { BUSINESS_TYPES } from '../../../../shared/validation';
import { clearFieldErrors, readForm, setBusy, setMessage, showFieldErrors } from '../../lib/forms';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, refreshMe } from '../../lib/session';
import { ApiRequestError } from '../../lib/api';
import { alert, partnerStatusBadge } from '../../ui/components';
import { errorText, showPartner } from './shell';

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export function businessFields(partner: NonNullable<Me['partner']>, readOnlyName: boolean) {
  return html`<label>Business name<input type="text" name="businessName" value="${partner.businessName}" required ${readOnlyName ? html`readonly` : ''} /></label>
    <label>Business type<select name="businessType" ${readOnlyName ? html`disabled` : ''}>${BUSINESS_TYPES.map((type) => html`<option value="${type}" ${type === partner.businessType ? html`selected` : ''}>${cap(type)}</option>`)}</select></label>
    <label>Phone<input type="tel" name="phone" value="${partner.phone}" autocomplete="tel" required /></label>
    <label>Address<input type="text" name="address" value="${partner.address}" required /></label>
    <label>City<input type="text" name="city" value="${partner.city}" ${readOnlyName ? html`readonly` : ''} required /></label>`;
}

export const applicationRoute: RouteDef = {
  path: '/partner/application',
  title: 'Your application',
  guard: { roles: ['storage_partner'] },
  mount(el, ctx) {
    const me = ctx.me;
    const partner = me?.partner;
    if (!me || !partner) return;
    if (partner.status === 'approved') {
      window.location.hash = '#/partner/dashboard';
      return;
    }
    const body =
      partner.status === 'pending'
        ? html`<p>We're reviewing your business. This usually takes 1-2 working days.</p>`
        : partner.status === 'suspended'
          ? html`${alert('danger', html`Your account is suspended${partner.rejectionReason ? html`: ${partner.rejectionReason}` : ''}.`)}<p>Existing bookings can still be handed over. Contact Potli support to get reinstated.</p>`
          : html`${alert('danger', html`Your application was not approved${partner.rejectionReason ? html`: ${partner.rejectionReason}` : ''}.`)}
            <p>Update your details and resubmit for another review.</p>
            <form class="partner-form" id="resubmit" novalidate>${businessFields(partner, false)}<button class="button" type="submit">Resubmit application</button><p class="form-message" role="status"></p></form>`;
    showPartner(el, me, '#/partner/application', 'Your application', html`<section class="card"><h2>${partner.businessName} ${partnerStatusBadge(partner.status)}</h2>${body}</section>`);

    const form = el.querySelector<HTMLFormElement>('#resubmit');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFieldErrors(form);
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
      setBusy(submit, true, 'Submitting...');
      try {
        const { businessName, businessType, phone, address, city } = readForm(form);
        await api('PATCH', '/partner/me', { body: { businessName, businessType, phone, address, city }, auth: 'required' });
        const fresh = await refreshMe({ fresh: true });
        void applicationRoute.mount(el, { ...ctx, me: fresh });
      } catch (err) {
        if (err instanceof ApiRequestError) showFieldErrors(form, err.fields);
        setMessage(form, errorText(err), 'error');
        setBusy(submit, false);
      }
    });
  },
};
