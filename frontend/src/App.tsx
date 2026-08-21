import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./api/AuthContext";
import Logo from "./components/Logo";
import ThemeToggle from "./components/ThemeToggle";
import Footer from "./components/Footer";
import Login from "./pages/Login";
import FirstLogin from "./pages/FirstLogin";
import Dashboard from "./pages/Dashboard";
import SensorDetail from "./pages/SensorDetail";
import NotificationSettings from "./pages/NotificationSettings";
import Integrations from "./pages/Integrations";

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { username, mustChangePassword, loading, logout } = useAuth();

  if (loading) return <div className="center-screen">Caricamento…</div>;
  if (!username) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/first-login" replace />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo-mark">
            <Logo />
          </span>
          Rack Temp Monitor
        </div>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/notifications">Notifiche</NavLink>
          <NavLink to="/integrazioni">Integrazioni</NavLink>
        </nav>
        <div className="topbar-right">
          <ThemeToggle />
          <span className="user">{username}</span>
          <button className="btn-link" onClick={() => logout()}>
            Esci
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/first-login" element={<FirstLogin />} />
      <Route
        path="/"
        element={
          <ProtectedLayout>
            <Dashboard />
          </ProtectedLayout>
        }
      />
      <Route
        path="/sensors/:id"
        element={
          <ProtectedLayout>
            <SensorDetail />
          </ProtectedLayout>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedLayout>
            <NotificationSettings />
          </ProtectedLayout>
        }
      />
      <Route
        path="/integrazioni"
        element={
          <ProtectedLayout>
            <Integrations />
          </ProtectedLayout>
        }
      />
    </Routes>
  );
}
