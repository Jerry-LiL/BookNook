import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, reserveSchema } from '../schemas.js';
import { cancelReservation, reserveBook } from '../services/lending.js';

export const reservationsRouter = Router();

reservationsRouter.use(requireAuth);

reservationsRouter.post(
  '/',
  requireRole('member'),
  validate(reserveSchema, 'body'),
  asyncHandler(async (req, res) => {
    const reservation = await reserveBook(req.user.id, req.body.bookId);
    res.status(201).json({ reservation });
  })
);

reservationsRouter.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const reservation = await cancelReservation(req.params.id, req.user);
    res.json({ reservation });
  })
);
