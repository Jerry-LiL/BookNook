import { pool, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';

function bookRow(row) {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    summary: row.summary,
    publishedYear: row.published_year,
    categoryId: row.category_id,
    category: row.category,
    copies: row.copies,
    available: row.available,
  };
}

export async function searchCatalogue({ q, categoryId }) {
  const { rows } = await pool.query(
    `SELECT
       b.id,
       b.isbn,
       b.title,
       b.author,
       b.summary,
       b.published_year,
       b.category_id,
       c.name AS category,
       COUNT(cp.id)::int AS copies,
       COUNT(cp.id) FILTER (WHERE cp.status = 'available')::int AS available,
       CASE
         WHEN $1 = '' THEN 0
         ELSE ts_rank(b.search_vector, websearch_to_tsquery('english', $1))
       END AS rank
     FROM books AS b
     JOIN categories AS c ON c.id = b.category_id
     LEFT JOIN copies AS cp ON cp.book_id = b.id
     WHERE (
       $1 = ''
       OR b.search_vector @@ websearch_to_tsquery('english', $1)
     )
       AND ($2::int IS NULL OR b.category_id = $2)
     GROUP BY b.id, c.name
     ORDER BY rank DESC, b.title ASC
     LIMIT 50`,
    [q, categoryId ?? null]
  );

  return rows.map(bookRow);
}

export async function listCategories() {
  const { rows } = await pool.query(
    'SELECT id, name FROM categories ORDER BY name'
  );
  return rows;
}

export async function createBook(input) {
  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO books (isbn, title, author, category_id, summary, published_year)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, isbn, title, author, summary, published_year, category_id`,
        [
          input.isbn ?? null,
          input.title,
          input.author,
          input.categoryId,
          input.summary,
          input.publishedYear ?? null,
        ]
      );
      const book = inserted.rows[0];
      const copies = [];
      for (let index = 0; index < input.copies; index += 1) {
        const copy = await client.query(
          `INSERT INTO copies (book_id, barcode)
           VALUES ($1, 'BN-' || nextval('copy_barcode_seq'))
           RETURNING id, barcode, status`,
          [book.id]
        );
        copies.push(copy.rows[0]);
      }

      const category = await client.query(
        'SELECT name FROM categories WHERE id = $1',
        [book.category_id]
      );

      return {
        id: book.id,
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        summary: book.summary,
        publishedYear: book.published_year,
        categoryId: book.category_id,
        category: category.rows[0].name,
        copies,
      };
    });
  } catch (error) {
    if (error.code === '23503') throw new HttpError(400, 'Unknown category');
    if (error.code === '23505') throw new HttpError(409, 'That ISBN is already in the catalogue');
    throw error;
  }
}
