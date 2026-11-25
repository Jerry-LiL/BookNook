import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Button, Notice, PolicyNote, Stat } from '../components';
import { errorText, money, prettyDate } from '../format';

export function MemberDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const next = await api('/api/dashboard/member');
    setData(next);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorText(err)));
  }, [load]);

  async function run(key, path, method, success) {
    setError('');
    setNotice('');
    setBusy(key);
    try {
      await api(path, { method });
      setNotice(success);
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

  const openLoans = data.loans.filter((loan) => !loan.returnedOn);
  const earlierLoans = data.loans.filter((loan) => loan.returnedOn);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">My loans</h1>
        <PolicyNote policy={data.policy} />
      </div>
      <Notice message={error} />
      <Notice message={notice} tone="ok" />
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Out now" value={data.counts.activeLoans} />
        <Stat label="Overdue" value={data.counts.overdue} />
        <Stat label="Unpaid fines" value={money(data.counts.unpaidCents)} />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Books out</h2>
        {openLoans.length === 0 ? (
          <p className="text-sm text-stone-600">Nothing is checked out.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-sand bg-card">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Fine</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {openLoans.map((loan) => (
                  <tr key={loan.id} className="border-t border-sand">
                    <td className="px-4 py-3">
                      <div className="font-medium">{loan.title}</div>
                      <div className="text-stone-500">{loan.author}</div>
                    </td>
                    <td className={`px-4 py-3 ${loan.overdue ? 'text-clay' : ''}`}>
                      {prettyDate(loan.dueOn)}
                      {loan.overdue ? ' · overdue' : ''}
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
                            `Returned ${loan.title}.`
                          )
                        }
                      >
                        Return
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {earlierLoans.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Returned</h2>
          <ul className="divide-y divide-sand rounded-lg border border-sand bg-card">
            {earlierLoans.map((loan) => (
              <li key={loan.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{loan.title}</span>
                <span className="text-stone-500">
                  {' '}
                  · back {prettyDate(loan.returnedOn)}
                  {loan.fineCents ? ` · fine ${money(loan.fineCents)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Reservations</h2>
        {data.reservations.length === 0 ? (
          <p className="text-sm text-stone-600">No holds in the queue.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-lg border border-sand bg-card">
            {data.reservations.map((reservation) => (
              <li
                key={reservation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{reservation.title}</div>
                  <div className="text-stone-500">
                    {reservation.status === 'ready'
                      ? `Ready for pickup until ${prettyDate(reservation.expiresOn)}`
                      : `Waiting, position ${reservation.queuePosition}`}
                  </div>
                </div>
                <Button
                  kind="ghost"
                  disabled={busy === `hold-${reservation.id}`}
                  onClick={() =>
                    run(
                      `hold-${reservation.id}`,
                      `/api/reservations/${reservation.id}`,
                      'DELETE',
                      `Cancelled the hold on ${reservation.title}.`
                    )
                  }
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl">Fines</h2>
        {data.fines.length === 0 ? (
          <p className="text-sm text-stone-600">No fines on the account.</p>
        ) : (
          <ul className="divide-y divide-sand rounded-lg border border-sand bg-card">
            {data.fines.map((fine) => {
              const open = !fine.paidOn && !fine.waivedOn;
              return (
                <li
                  key={fine.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {money(fine.amountCents)} · {fine.title}
                    </div>
                    <div className="text-stone-500">
                      {fine.daysOverdue} days overdue
                      {fine.paidOn ? ` · paid ${prettyDate(fine.paidOn)}` : ''}
                      {fine.waivedOn ? ` · waived ${prettyDate(fine.waivedOn)}` : ''}
                    </div>
                  </div>
                  {open ? (
                    <Button
                      disabled={busy === `fine-${fine.id}`}
                      onClick={() =>
                        run(
                          `fine-${fine.id}`,
                          `/api/fines/${fine.id}/pay`,
                          'POST',
                          'Fine marked paid.'
                        )
                      }
                    >
                      Pay
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
