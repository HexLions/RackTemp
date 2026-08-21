<div align="center">

<img src="docs/racktemp-logo.png" width="96" height="96" alt="RackTemp logo" />

# 🌡️ RackTemp
### Monitora temperatura e umidità del tuo rack, self-hosted, dal browser.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](#-avvio-rapido-docker)
[![GHCR](https://img.shields.io/badge/ghcr.io-hexlions%2Fracktemp-blue.svg)](https://github.com/HexLions/RackTemp/pkgs/container/racktemp)
[![Windows](https://img.shields.io/badge/windows-installer-0078D6.svg?logo=windows&logoColor=white)](#-avvio-su-windows-senza-docker)
[![Linux](https://img.shields.io/badge/linux-systemd-FCC624.svg?logo=linux&logoColor=black)](#-avvio-su-linux-senza-docker)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-success.svg)](#-avvio-rapido-docker)
[![Version](https://img.shields.io/badge/version-0.3.2-purple.svg)](#)

**📦 [Vedi il pacchetto Docker →](https://github.com/HexLions/RackTemp/pkgs/container/racktemp)**

</div>

---

## 🤔 Cos'è?

Un sensore **ESP32-C3 Super Mini + SHT31-D** manda temperatura e umidità via WiFi a un
backend che gira su Docker, in casa tua. Nessun cloud, nessun abbonamento: soglie, notifiche
(email/Telegram) e integrazione con PRTG/Prometheus/Grafana/Zabbix configurate tutte dalla
stessa pagina web.

---

## ✨ Funzionalità

- 🐳 **Un solo container Docker** — build da sorgente o immagine pronta da GHCR, dati in un volume
- 🔐 **Nessuna credenziale di default sfruttabile** — primo accesso forzato a scegliere
  username/password veri, l'app resta bloccata finché non lo fai
- 📊 **Dashboard live** — LED di stato, sparkline, soglie min/max con isteresi e cooldown
- 🔔 **Notifiche SMTP + Telegram** — soglia superata, sensore offline, rientro alla normalità
- 📡 **Rilevamento sensori in rete** — un ESP32 non ancora collegato si annuncia da solo e
  compare in dashboard con una notifica, senza dover cercare l'IP a mano
- 🔗 **Integrazioni a livello di controller** — un endpoint PRTG aggregato e uno Prometheus
  standard: aggiungi un sensore e compare ovunque, zero setup per-dispositivo
- 🌐 **IP statico opzionale** — annota l'IP di ogni sensore per riferimento, se ne hai fissato uno
- ⌨️ **UI a tema strumentazione rack** — ogni numero (temperature, chiavi, timestamp) in
  monospace tabulare, stati codificati a colori come i LED reali di un apparato rack

---

## 🚀 Avvio rapido (Docker)

```
┌─────────────────────────────────────────────────────────┐
│  1. 🐳 Installa Docker (Desktop su Win/Mac, Engine+Compose su Linux) │
│  2. 📥 git clone + cp .env.example .env                  │
│  3. 🔑 Imposta un SESSION_SECRET tuo nel .env             │
│  4. ▶️  docker compose up -d --build                      │
│  5. 🌐 Apri http://<ip-del-pc>:7431                       │
│  6. 👤 Primo accesso: admin/admin → scegli credenziali vere │
└─────────────────────────────────────────────────────────┘
```

```bash
git clone https://github.com/HexLions/RackTemp.git
cd RackTemp
cp .env.example .env
# apri .env, imposta SESSION_SECRET=una-stringa-lunga-e-casuale
docker compose up -d --build
```

Prima esecuzione: scarica le immagini base e builda backend+frontend, qualche minuto. Le
successive (`docker compose up -d`) sono immediate.

**Verifica:**

```bash
docker compose ps          # deve mostrare rack-temp-monitor "Up"
docker compose logs -f      # segui i log, Ctrl+C per uscire
```

> 🔑 **Primo accesso**: l'app crea sempre un admin con credenziali di default `admin`/`admin`,
> ma blocca ogni altra funzione finché non scegli username e password veri (min. 8 caratteri)
> dalla schermata dedicata — non serve configurare nulla in `.env` per questo.

**Gestione:**

```bash
docker compose down            # ferma e rimuove il container (i dati restano nel volume)
docker compose up -d           # riavvia senza rebuild
docker compose up -d --build   # rebuild dopo un git pull con modifiche al codice
docker compose down -v         # ⚠️ rimuove anche il volume, cancella tutti i dati
```

I dati (sensori, letture, soglie) vivono nel volume Docker `rack-temp-data`, persistono tra
riavvii/rebuild finché non usi `-v`.

Le letture vengono potate automaticamente dopo 90 giorni per non far crescere il DB
all'infinito (soglie e sensori non vengono mai toccati). Per cambiare la finestra, imposta
`READING_RETENTION_DAYS` nel `.env` (o come environment variable nello stack Portainer).

---

## 🐳 Avvio con Portainer

Preferisci gestirlo da Portainer? Usa lo stack pronto in
[`docker-compose.portainer.yml`](docker-compose.portainer.yml) — a differenza del compose
principale non builda da Dockerfile (Portainer non ha accesso alla repo locale), ma tira giù
l'immagine già pronta da `ghcr.io/hexlions/racktemp`, pubblicata automaticamente a ogni push su
`main` da [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).

1. **Stacks** → **Add stack**, nome a piacere.
2. **Web editor**: incolla il contenuto di `docker-compose.portainer.yml` (o **Upload** del file).
3. In **Environment variables** aggiungi `SESSION_SECRET` con una stringa lunga e casuale.
4. **Deploy the stack**.

Apri `http://<ip-del-pc>:7431` — stesso comportamento del deploy via CLI, incluso il primo
accesso `admin`/`admin` da cambiare subito.

Lo stack include già **Watchtower**: appena esce una nuova immagine su GHCR (ogni push su
`main`), il container si aggiorna e riavvia da solo entro 6 ore, senza bisogno di toccare
Portainer. I dati restano intatti (vivono nel volume `rack-temp-data`, non nell'immagine). In
**Integrazioni** trovi comunque un indicatore di versione con link alla release e un bottone per
forzare subito un redeploy tramite un webhook Portainer opzionale, se non vuoi aspettare il poll
di Watchtower. Per disattivare gli aggiornamenti automatici, rimuovi il servizio `watchtower` (e
il relativo label su `rack-temp-monitor`) dallo stack.

---

## 🪟 Avvio su Windows (senza Docker)

Niente Docker/Portainer? C'è un installer Windows nativo, stesso backend/frontend di questo
repo: [`installer/installer.iss`](installer/installer.iss) impacchetta un runtime Node.js
portatile + l'app in un unico `RackTemp-Setup-X.Y.Z.exe` che registra RackTemp come **servizio
Windows** (auto-avvio, gira anche senza utente loggato — pensato per Windows Server).

1. Scarica `RackTemp-Setup-X.Y.Z.exe` dalle [Release](../../releases) (compilato in automatico
   a ogni release, insieme all'immagine Docker — vedi
   [`.github/workflows/windows-installer.yml`](.github/workflows/windows-installer.yml)).
2. Eseguilo (richiede privilegi amministratore). Windows SmartScreen probabilmente avvisa che
   l'exe non è firmato ("Editore sconosciuto") — è normale per un installer open-source senza
   certificato a pagamento: **Ulteriori informazioni → Esegui comunque**.
3. A fine installazione si apre una finestra RackTemp dedicata (non il browser) — se manca il
   runtime WebView2 lo installa da sé al volo (serve internet quel momento; su Windows 10/11
   aggiornati è già presente e questo passo viene saltato).

Il servizio Windows **RackTemp** (nssm, auto-avvio, gira anche senza utente loggato — pensato
per Windows Server) fa girare backend/API indipendentemente dalla finestra: chiudendola con la
X non si spegne nulla, va solo nella tray (icona vicino all'orologio) — doppio click per
riaprirla, o tasto destro → Esci per chiudere solo quella finestra. Di default parte anche in
automatico all'accesso a Windows (minimizzata in tray); si disattiva deselezionando l'opzione
durante l'installazione.

Il database vive in `%ProgramData%\RackTemp\data\`, fuori da Program Files: reinstallare o
aggiornare (scaricando ed eseguendo un `Setup.exe` più recente) non tocca i dati né il
`SESSION_SECRET` generato al primo install. Per buildare l'installer da sorgente:

```powershell
# Serve Node.js + .NET 8 SDK + Inno Setup 6 (winget install JRSoftware.InnoSetup) sulla macchina di build
powershell -ExecutionPolicy Bypass -File scripts\build-installer-windows.ps1
```

---

## 🐧 Avvio su Linux senza Docker

Preferisci un servizio nativo invece di un container? `racktemp-linux-x64.tar.gz` (dalle
[Release](../../releases), buildato automaticamente insieme a Docker e Windows) porta con sé
un runtime Node.js portatile e uno script d'installazione che registra RackTemp come **servizio
systemd**.

```bash
tar -xzf racktemp-linux-x64.tar.gz
cd racktemp-linux-x64
sudo ./install.sh
```

Crea un utente di sistema `racktemp` (non root), il servizio `racktemp.service` (auto-avvio al
boot), e tiene il database in `/var/lib/racktemp/data/` — fuori da `/opt/racktemp`, così
sopravvive a reinstallazioni. `SESSION_SECRET` viene generato una volta sola al primo install.

```bash
systemctl status racktemp     # stato
journalctl -u racktemp -f     # log
sudo ./uninstall.sh           # disinstalla (chiede se tenere i dati)
```

Per buildare il pacchetto da sorgente (richiede Node.js + npm su una macchina Linux x86_64):

```bash
bash scripts/build-package-linux.sh
```

---

## 📋 Come si usa

1. **Flasha l'ESP32-C3** (vedi sotto) — stesso firmware per tutti i sensori, nessuna
   configurazione da compilare.
2. **Collega il sensore alla tua rete**: al primo avvio apre un access point di setup, ci ti
   connetti da telefono/PC e inserisci WiFi + indirizzo del server dalla sua pagina web.
3. **Crea il sensore** dalla dashboard → ottieni una API key dedicata (puoi annotare anche un
   IP statico, solo come promemoria: il server non lo usa per raggiungere il sensore). Se il
   dispositivo si è già annunciato, compare nel banner "Sensori rilevati in rete" — vedi
   [Rilevamento sensori](#-rilevamento-sensori-in-rete).
4. **Configura le soglie** (min/max °C, isteresi, cooldown notifiche, timeout offline) nella
   pagina del sensore.
5. **Configura le notifiche** (SMTP e/o Telegram) nella pagina Notifiche, con pulsante di test.
6. **Collega PRTG/Prometheus/altri strumenti** dalla pagina **Integrazioni** — una volta sola
   per tutti i sensori, non per singolo dispositivo.

---

## 🔌 Firmware ESP32-C3 Super Mini

### Hardware

| Componente | Note |
|---|---|
| **ESP32-C3 Super Mini** | Board Arduino IDE: `ESP32C3 Dev Module`. Molti cloni servono il driver USB-seriale **CH340**; se il flash non parte, tieni **BOOT** premuto collegando l'USB |
| **SHT31-D** | Sensore temperatura/umidità I2C, indirizzo `0x44` |

### Cablaggio I2C

| SHT31-D | ESP32-C3 Super Mini |
|---|---|
| VIN | 3V3 |
| GND | GND |
| SCL | GPIO9 |
| SDA | GPIO8 |

> Piedinatura più comune sui cloni "Super Mini" — verifica la serigrafia della tua scheda. I
> pin sono `#define I2C_SDA_PIN` / `I2C_SCL_PIN` in cima allo sketch, se devi cambiarli.

### Flash

In `firmware/rack_temp_sensor/`:

1. Installa le librerie **Adafruit SHT31 Library** e **Adafruit BusIO** (Library Manager) —
   WiFi/WebServer/DNSServer/Preferences/HTTPClient/Wire sono già incluse nel core esp32.
2. Collega il sensore come da tabella sopra.
3. Flasha lo sketch **così com'è**: nessun file da editare, nessun dato da compilare dentro.
   Lo stesso firmware va bene per ogni sensore che monti.

Il firmware invia un POST JSON a `/api/ingest` ogni 60 secondi (`SEND_INTERVAL_SEC` in cima
allo sketch, se vuoi cambiarlo):

```json
{ "temperature": 23.4, "humidity": 41.2, "rssi": -58, "chipId": "AABBCCDDEEFF0011" }
```

`chipId` è l'identificativo hardware del chip (usato per la discovery sotto): il firmware lo
include da solo, non serve configurarlo.

### Setup WiFi via portale captive (primo avvio)

Al primo avvio — o tenendo premuto **BOOT** all'accensione per rientrarci più tardi — il
sensore non trova nessuna configurazione salvata e apre un proprio access point invece di
collegarsi a una rete:

1. Da telefono/PC, connettiti alla rete WiFi **`RackTemp-XXXXXXXX`** (nessuna password —
   le ultime cifre sono l'ID del chip).
2. Si apre da solo un popup "accedi alla rete" (Android/iOS/Windows); se non appare, apri il
   browser su `http://192.168.4.1`.
3. Scegli la tua rete WiFi dall'elenco (o scrivila a mano) + password, indirizzo del server
   (es. `http://192.168.1.50:7431`), e se già la conosci la API key del sensore — altrimenti
   lasciala vuota.
4. **Salva**: il sensore si riavvia e prova a collegarsi. Se l'API key è vuota, si annuncia in
   rete e lo colleghi dal banner discovery nella dashboard (vedi sotto); se l'hai già incollata,
   parte a mandare dati subito.

La configurazione resta salvata sul chip (NVS interna) anche dopo un power-cycle o un
re-flash dello sketch. Per cambiarla — nuova rete, nuovo server, nuova API key — tieni premuto
BOOT all'accensione per riaprire il portale; i campi WiFi/server/API key restano precompilati
con i valori attuali, la password va reinserita solo se vuoi cambiarla.

> Nota: su questi cloni **BOOT è spesso sullo stesso GPIO9 usato per SCL** — lo sketch lo legge
> una volta sola all'avvio, prima di inizializzare l'I2C, quindi normalmente non c'è conflitto.
> Se sulla tua scheda BOOT è su un pin diverso, aggiorna `#define BOOT_BUTTON_PIN` in cima allo
> sketch.

---

## 📡 Rilevamento sensori in rete

Niente discovery via mDNS/UDP broadcast: un broadcast non attraverserebbe la rete bridge di
Docker in un deploy tipico (servirebbe `network_mode: host`, solo Linux). Il firmware si
annuncia invece con una normale richiesta HTTP verso l'indirizzo del server inserito nel
portale di setup (`POST /api/discovery/announce`, appena connesso) — funziona senza modifiche
di rete anche dentro Docker/Portainer.

Se il chip non ha ancora una API key valida, compare nel banner **"Sensori rilevati in rete"**
in dashboard con IP e ID del chip, più una notifica (SMTP/Telegram, se configurate) al primo
avvistamento. Appena crei il sensore, incolli la sua API key nel portale di setup del
dispositivo (tieni premuto BOOT per riaprirlo) e salvi, la voce sparisce da sola.

---

## 🔗 Integrazioni monitoring

Configurate **una volta sola a livello di controller**, dalla pagina **Integrazioni** — non per
singolo sensore: aggiungi un sensore rack e compare automaticamente ovunque.

| Strumento | Come |
|---|---|
| **PRTG** | Un solo sensore `HTTP Data Advanced` puntato a `/api/prtg/all?key=<token>` — ogni sensore rack diventa una coppia di canali `<nome> - Temperature/Humidity/Age`. Token nella pagina Integrazioni |
| **Prometheus / Grafana** | `GET /metrics` in formato Prometheus standard, aggiungilo come scrape target |
| **Zabbix, Uptime Kuma, altri** | Leggono lo stesso `/metrics` senza plugin dedicati |
| **PRTG per-dispositivo (legacy)** | `/api/prtg/<sensorId>?key=<apiKey del sensore>`, se preferisci un sensore PRTG per device |

Esempio `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: rack-temp-monitor
    static_configs:
      - targets: ["<host>:7431"]
```

Metriche esposte: `rack_temp_celsius`, `rack_temp_humidity_percent`, `rack_temp_online`,
`rack_temp_last_seen_seconds`, `rack_temp_threshold_min_celsius`, `rack_temp_threshold_max_celsius`
— tutte con label `sensor`, `sensor_id`, `location`.

> `/metrics` non richiede autenticazione (come `node_exporter` e la maggior parte degli
> endpoint Prometheus): se questa istanza è raggiungibile oltre la tua LAN fidata, mettila
> dietro un reverse proxy con allowlist IP o basic auth.

---

## 📁 Struttura progetto

```
RackTemp/
├── backend/                    ← API Express + Prisma/SQLite
│   ├── src/routes/             ← auth, sensors, ingest, discovery, prtg, metrics, integrations
│   ├── src/services/           ← notifier (SMTP/Telegram), soglie e allarmi
│   └── prisma/schema.prisma
├── frontend/                   ← React + Vite (dashboard, sensore, notifiche, integrazioni)
│   └── src/pages/
├── firmware/rack_temp_sensor/  ← sketch Arduino ESP32-C3, setup WiFi via portale captive
├── Dockerfile                  ← build multi-stage, immagine unica
├── docker-compose.yml          ← deploy via CLI (build da sorgente)
├── docker-compose.portainer.yml ← deploy via Portainer (immagine da GHCR) + Watchtower
├── installer/installer.iss     ← installer Windows (Inno Setup)
├── windows-tray/RackTempTray/  ← finestra WebView2 + icona tray per l'install Windows
├── linux/                      ← systemd unit + install.sh/uninstall.sh
├── scripts/build-installer-windows.ps1 ← builda + compila l'installer Windows
├── scripts/build-package-linux.sh      ← builda il pacchetto nativo Linux
└── .github/workflows/          ← publish immagine Docker + installer Windows + pacchetto Linux
                                   a ogni push/release
```

---

## 🧭 API principali

| Metodo | Endpoint | Auth | Descrizione |
|---|---|---|---|
| POST | `/api/ingest` | header `X-Api-Key` | riceve una lettura dal sensore |
| GET | `/api/sensors` | sessione | lista sensori + ultima lettura |
| PUT | `/api/sensors/:id/threshold` | sessione | aggiorna soglie |
| POST | `/api/discovery/announce` | nessuna | un ESP32 si annuncia sulla rete |
| GET | `/api/discovery` | sessione | dispositivi rilevati non ancora configurati |
| GET | `/api/integrations` | sessione | token di integrazione a livello controller |
| GET | `/api/prtg/all?key=TOKEN` | query key | tutti i sensori in un unico sensore PRTG |
| GET | `/metrics` | nessuna | tutti i sensori in formato Prometheus |
| PUT | `/api/notifications/config` | sessione | configura SMTP/Telegram |

---

## 💻 Sviluppo locale (senza Docker)

```bash
# backend
cd backend
cp .env.example .env
npm install
npx prisma db push
npm run dev            # http://localhost:7431

# frontend, in un altro terminale
cd frontend
npm install
npm run dev             # http://localhost:5173, proxy verso :7431
```

---

## 🗺️ Roadmap

- 🐘 Migrazione a Postgres per deploy multi-istanza (cambia `provider` in
  `backend/prisma/schema.prisma` + `DATABASE_URL`)
- 📶 Supporto MQTT come alternativa a HTTP POST
- 📤 Export storico letture (CSV)

---

## 🙏 Crediti

Costruito su un'ottima base open-source:

- 🔧 **[Prisma](https://www.prisma.io/)** + **[Express](https://expressjs.com/)** — backend e persistenza
- ⚛️ **[React](https://react.dev/)** + **[Vite](https://vitejs.dev/)** + **[Recharts](https://recharts.org/)** — dashboard e grafici
- 📟 **[Adafruit SHT31 Library](https://github.com/adafruit/Adafruit_SHT31)** — driver del sensore
- 📨 **[Nodemailer](https://nodemailer.com/)** + **[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)** — notifiche
- 🐳 **Docker** + **GitHub Container Registry** — build e distribuzione dell'immagine

---

## 📜 Licenza

Rilasciato sotto **[GNU General Public License v3.0](./LICENSE)**.

> This program is free software: you can redistribute it and/or modify it under the terms of
> the GNU General Public License as published by the Free Software Foundation, either version 3
> of the License, or (at your option) any later version.

---

<div align="center">

**Made with 💚 by [HexLions](https://github.com/HexLions)**

*Se questo progetto ti è utile, lascia una ⭐ sul repo!*

</div>
