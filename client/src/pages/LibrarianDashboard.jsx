import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Button, Field, Notice, PolicyNote, Stat, TextInput } from '../components';
import { errorText, money, prettyDate } from '../format';

export function LibrarianDashboard() {
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const [dashboard, categoryList] = await Promise.all([
      api('/api/dashboard/librarian'),
      api('/api/catalogue/categories'),
    ]);
    setData(dashboard);
    setCategories(categoryList.categories);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorText(err)));
  }, [load]);

  async function run(key, path, method, success) {
    setError('');
    setNotice('');
    setBusy(key);
    try {
      const result = await api(path, { method });
      setNotice(success(result));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <p className="text-sm text-stone-500">{error || 'Loading…'}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Desk</h1>
          <PolicyNote policy={data.policy} />
        </div>
        <Button
          disabled={busy === 'job'}
          onClick={() =>
            run('job', '/api/maintenance/run', 'POST', (result) => {
              const fines =
                result.finesUpdated === 1 ? '1 fine' : `${result.finesUpdated} fines`;
              const holds =
                result.holdsExpired === 1 ? '1 hold' : `${result.holdsExpired} holds`;
              return `Nightly job updated ${fines} and expired ${holds}.`;
            })
          }
        >
          Run nightly job
        </Button>
      </div>
      <Notice message={error} />
      <Notice message={notice} tone="ok" />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On loan" value={data.counts.onLoan} />
        <Stat label="Overdue" value={data.counts.overdue} />
        <Stat label="Holds ready" value={data.counts.holds} />
        <Stat label="Unpaid fines" value={money(data.counts.unpaidCents)} />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Overdue</h2>
        {data.overdue.length === 0 ? (
          <p className="text-sm text-stone-600">Nothing is overdue.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-sand bg-card">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Accruing</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.overdue.map((loan) => (
                  <tr key={loan.id} className="border-t border-sand">
                    <td className="px-4 py-3">{loan.memberName}</td>
                    <td className="px-4 py-3">
                      <div>{loan.title}</div>
                      <div className="text-stone-500">{loan.barcode}</div>
                    </td>
                    <td className="px-4 py-3 text-clay">
                      {prettyDate(loan.dueOn)} · {loan.daysOverdue} days
                    </td>
                    <td className="px-4 py-3">{money(loan.fineCents)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        kind="quiet"
                        disabled={busy === `loan-${loan.id}`}
                        onClick={() =>
                          run(
                            `loan-${loan.id}`,
                            `/api/loans/${loan.id}/return`,
                            'POST',
                            () => `Checked in ${loan.title}.`
                          )
                        }
                      >
                        Check in
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Ready for pickup</h2>
        {data.holds.length === 0 ? (
          <p className="text-sm text-stone-600">No copies are being held.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-lg border border-sand bg-card">
            {data.holds.map((hold) => (
              <li key={hold.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{hold.title}</span>
                <span className="text-stone-600">
                  {' '}
                  for {hold.memberName}, until {prettyDate(hold.expiresOn)}
                  {hold.barcode ? ` · ${hold.barcode}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Unpaid fines</h2>
        {data.fines.length === 0 ? (
          <p className="text-sm text-stone-600">No unpaid fines.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-lg border border-sand bg-card">
            {data.fines.map((fine) => (
              <li
                key={fine.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {money(fine.amountCents)} · {fine.memberName}
                  </div>
                  <div className="text-stone-500">
                    {fine.title} · {fine.daysOverdue} days
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    kind="quiet"
                    disabled={busy === `pay-${fine.id}`}
                    onClick={() =>
                      run(
                        `pay-${fine.id}`,
                        `/api/fines/${fine.id}/pay`,
                        'POST',
                        () => `Marked ${fine.memberName}'s fine paid.`
                      )
                    }
                  >
                    Mark paid
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={busy === `waive-${fine.id}`}
                    onClick={() =>
                      run(
                        `waive-${fine.id}`,
                        `/api/fines/${fine.id}/waive`,
                        'POST',
                        () => `Waived ${fine.memberName}'s fine.`
                      )
                    }
                  >
                    Waive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <AddBook
          categories={categories}
          onDone={async (title) => {
            setNotice(`Added ${title} to the catalogue.`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await load();
          }}
          onError={setError}
        />
        <AddMember
          onDone={async (name) => {
            setNotice(`Added member ${name}.`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await load();
          }}
          onError={setError}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Members</h2>
        <div className="overflow-x-auto rounded-lg border border-sand bg-card">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Out</th>
                <th className="px-4 py-3 font-semibold">Unpaid</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.id} className="border-t border-sand">
                  <td className="px-4 py-3">{member.fullName}</td>
                  <td className="px-4 py-3 text-stone-600">{member.email}</td>
                  <td className="px-4 py-3">{member.activeLoans}</td>
                  <td className="px-4 py-3">{money(member.unpaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AddBook({ categories, onDone, onError }) {
  const [form, setForm] = useState({
    title: '',
    author: '',
    categoryId: '',
    publishedYear: '',
    copies: '1',
    summary: '',
  });
  const [pending, setPending] = useState(false);

  function set(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    onError('');
    setPending(true);
    try {
      const body = {
        title: form.title,
        author: form.author,
        categoryId: Number(form.categoryId),
        copies: Number(form.copies),
        summary: form.summary,
      };
      if (form.publishedYear) body.publishedYear = Number(form.publishedYear);
      await api('/api/catalogue', { method: 'POST', body: JSON.stringify(body) });
      const title = form.title;
      setForm({
        title: '',
        author: '',
        categoryId: form.categoryId,
        publishedYear: '',
        copies: '1',
        summary: '',
      });
      await onDone(title);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-sand bg-card p-4">
      <h2 className="font-serif text-2xl">Add a title</h2>
      <Field label="Title">
        <TextInput value={form.title} onChange={set('title')} required />
      </Field>
      <Field label="Author">
        <TextInput value={form.author} onChange={set('author')} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            value={form.categoryId}
            onChange={set('categoryId')}
            required
          >
            <option value="">Choose</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Copies">
          <TextInput
            type="number"
            min="1"
            max="20"
            value={form.copies}
            onChange={set('copies')}
            required
          />
        </Field>
      </div>
      <Field label="Year">
        <TextInput
          inputMode="numeric"
          value={form.publishedYear}
          onChange={set('publishedYear')}
          placeholder="Optional"
        />
      </Field>
      <Field label="Summary">
        <textarea
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-pine"
          rows={3}
          value={form.summary}
          onChange={set('summary')}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add title'}
      </Button>
    </form>
  );
}

function AddMember({ onDone, onError }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [pending, setPending] = useState(false);

  function set(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    onError('');
    setPending(true);
    try {
      await api('/api/members', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const name = form.fullName;
      setForm({ fullName: '', email: '', password: '' });
      await onDone(name);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-sand bg-card p-4">
      <h2 className="font-serif text-2xl">Add a member</h2>
      <Field label="Name">
        <TextInput value={form.fullName} onChange={set('fullName')} required />
      </Field>
      <Field label="Email">
        <TextInput type="email" value={form.email} onChange={set('email')} required />
      </Field>
      <Field label="Password">
        <TextInput
          type="text"
          value={form.password}
          onChange={set('password')}
          minLength={8}
          required
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add member'}
      </Button>
    </form>
  );
}
