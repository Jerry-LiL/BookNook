import { Router } from 'express';
import { asyncHandler } from '../http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { bookSchema, searchQuerySchema } from '../schemas.js';
import { createBook, listCategories, searchCatalogue } from '../services/catalogue.js';

export const catalogueRouter = Router();

catalogueRouter.use(requireAuth);

catalogueRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await listCategories() });
  })
);

catalogueRouter.get(
  '/',
  validate(searchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const books = await searchCatalogue(req.query);
    res.json({ books });
  })
);

catalogueRouter.post(
  '/',
  requireRole('librarian'),
  validate(bookSchema, 'body'),
  asyncHandler(async (req, res) => {
    const book = await createBook(req.body);
    res.status(201).json({ book });
  })
);
