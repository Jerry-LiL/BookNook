import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components';
import { Catalogue } from './pages/Catalogue';
import { LibrarianDashboard } from './pages/LibrarianDashboard';
import { Login } from './pages/Login';
import { MemberDashboard } from './pages/MemberDashboard';

function RequireAuth() {
  const { user, ready } = useAuth();
  if (!ready) {
    return <p className="px-4 py-10 text-sm text-stone-500">Loading…</p>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Dashboard() {
  const { user } = useAuth();
  if (user.role === 'librarian') return <LibrarianDashboard />;
  return <MemberDashboard />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/catalogue" replace />} />
          <Route path="/catalogue" element={<Catalogue />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/catalogue" replace />} />
    </Routes>
  );
}
