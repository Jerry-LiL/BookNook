import pg from 'pg';
import { config } from './config.js';

// Keep DATE values as YYYY-MM-DD strings. node-pg otherwise returns a JS Date
// at local midnight, which can move the calendar day when it is serialized.
pg.types.setTypeParser(1082, (value) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (error) => {
  console.error('Postgres pool error', error);
});

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
