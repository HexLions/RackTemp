import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./api/AuthContext";
import Logo from "./components/Logo";
import ThemeToggle from "./components/ThemeToggle";
import Footer from "./components/Footer";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import FirstLogin from "./pages/FirstLogin";
import Dashboard from "./pages/Dashboard";
import SensorDetail from "./pages/SensorDetail";
import BulkThresholds from "./pages/BulkThresholds";
import SettingsLayout from "./pages/settings/SettingsLayout";
import AccountSection from "./pages/settings/AccountSection";
import NotificationsSection from "./pages/settings/NotificationsSection";
import IntegrationsSection from "./pages/settings/IntegrationsSection";
import NetworkSection from "./pages/settings/NetworkSection";
import UpdatesSection from "./pages/settings/UpdatesSection";
import FirmwareSection from "./pages/settings/FirmwareSection";
import BackupSection from "./pages/settings/BackupSection";

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { username, mustChangePassword, loading, logout } = useAuth();

  if (loading) return <div className="center-screen">Loading…</div>;
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
          <NavLink to="/soglie-bulk">Multiple thresholds</NavLink>
          <NavLink to="/impostazioni">Settings</NavLink>
        </nav>
        <div className="topbar-right">
          <ThemeToggle />
          <NavLink to="/impostazioni/account" className="user" style={{ textDecoration: "none" }}>
            {username}
          </NavLink>
          <button className="btn-link" onClick={() => logout()}>
            Log out
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
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
        path="/soglie-bulk"
        element={
          <ProtectedLayout>
            <BulkThresholds />
          </ProtectedLayout>
        }
      />
      <Route
        path="/impostazioni"
        element={
          <ProtectedLayout>
            <SettingsLayout />
          </ProtectedLayout>
        }
      >
        <Route index element={<Navigate to="account" replace />} />
        <Route path="account" element={<AccountSection />} />
        <Route path="notifiche" element={<NotificationsSection />} />
        <Route path="integrazioni" element={<IntegrationsSection />} />
        <Route path="rete" element={<NetworkSection />} />
        <Route path="aggiornamenti" element={<UpdatesSection />} />
        <Route path="firmware" element={<FirmwareSection />} />
        <Route path="backup" element={<BackupSection />} />
      </Route>

      {/* Legacy paths, for existing links/bookmarks */}
      <Route path="/account" element={<Navigate to="/impostazioni/account" replace />} />
      <Route path="/notifications" element={<Navigate to="/impostazioni/notifiche" replace />} />
      <Route path="/integrazioni" element={<Navigate to="/impostazioni/integrazioni" replace />} />
    </Routes>
  );
}
