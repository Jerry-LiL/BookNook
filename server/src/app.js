import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { catalogueRouter } from './routes/catalogue.js';
import { dashboardRouter } from './routes/dashboard.js';
import { finesRouter } from './routes/fines.js';
import { loansRouter } from './routes/loans.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { membersRouter } from './routes/members.js';
import { reservationsRouter } from './routes/reservations.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/catalogue', catalogueRouter);
  app.use('/api/loans', loansRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/fines', finesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/maintenance', maintenanceRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../client/dist'
  );
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
