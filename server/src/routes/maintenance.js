import { Router } from 'express';
import { runNightlyMaintenance } from '../jobs/nightly.js';
import { asyncHandler } from '../http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const maintenanceRouter = Router();

maintenanceRouter.use(requireAuth, requireRole('librarian'));

maintenanceRouter.post(
  '/run',
  asyncHandler(async (_req, res) => {
    res.json(await runNightlyMaintenance());
  })
);
