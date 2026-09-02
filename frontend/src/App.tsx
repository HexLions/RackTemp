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
import UsersSection from "./pages/settings/UsersSection";
import NotificationsSection from "./pages/settings/NotificationsSection";
import IntegrationsSection from "./pages/settings/IntegrationsSection";
import NetworkSection from "./pages/settings/NetworkSection";
import UpdatesSection from "./pages/settings/UpdatesSection";
import FirmwareSection from "./pages/settings/FirmwareSection";
import BackupSection from "./pages/settings/BackupSection";

// adminOnly: BulkThresholds and everything under /settings are admin-only —
// a viewer session hitting one of these routes gets bounced back to "/"
// (the backend already rejects the API calls those pages would make; this
// is just defense in depth / not showing a broken page). Dashboard and
// SensorDetail are the two pages a viewer is actually meant to reach,
// rendered read-only by the pages themselves based on role.
function ProtectedLayout({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { username, role, mustChangePassword, loading, logout } = useAuth();

  if (loading) return <div className="center-screen">Loading…</div>;
  if (!username) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/first-login" replace />;
  if (adminOnly && role === "viewer") return <Navigate to="/" replace />;

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
          {role === "admin" && (
            <>
              <NavLink to="/bulk-thresholds">Multiple thresholds</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </>
          )}
        </nav>
        <div className="topbar-right">
          <ThemeToggle />
          {role === "admin" ? (
            <NavLink to="/settings/account" className="user" style={{ textDecoration: "none" }}>
              {username}
            </NavLink>
          ) : (
            <span className="user">{username} (viewer)</span>
          )}
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
        path="/bulk-thresholds"
        element={
          <ProtectedLayout adminOnly>
            <BulkThresholds />
          </ProtectedLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedLayout adminOnly>
            <SettingsLayout />
          </ProtectedLayout>
        }
      >
        <Route index element={<Navigate to="account" replace />} />
        <Route path="account" element={<AccountSection />} />
        <Route path="users" element={<UsersSection />} />
        <Route path="notifications" element={<NotificationsSection />} />
        <Route path="integrations" element={<IntegrationsSection />} />
        <Route path="network" element={<NetworkSection />} />
        <Route path="updates" element={<UpdatesSection />} />
        <Route path="firmware" element={<FirmwareSection />} />
        <Route path="backup" element={<BackupSection />} />
      </Route>

      {/* Legacy paths (pre-English-route-rename and older), for existing links/bookmarks */}
      <Route path="/soglie-bulk" element={<Navigate to="/bulk-thresholds" replace />} />
      <Route path="/account" element={<Navigate to="/settings/account" replace />} />
      <Route path="/notifications" element={<Navigate to="/settings/notifications" replace />} />
      <Route path="/integrazioni" element={<Navigate to="/settings/integrations" replace />} />
      <Route path="/impostazioni" element={<Navigate to="/settings" replace />} />
      <Route path="/impostazioni/account" element={<Navigate to="/settings/account" replace />} />
      <Route path="/impostazioni/notifiche" element={<Navigate to="/settings/notifications" replace />} />
      <Route path="/impostazioni/integrazioni" element={<Navigate to="/settings/integrations" replace />} />
      <Route path="/impostazioni/rete" element={<Navigate to="/settings/network" replace />} />
      <Route path="/impostazioni/aggiornamenti" element={<Navigate to="/settings/updates" replace />} />
      <Route path="/impostazioni/firmware" element={<Navigate to="/settings/firmware" replace />} />
      <Route path="/impostazioni/backup" element={<Navigate to="/settings/backup" replace />} />
    </Routes>
  );
}
