import { NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
  { to: "/impostazioni/account", label: "Account" },
  { to: "/impostazioni/notifiche", label: "Notifications" },
  { to: "/impostazioni/integrazioni", label: "Integrations" },
  { to: "/impostazioni/rete", label: "Network" },
  { to: "/impostazioni/aggiornamenti", label: "Updates" },
  { to: "/impostazioni/firmware", label: "Sensor firmware" },
  { to: "/impostazioni/backup", label: "Backup" },
];

export default function SettingsLayout() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Account, notifications, integrations, network, updates, firmware and backup.</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-sidebar">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
