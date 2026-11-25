import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { publicUser, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { memberSchema } from '../schemas.js';

export const membersRouter = Router();

membersRouter.use(requireAuth, requireRole('librarian'));

membersRouter.post(
  '/',
  validate(memberSchema, 'body'),
  asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, config.bcryptRounds);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'member')
         RETURNING id, email, full_name, role`,
        [req.body.email, passwordHash, req.body.fullName]
      );
      res.status(201).json({ user: publicUser(rows[0]) });
    } catch (error) {
      if (error.code === '23505') {
        throw new HttpError(409, 'A user with that email already exists');
      }
      throw error;
    }
  })
);
