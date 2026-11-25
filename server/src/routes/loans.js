import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { borrowSchema, idParamSchema } from '../schemas.js';
import { borrowBook, returnLoan } from '../services/lending.js';

export const loansRouter = Router();

loansRouter.use(requireAuth);

loansRouter.post(
  '/',
  requireRole('member'),
  validate(borrowSchema, 'body'),
  asyncHandler(async (req, res) => {
    const loan = await borrowBook(req.user.id, req.body.bookId);
    res.status(201).json({ loan });
  })
);

loansRouter.post(
  '/:id/return',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await returnLoan(req.params.id, req.user);
    res.json(result);
  })
);
