import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

export const app = createApp();

export async function reset() {
  await pool.query(`
    TRUNCATE fines, reservations, loans, copies, books, users, categories
    RESTART IDENTITY CASCADE
  `);
  await pool.query('ALTER SEQUENCE copy_barcode_seq RESTART WITH 1000');
  await pool.query(`
    INSERT INTO categories (name) VALUES
      ('Fiction'),
      ('Science Fiction'),
      ('History'),
      ('Science'),
      ('Nature')
  `);
}

export async function insertUser({ email, password, fullName, role }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, full_name, role`,
    [email, passwordHash, fullName, role]
  );
  return rows[0];
}

export async function login(email, password) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

export async function seedDesk() {
  await reset();
  await insertUser({
    email: 'ada@booknook.local',
    password: 'library123',
    fullName: 'Ada Okonkwo',
    role: 'librarian',
  });
  await insertUser({
    email: 'sam@booknook.local',
    password: 'member123',
    fullName: 'Sam Patel',
    role: 'member',
  });
  const ada = await login('ada@booknook.local', 'library123');
  const sam = await login('sam@booknook.local', 'member123');
  return {
    librarianToken: ada.token,
    memberToken: sam.token,
    member: sam.user,
  };
}

export async function categoryId(name) {
  const { rows } = await pool.query('SELECT id FROM categories WHERE name = $1', [name]);
  return rows[0].id;
}

export async function addBook(token, overrides = {}) {
  const payload = {
    title: overrides.title ?? 'Test Title',
    author: overrides.author ?? 'Test Author',
    categoryId: overrides.categoryId ?? (await categoryId(overrides.category ?? 'Fiction')),
    summary: overrides.summary ?? '',
    copies: overrides.copies ?? 1,
  };
  if (overrides.publishedYear) payload.publishedYear = overrides.publishedYear;
  if (overrides.isbn) payload.isbn = overrides.isbn;

  const response = await request(app)
    .post('/api/catalogue')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.book;
}

export async function addMember(token, overrides = {}) {
  const response = await request(app)
    .post('/api/members')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: overrides.fullName ?? 'Noah Brooks',
      email: overrides.email ?? 'noah@booknook.local',
      password: overrides.password ?? 'member123',
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.user;
}

export async function backdateLoan(loanId, daysOverdue) {
  await pool.query(
    `UPDATE loans
     SET borrowed_on = CURRENT_DATE - $2::int - 14,
         due_on = CURRENT_DATE - $2::int
     WHERE id = $1`,
    [loanId, daysOverdue]
  );
}
