import { withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { upsertLoanFine } from './fines.js';

const BLOCKED = 'Unpaid fines block borrowing and reservations';

async function policy(client) {
  const { rows } = await client.query('SELECT * FROM library_policy WHERE id');
  if (!rows[0]) throw new HttpError(500, 'Library policy is missing');
  return rows[0];
}

async function unpaidCents(client, memberId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
     FROM fines
     WHERE member_id = $1
       AND paid_on IS NULL
       AND waived_on IS NULL`,
    [memberId]
  );
  return rows[0].total;
}

async function requireBook(client, bookId) {
  const { rowCount } = await client.query('SELECT id FROM books WHERE id = $1', [bookId]);
  if (!rowCount) throw new HttpError(404, 'Book not found');
}

async function hasOpenLoan(client, memberId, bookId) {
  const { rowCount } = await client.query(
    `SELECT 1
     FROM loans AS l
     JOIN copies AS c ON c.id = l.copy_id
     WHERE l.member_id = $1
       AND l.returned_on IS NULL
       AND c.book_id = $2`,
    [memberId, bookId]
  );
  return rowCount > 0;
}

// A returned copy, or a hold that expired, goes to the oldest waiting member.
export async function offerCopyToNextWaiter(client, bookId, copyId) {
  const next = await client.query(
    `SELECT id, member_id
     FROM reservations
     WHERE book_id = $1
       AND status = 'waiting'
     ORDER BY created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT 1`,
    [bookId]
  );

  if (!next.rowCount) {
    await client.query(
      `UPDATE copies
       SET status = 'available', held_for_user_id = NULL
       WHERE id = $1`,
      [copyId]
    );
    return null;
  }

  const waiter = next.rows[0];
  await client.query(
    `UPDATE copies
     SET status = 'held', held_for_user_id = $2
     WHERE id = $1`,
    [copyId, waiter.member_id]
  );
  await client.query(
    `UPDATE reservations
     SET status = 'ready',
         ready_at = now(),
         copy_id = $2,
         expires_on = CURRENT_DATE + (
           SELECT reservation_hold_days FROM library_policy
         )
     WHERE id = $1`,
    [waiter.id, copyId]
  );
  return waiter.id;
}

export async function borrowBook(memberId, bookId) {
  return withTransaction(async (client) => {
    await requireBook(client, bookId);
    const rules = await policy(client);

    if ((await unpaidCents(client, memberId)) >= rules.fine_block_cents) {
      throw new HttpError(409, BLOCKED);
    }

    const active = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM loans
       WHERE member_id = $1 AND returned_on IS NULL`,
      [memberId]
    );
    if (active.rows[0].total >= rules.max_active_loans) {
      throw new HttpError(409, 'Loan limit reached');
    }

    if (await hasOpenLoan(client, memberId, bookId)) {
      throw new HttpError(409, 'You already have this title on loan');
    }

    const hold = await client.query(
      `SELECT id, copy_id
       FROM reservations
       WHERE member_id = $1
         AND book_id = $2
         AND status = 'ready'
       FOR UPDATE`,
      [memberId, bookId]
    );

    let copy;
    if (hold.rowCount) {
      const held = await client.query(
        `SELECT id, barcode
         FROM copies
         WHERE id = $1
           AND status = 'held'
           AND held_for_user_id = $2
         FOR UPDATE`,
        [hold.rows[0].copy_id, memberId]
      );
      if (!held.rowCount) {
        throw new HttpError(409, 'The held copy is no longer available');
      }
      copy = held.rows[0];
    } else {
      const shelf = await client.query(
        `SELECT id, barcode
         FROM copies
         WHERE book_id = $1
           AND status = 'available'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [bookId]
      );
      if (!shelf.rowCount) {
        throw new HttpError(409, 'No copies are available to borrow');
      }
      copy = shelf.rows[0];
    }

    await client.query(
      `UPDATE copies
       SET status = 'on_loan', held_for_user_id = NULL
       WHERE id = $1`,
      [copy.id]
    );

    const inserted = await client.query(
      `INSERT INTO loans (copy_id, member_id, borrowed_on, due_on)
       SELECT $1, $2, CURRENT_DATE, CURRENT_DATE + loan_days
       FROM library_policy
       RETURNING id, borrowed_on, due_on`,
      [copy.id, memberId]
    );

    if (hold.rowCount) {
      await client.query(
        `UPDATE reservations SET status = 'fulfilled' WHERE id = $1`,
        [hold.rows[0].id]
      );
    }

    const loan = inserted.rows[0];
    return {
      id: loan.id,
      bookId,
      copyId: copy.id,
      barcode: copy.barcode,
      borrowedOn: loan.borrowed_on,
      dueOn: loan.due_on,
    };
  });
}

export async function returnLoan(loanId, actor) {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT l.id, l.member_id, l.returned_on, l.copy_id, c.book_id
       FROM loans AS l
       JOIN copies AS c ON c.id = l.copy_id
       WHERE l.id = $1
       FOR UPDATE OF l, c`,
      [loanId]
    );
    const loan = found.rows[0];
    if (!loan) throw new HttpError(404, 'Loan not found');
    if (actor.role !== 'librarian' && loan.member_id !== actor.id) {
      throw new HttpError(403, 'Not your loan');
    }
    if (loan.returned_on) throw new HttpError(409, 'That loan is already back');

    const updated = await client.query(
      `UPDATE loans SET returned_on = CURRENT_DATE WHERE id = $1 RETURNING returned_on`,
      [loanId]
    );
    const fineCents = await upsertLoanFine(client, loanId);
    const heldForReservationId = await offerCopyToNextWaiter(
      client,
      loan.book_id,
      loan.copy_id
    );

    return {
      loan: {
        id: loan.id,
        returnedOn: updated.rows[0].returned_on,
        fineCents,
      },
      heldForReservationId,
    };
  });
}

