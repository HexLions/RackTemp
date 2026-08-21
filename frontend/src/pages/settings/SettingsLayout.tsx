import { NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
  { to: "/impostazioni/account", label: "Account" },
  { to: "/impostazioni/notifiche", label: "Notifiche" },
  { to: "/impostazioni/integrazioni", label: "Integrazioni" },
  { to: "/impostazioni/aggiornamenti", label: "Aggiornamenti" },
  { to: "/impostazioni/firmware", label: "Firmware sensori" },
  { to: "/impostazioni/backup", label: "Backup" },
];

export default function SettingsLayout() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Impostazioni</h1>
          <p className="page-sub">Account, notifiche, integrazioni, aggiornamenti, firmware e backup.</p>
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
