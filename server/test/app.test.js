import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../src/db.js';
import { runNightlyMaintenance } from '../src/jobs/nightly.js';
import { migrate } from '../src/migrate.js';
import { maintenanceCron, startScheduler } from '../src/scheduler.js';
import {
  addBook,
  addMember,
  app,
  backdateLoan,
  login,
  seedDesk,
} from './fixtures.js';

describe('BookNook', { concurrency: false }, () => {
  let desk;

  before(async () => {
    await migrate();
  });

  beforeEach(async () => {
    desk = await seedDesk();
  });

  after(async () => {
    await pool.end();
  });

  test('migrations are versioned and idempotent', async () => {
    const again = await migrate();
    assert.deepEqual(again, []);
    const { rows } = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    assert.deepEqual(
      rows.map((row) => row.version),
      ['001_schema', '002_search', '003_seed']
    );
  });

  test('bcryptjs accepts the pgcrypto hashes used in the seed', async () => {
    const { rows } = await pool.query(
      `SELECT crypt('library123', gen_salt('bf', 10)) AS hash`
    );
    assert.equal(await bcrypt.compare('library123', rows[0].hash), true);
    assert.equal(await bcrypt.compare('wrong-password', rows[0].hash), false);
  });

  test('the nightly schedule is a valid cron expression', () => {
    assert.equal(maintenanceCron(), '15 2 * * *');
    const previous = process.env.MAINTENANCE_CRON;
    process.env.MAINTENANCE_CRON = 'not a cron';
    assert.throws(() => startScheduler(), /MAINTENANCE_CRON/);
    if (previous === undefined) delete process.env.MAINTENANCE_CRON;
    else process.env.MAINTENANCE_CRON = previous;
  });

  test('health check and sign-in', async () => {
    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@booknook.local', password: 'not-the-password' });
    assert.equal(wrong.status, 401);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${desk.memberToken}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'member');
    assert.equal(me.body.fullName, 'Sam Patel');
  });

  test('Zod rejects a malformed loan and members cannot do desk work', async () => {
    const badLoan = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${desk.memberToken}`)
      .send({ bookId: 'nope' });
    assert.equal(badLoan.status, 400);
    assert.equal(badLoan.body.error, 'Invalid request');
    assert.ok(badLoan.body.issues.some((issue) => issue.path === 'bookId'));

    const create = await request(app)
      .post('/api/catalogue')
      .set('Authorization', `Bearer ${desk.memberToken}`)
      .send({ title: 'Nope', author: 'Nope', categoryId: 1 });
    assert.equal(create.status, 403);

    const deskView = await request(app)
      .get('/api/dashboard/librarian')
      .set('Authorization', `Bearer ${desk.memberToken}`);
    assert.equal(deskView.status, 403);

    const memberView = await request(app)
      .get('/api/dashboard/member')
      .set('Authorization', `Bearer ${desk.librarianToken}`);
    assert.equal(memberView.status, 403);

    const librarianBorrow = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${desk.librarianToken}`)
      .send({ bookId: 1 });
    assert.equal(librarianBorrow.status, 403);
  });

  test('duplicate member emails are rejected', async () => {
    await addMember(desk.librarianToken);
    const again = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${desk.librarianToken}`)
      .send({
        fullName: 'Noah Brooks',
        email: 'Noah@booknook.local',
        password: 'member123',
      });
    assert.equal(again.status, 409);
  });

  describe('catalogue search', () => {
    beforeEach(async () => {
      await addBook(desk.librarianToken, {
        title: 'A Brief History of Time',
        author: 'Stephen Hawking',
        category: 'Science',
      });
      await addBook(desk.librarianToken, {
        title: 'The Warmth of Other Suns',
        author: 'Isabel Wilkerson',
        category: 'History',
      });
      await addBook(desk.librarianToken, {
        title: 'Braiding Sweetgrass',
        author: 'Robin Wall Kimmerer',
        category: 'Nature',
      });
    });

    async function titles(query) {
      const response = await request(app)
        .get('/api/catalogue')
        .query(query)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.books.map((book) => book.title);
    }

    test('matches title, author, and category through the GIN index', async () => {
      const index = await pool.query(
        `SELECT am.amname
         FROM pg_class AS indexed
         JOIN pg_index AS ix ON ix.indexrelid = indexed.oid
         JOIN pg_class AS relation ON relation.oid = ix.indrelid
         JOIN pg_am AS am ON am.oid = indexed.relam
         WHERE relation.relname = 'books'
           AND indexed.relname = 'books_search_gin'`
      );
      assert.equal(index.rows[0].amname, 'gin');

      assert.deepEqual(await titles({ q: 'hawking' }), ['A Brief History of Time']);
      assert.deepEqual(await titles({ q: 'kimmerer' }), ['Braiding Sweetgrass']);
      assert.deepEqual(await titles({ q: 'nature' }), ['Braiding Sweetgrass']);

      const history = await titles({ q: 'history' });
      assert.deepEqual(history, [
        'A Brief History of Time',
        'The Warmth of Other Suns',
      ]);

      const stemmed = await titles({ q: 'histories' });
      assert.ok(stemmed.includes('A Brief History of Time'));
    });

    test('a category filter narrows a full-text query', async () => {
      const scienceId = (
        await pool.query(`SELECT id FROM categories WHERE name = 'Science'`)
      ).rows[0].id;
      const found = await titles({ q: 'history', categoryId: scienceId });
      assert.deepEqual(found, ['A Brief History of Time']);
    });

    test('renaming a category or a title refreshes the search vector', async () => {
      await pool.query(
        `UPDATE categories SET name = 'Speculative' WHERE name = 'Science Fiction'`
      );
      await addBook(desk.librarianToken, {
        title: 'Kindred',
        author: 'Octavia E. Butler',
        category: 'Speculative',
      });
      assert.deepEqual(await titles({ q: 'speculative' }), ['Kindred']);

      await pool.query(
        `UPDATE books SET title = 'Kindred Revisited' WHERE title = 'Kindred'`
      );
      assert.deepEqual(await titles({ q: 'kindred' }), ['Kindred Revisited']);
      assert.deepEqual(await titles({ q: 'zzzznotabook' }), []);
    });
  });

  describe('lending rules', () => {
    test('due dates come from the policy and an on-time return has no fine', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Circe', copies: 1 });
      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(borrowed.status, 201);

      const expected = await pool.query(
        'SELECT (CURRENT_DATE + loan_days)::text AS due FROM library_policy'
      );
      assert.equal(borrowed.body.loan.dueOn, expected.rows[0].due);

      const fine = await pool.query(
        `SELECT overdue_fine_cents(CURRENT_DATE + 1, CURRENT_DATE, 25, 1000) AS none,
                overdue_fine_cents(CURRENT_DATE - 4, CURRENT_DATE, 25, 1000) AS four,
                overdue_fine_cents(CURRENT_DATE - 80, CURRENT_DATE, 25, 1000) AS capped`
      );
      assert.equal(fine.rows[0].none, 0);
      assert.equal(fine.rows[0].four, 100);
      assert.equal(fine.rows[0].capped, 1000);

      const returned = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(returned.status, 200);
      assert.equal(returned.body.loan.fineCents, 0);
      const fines = await pool.query('SELECT id FROM fines');
      assert.equal(fines.rowCount, 0);

      const again = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(again.status, 201);
    });

    test('a second copy of the same title is refused', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Pachinko', copies: 2 });
      const first = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(first.status, 201);

      const second = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(second.status, 409);
      assert.match(second.body.error, /already have this title/);
    });

    test('the loan limit is five open loans', async () => {
      for (let index = 0; index < 5; index += 1) {
        const book = await addBook(desk.librarianToken, { title: `Shelf ${index}` });
        const response = await request(app)
          .post('/api/loans')
          .set('Authorization', `Bearer ${desk.memberToken}`)
          .send({ bookId: book.id });
        assert.equal(response.status, 201);
      }

      const extra = await addBook(desk.librarianToken, { title: 'One Too Many' });
      const blocked = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: extra.id });
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /Loan limit/);
    });

    test('a late return writes the SQL fine', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Circe' });
      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      await backdateLoan(borrowed.body.loan.id, 4);

      const returned = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(returned.status, 200);
      assert.equal(returned.body.loan.fineCents, 100);

      const stored = await pool.query(
        'SELECT amount_cents, days_overdue FROM fines WHERE loan_id = $1',
        [borrowed.body.loan.id]
      );
      assert.equal(stored.rows[0].amount_cents, 100);
      assert.equal(stored.rows[0].days_overdue, 4);

      const repeat = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(repeat.status, 409);
    });

    test('a member cannot return someone else\'s loan, a librarian can', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Circe' });
      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });

      await addMember(desk.librarianToken, {
        fullName: 'Noah Brooks',
        email: 'noah@booknook.local',
      });
      const noah = await login('noah@booknook.local', 'member123');
      const denied = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${noah.token}`);
      assert.equal(denied.status, 403);

      const returned = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.librarianToken}`);
      assert.equal(returned.status, 200);
    });

    test('unpaid fines at the threshold block borrowing until paid or waived', async () => {
      const first = await addBook(desk.librarianToken, { title: 'Overdue One' });
      const second = await addBook(desk.librarianToken, { title: 'Next One' });
      const third = await addBook(desk.librarianToken, { title: 'After Waiver' });

      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: first.id });
      await backdateLoan(borrowed.body.loan.id, 20);

      const run = await runNightlyMaintenance();
      assert.equal(run.finesUpdated, 1);

      const blocked = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: second.id });
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /Unpaid fines/);

      const reserveBlocked = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: second.id });
      assert.equal(reserveBlocked.status, 409);

      const fine = await pool.query(
        'SELECT id, amount_cents FROM fines WHERE loan_id = $1',
        [borrowed.body.loan.id]
      );
      assert.equal(fine.rows[0].amount_cents, 500);

      const paid = await request(app)
        .post(`/api/fines/${fine.rows[0].id}/pay`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(paid.status, 200);

      const allowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: second.id });
      assert.equal(allowed.status, 201);

      await backdateLoan(allowed.body.loan.id, 20);
      await runNightlyMaintenance();
      const nextFine = await pool.query(
        'SELECT id, amount_cents FROM fines WHERE loan_id = $1',
        [allowed.body.loan.id]
      );
      assert.equal(nextFine.rows[0].amount_cents, 500);

      const waived = await request(app)
        .post(`/api/fines/${nextFine.rows[0].id}/waive`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(waived.status, 403);

      const waiver = await request(app)
        .post(`/api/fines/${nextFine.rows[0].id}/waive`)
        .set('Authorization', `Bearer ${desk.librarianToken}`);
      assert.equal(waiver.status, 200);

      const afterWaiver = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: third.id });
      assert.equal(afterWaiver.status, 201);
    });

    test('the nightly job refreshes an open fine and leaves a paid one alone', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Still Out' });
      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      await backdateLoan(borrowed.body.loan.id, 2);
      await runNightlyMaintenance();

      const first = await pool.query('SELECT id, amount_cents FROM fines');
      assert.equal(first.rows[0].amount_cents, 50);

      await backdateLoan(borrowed.body.loan.id, 4);
      await runNightlyMaintenance();
      const second = await pool.query('SELECT amount_cents, paid_on FROM fines WHERE id = $1', [
        first.rows[0].id,
      ]);
      assert.equal(second.rows[0].amount_cents, 100);

      const memberDash = await request(app)
        .get('/api/dashboard/member')
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(memberDash.status, 200);
      assert.equal(memberDash.body.counts.overdue, 1);
      assert.equal(memberDash.body.counts.unpaidCents, 100);
      assert.equal(memberDash.body.loans[0].title, 'Still Out');

      const deskDash = await request(app)
        .get('/api/dashboard/librarian')
        .set('Authorization', `Bearer ${desk.librarianToken}`);
      assert.equal(deskDash.status, 200);
      assert.equal(deskDash.body.counts.onLoan, 1);
      assert.equal(deskDash.body.counts.overdue, 1);
      assert.equal(deskDash.body.overdue[0].memberName, 'Sam Patel');
      assert.equal(deskDash.body.overdue[0].fineCents, 100);
      assert.equal(deskDash.body.fines[0].amountCents, 100);
      assert.equal(deskDash.body.members[0].unpaidCents, 100);

      await request(app)
        .post(`/api/fines/${first.rows[0].id}/pay`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      await backdateLoan(borrowed.body.loan.id, 10);
      await runNightlyMaintenance();

      const paid = await pool.query(
        'SELECT amount_cents, paid_on FROM fines WHERE id = $1',
        [first.rows[0].id]
      );
      assert.equal(paid.rows[0].amount_cents, 100);
      assert.ok(paid.rows[0].paid_on);
    });

    test('reservations queue, then a return holds the copy for the next member', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Kindred', copies: 1 });
      await addMember(desk.librarianToken, {
        fullName: 'Noah Brooks',
        email: 'noah@booknook.local',
      });
      await addMember(desk.librarianToken, {
        fullName: 'Mina Shah',
        email: 'mina@booknook.local',
      });
      const noah = await login('noah@booknook.local', 'member123');
      const mina = await login('mina@booknook.local', 'member123');

      const onShelf = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(onShelf.status, 409);
      assert.match(onShelf.body.error, /on the shelf/);

      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      assert.equal(borrowed.status, 201);

      const first = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${noah.token}`)
        .send({ bookId: book.id });
      assert.equal(first.status, 201);
      assert.equal(first.body.reservation.queuePosition, 1);

      const second = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${mina.token}`)
        .send({ bookId: book.id });
      assert.equal(second.status, 201);
      assert.equal(second.body.reservation.queuePosition, 2);

      const duplicate = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${noah.token}`)
        .send({ bookId: book.id });
      assert.equal(duplicate.status, 409);

      const returned = await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);
      assert.equal(returned.body.heldForReservationId, first.body.reservation.id);

      const jumped = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${mina.token}`)
        .send({ bookId: book.id });
      assert.equal(jumped.status, 409);

      const pickup = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${noah.token}`)
        .send({ bookId: book.id });
      assert.equal(pickup.status, 201);
      assert.equal(pickup.body.loan.copyId, borrowed.body.loan.copyId);

      const status = await pool.query(
        `SELECT status FROM reservations WHERE id = $1`,
        [first.body.reservation.id]
      );
      assert.equal(status.rows[0].status, 'fulfilled');
    });

    test('an expired hold is offered to the next member', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Kindred', copies: 1 });
      await addMember(desk.librarianToken, {
        fullName: 'Noah Brooks',
        email: 'noah@booknook.local',
      });
      await addMember(desk.librarianToken, {
        fullName: 'Mina Shah',
        email: 'mina@booknook.local',
      });
      const noah = await login('noah@booknook.local', 'member123');
      const mina = await login('mina@booknook.local', 'member123');

      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      const first = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${noah.token}`)
        .send({ bookId: book.id });
      const second = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${mina.token}`)
        .send({ bookId: book.id });
      await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);

      await pool.query(
        `UPDATE reservations SET expires_on = CURRENT_DATE - 1 WHERE id = $1`,
        [first.body.reservation.id]
      );
      const run = await runNightlyMaintenance();
      assert.equal(run.holdsExpired, 1);

      const states = await pool.query(
        'SELECT id, status FROM reservations ORDER BY id'
      );
      assert.equal(states.rows[0].status, 'expired');
      assert.equal(states.rows[1].status, 'ready');

      const pickup = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${mina.token}`)
        .send({ bookId: book.id });
      assert.equal(pickup.status, 201);
      assert.equal(second.body.reservation.id > 0, true);
    });

    test('cancelling a ready hold passes the copy down the queue', async () => {
      const book = await addBook(desk.librarianToken, { title: 'Kindred', copies: 1 });
      await addMember(desk.librarianToken, {
        fullName: 'Noah Brooks',
        email: 'noah@booknook.local',
      });
      await addMember(desk.librarianToken, {
        fullName: 'Mina Shah',
        email: 'mina@booknook.local',
      });
      const noah = await login('noah@booknook.local', 'member123');
      const mina = await login('mina@booknook.local', 'member123');

      const borrowed = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${desk.memberToken}`)
        .send({ bookId: book.id });
      const first = await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${noah.token}`)
        .send({ bookId: book.id });
      await request(app)
        .post('/api/reservations')
        .set('Authorization', `Bearer ${mina.token}`)
        .send({ bookId: book.id });
      await request(app)
        .post(`/api/loans/${borrowed.body.loan.id}/return`)
        .set('Authorization', `Bearer ${desk.memberToken}`);

      const cancelled = await request(app)
        .delete(`/api/reservations/${first.body.reservation.id}`)
        .set('Authorization', `Bearer ${noah.token}`);
      assert.equal(cancelled.status, 200);

      const dashboard = await request(app)
        .get('/api/dashboard/member')
        .set('Authorization', `Bearer ${mina.token}`);
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.body.reservations[0].status, 'ready');
      assert.equal(dashboard.body.counts.activeLoans, 0);
    });
  });
});
