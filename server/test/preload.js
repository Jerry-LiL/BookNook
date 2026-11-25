import pg from 'pg';

const adminUrl =
  process.env.ADMIN_DATABASE_URL ||
  'postgres://booknook:booknook@localhost:5432/booknook';
const testUrl =
  process.env.TEST_DATABASE_URL ||
  'postgres://booknook:booknook@localhost:5432/booknook_test';

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
const existing = await client.query(
  "SELECT 1 FROM pg_database WHERE datname = 'booknook_test'"
);
if (existing.rowCount === 0) {
  await client.query('CREATE DATABASE booknook_test');
}
await client.end();

process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
