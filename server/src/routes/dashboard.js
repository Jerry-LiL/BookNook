import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { librarianDashboard, memberDashboard } from '../services/dashboard.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/member',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    res.json(await memberDashboard(req.user.id));
  })
);

dashboardRouter.get(
  '/librarian',
  requireRole('librarian'),
  asyncHandler(async (_req, res) => {
    res.json(await librarianDashboard());
  })
);
