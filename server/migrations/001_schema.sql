-- Catalogue, copies, loans, reservations, and the fine rule.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE library_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  loan_days integer NOT NULL DEFAULT 14 CHECK (loan_days > 0),
  daily_fine_cents integer NOT NULL DEFAULT 25 CHECK (daily_fine_cents >= 0),
  max_fine_cents integer NOT NULL DEFAULT 1000 CHECK (max_fine_cents >= 0),
  max_active_loans integer NOT NULL DEFAULT 5 CHECK (max_active_loans > 0),
  fine_block_cents integer NOT NULL DEFAULT 500 CHECK (fine_block_cents >= 0),
  reservation_hold_days integer NOT NULL DEFAULT 3 CHECK (reservation_hold_days > 0),
  CONSTRAINT library_policy_cap CHECK (max_fine_cents >= daily_fine_cents)
);

INSERT INTO library_policy (id) VALUES (true);

-- The due date itself is not charged. One day late is one day's fine, capped.
CREATE FUNCTION overdue_fine_cents(
  due_on date,
  as_of date,
  daily_fine_cents integer,
  max_fine_cents integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN as_of <= due_on THEN 0
    ELSE LEAST((as_of - due_on) * daily_fine_cents, max_fine_cents)
  END;
$$;

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('librarian', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE books (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  isbn text UNIQUE,
  title text NOT NULL,
  author text NOT NULL,
  category_id integer NOT NULL REFERENCES categories (id),
  summary text NOT NULL DEFAULT '',
  published_year integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE copy_barcode_seq START 1000;

CREATE TABLE copies (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books (id),
  barcode text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_loan', 'held')),
  held_for_user_id integer REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT held_copy_has_member CHECK (
    status <> 'held' OR held_for_user_id IS NOT NULL
  )
);

CREATE TABLE loans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  copy_id integer NOT NULL REFERENCES copies (id),
  member_id integer NOT NULL REFERENCES users (id),
  borrowed_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date NOT NULL,
  returned_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= borrowed_on),
  CHECK (returned_on IS NULL OR returned_on >= borrowed_on)
);

CREATE UNIQUE INDEX loans_one_open_per_copy
  ON loans (copy_id)
  WHERE returned_on IS NULL;

CREATE INDEX loans_open_member_idx
  ON loans (member_id)
  WHERE returned_on IS NULL;

CREATE TABLE reservations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id integer NOT NULL REFERENCES books (id),
  member_id integer NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  expires_on date,
  copy_id integer REFERENCES copies (id),
  CONSTRAINT ready_reservation_has_copy CHECK (
    status <> 'ready' OR (copy_id IS NOT NULL AND expires_on IS NOT NULL)
  )
);

CREATE UNIQUE INDEX reservations_one_active
  ON reservations (book_id, member_id)
  WHERE status IN ('waiting', 'ready');

CREATE INDEX reservations_queue_idx
  ON reservations (book_id, status, created_at, id);

CREATE TABLE fines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id integer NOT NULL UNIQUE REFERENCES loans (id),
  member_id integer NOT NULL REFERENCES users (id),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  days_overdue integer NOT NULL CHECK (days_overdue >= 0),
  assessed_on date NOT NULL DEFAULT CURRENT_DATE,
  paid_on date,
  waived_on date,
  CHECK (paid_on IS NULL OR waived_on IS NULL)
);
