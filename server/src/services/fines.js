import { pool } from '../db.js';
import { HttpError } from '../errors.js';

const fineSelect = `
  SELECT
    l.id,
    l.member_id,
    overdue_fine_cents(l.due_on, CURRENT_DATE, p.daily_fine_cents, p.max_fine_cents) AS amount_cents,
    GREATEST(CURRENT_DATE - l.due_on, 0) AS days_overdue,
    CURRENT_DATE AS assessed_on
  FROM loans AS l
  CROSS JOIN library_policy AS p
`;

export async function upsertLoanFine(client, loanId) {
  const { rows } = await client.query(
    `INSERT INTO fines (loan_id, member_id, amount_cents, days_overdue, assessed_on)
     ${fineSelect}
     WHERE l.id = $1
       AND overdue_fine_cents(l.due_on, CURRENT_DATE, p.daily_fine_cents, p.max_fine_cents) > 0
     ON CONFLICT (loan_id) DO UPDATE
     SET amount_cents = EXCLUDED.amount_cents,
         days_overdue = EXCLUDED.days_overdue,
         assessed_on = EXCLUDED.assessed_on
     WHERE fines.paid_on IS NULL
       AND fines.waived_on IS NULL
     RETURNING amount_cents`,
    [loanId]
  );

  if (rows[0]) return rows[0].amount_cents;

  const existing = await client.query(
    'SELECT amount_cents FROM fines WHERE loan_id = $1',
    [loanId]
  );
  return existing.rows[0]?.amount_cents ?? 0;
}

export async function assessOverdueFines() {
  const { rows } = await pool.query(
    `WITH upserted AS (
       INSERT INTO fines (loan_id, member_id, amount_cents, days_overdue, assessed_on)
       ${fineSelect}
       WHERE l.returned_on IS NULL
         AND l.due_on < CURRENT_DATE
       ON CONFLICT (loan_id) DO UPDATE
       SET amount_cents = EXCLUDED.amount_cents,
           days_overdue = EXCLUDED.days_overdue,
           assessed_on = EXCLUDED.assessed_on
       WHERE fines.paid_on IS NULL
         AND fines.waived_on IS NULL
       RETURNING loan_id
     )
     SELECT COUNT(*)::int AS updated FROM upserted`
  );
  return rows[0].updated;
}

export async function settleFine(fineId, actor, action) {
  if (action !== 'pay' && action !== 'waive') {
    throw new HttpError(400, 'Unknown fine action');
  }
  if (action === 'waive' && actor.role !== 'librarian') {
    throw new HttpError(403, 'Not allowed');
  }

  const column = action === 'pay' ? 'paid_on' : 'waived_on';
  const { rows } = await pool.query(
    `UPDATE fines
     SET ${column} = CURRENT_DATE
     WHERE id = $1
       AND paid_on IS NULL
       AND waived_on IS NULL
       AND ($2::text = 'librarian' OR member_id = $3)
     RETURNING id, amount_cents, paid_on, waived_on, member_id`,
    [fineId, actor.role, actor.id]
  );

  if (rows[0]) {
    return {
      id: rows[0].id,
      amountCents: rows[0].amount_cents,
      paidOn: rows[0].paid_on,
      waivedOn: rows[0].waived_on,
    };
  }

  const existing = await pool.query(
    'SELECT member_id, paid_on, waived_on FROM fines WHERE id = $1',
    [fineId]
  );
  if (!existing.rowCount) throw new HttpError(404, 'Fine not found');

  const fine = existing.rows[0];
  if (actor.role !== 'librarian' && fine.member_id !== actor.id) {
    throw new HttpError(403, 'Not your fine');
  }
  throw new HttpError(409, 'That fine is already settled');
}