export async function reserveBook(memberId, bookId) {
  try {
    return await withTransaction(async (client) => {
      await requireBook(client, bookId);
      const rules = await policy(client);
      if ((await unpaidCents(client, memberId)) >= rules.fine_block_cents) {
        throw new HttpError(409, BLOCKED);
      }
      if (await hasOpenLoan(client, memberId, bookId)) {
        throw new HttpError(409, 'You already have this title on loan');
      }

      const existing = await client.query(
        `SELECT id
         FROM reservations
         WHERE member_id = $1
           AND book_id = $2
           AND status IN ('waiting', 'ready')
         FOR UPDATE`,
        [memberId, bookId]
      );
      if (existing.rowCount) {
        throw new HttpError(409, 'You already have this title reserved');
      }

      const shelf = await client.query(
        `SELECT id
         FROM copies
         WHERE book_id = $1 AND status = 'available'
         ORDER BY id
         FOR UPDATE
         LIMIT 1`,
        [bookId]
      );
      if (shelf.rowCount) {
        throw new HttpError(409, 'Borrow the copy that is on the shelf');
      }

      const inserted = await client.query(
        `WITH inserted AS (
           INSERT INTO reservations (book_id, member_id, status)
           VALUES ($1, $2, 'waiting')
           RETURNING id, book_id, status, created_at
         )
         SELECT
           inserted.id,
           inserted.status,
           1 + (
             SELECT COUNT(*)::int
             FROM reservations AS earlier
             WHERE earlier.book_id = inserted.book_id
               AND earlier.status = 'waiting'
               AND (earlier.created_at, earlier.id) < (inserted.created_at, inserted.id)
           ) AS queue_position
         FROM inserted`,
        [bookId, memberId]
      );
      const reservation = inserted.rows[0];

      return {
        id: reservation.id,
        bookId,
        status: reservation.status,
        queuePosition: reservation.queue_position,
        expiresOn: null,
      };
    });
  } catch (error) {
    if (error.code === '23505') {
      throw new HttpError(409, 'You already have this title reserved');
    }
    throw error;
  }
}

export async function cancelReservation(reservationId, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM reservations WHERE id = $1 FOR UPDATE',
      [reservationId]
    );
    const reservation = rows[0];
    if (!reservation) throw new HttpError(404, 'Reservation not found');
    if (actor.role !== 'librarian' && reservation.member_id !== actor.id) {
      throw new HttpError(403, 'Not your reservation');
    }
    if (reservation.status !== 'waiting' && reservation.status !== 'ready') {
      throw new HttpError(409, 'That reservation is closed');
    }

    await client.query(
      `UPDATE reservations SET status = 'cancelled' WHERE id = $1`,
      [reservationId]
    );

    if (reservation.status === 'ready' && reservation.copy_id) {
      await offerCopyToNextWaiter(client, reservation.book_id, reservation.copy_id);
    }

    return { id: reservation.id, status: 'cancelled' };
  });
}

export async function expireReadyReservations() {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, book_id, copy_id
       FROM reservations
       WHERE status = 'ready'
         AND expires_on < CURRENT_DATE
       ORDER BY expires_on, id
       FOR UPDATE`
    );

    for (const reservation of rows) {
      await client.query(
        `UPDATE reservations SET status = 'expired' WHERE id = $1`,
        [reservation.id]
      );
      if (reservation.copy_id) {
        await offerCopyToNextWaiter(client, reservation.book_id, reservation.copy_id);
      }
    }

    return rows.length;
  });
}
