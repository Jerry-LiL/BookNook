import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, Field, Notice, TextInput } from '../components';
import { errorText } from '../format';

export function Catalogue() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [books, setBooks] = useState([]);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load(nextQuery = q, nextCategory = categoryId) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    if (nextCategory) params.set('categoryId', nextCategory);
    const data = await api(`/api/catalogue?${params.toString()}`);
    setBooks(data.books);
  }

  useEffect(() => {
    let active = true;
    Promise.all([api('/api/catalogue/categories'), api('/api/catalogue')])
      .then(([categoryData, bookData]) => {
        if (!active) return;
        setCategories(categoryData.categories);
        setBooks(bookData.books);
      })
      .catch((err) => {
        if (active) setError(errorText(err));
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSearch(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function act(book, path) {
    setError('');
    setNotice('');
    setBusyId(book.id);
    try {
      await api(path, {
        method: 'POST',
        body: JSON.stringify({ bookId: book.id }),
      });
      setNotice(
        path === '/api/loans'
          ? `Borrowed “${book.title}”. The due date is on your loans page.`
          : `Reserved “${book.title}”. You are in the queue.`
      );
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Catalogue</h1>
        <p className="mt-1 text-sm text-stone-600">
          Search title, author, or category. A title match ranks above a category match.
        </p>
      </div>
      <form onSubmit={onSearch} className="grid gap-3 md:grid-cols-[1fr_14rem_auto]">
        <Field label="Search">
          <TextInput
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="le guin, history, kimmerer"
          />
        </Field>
        <Field label="Category">
          <select
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-pine"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit">Search</Button>
        </div>
      </form>
      <Notice message={error} />
      <Notice message={notice} tone="ok" />
      <div className="grid gap-3">
        {books.length === 0 ? (
          <p className="text-sm text-stone-600">No books matched.</p>
        ) : (
          books.map((book) => (
            <article
              key={book.id}
              className="rounded-lg border border-sand bg-card px-4 py-4 md:flex md:items-start md:justify-between md:gap-6"
            >
              <div>
                <h2 className="font-serif text-xl leading-tight">{book.title}</h2>
                <p className="mt-1 text-sm text-stone-700">
                  {book.author}
                  {book.publishedYear ? ` · ${book.publishedYear}` : ''}
                </p>
                <p className="mt-2 text-sm text-stone-600">{book.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-sand px-2 py-0.5">{book.category}</span>
                  <span className="text-stone-500">
                    {book.available > 0
                      ? `${book.available} of ${book.copies} on the shelf`
                      : 'No copies on the shelf'}
                  </span>
                </div>
              </div>
              {user.role === 'member' ? (
                <div className="mt-4 flex shrink-0 gap-2 md:mt-0">
                  {book.available > 0 ? (
                    <Button disabled={busyId === book.id} onClick={() => act(book, '/api/loans')}>
                      Borrow
                    </Button>
                  ) : (
                    <Button
                      kind="quiet"
                      disabled={busyId === book.id}
                      onClick={() => act(book, '/api/reservations')}
                    >
                      Reserve
                    </Button>
                  )}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
