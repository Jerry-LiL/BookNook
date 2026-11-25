-- A small branch worth opening: one librarian, two members, a few loans.

INSERT INTO categories (name) VALUES
  ('Fiction'),
  ('Science Fiction'),
  ('History'),
  ('Science'),
  ('Nature');

INSERT INTO users (email, password_hash, full_name, role) VALUES
  (
    'ada@booknook.local',
    crypt('library123', gen_salt('bf', 10)),
    'Ada Okonkwo',
    'librarian'
  ),
  (
    'sam@booknook.local',
    crypt('member123', gen_salt('bf', 10)),
    'Sam Patel',
    'member'
  ),
  (
    'noah@booknook.local',
    crypt('member123', gen_salt('bf', 10)),
    'Noah Brooks',
    'member'
  );

INSERT INTO books (title, author, category_id, summary, published_year, isbn)
SELECT
  seed.title,
  seed.author,
  c.id,
  seed.summary,
  seed.published_year,
  seed.isbn
FROM (
  VALUES
    (
      'The Left Hand of Darkness',
      'Ursula K. Le Guin',
      'Science Fiction',
      'An envoy spends a winter on Gethen.',
      1969,
      '9780441478125'
    ),
    (
      'Kindred',
      'Octavia E. Butler',
      'Science Fiction',
      'A writer is pulled from California back to the antebellum South.',
      1979,
      '9780807083697'
    ),
    (
      'The Dispossessed',
      'Ursula K. Le Guin',
      'Science Fiction',
      'A physicist moves between an anarchist moon and its rich twin planet.',
      1974,
      '9780061054884'
    ),
    (
      'The Warmth of Other Suns',
      'Isabel Wilkerson',
      'History',
      'A history of the Great Migration told through three lives.',
      2010,
      '9780679763888'
    ),
    (
      'A Brief History of Time',
      'Stephen Hawking',
      'Science',
      'A short tour of cosmology, from the big bang to black holes.',
      1988,
      '9780553380163'
    ),
    (
      'Braiding Sweetgrass',
      'Robin Wall Kimmerer',
      'Nature',
      'Essays on plants, reciprocity, and indigenous knowledge.',
      2013,
      '9781571313560'
    ),
    (
      'Circe',
      'Madeline Miller',
      'Fiction',
      'The witch of Aiaia tells her own story.',
      2018,
      '9780316556347'
    ),
    (
      'Pachinko',
      'Min Jin Lee',
      'Fiction',
      'Four generations of a Korean family in Japan.',
      2017,
      '9781455563930'
    )
) AS seed(title, author, category, summary, published_year, isbn)
JOIN categories AS c ON c.name = seed.category;

INSERT INTO copies (book_id, barcode, status)
SELECT b.id, copy.barcode, copy.status
FROM (
  VALUES
    ('The Left Hand of Darkness', 'BN-1001', 'on_loan'),
    ('Kindred', 'BN-1002', 'on_loan'),
    ('Kindred', 'BN-1003', 'available'),
    ('The Dispossessed', 'BN-1004', 'available'),
    ('The Warmth of Other Suns', 'BN-1005', 'available'),
    ('A Brief History of Time', 'BN-1006', 'on_loan'),
    ('Braiding Sweetgrass', 'BN-1007', 'available'),
    ('Circe', 'BN-1008', 'available'),
    ('Pachinko', 'BN-1009', 'available'),
    ('Pachinko', 'BN-1010', 'available')
) AS copy(title, barcode, status)
JOIN books AS b ON b.title = copy.title;

SELECT setval('copy_barcode_seq', 1010, true);

-- Noah has the only copy of Left Hand of Darkness.
INSERT INTO loans (copy_id, member_id, borrowed_on, due_on)
SELECT c.id, u.id, CURRENT_DATE - 4, CURRENT_DATE + 10
FROM copies AS c
JOIN users AS u ON u.email = 'noah@booknook.local'
WHERE c.barcode = 'BN-1001';

-- Sam has Kindred, still within the loan period.
INSERT INTO loans (copy_id, member_id, borrowed_on, due_on)
SELECT c.id, u.id, CURRENT_DATE - 9, CURRENT_DATE + 5
FROM copies AS c
JOIN users AS u ON u.email = 'sam@booknook.local'
WHERE c.barcode = 'BN-1002';

-- Sam's Hawking is six days overdue. The fine uses the SQL function.
INSERT INTO loans (copy_id, member_id, borrowed_on, due_on)
SELECT c.id, u.id, CURRENT_DATE - 20, CURRENT_DATE - 6
FROM copies AS c
JOIN users AS u ON u.email = 'sam@booknook.local'
WHERE c.barcode = 'BN-1006';

INSERT INTO fines (loan_id, member_id, amount_cents, days_overdue, assessed_on)
SELECT
  l.id,
  l.member_id,
  overdue_fine_cents(l.due_on, CURRENT_DATE, p.daily_fine_cents, p.max_fine_cents),
  CURRENT_DATE - l.due_on,
  CURRENT_DATE
FROM loans AS l
JOIN copies AS c ON c.id = l.copy_id
CROSS JOIN library_policy AS p
WHERE c.barcode = 'BN-1006';

-- Sam is waiting for the Le Guin that Noah has out.
INSERT INTO reservations (book_id, member_id, status)
SELECT b.id, u.id, 'waiting'
FROM books AS b
JOIN users AS u ON u.email = 'sam@booknook.local'
WHERE b.title = 'The Left Hand of Darkness';
