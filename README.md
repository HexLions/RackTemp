<div align="center">

<img src="docs/racktemp-logo.png" width="96" height="96" alt="RackTemp logo" />

# 🌡️ RackTemp
### Monitor your rack's temperature and humidity, self-hosted, from the browser.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](#-quick-start-docker)
[![GHCR](https://img.shields.io/badge/ghcr.io-hexlions%2Fracktemp-blue.svg)](https://github.com/HexLions/RackTemp/pkgs/container/racktemp)
[![Windows](https://img.shields.io/badge/windows-installer-0078D6.svg?logo=windows&logoColor=white)](#-running-on-windows-without-docker)
[![Linux](https://img.shields.io/badge/linux-systemd-FCC624.svg?logo=linux&logoColor=black)](#-running-on-linux-without-docker)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-success.svg)](#-quick-start-docker)
[![Version](https://img.shields.io/badge/version-0.4.0-purple.svg)](#)

**📦 [See the Docker package →](https://github.com/HexLions/RackTemp/pkgs/container/racktemp)**

</div>

---

## 🤔 What is it?

An **ESP32-C3 Super Mini + SHT31-D** sensor sends temperature and humidity over WiFi to a
backend running on Docker, at your place. No cloud, no subscription: thresholds, notifications
(email/Telegram) and integration with PRTG/Prometheus/Grafana/Zabbix all configured from the
same web page.

---

## ✨ Features

- 🐳 **A single Docker container** — build from source or ready-made image from GHCR, data in a volume
- 🔐 **No exploitable default credentials** — first login forces you to choose a
  real username/password, the app stays locked until you do
- 📊 **Live dashboard** — status LEDs, sparklines, min/max thresholds with hysteresis and cooldown
- 🔔 **SMTP + Telegram notifications** — threshold breach, sensor offline, back to normal
- 📡 **Sensor discovery on the network** — an ESP32 not yet linked announces itself and
  shows up in the dashboard with a notification, no need to hunt for its IP by hand
- 🔗 **Controller-level integrations** — one aggregated PRTG endpoint and one standard
  Prometheus endpoint: add a sensor and it shows up everywhere, zero per-device setup
- 🌐 **Optional static IP** — jot down each sensor's IP for reference, if you've fixed one
- ⌨️ **Rack-instrumentation-themed UI** — every number (temperatures, keys, timestamps) in
  tabular monospace, states color-coded like the real LEDs on a rack appliance

---

## 🚀 Quick start (Docker)

```
┌─────────────────────────────────────────────────────────┐
│  1. 🐳 Install Docker (Desktop on Win/Mac, Engine+Compose on Linux) │
│  2. 📥 git clone + cp .env.example .env                  │
│  3. 🔑 Set your own SESSION_SECRET in .env                │
│  4. ▶️  docker compose up -d --build                      │
│  5. 🌐 Open http://<pc-ip>:7431                            │
│  6. 👤 First login: admin/admin → choose real credentials  │
└─────────────────────────────────────────────────────────┘
```

```bash
git clone https://github.com/HexLions/RackTemp.git
cd RackTemp
cp .env.example .env
# open .env, set SESSION_SECRET=a-long-random-string
docker compose up -d --build
```

First run: downloads the base images and builds backend+frontend, a few minutes. Subsequent
ones (`docker compose up -d`) are instant.

**Check:**

```bash
docker compose ps          # should show rack-temp-monitor "Up"
docker compose logs -f      # follow the logs, Ctrl+C to exit
```

> 🔑 **First login**: the app always creates an admin with default credentials `admin`/`admin`,
> but locks every other feature until you choose a real username and password (min. 8 characters)
> from the dedicated screen — nothing to configure in `.env` for this.

**Management:**

```bash
docker compose down            # stops and removes the container (data stays in the volume)
docker compose up -d           # restarts without rebuilding
docker compose up -d --build   # rebuild after a git pull with code changes
docker compose down -v         # ⚠️ also removes the volume, deletes all data
```

The data (sensors, readings, thresholds) lives in the `rack-temp-data` Docker volume, persists
across restarts/rebuilds unless you use `-v`.

Readings are automatically pruned after 90 days so the DB doesn't grow forever
(thresholds and sensors are never touched). To change the window, set
`READING_RETENTION_DAYS` in `.env` (or as an environment variable in the Portainer stack).

---

## 🐳 Running with Portainer

Prefer to manage it from Portainer? Use the ready-made stack at
[`docker-compose.portainer.yml`](docker-compose.portainer.yml) — unlike the main
compose file it doesn't build from a Dockerfile (Portainer has no access to the local repo), but pulls
the ready-made image from `ghcr.io/hexlions/racktemp`, published automatically on every push to
`main` by [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).

1. **Stacks** → **Add stack**, any name.
2. **Web editor**: paste the contents of `docker-compose.portainer.yml` (or **Upload** the file).
3. In **Environment variables** add `SESSION_SECRET` with a long, random string.
4. **Deploy the stack**.

Open `http://<pc-ip>:7431` — same behavior as the CLI deploy, including the first
`admin`/`admin` login you need to change right away.

The stack already includes **Watchtower**: as soon as a new image is out on GHCR (every push to
`main`), the container updates and restarts itself within 6 hours, with no need to touch
Portainer. The data stays intact (it lives in the `rack-temp-data` volume, not in the image). In
**Integrations** you'll still find a version indicator with a link to the release and a button to
force an immediate redeploy via an optional Portainer webhook, if you don't want to wait for
Watchtower's poll. To disable automatic updates, remove the `watchtower` service (and
the matching label on `rack-temp-monitor`) from the stack.

---

## 🪟 Running on Windows (without Docker)

No Docker/Portainer? There's a native Windows installer, same backend/frontend as this
repo: [`installer/installer.iss`](installer/installer.iss) packages a portable Node.js runtime
+ the app into a single `RackTemp-Setup-X.Y.Z.exe` that registers RackTemp as a **Windows
service** (auto-start, runs even without a logged-in user — designed for Windows Server).

1. Download `RackTemp-Setup-X.Y.Z.exe` from the [Releases](../../releases) (built automatically
   on every release, alongside the Docker image — see
   [`.github/workflows/windows-installer.yml`](.github/workflows/windows-installer.yml)).
2. Run it (requires administrator privileges). Windows SmartScreen will probably warn that
   the exe isn't signed ("Unknown publisher") — that's normal for an open-source installer without a
   paid certificate: **More info → Run anyway**.
3. At the end of installation a dedicated RackTemp window opens (not the browser) — if the
   WebView2 runtime is missing it installs it on its own on the spot (needs internet at that
   moment; on up-to-date Windows 10/11 it's already present and this step is skipped).

The **RackTemp** Windows service (nssm, auto-start, runs even without a logged-in user — designed
for Windows Server) runs the backend/API independently of the window: closing it with the
X doesn't shut anything down, it just goes to the tray (icon near the clock) — double-click to
reopen it. The tray menu (right-click the icon) has **"Exit and stop the service"** (that's the
real exit, requires UAC confirmation) and **"Start with Windows at login"**, a checkbox you can
change any time, not just during installation. Reopening the app after a full exit,
the service starts back up on its own (another UAC prompt).

The database lives in `%ProgramData%\RackTemp\data\`, outside Program Files: reinstalling or
updating (by downloading and running a newer `Setup.exe`) doesn't touch the data or the
`SESSION_SECRET` generated at first install. To build the installer from source:

```powershell
# Requires Node.js + .NET 8 SDK + Inno Setup 6 (winget install JRSoftware.InnoSetup) on the build machine
powershell -ExecutionPolicy Bypass -File scripts\build-installer-windows.ps1
```

---

## 🐧 Running on Linux without Docker

Prefer a native service instead of a container? `racktemp-linux-x64.tar.gz` (from the
[Releases](../../releases), built automatically alongside Docker and Windows) brings along
a portable Node.js runtime and an install script that registers RackTemp as a **systemd
service**.

```bash
tar -xzf racktemp-linux-x64.tar.gz
cd racktemp-linux-x64
sudo ./install.sh
```

Creates a system user `racktemp` (not root), the `racktemp.service` service (auto-start on
boot), and keeps the database in `/var/lib/racktemp/data/` — outside `/opt/racktemp`, so it
survives reinstalls. `SESSION_SECRET` is generated once, at first install.

```bash
systemctl status racktemp     # status
journalctl -u racktemp -f     # logs
sudo ./uninstall.sh           # uninstall (asks whether to keep the data)
```

To build the package from source (requires Node.js + npm on an x86_64 Linux machine):

```bash
bash scripts/build-package-linux.sh
```

---

## 📋 How to use it

1. **Flash the ESP32-C3** (see below) — same firmware for every sensor, no
   configuration to compile in.
2. **Connect the sensor to your network**: on first boot it opens a setup access point, you
   connect to it from a phone/PC and enter the WiFi + server address from its web page.
3. **Create the sensor** from the dashboard → get a dedicated API key (you can also jot down an
   IP static, just as a reminder: the server doesn't use it to reach the sensor). If the
   device has already announced itself, it shows up in the "Sensors discovered on the network" banner — see
   [Sensor discovery](#-discovering-sensors-on-the-network).
4. **Configure the thresholds** (min/max °C, hysteresis, notification cooldown, offline timeout) on
   the sensor's page.
5. **Configure notifications** (SMTP and/or Telegram) on the Notifications page, with a test button.
6. **Connect PRTG/Prometheus/other tools** from the **Integrations** page — once
   for all sensors, not per device.

---

## 🔌 ESP32-C3 Super Mini Firmware

### Hardware

| Component | Notes |
|---|---|
| **ESP32-C3 Super Mini** | Arduino IDE board: `ESP32C3 Dev Module`. Many clones need the **CH340** USB-serial driver; if the flash doesn't start, hold **BOOT** while plugging in the USB |
| **SHT31-D** | I2C temperature/humidity sensor, address `0x44` |

### I2C wiring

| SHT31-D | ESP32-C3 Super Mini |
|---|---|
| VIN | 3V3 |
| GND | GND |
| SCL | GPIO9 |
| SDA | GPIO8 |

> The most common pinout on "Super Mini" clones — check the silkscreen on your board. The
> pins are `#define I2C_SDA_PIN` / `I2C_SCL_PIN` at the top of the sketch, if you need to change them.

### Flashing

In `firmware/rack_temp_sensor/`:

1. Install the **Adafruit SHT31 Library** and **Adafruit BusIO** libraries (Library Manager) —
   WiFi/WebServer/DNSServer/Preferences/HTTPClient/Wire are already included in the esp32 core.
2. Wire the sensor as per the table above.
3. Flash the sketch **as-is**: no file to edit, no data to compile in.
   The same firmware works for every sensor you install.

The firmware sends a JSON POST to `/api/ingest` every 60 seconds (`SEND_INTERVAL_SEC` at the top
of the sketch, if you want to change it):

```json
{ "temperature": 23.4, "humidity": 41.2, "rssi": -58, "chipId": "AABBCCDDEEFF0011" }
```

`chipId` is the chip's hardware identifier (used for discovery below): the firmware
includes it on its own, no need to configure it.

### WiFi setup via captive portal (first boot)

On first boot — or by holding **BOOT** at power-on to re-enter it later — the
sensor finds no saved configuration and opens its own access point instead of
connecting to a network:

1. From a phone/PC, connect to the WiFi network **`RackTemp-XXXXXXXX`** (no password —
   the last digits are the chip's ID).
2. A "sign in to network" popup opens on its own (Android/iOS/Windows); if it doesn't appear, open
   your browser at `http://192.168.4.1`.
3. Choose your WiFi network from the list (or type it manually) + password, the server address
   (e.g. `http://192.168.1.50:7431`), and, if you already know it, the sensor's API key — otherwise
   leave it empty.
4. **Save**: the sensor restarts and tries to connect. If the API key is empty, it announces itself on
   the network and you link it from the discovery banner in the dashboard (see below); if you already pasted it,
   it starts sending data right away.

The configuration stays saved on the chip (internal NVS) even after a power-cycle or a
sketch re-flash. To change it — new network, new server, new API key — hold
BOOT at power-on to reopen the portal; the WiFi/server/API key fields stay pre-filled
with the current values, the password only needs re-entering if you want to change it.

> Note: on these clones **BOOT is often on the same GPIO9 used for SCL** — the sketch reads it
> once at startup, before initializing I2C, so there's normally no conflict.
> If BOOT is on a different pin on your board, update `#define BOOT_BUTTON_PIN` at the top of the
> sketch.

---

## 📡 Discovering sensors on the network

No mDNS/UDP broadcast discovery: a broadcast wouldn't cross Docker's bridge network in a
typical deploy (it would need `network_mode: host`, Linux only). Instead the firmware
announces itself with a plain HTTP request to the server address entered in the
setup portal (`POST /api/discovery/announce`, right after connecting) — works with no network
changes even inside Docker/Portainer.

If the chip doesn't have a valid API key yet, it shows up in the **"Sensors discovered on the network"**
banner in the dashboard with the chip's IP and ID, plus a notification (SMTP/Telegram, if configured) on
first sighting. As soon as you create the sensor, paste its API key into the device's setup portal
(hold BOOT to reopen it) and save, the entry disappears on its own.

---

## 🔗 Monitoring integrations

Configured **once, at the controller level**, from the **Integrations** page — not per
sensor: add a rack sensor and it shows up automatically everywhere.

| Tool | How |
|---|---|
| **PRTG** | A single `HTTP Data Advanced` sensor pointed at `/api/prtg/all?key=<token>` — every rack sensor becomes a `<name> - Temperature/Humidity/Age` channel pair. Token on the Integrations page |
| **Prometheus / Grafana** | `GET /metrics` in standard Prometheus format, add it as a scrape target |
| **Zabbix, Uptime Kuma, others** | Read the same `/metrics` with no dedicated plugins |
| **Per-device PRTG (legacy)** | `/api/prtg/<sensorId>?key=<sensor's apiKey>`, if you prefer one PRTG sensor per device |

Example `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: rack-temp-monitor
    static_configs:
      - targets: ["<host>:7431"]
```

Exposed metrics: `rack_temp_celsius`, `rack_temp_humidity_percent`, `rack_temp_online`,
`rack_temp_last_seen_seconds`, `rack_temp_threshold_min_celsius`, `rack_temp_threshold_max_celsius`
— all with `sensor`, `sensor_id`, `location` labels.

> `/metrics` doesn't require authentication (like `node_exporter` and most
> Prometheus endpoints): if this instance is reachable beyond your trusted LAN, put it
> behind a reverse proxy with an IP allowlist or basic auth.

---

## 📁 Project structure

```
RackTemp/
├── backend/                    ← Express + Prisma/SQLite API
│   ├── src/routes/             ← auth, sensors, ingest, discovery, prtg, metrics, integrations
│   ├── src/services/           ← notifier (SMTP/Telegram), thresholds and alarms
│   └── prisma/schema.prisma
├── frontend/                   ← React + Vite (dashboard, sensor, notifications, integrations)
│   └── src/pages/
├── firmware/rack_temp_sensor/  ← ESP32-C3 Arduino sketch, WiFi setup via captive portal
├── Dockerfile                  ← multi-stage build, single image
├── docker-compose.yml          ← deploy via CLI (build from source)
├── docker-compose.portainer.yml ← deploy via Portainer (image from GHCR) + Watchtower
├── installer/installer.iss     ← Windows installer (Inno Setup)
├── windows-tray/RackTempTray/  ← WebView2 window + tray icon for the Windows install
├── linux/                      ← systemd unit + install.sh/uninstall.sh
├── scripts/build-installer-windows.ps1 ← builds + compiles the Windows installer
├── scripts/build-package-linux.sh      ← builds the native Linux package
└── .github/workflows/          ← publishes the Docker image + Windows installer + Linux package
                                   on every push/release
```

---

## 🧭 Main API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/ingest` | `X-Api-Key` header | receives a reading from the sensor |
| GET | `/api/sensors` | session | list of sensors + latest reading |
| PUT | `/api/sensors/:id/threshold` | session | updates thresholds |
| POST | `/api/discovery/announce` | none | an ESP32 announces itself on the network |
| GET | `/api/discovery` | session | devices discovered but not yet configured |
| GET | `/api/integrations` | session | controller-level integration token |
| GET | `/api/prtg/all?key=TOKEN` | query key | all sensors in a single PRTG sensor |
| GET | `/metrics` | none | all sensors in Prometheus format |
| PUT | `/api/notifications/config` | session | configures SMTP/Telegram |

---

## 💻 Local development (without Docker)

```bash
# backend
cd backend
cp .env.example .env
npm install
npx prisma db push
npm run dev            # http://localhost:7431

# frontend, in another terminal
cd frontend
npm install
npm run dev             # http://localhost:5173, proxies to :7431
```

---

## 🗺️ Roadmap

- 🐘 Migration to Postgres for multi-instance deploys (change `provider` in
  `backend/prisma/schema.prisma` + `DATABASE_URL`)
- 📶 MQTT support as an alternative to HTTP POST
- 📤 Export reading history (CSV)

---

## 🙏 Credits

Built on a great open-source foundation:

- 🔧 **[Prisma](https://www.prisma.io/)** + **[Express](https://expressjs.com/)** — backend and persistence
- ⚛️ **[React](https://react.dev/)** + **[Vite](https://vitejs.dev/)** + **[Recharts](https://recharts.org/)** — dashboard and charts
- 📟 **[Adafruit SHT31 Library](https://github.com/adafruit/Adafruit_SHT31)** — sensor driver
- 📨 **[Nodemailer](https://nodemailer.com/)** + **[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)** — notifications
- 🐳 **Docker** + **GitHub Container Registry** — image build and distribution

---

## 📜 License

Released under the **[GNU General Public License v3.0](./LICENSE)**.

> This program is free software: you can redistribute it and/or modify it under the terms of
> the GNU General Public License as published by the Free Software Foundation, either version 3
> of the License, or (at your option) any later version.

---

<div align="center">

**Made with 💚 by [HexLions](https://github.com/HexLions)**

*If this project is useful to you, leave a ⭐ on the repo!*

</div>
