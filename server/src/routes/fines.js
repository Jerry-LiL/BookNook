import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../schemas.js';
import { settleFine } from '../services/fines.js';

export const finesRouter = Router();

finesRouter.use(requireAuth);

function settle(action) {
  return asyncHandler(async (req, res) => {
    const fine = await settleFine(req.params.id, req.user, action);
    res.json({ fine });
  });
}

finesRouter.post('/:id/pay', validate(idParamSchema, 'params'), settle('pay'));
finesRouter.post('/:id/waive', validate(idParamSchema, 'params'), settle('waive'));
