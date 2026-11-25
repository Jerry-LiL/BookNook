import 'dotenv/config';
import { pool } from './db.js';
import { migrate } from './migrate.js';

try {
  const applied = await migrate();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Migrations are up to date');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
