/** Builds the Express app from injected dependencies; nothing here connects or listens. */
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Database } from '../../db/client.ts';
import type { AppwriteAdapter } from './appwrite.ts';
import type { Config } from './config.ts';
import { errorHandler, notFoundHandler } from './http/errors.ts';
import { globalLimiter } from './http/rateLimit.ts';
import { createHandoffCodes, type HandoffCodes } from './lib/handoff.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { customerRouter } from './routes/customer.ts';
import { filesRouter } from './routes/files.ts';
import { partnerRouter } from './routes/partner.ts';
import { systemRouter } from './routes/system.ts';

/** What the app is built from; tests inject a throwaway database and a fake Appwrite. */
export interface AppInput {
  db: Database;
  appwrite: AppwriteAdapter;
  config: Config;
}

/** What every router receives. */
export interface AppDeps extends AppInput {
  handoff: HandoffCodes;
}

export function createApp(input: AppInput): Express {
  const deps: AppDeps = { ...input, handoff: createHandoffCodes(input.config.handoffSecret) };
  const { config } = deps;

  const app = express();
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  // The API serves JSON and private images, so a content security policy adds nothing here.
  // Images are fetched cross-origin by the frontend, hence the relaxed resource policy.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: false,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(globalLimiter());

  const v1 = express.Router();
  v1.use(systemRouter(deps));
  v1.use(authRouter(deps));
  v1.use(filesRouter(deps));
  v1.use(customerRouter(deps));
  v1.use(partnerRouter(deps));
  v1.use(adminRouter(deps));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(config));
  return app;
}
