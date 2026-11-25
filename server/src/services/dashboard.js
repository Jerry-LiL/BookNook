import { pool } from '../db.js';

function policyView(row) {
  return {
    loanDays: row.loan_days,
    dailyFineCents: row.daily_fine_cents,
    maxFineCents: row.max_fine_cents,
    maxActiveLoans: row.max_active_loans,
    fineBlockCents: row.fine_block_cents,
    reservationHoldDays: row.reservation_hold_days,
  };
}

async function loadPolicy() {
  const { rows } = await pool.query('SELECT * FROM library_policy WHERE id');
  return policyView(rows[0]);
}

function loanView(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name ?? null,
    title: row.title,
    author: row.author,
    barcode: row.barcode,
    borrowedOn: row.borrowed_on,
    dueOn: row.due_on,
    returnedOn: row.returned_on,
    fineCents: row.fine_cents,
    overdue: row.overdue,
    daysOverdue: row.days_overdue ?? null,
  };
}

function reservationView(row) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    author: row.author,
    memberName: row.member_name ?? null,
    queuePosition: row.queue_position,
    expiresOn: row.expires_on,
    barcode: row.barcode ?? null,
  };
}

function fineView(row) {
  return {
    id: row.id,
    loanId: row.loan_id,
    memberId: row.member_id,
    memberName: row.member_name ?? null,
    title: row.title,
    amountCents: row.amount_cents,
    daysOverdue: row.days_overdue,
    assessedOn: row.assessed_on,
    paidOn: row.paid_on,
    waivedOn: row.waived_on,
  };
}

export async function memberDashboard(memberId) {
  const [policy, loans, reservations, fines, counts, unpaid] = await Promise.all([
    loadPolicy(),
    pool.query(
      `SELECT
         l.id,
         l.member_id,
         l.borrowed_on,
         l.due_on,
         l.returned_on,
         b.title,
         b.author,
         cp.barcode,
         CASE
           WHEN f.waived_on IS NOT NULL THEN 0
           WHEN f.id IS NOT NULL THEN f.amount_cents
           ELSE overdue_fine_cents(
             l.due_on,
             COALESCE(l.returned_on, CURRENT_DATE),
             p.daily_fine_cents,
             p.max_fine_cents
           )
         END AS fine_cents,
         (l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue
       FROM loans AS l
       JOIN copies AS cp ON cp.id = l.copy_id
       JOIN books AS b ON b.id = cp.book_id
       CROSS JOIN library_policy AS p
       LEFT JOIN fines AS f ON f.loan_id = l.id
       WHERE l.member_id = $1
       ORDER BY (l.returned_on IS NULL) DESC, l.due_on ASC, l.id DESC
       LIMIT 20`,
      [memberId]
    ),
    pool.query(
      `SELECT
         r.id,
         r.status,
         r.expires_on,
         b.title,
         b.author,
         CASE
           WHEN r.status = 'waiting' THEN (
             SELECT COUNT(*)::int
             FROM reservations AS earlier
             WHERE earlier.book_id = r.book_id
               AND earlier.status = 'waiting'
               AND (earlier.created_at, earlier.id) <= (r.created_at, r.id)
           )
           ELSE NULL
         END AS queue_position
       FROM reservations AS r
       JOIN books AS b ON b.id = r.book_id
       WHERE r.member_id = $1
         AND r.status IN ('waiting', 'ready')
       ORDER BY CASE r.status WHEN 'ready' THEN 0 ELSE 1 END, r.created_at, r.id`,
      [memberId]
    ),
    pool.query(
      `SELECT
         f.id,
         f.loan_id,
         f.member_id,
         f.amount_cents,
         f.days_overdue,
         f.assessed_on,
         f.paid_on,
         f.waived_on,
         b.title
       FROM fines AS f
       JOIN loans AS l ON l.id = f.loan_id
       JOIN copies AS cp ON cp.id = l.copy_id
       JOIN books AS b ON b.id = cp.book_id
       WHERE f.member_id = $1
       ORDER BY (f.paid_on IS NULL AND f.waived_on IS NULL) DESC, f.assessed_on DESC`,
      [memberId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE returned_on IS NULL)::int AS active_loans,
         COUNT(*) FILTER (
           WHERE returned_on IS NULL AND due_on < CURRENT_DATE
         )::int AS overdue
       FROM loans
       WHERE member_id = $1`,
      [memberId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS unpaid_cents
       FROM fines
       WHERE member_id = $1
         AND paid_on IS NULL
         AND waived_on IS NULL`,
      [memberId]
    ),
  ]);

  return {
    policy,
    counts: {
      activeLoans: counts.rows[0].active_loans,
      overdue: counts.rows[0].overdue,
      unpaidCents: unpaid.rows[0].unpaid_cents,
    },
    loans: loans.rows.map(loanView),
    reservations: reservations.rows.map(reservationView),
    fines: fines.rows.map(fineView),
  };
}

