/** Request fields added by the middleware in this folder. */
import type { AuthUser } from './auth.ts';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    user?: AuthUser;
    valid?: Record<string, unknown>;
  }
}
