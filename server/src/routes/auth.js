import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { publicUser, requireAuth, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema } from '../schemas.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  validate(loginSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, role, password_hash
       FROM users
       WHERE email = $1`,
      [req.body.email]
    );
    const user = rows[0];
    const matches = user && (await bcrypt.compare(req.body.password, user.password_hash));
    if (!matches) throw new HttpError(401, 'Email or password is wrong');

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) throw new HttpError(401, 'Sign in required');
    res.json(publicUser(rows[0]));
  })
);
