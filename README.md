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

Apri `.env` e imposta un `SESSION_SECRET` tuo (una stringa lunga e casuale):

```
SESSION_SECRET=una-stringa-lunga-e-casuale
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

Apri `http://<ip-del-pc>:7431` da browser (anche da un altro dispositivo sulla stessa rete).

### Primo accesso

Al primo avvio l'app crea un utente amministratore con credenziali di default
**`admin` / `admin`**. Al primo login l'app blocca l'accesso al resto delle funzioni e ti
chiede subito di scegliere un username e una password definitivi (min. 8 caratteri) — non è
possibile usare l'app con le credenziali di default. Non serve configurare nulla in `.env` per
questo.

### Gestione

```bash
docker compose down         # ferma e rimuove il container (i dati restano nel volume)
docker compose up -d        # riavvia senza rebuild
docker compose up -d --build   # rebuild dopo un git pull con modifiche al codice
docker compose down -v      # ATTENZIONE: rimuove anche il volume, cancella tutti i dati
```

I dati (sensori, letture, soglie) vivono nel volume Docker `rack-temp-data`, persistono tra
riavvii/rebuild finché non usi `-v`.

## Avvio con Portainer

Se preferisci gestire il container da Portainer invece che da riga di comando, usa lo stack
già pronto in [`docker-compose.portainer.yml`](docker-compose.portainer.yml). A differenza del
`docker-compose.yml` principale non builda da Dockerfile (Portainer non ha accesso alla
repository locale), ma usa un'immagine già pronta pubblicata su GitHub Container Registry a
ogni push su `main` (vedi [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)).

Il pacchetto `ghcr.io/hexlions/racktemp` è pubblico (eredita la visibilità del repo), quindi
Portainer può scaricarlo senza autenticazione. Se in futuro il repo diventasse privato, il
pacchetto andrebbe reso pubblico a mano da GitHub → tab **Packages** → `racktemp` →
**Package settings** → **Change visibility**, altrimenti Portainer non riesce a fare il pull.

Import in Portainer:

1. **Stacks** → **Add stack**.
2. Nome stack, es. `rack-temp-monitor`.
3. **Web editor**: incolla il contenuto di `docker-compose.portainer.yml`
   (oppure **Upload**: seleziona il file direttamente).
4. In **Environment variables** aggiungi `SESSION_SECRET` con una stringa lunga e casuale
   (se lo lasci vuoto resta il valore di default nel file — da evitare in produzione).
5. **Deploy the stack**.

Apri `http://<ip-del-pc>:7431`: stesso comportamento del deploy via `docker compose`, incluso
il primo accesso con `admin`/`admin` da cambiare subito (vedi sopra).

In alternativa, se preferisci gli aggiornamenti automatici ad ogni push, crea lo stack col
metodo **Repository** di Portainer puntando a questo repo Git e al percorso
`docker-compose.portainer.yml`, attivando il **GitOps update** (polling o webhook).

## Utilizzo

1. **Crea un sensore** dalla dashboard → ottieni una API key dedicata (puoi anche annotare un IP
   statico opzionale, solo come promemoria: il server non lo usa per raggiungere il sensore).
2. **Configura le soglie** (min/max °C, isteresi, cooldown notifiche, timeout offline) nella
   pagina del sensore.