export async function librarianDashboard() {
  const [policy, counts, overdue, holds, fines, members] = await Promise.all([
    loadPolicy(),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM loans WHERE returned_on IS NULL) AS on_loan,
         (SELECT COUNT(*)::int FROM loans WHERE returned_on IS NULL AND due_on < CURRENT_DATE) AS overdue,
         (SELECT COUNT(*)::int FROM reservations WHERE status = 'ready') AS holds,
         (
           SELECT COALESCE(SUM(amount_cents), 0)::int
           FROM fines
           WHERE paid_on IS NULL AND waived_on IS NULL
         ) AS unpaid_cents,
         (SELECT COUNT(*)::int FROM books) AS titles`
    ),
    pool.query(
      `SELECT
         l.id,
         l.member_id,
         u.full_name AS member_name,
         l.borrowed_on,
         l.due_on,
         l.returned_on,
         b.title,
         b.author,
         cp.barcode,
         overdue_fine_cents(l.due_on, CURRENT_DATE, p.daily_fine_cents, p.max_fine_cents) AS fine_cents,
         true AS overdue,
         (CURRENT_DATE - l.due_on) AS days_overdue
       FROM loans AS l
       JOIN users AS u ON u.id = l.member_id
       JOIN copies AS cp ON cp.id = l.copy_id
       JOIN books AS b ON b.id = cp.book_id
       CROSS JOIN library_policy AS p
       WHERE l.returned_on IS NULL
         AND l.due_on < CURRENT_DATE
       ORDER BY l.due_on, l.id`
    ),
    pool.query(
      `SELECT
         r.id,
         r.status,
         r.expires_on,
         NULL::int AS queue_position,
         u.full_name AS member_name,
         b.title,
         b.author,
         cp.barcode
       FROM reservations AS r
       JOIN users AS u ON u.id = r.member_id
       JOIN books AS b ON b.id = r.book_id
       LEFT JOIN copies AS cp ON cp.id = r.copy_id
       WHERE r.status = 'ready'
       ORDER BY r.expires_on, r.id`
    ),
    pool.query(
      `SELECT
         f.id,
         f.loan_id,
         f.member_id,
         u.full_name AS member_name,
         f.amount_cents,
         f.days_overdue,
         f.assessed_on,
         f.paid_on,
         f.waived_on,
         b.title
       FROM fines AS f
       JOIN users AS u ON u.id = f.member_id
       JOIN loans AS l ON l.id = f.loan_id
       JOIN copies AS cp ON cp.id = l.copy_id
       JOIN books AS b ON b.id = cp.book_id
       WHERE f.paid_on IS NULL
         AND f.waived_on IS NULL
       ORDER BY f.assessed_on, f.id`
    ),
    pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         (
           SELECT COUNT(*)::int
           FROM loans AS l
           WHERE l.member_id = u.id AND l.returned_on IS NULL
         ) AS active_loans,
         (
           SELECT COALESCE(SUM(f.amount_cents), 0)::int
           FROM fines AS f
           WHERE f.member_id = u.id
             AND f.paid_on IS NULL
             AND f.waived_on IS NULL
         ) AS unpaid_cents
       FROM users AS u
       WHERE u.role = 'member'
       ORDER BY u.full_name`
    ),
  ]);

  return {
    policy,
    counts: {
      onLoan: counts.rows[0].on_loan,
      overdue: counts.rows[0].overdue,
      holds: counts.rows[0].holds,
      unpaidCents: counts.rows[0].unpaid_cents,
      titles: counts.rows[0].titles,
    },
    overdue: overdue.rows.map(loanView),
    holds: holds.rows.map(reservationView),
    fines: fines.rows.map(fineView),
    members: members.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      activeLoans: row.active_loans,
      unpaidCents: row.unpaid_cents,
    })),
  };
}
