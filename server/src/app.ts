import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env';
import { loadSession } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter, requireClientHeader } from './middleware/security';
import { authRouter } from './modules/auth/routes';
import { institutionRouter } from './modules/institution/routes';
import { eventsRouter } from './modules/events/routes';
import { registrationsRouter } from './modules/registrations/routes';
import { checkinRouter } from './modules/checkin/routes';
import { venuesRouter } from './modules/venues/routes';
import { reportsRouter } from './modules/reports/routes';
import { importsRouter } from './modules/imports/routes';
import { logger } from './lib/logger';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: env.WEB_DIST
        ? {
            directives: {
              'img-src': ["'self'", 'data:', 'blob:'],
              'media-src': ["'self'", 'blob:'],
              'connect-src': ["'self'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cors({ origin: env.webOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use('/api', (req, res, next) => {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        logger.info('request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) });
      });
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });

  app.use('/api', apiLimiter, requireClientHeader, loadSession);
  app.use('/api', authRouter, institutionRouter, eventsRouter, registrationsRouter, checkinRouter, venuesRouter, reportsRouter, importsRouter);
  app.use('/api', notFoundHandler);

  app.use(
    '/uploads',
    express.static(path.resolve(env.UPLOAD_DIR), { maxAge: '7d', dotfiles: 'deny', index: false, fallthrough: true }),
  );

  if (env.WEB_DIST && existsSync(env.WEB_DIST)) {
    const dist = path.resolve(env.WEB_DIST);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io|\/uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
