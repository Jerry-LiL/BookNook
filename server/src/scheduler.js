import cron from 'node-cron';
import { runNightlyMaintenance } from './jobs/nightly.js';

// 02:15 UTC, after a branch would have closed. Override with MAINTENANCE_CRON.
export function maintenanceCron() {
  return process.env.MAINTENANCE_CRON || '15 2 * * *';
}

export function startScheduler() {
  const expression = maintenanceCron();
  if (!cron.validate(expression)) {
    throw new Error(`Invalid MAINTENANCE_CRON: ${expression}`);
  }

  return cron.schedule(expression, () => {
    runNightlyMaintenance().catch((error) => {
      console.error('Nightly maintenance failed', error);
    });
  });
}
