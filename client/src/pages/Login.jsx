import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, Field, Notice, TextInput } from '../components';
import { errorText } from '../format';

export function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('sam@booknook.local');
  const [password, setPassword] = useState('member123');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (!ready) return null;
  if (user) return <Navigate to="/catalogue" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(email, password);
      navigate('/catalogue');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-4 py-12 md:grid-cols-2">
      <div>
        <p className="font-serif text-5xl text-pine">BookNook</p>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-stone-700">
          Catalogue, loans, and reservations for one branch. Members search the
          shelves. The desk watches overdue fines and holds.
        </p>
      </div>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-sand bg-card p-6 shadow-sm"
      >
        <h1 className="font-serif text-2xl">Sign in</h1>
        <Notice message={error} />
        <Field label="Email">
          <TextInput
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="space-y-1 border-t border-sand pt-4 text-sm text-stone-600">
          <p>Desk: ada@booknook.local / library123</p>
          <p>Members: sam@booknook.local or noah@booknook.local / member123</p>
        </div>
      </form>
    </div>
  );
}