3. **Configura le notifiche** (SMTP e/o Telegram) nella pagina Notifiche, con pulsante di test.
4. **Flasha l'ESP32-S2** (vedi sotto) con l'URL del server e la API key del sensore. Se il
   dispositivo è già acceso con l'URL del server configurato ma senza una API key valida, si
   annuncia da solo e compare in un banner "Sensori rilevati in rete" sulla dashboard — vedi
   [Rilevamento sensori](#rilevamento-sensori-sulla-rete).
5. **Collega PRTG/Prometheus/altri strumenti di monitoring** dalla pagina **Integrazioni**: è
   configurata una volta sola a livello di controller, non per singolo sensore — vedi
   [Integrazioni monitoring](#integrazioni-monitoring).

## Firmware ESP32-S2 (Arduino)

In `firmware/rack_temp_sensor/`:

1. Installa in Arduino IDE la board **Adafruit QT Py ESP32-S2** (Boards Manager → esp32).
2. Installa le librerie **Adafruit SHT31** (o **Adafruit SHT4x** per SHT40) e **Adafruit BusIO**.
3. Copia `config.h.example` in `config.h` e imposta WiFi, `SERVER_URL` e `API_KEY` del sensore.
4. Collega il sensore SHT31-D/SHT40 via STEMMA QT (nessuna saldatura richiesta), flasha.

Il firmware invia un POST JSON a `/api/ingest` ogni `SEND_INTERVAL_SEC` secondi:

```json
{ "temperature": 23.4, "humidity": 41.2, "rssi": -58, "chipId": "AABBCCDDEEFF0011" }
```

`chipId` è l'identificativo hardware del chip (usato per la discovery, vedi sotto): il firmware
lo include da solo, non serve configurarlo.

## Rilevamento sensori sulla rete

Non c'è vera discovery di rete (niente mDNS/UDP broadcast): un broadcast non attraverserebbe la
rete bridge di Docker in un deploy tipico (servirebbe `network_mode: host`, solo Linux). Il
firmware quindi si annuncia con una normale richiesta HTTP verso il `SERVER_URL` già configurato
in `config.h` (`POST /api/discovery/announce`, chiamata all'avvio) — funziona senza modifiche di
rete anche dentro Docker/Portainer.

Se il chip che si annuncia non ha ancora nessun sensore configurato con la sua API key, compare
nel banner **"Sensori rilevati in rete"** sulla dashboard con IP e ID del chip, e arriva una
notifica (SMTP/Telegram, se configurate) alla prima volta che viene visto. Appena crei il
sensore e flashi la sua API key vera sul dispositivo, la voce sparisce da sola (la prima lettura
autenticata con quel `chipId` la rimuove).

## API principali

| Metodo | Endpoint | Auth | Descrizione |
|---|---|---|---|
| POST | `/api/ingest` | header `X-Api-Key` | riceve una lettura dal sensore |
| GET | `/api/sensors` | sessione | lista sensori + ultima lettura |
| PUT | `/api/sensors/:id/threshold` | sessione | aggiorna soglie |
| POST | `/api/discovery/announce` | nessuna | un ESP32 si annuncia sulla rete |
| GET | `/api/discovery` | sessione | lista dispositivi rilevati non ancora configurati |
| GET | `/api/integrations` | sessione | token di integrazione a livello controller |
| GET | `/api/prtg/all?key=TOKEN` | query key | tutti i sensori in un unico sensore PRTG |
| GET | `/api/prtg/:sensorId?key=API_KEY` | query key | endpoint legacy per un singolo sensore |
| GET | `/metrics` | nessuna | tutti i sensori in formato Prometheus |
| PUT | `/api/notifications/config` | sessione | configura SMTP/Telegram |

## Integrazioni monitoring

Configurate **una volta sola a livello di controller**, dalla pagina **Integrazioni** della web
UI — non per singolo sensore: aggiungi un sensore rack e compare automaticamente in entrambi gli
endpoint qui sotto, senza toccare la configurazione di PRTG/Prometheus.

### PRTG

Crea un solo sensore **"HTTP Data Advanced"** (o **"REST Custom"**) in PRTG, puntato a:

```
http://<host>:7431/api/prtg/all?key=<token>
```

Il `token` si trova (e si rigenera) nella pagina Integrazioni. Ogni sensore rack configurato
compare come coppia di canali `<nome sensore> - Temperature` / `- Humidity` / `- Age`
(minuti dall'ultima lettura), nel formato JSON standard PRTG (`{"prtg":{"result":[...]}}`).

Resta disponibile anche l'endpoint legacy per-sensore
`/api/prtg/<sensorId>?key=<apiKey del sensore>`, per chi preferisce un sensore PRTG per
dispositivo invece che uno aggregato.

### Prometheus, Grafana, Zabbix, Uptime Kuma, altri

`GET /metrics` espone tutti i sensori in formato Prometheus standard — copre nativamente
Prometheus/Grafana, e la maggior parte degli altri strumenti (Zabbix via item HTTP/Prometheus,
Uptime Kuma, ecc.) sa leggere questo formato senza plugin dedicati. Un sensore nuovo compare da
solo al primo dato, senza configurazione per-sensore nel tool di monitoring.

Esempio target Prometheus (`prometheus.yml`):

```yaml
scrape_configs:
  - job_name: rack-temp-monitor
    static_configs:
      - targets: ["<host>:7431"]
```

Metriche esposte: `rack_temp_celsius`, `rack_temp_humidity_percent`, `rack_temp_online`,
`rack_temp_last_seen_seconds`, `rack_temp_threshold_min_celsius`, `rack_temp_threshold_max_celsius`
— tutte con label `sensor`, `sensor_id`, `location`.

L'endpoint non richiede autenticazione (come `node_exporter` e la maggior parte degli
`/metrics`): se questa istanza è raggiungibile oltre la tua LAN fidata, mettila dietro un
reverse proxy con allowlist IP o basic auth.

## Sviluppo locale (senza Docker)

```bash
# backend
cd backend
cp .env.example .env
npm install
npx prisma db push
npm run dev          # http://localhost:7431

# frontend (in un altro terminale)
cd frontend
npm install
npm run dev           # http://localhost:5173, proxy verso :7431
```

## Roadmap / idee future

- Migrazione a Postgres per deploy multi-istanza (basta cambiare `provider` in
  `backend/prisma/schema.prisma` e `DATABASE_URL`).
- Supporto MQTT come alternativa a HTTP POST.
- Export storico letture (CSV/Prometheus).
