# Rack Temp Monitor

Monitoraggio temperatura/umidità rack basato su **Adafruit QT Py ESP32-S2** + sensore STEMMA QT
(SHT31-D / SHT40), con backend + web UI self-hosted, notifiche SMTP/Telegram e integrazione PRTG.

Stack: Node.js + TypeScript + Express + Prisma (SQLite, migrabile a Postgres) sul backend,
React + Vite sul frontend, tutto in un unico container Docker.

## Avvio rapido (Docker)

### Prerequisiti

Serve Docker con il plugin Compose v2 (comando `docker compose`, senza trattino):

- **Windows/Mac**: installa [Docker Desktop](https://www.docker.com/products/docker-desktop/) — include già Compose.
- **Linux**: installa [Docker Engine](https://docs.docker.com/engine/install/) e il plugin
  `docker-compose-plugin` (su Debian/Ubuntu: `sudo apt install docker-compose-plugin`).

Verifica che funzioni:

```bash
docker --version
docker compose version
```

### Clone e avvio

```bash
git clone https://github.com/HexLions/RackTemp.git
cd RackTemp
cp .env.example .env
```

Apri `.env` e imposta valori tuoi (non lasciare i default in produzione):

```
SESSION_SECRET=una-stringa-lunga-e-casuale
ADMIN_USERNAME=admin
ADMIN_PASSWORD=una-password-tua
```

Poi builda e avvia il container:

```bash
docker compose up -d --build
```

Prima esecuzione: scarica le immagini base e builda backend+frontend, ci vuole qualche minuto.
Le esecuzioni successive (`docker compose up -d`) sono immediate.

### Verifica

```bash
docker compose ps          # deve mostrare rack-temp-monitor "Up"
docker compose logs -f      # segui i log, Ctrl+C per uscire
```

Apri `http://<ip-del-pc>:3000` da browser (anche da un altro dispositivo sulla stessa rete),
login con `ADMIN_USERNAME`/`ADMIN_PASSWORD` di `.env`. Cambia la password da Impostazioni dopo
il primo accesso.

### Gestione

```bash
docker compose down         # ferma e rimuove il container (i dati restano nel volume)
docker compose up -d        # riavvia senza rebuild
docker compose up -d --build   # rebuild dopo un git pull con modifiche al codice
docker compose down -v      # ATTENZIONE: rimuove anche il volume, cancella tutti i dati
```

I dati (sensori, letture, soglie) vivono nel volume Docker `rack-temp-data`, persistono tra
riavvii/rebuild finché non usi `-v`.

## Utilizzo

1. **Crea un sensore** dalla dashboard → ottieni una API key dedicata.
2. **Configura le soglie** (min/max °C, isteresi, cooldown notifiche, timeout offline) nella
   pagina del sensore.
3. **Configura le notifiche** (SMTP e/o Telegram) nella pagina Notifiche, con pulsante di test.
4. **Flasha l'ESP32-S2** (vedi sotto) con l'URL del server e la API key del sensore.

## Firmware ESP32-S2 (Arduino)

In `firmware/rack_temp_sensor/`:

1. Installa in Arduino IDE la board **Adafruit QT Py ESP32-S2** (Boards Manager → esp32).
2. Installa le librerie **Adafruit SHT31** (o **Adafruit SHT4x** per SHT40) e **Adafruit BusIO**.
3. Copia `config.h.example` in `config.h` e imposta WiFi, `SERVER_URL` e `API_KEY` del sensore.
4. Collega il sensore SHT31-D/SHT40 via STEMMA QT (nessuna saldatura richiesta), flasha.

Il firmware invia un POST JSON a `/api/ingest` ogni `SEND_INTERVAL_SEC` secondi:

```json
{ "temperature": 23.4, "humidity": 41.2, "rssi": -58 }
```

## API principali

| Metodo | Endpoint | Auth | Descrizione |
|---|---|---|---|
| POST | `/api/ingest` | header `X-Api-Key` | riceve una lettura dal sensore |
| GET | `/api/sensors` | sessione | lista sensori + ultima lettura |
| PUT | `/api/sensors/:id/threshold` | sessione | aggiorna soglie |
| GET | `/api/prtg/:sensorId?key=API_KEY` | query key | sensore custom per PRTG |
| PUT | `/api/notifications/config` | sessione | configura SMTP/Telegram |

## Integrazione PRTG

Aggiungi un sensore **"HTTP Data Advanced"** (o **"REST Custom"**) puntato a:

```
http://<host>:3000/api/prtg/<sensorId>?key=<apiKey>
```

Restituisce i canali `Temperature`, `Age` (minuti dall'ultima lettura), e se disponibili
`Humidity` e `WiFi RSSI`, nel formato JSON standard PRTG (`{"prtg":{"result":[...]}}`).

## Sviluppo locale (senza Docker)

```bash
# backend
cd backend
cp .env.example .env
npm install
npx prisma db push
npm run dev          # http://localhost:3000

# frontend (in un altro terminale)
cd frontend
npm install
npm run dev           # http://localhost:5173, proxy verso :3000
```

## Roadmap / idee future

- Migrazione a Postgres per deploy multi-istanza (basta cambiare `provider` in
  `backend/prisma/schema.prisma` e `DATABASE_URL`).
- Supporto MQTT come alternativa a HTTP POST.
- Export storico letture (CSV/Prometheus).
