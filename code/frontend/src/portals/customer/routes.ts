/** Traveller routes, owned by the Customer agent. Foundation provides placeholders only. */
import type { RouteDef } from '../../lib/router';
import { html, mount } from '../../lib/html';
import { messagePage } from '../../ui/layout';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/customer.css';

const spec: PortalSpec = {
  role: 'traveler',
  roleLabel: 'Traveller',
  guard: { roles: ['traveler'] },
  nav: [
    { label: 'Home', href: '#/app', icon: 'home' },
    { label: 'Find storage', href: '#/search', icon: 'search' },
    { label: 'My bookings', href: '#/app/bookings', icon: 'calendar' },
    { label: 'Profile', href: '#/app/profile', icon: 'user' },
  ],
};

const publicStub = (path: string, title: string): RouteDef => ({
  path,
  title,
  mount: (el) => mount(el, messagePage(title, 'This page is being built.', html`<a class="button" href="#/">Back to home</a>`)),
});

export const customerRoutes: RouteDef[] = [
  publicStub('/search', 'Find storage'),
  publicStub('/listing/:id', 'Storage details'),
  placeholderRoute(spec, '/app', 'Home', true),
  placeholderRoute(spec, '/app/bookings', 'My bookings'),
  placeholderRoute(spec, '/app/profile', 'Profile'),
];
