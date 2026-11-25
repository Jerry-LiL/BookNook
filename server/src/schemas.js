import { z } from 'zod';

function emptyToUndefined(value) {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export const memberSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(120),
  email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const bookSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  author: z.string().trim().min(1, 'Author is required').max(200),
  categoryId: z.number().int().positive(),
  summary: z.string().trim().max(2000).optional().default(''),
  publishedYear: z.preprocess(
    emptyToUndefined,
    z.number().int().min(1000).max(2100).optional()
  ),
  isbn: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^[0-9Xx-]{10,17}$/, 'ISBN looks wrong')
      .optional()
  ),
  copies: z.number().int().min(1).max(20).optional().default(1),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const borrowSchema = z.object({
  bookId: z.number({ invalid_type_error: 'Book id must be a number' }).int().positive(),
});

export const reserveSchema = borrowSchema;

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
