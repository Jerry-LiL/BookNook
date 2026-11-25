import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { startScheduler } from './scheduler.js';

const app = createApp();

try {
  const applied = await migrate();
  if (applied.length) {
    console.log(`Applied migrations: ${applied.join(', ')}`);
  }
} catch (error) {
  console.error('Migration failed', error);
  await pool.end();
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`BookNook API listening on ${config.port}`);
});

const task = startScheduler();

async function shutdown() {
  task.stop();
  server.close();
  await pool.end();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
