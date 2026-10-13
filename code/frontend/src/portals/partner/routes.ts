/**
 * Storage-partner routes, owned by the Partner agent. The public `#/partner` sign-up and
 * login page lives in main.ts for now; Foundation provides placeholders only.
 */
import type { RouteDef } from '../../lib/router';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/partner.css';

const spec: PortalSpec = {
  role: 'storage_partner',
  roleLabel: 'Storage partner',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  nav: [
    { label: 'Dashboard', href: '#/partner/dashboard', icon: 'dashboard' },
    { label: 'Listings', href: '#/partner/listings', icon: 'store' },
    { label: 'Bookings', href: '#/partner/bookings', icon: 'calendar' },
    { label: 'Handoff', href: '#/partner/handoff', icon: 'qr' },
    { label: 'Earnings', href: '#/partner/earnings', icon: 'rupee' },
    { label: 'Profile', href: '#/partner/profile', icon: 'user' },
  ],
};

const anyPartner = { roles: ['storage_partner' as const] };

export const partnerRoutes: RouteDef[] = [
  placeholderRoute(spec, '/partner/application', 'Your application', true, anyPartner),
  placeholderRoute(spec, '/partner/dashboard', 'Dashboard', true),
  placeholderRoute(spec, '/partner/listings', 'Listings'),
  placeholderRoute(spec, '/partner/bookings', 'Bookings'),
  placeholderRoute(spec, '/partner/handoff', 'Handoff'),
  placeholderRoute(spec, '/partner/earnings', 'Earnings'),
  placeholderRoute(spec, '/partner/profile', 'Profile'),
];
