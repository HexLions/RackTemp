import { NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/updates", label: "Updates" },
  { to: "/settings/firmware", label: "Sensor firmware" },
  { to: "/settings/backup", label: "Backup" },
];

export default function SettingsLayout() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Account, notifications, integrations, updates, firmware and backup.</p>
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
