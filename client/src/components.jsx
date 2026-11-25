import { Link, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { money } from './format';

export function Button({ kind = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-pine text-paper hover:bg-moss',
    quiet: 'bg-sand text-ink hover:bg-[#ddd4c3]',
    danger: 'bg-clay text-white hover:bg-[#732f22]',
    ghost: 'bg-transparent text-pine hover:underline',
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-semibold ${styles[kind]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props) {
  return (
    <input
      className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-pine"
      {...props}
    />
  );
}

export function Notice({ message, tone = 'error' }) {
  if (!message) return null;
  const toneClass =
    tone === 'error'
      ? 'border-clay/30 bg-red-50 text-clay'
      : 'border-moss/30 bg-emerald-50 text-pine';
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${toneClass}`}>{message}</div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-sand bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 font-serif text-2xl text-ink">{value}</div>
    </div>
  );
}

export function PolicyNote({ policy }) {
  if (!policy) return null;
  return (
    <p className="mt-2 max-w-3xl text-sm text-stone-600">
      Loans run {policy.loanDays} days. Overdue fines are {money(policy.dailyFineCents)} a
      day, capped at {money(policy.maxFineCents)}. Borrowing and reservations stop when
      unpaid fines reach {money(policy.fineBlockCents)}. A ready hold is kept for{' '}
      {policy.reservationHoldDays} days.
    </p>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <div className="h-1 bg-pine" />
      <header className="border-b border-sand bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link to="/catalogue" className="font-serif text-2xl text-pine">
            BookNook
          </Link>
          <nav className="flex gap-4 text-sm font-semibold">
            <Link to="/catalogue" className="hover:text-pine">
              Catalogue
            </Link>
            <Link to="/dashboard" className="hover:text-pine">
              {user.role === 'librarian' ? 'Desk' : 'My loans'}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-stone-700">{user.fullName}</span>
            <span className="rounded-full bg-sand px-2 py-0.5 text-xs capitalize text-stone-700">
              {user.role}
            </span>
            <button type="button" onClick={logout} className="font-semibold text-pine">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
