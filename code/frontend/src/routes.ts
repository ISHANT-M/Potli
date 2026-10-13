/** Every `#/…` route the router knows. Portal agents add to their own routes.ts, not this file. */
import { registerRoute } from './pages/auth/register';
import { verifyRoute } from './pages/auth/verify';
import type { RouteDef } from './lib/router';
import { adminRoutes } from './portals/admin/routes';
import { customerRoutes } from './portals/customer/routes';
import { partnerRoutes } from './portals/partner/routes';

export const routes: RouteDef[] = [registerRoute, verifyRoute, ...customerRoutes, ...partnerRoutes, ...adminRoutes];
