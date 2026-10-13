/** Partner portal chrome: the nav differs by application status. */
import type { Me } from '../../../../shared/types';
import { ApiRequestError } from '../../lib/api';
import type { SafeHtml } from '../../lib/html';
import type { NavItem } from '../../ui/layout';
import { renderPortal } from '../../ui/layout';

export const FULL_NAV: NavItem[] = [
  { label: 'Dashboard', href: '#/partner/dashboard', icon: 'dashboard' },
  { label: 'Handoff', href: '#/partner/handoff', icon: 'qr' },
  { label: 'Bookings', href: '#/partner/bookings', icon: 'calendar' },
  { label: 'Listings', href: '#/partner/listings', icon: 'store' },
  { label: 'Earnings', href: '#/partner/earnings', icon: 'rupee' },
  { label: 'Profile', href: '#/partner/profile', icon: 'user' },
];
const APPLICATION_NAV: NavItem[] = [{ label: 'Application', href: '#/partner/application', icon: 'store' }];

export function showPartner(el: HTMLElement, me: Me, active: string, title: string, content: SafeHtml): void {
  const open = me.partner?.status === 'approved' || me.partner?.status === 'suspended';
  renderPortal(el, { nav: open ? FULL_NAV : APPLICATION_NAV, active, title, me, roleLabel: 'Storage partner', content });
}

export const errorText = (err: unknown): string => (err instanceof ApiRequestError || err instanceof Error ? err.message : 'Something went wrong.');
