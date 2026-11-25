import { assessOverdueFines } from '../services/fines.js';
import { expireReadyReservations } from '../services/lending.js';

export async function runNightlyMaintenance() {
  const finesUpdated = await assessOverdueFines();
  const holdsExpired = await expireReadyReservations();
  return {
    finesUpdated,
    holdsExpired,
    ranAt: new Date().toISOString(),
  };
}
