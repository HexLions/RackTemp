# RackTemp — brief di remediation per Claude Code

Documento operativo da dare in pasto a Claude Code nella root del repo `RackTemp`.
Deriva dall'analisi di sicurezza del 2026-08-26. Ogni fase è indipendente e va su un branch e una PR separati.

Uso consigliato:

```bash
cd ~/RackTemp
claude
```

poi, nella sessione:

```
Leggi CLAUDE-CODE-security-remediation.md e implementa la FASE 1. Fermati alla fine
della fase, mostrami il diff completo e non fare commit finché non ti do l'ok.
```

---

## Regole di ingaggio (valgono per tutte le fasi)

1. **Una fase = un branch = una PR.** Naming: `security/fase-N-<slug>`. Non accorpare fasi.
2. **Non rifattorizzare nulla che non sia nello scope della fase.** Niente riformattazione di file interi, niente rinomina di variabili, niente "già che ci sono". Il diff deve essere leggibile in review.
3. **Non toccare il README** se non dove esplicitamente richiesto. La documentazione pubblica va aggiornata in FASE 8, alla fine.
4. **Prima di ogni modifica a un file di config o a uno script**, fai la copia `.bak` nella stessa directory (esclusa da git via `.gitignore` — verifica che `*.bak` ci sia, altrimenti aggiungilo).
5. **Commit atomici, conventional commits**, in inglese: `fix(security): ...`, `chore(deps): ...`, `feat(firmware): ...`.
6. **Ogni fase finisce con la sua verifica eseguita davvero**, non descritta. Se un comando di verifica fallisce, fermati e riporta l'output invece di aggiustare a tentativi.
7. **Non inventare API.** Se non sei sicuro della firma di un metodo dopo un bump di versione (nodemailer 9, express-rate-limit 8, helmet 8), leggi il `node_modules/<pkg>/README.md` o i `.d.ts` prima di scrivere il codice.
8. **Se una fase richiede una scelta architetturale non specificata qui**, fermati e chiedi. Non decidere in autonomia su schema del DB, formato delle chiavi o protocollo di pairing.

### Ambiente di lavoro

Tutto in locale, niente deploy. Setup dev:

```bash
cd backend && npm install && cp .env.example .env && npx prisma db push && npm run dev
# in un altro terminale
cd frontend && npm install && npm run dev
```

Il backend gira su `http://localhost:7431`, il frontend dev su `http://localhost:5173`.

### Definition of done (per ogni fase)

- `cd backend && npx tsc -p tsconfig.json --noEmit` — zero errori
- `cd frontend && npx tsc -b --noEmit` — zero errori
- `docker compose build` — successo
- il flusso di login + creazione sensore + invio di una lettura simulata funziona ancora (vedi smoke test in fondo)

---

## FASE 1 — Quick wins di deploy e dipendenze

**Branch:** `security/fase-1-deploy-hardening`
**Impatto:** alto. **Rischio di regressione:** basso.

### 1.1 — SESSION_SECRET auto-generato e persistito

**File:** `backend/src/index.ts`, `docker-compose.yml`, `docker-compose.portainer.yml`, `.env.example`

Attualmente:

```ts
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
```

Il fallback è pubblico: chi non imposta la variabile ha cookie di sessione forgiabili da chiunque legga il repo.

Sostituisci con una funzione che, in ordine:
1. usa `process.env.SESSION_SECRET` se è lungo ≥32 caratteri e non inizia con `change-me`;
2. altrimenti legge `backend/data/session-secret` se esiste;
3. altrimenti genera `randomBytes(32).toString("hex")`, lo scrive in `backend/data/session-secret` con `mode: 0o600` e logga un warning.

Il file va nel volume dati, quindi sopravvive a restart e rebuild dell'immagine. **Aggiungi `data/session-secret` a `.dockerignore` e verifica che `backend/data/` sia già in `.gitignore`.**

Nei due compose, togli il default: `SESSION_SECRET: ${SESSION_SECRET:-}`.
In `.env.example`, cambia il commento: la variabile è ora opzionale, se omessa viene generata al primo avvio.

**Verifica:**
```bash
cd backend && rm -f data/session-secret && unset SESSION_SECRET && npm run dev
# atteso: warning in console + file creato
ls -l backend/data/session-secret   # deve essere -rw-------
```

### 1.2 — Bump dipendenze vulnerabili

**File:** `backend/package.json`

`npm audit` riporta 2 critical + 1 high:
- `nodemailer` ≤9.0.0 → **9.0.5** (SMTP command injection via `envelope.size`; invio a dominio non previsto). Major bump.
- `node-telegram-bot-api` 0.66 → **2.1.0** (trascina `request` → SSRF, e `form-data` → CRLF injection + boundary da PRNG debole). Major bump.

```bash
cd backend
npm i nodemailer@9.0.5 node-telegram-bot-api@2.1.0
npm i -D @types/nodemailer@latest @types/node-telegram-bot-api@latest
```

Dopo il bump, **verifica la firma delle API usate in `backend/src/services/notifier.ts`**: `nodemailer.createTransport()`, `transport.sendMail()`, `new TelegramBot(token, { polling: false })`, `bot.sendMessage()`. Se qualcosa è cambiato, adegua il codice — non silenziare con `as any`.

**Verifica:**
```bash
cd backend && npm audit --audit-level=high && npx tsc -p tsconfig.json --noEmit
```

### 1.3 — Runtime base a fine vita

**File:** `Dockerfile`, `.github/workflows/*.yml`, `scripts/build-package-linux.sh`, `scripts/build-installer-windows.ps1`

Node 20 è EOL dal 30 aprile 2026: nessuna patch di sicurezza su V8, parser HTTP e crypto. Passa a **Node 24** (Active LTS, EOL 2028-04-30).

```bash
cp Dockerfile Dockerfile.bak
sed -i 's/node:20-alpine/node:24-alpine/g' Dockerfile
sed -i 's/node-version: 20/node-version: 24/g' .github/workflows/*.yml
```

Poi **controlla a mano** i due script di build: se scaricano un runtime Node portatile con una versione pinnata alla 20.x, aggiornala alla 24.x più recente. Non indovinare il numero di patch: recuperalo da `https://nodejs.org/dist/index.json`.

**Verifica:**
```bash
grep -rn 'node:20\|node-version: 20\|nodejs.*20\.' Dockerfile .github/ scripts/ || echo "OK, nessun riferimento a Node 20"
docker compose build
```

### 1.4 — Container non-root e hardening compose

**File:** `Dockerfile`, `docker-compose.yml`, `docker-compose.portainer.yml`

Nello stage `runtime`, dopo `RUN mkdir -p /app/backend/data`:

```dockerfile
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend
USER node
```

Nei due compose, sul servizio `rack-temp-monitor`:

```yaml
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

**Non aggiungere `read_only: true` in questa fase**: `npx prisma db push` all'avvio potrebbe scrivere fuori dal volume. Se vuoi valutarlo, fallo in una fase separata dopo aver verificato con `docker compose logs` che non ci siano `EROFS`.

Attenzione: su un volume esistente creato da un container root, i file sono di root e l'utente `node` non potrà scriverci. **Aggiungi una nota di upgrade** in un file `UPGRADING.md` nella root (creane uno se non c'è) con il comando di fix:

```bash
docker compose down
docker run --rm -v rack-temp-data:/data alpine chown -R 1000:1000 /data
docker compose up -d
```

**Verifica:**
```bash
docker compose up -d --build
docker compose exec rack-temp-monitor id     # atteso: uid=1000(node)
curl -sf http://localhost:7431/api/version && echo OK
```

### 1.5 — Rate limiting

**File:** `backend/src/index.ts`

Nessun endpoint ha limiti. I due bersagli seri: brute force del codice TOTP a 6 cifre su `/api/auth/mfa/login` (otplib non tiene memoria dei tentativi), e flood di `/api/discovery/announce`, dove ogni chipId nuovo scatena `notifyAll()` — email + Telegram.

```bash
cd backend && npm i express-rate-limit@8.6.2
```

In `index.ts`, prima dei router:

```ts
import rateLimit from "express-rate-limit";

// Necessario solo se l'istanza sta dietro un reverse proxy: senza questo,
// req.ip è l'IP del proxy e il limite diventa globale. Con un valore troppo
// alto, invece, l'IP client è falsificabile via X-Forwarded-For.
if (process.env.TRUST_PROXY_HOPS) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
}

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too many attempts, retry later" },
});
const announceLimiter = rateLimit({ windowMs: 60_000, limit: 30, legacyHeaders: false });

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/mfa/login", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/reset-password-with-key", authLimiter);
app.use("/api/discovery/announce", announceLimiter);
```

Documenta `TRUST_PROXY_HOPS` in `.env.example`.

**In aggiunta**, in `backend/src/routes/discovery.ts`: metti un cap sulle notifiche discovery. Tieni un contatore in memoria (resettato ogni 24h) e dopo 10 notifiche smetti di chiamare `notifyAll()` per i nuovi chipId, loggando soltanto. Il flood via `/announce` non deve poter bruciare la quota SMTP o far bloccare l'account.

**Verifica:**
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:7431/api/auth/login \
    -H 'Content-Type: application/json' -d '{"username":"x","password":"y"}'
done; echo
# atteso: dieci 401 poi 429
```

---

## FASE 2 — Superficie web

**Branch:** `security/fase-2-web-surface`
**Impatto:** medio. **Rischio di regressione:** medio (tocca cookie e CORS: testa il login end-to-end).

### 2.1 — Rimuovi CORS permissivo

**File:** `backend/src/index.ts`

```ts
app.use(cors({ origin: true, credentials: true }));
```

`origin: true` riflette qualsiasi Origin con `Allow-Credentials: true`. In produzione il frontend è servito **same-origin** dallo stesso Express (`express.static` + fallback SPA), quindi il middleware è inutile. Serve solo al dev server Vite su :5173, che però ha già il proxy.

Sostituisci con:

```ts
if (process.env.NODE_ENV !== "production") {
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
}
```

Poi **verifica che `frontend/vite.config.ts` proxi correttamente `/api` e `/ws` verso :7431**; se il proxy c'è già ed è completo, togli `cors` del tutto e rimuovi la dipendenza da `package.json`.

### 2.2 — Cookie di sessione

**File:** `backend/src/index.ts`

```ts
cookieSession({
  name: "session",
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 3600_000,
  sameSite: "strict",
  secure: process.env.COOKIE_SECURE === "1",
  httpOnly: true,
})
```

`strict` invece di `lax`: non ci sono link esterni in entrata verso l'app, quindi non rompe nulla e chiude anche i GET cross-site. Documenta `COOKIE_SECURE` in `.env.example` (da mettere a `1` quando c'è un reverse proxy HTTPS davanti).

**Correlato:** converti `GET /api/system/backup` in `POST` (scarica l'intero database, non deve essere raggiungibile da una navigazione). Aggiorna la chiamata in `frontend/src/pages/settings/BackupSection.tsx`.

### 2.3 — Security headers

**File:** `backend/src/index.ts`

```bash
cd backend && npm i helmet@8.3.0
```

```ts
import helmet from "helmet";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],          // QR code MFA = data URL
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: false,   // inutile su HTTP; lo mette il reverse proxy
  })
);
```

**Testa la dashboard nel browser con la console aperta** dopo aver aggiunto la CSP: se Recharts o il tema iniettano stili/script in modi non previsti, la pagina si rompe in silenzio. Se serve, allarga la direttiva specifica — non disattivare la CSP intera.

### 2.4 — Autenticazione sulla WebSocket

**File:** `backend/src/ws.ts`, `backend/src/index.ts`

`new WebSocketServer({ server, path: "/ws" })` non ha `verifyClient`: chiunque raggiunge la porta riceve tutte le letture live di tutti i sensori, e può aprire connessioni illimitate.

Implementa `verifyClient` che valida il cookie di sessione. `cookie-session` mette il payload base64 in `session` e la firma in `session.sig`, verificabile con `Keygrip` (già dipendenza transitiva di `cookie-session`, ma **aggiungila esplicitamente** a `package.json` insieme a `cookie` — non affidarti a una transitiva).

Requisiti:
- rifiuta con 401 se il cookie manca, la firma non verifica, `userId` è assente o `mustChangePassword` è true;
- `maxPayload: 4096`;
- heartbeat: `ping()` ogni 30s su tutti i client, `terminate()` su chi non risponde con `pong` entro il ciclo successivo.

`initWs(server)` va cambiato in `initWs(server, SESSION_SECRET)`; aggiorna la chiamata in `index.ts`.

**Verifica:**
```bash
npx wscat -c ws://localhost:7431/ws            # atteso: 401
npx wscat -c ws://localhost:7431/ws -H "Cookie: session=...; session.sig=..."   # atteso: connesso
```
(prendi i valori del cookie dal browser dopo il login)

### 2.5 — Handler async che uccidono il processo

**File:** `backend/src/routes/sensors.ts` e ovunque ci sia `async` senza try/catch

Express 4 non cattura le reject degli handler async. `DELETE /api/sensors/<id-inesistente>` fa lanciare Prisma con `P2025` → unhandled rejection → da Node 15 il processo termina. È un DoS a una richiesta.

**Approccio scelto: restare su Express 4 e aggiungere il wrapper.** (Il bump a Express 5 è una fase a sé, non farlo qui.)

1. Crea `backend/src/middleware/asyncHandler.ts` con un `ah()` che fa `Promise.resolve(fn(req,res,next)).catch(next)`.
2. **Avvolgi ogni handler async di ogni router** — non solo quelli di `sensors.ts`. Passa in rassegna tutti i file in `backend/src/routes/`.
3. In `index.ts`, **dopo tutti gli `app.use` dei router**, aggiungi un error handler a 4 argomenti che mappa `P2025` → 404, logga il resto e risponde 500 senza mai esporre lo stack al client.

**Verifica:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:7431/api/sensors/nope -b cookies.txt
# atteso: 404 (non 500, non connessione chiusa)
curl -sf http://localhost:7431/api/version && echo "processo vivo"
```

---

## FASE 3 — Credenziali dei sensori (breaking)

**Branch:** `security/fase-3-sensor-credentials`
**Impatto:** critico. **Rischio di regressione:** alto — invalida le API key esistenti.

> ⚠️ **Prima di iniziare, fermati e chiedimi conferma sulla strategia di migrazione.** Questa fase rompe le installazioni esistenti e va coordinata con una release minor + note di upgrade.

### 3.1 — API key crittograficamente sicure

**File:** `backend/prisma/schema.prisma`, `backend/src/routes/sensors.ts`, `backend/src/routes/integrations.ts`

```prisma
apiKey    String @unique @default(cuid())   // Sensor
prtgToken String @default(cuid())           // IntegrationSettings
```

`cuid` v1 è deprecato dall'autore per motivi di sicurezza: k-sortable, timestamp in chiaro, fingerprint derivato da `process.pid` + hostname, solo l'ultimo blocco pseudo-casuale. Non è materiale per una credenziale.
Riferimento: https://github.com/paralleldrive/cuid

Interventi:
1. Togli `@default(cuid())` da `Sensor.apiKey` e da `IntegrationSettings.prtgToken`.
2. In `sensors.ts`, nel `POST "/"`, genera `apiKey: randomBytes(32).toString("hex")`.
3. In `integrations.ts`, in `getSettings()`, genera il `prtgToken` con `randomBytes(32).toString("hex")` alla create.
4. Allinea `POST /api/sensors/:id/regenerate-key` e `POST /api/integrations/regenerate-prtg-token` a **32 byte** (oggi usano 16 — non è un problema, ma l'uniformità aiuta).
5. **Non toccare i campi `id`**: `@default(cuid())` lì va benissimo, non sono segreti.

**Migrazione delle chiavi esistenti.** Il progetto usa `prisma db push`, non `migrate`, quindi non c'è una migration dir. Scrivi uno script `backend/scripts/rotate-weak-keys.ts` che:
- rigenera `apiKey` per ogni `Sensor` la cui chiave matcha il pattern cuid (`/^c[a-z0-9]{24}$/`);
- rigenera `prtgToken` se matcha lo stesso pattern;
- stampa un riepilogo `nome sensore → nuova chiave` da ri-inserire nei device;
- è **idempotente** (rieseguirlo non rigenera chiavi già forti).

Aggiungi lo script a `package.json` come `"rotate-keys": "tsx scripts/rotate-weak-keys.ts"` e documentalo in `UPGRADING.md`.

### 3.2 — Handoff della API key a finestra temporale

**File:** `backend/src/routes/discovery.ts`, `backend/src/routes/sensors.ts`, `backend/prisma/schema.prisma`, frontend

Oggi:

```ts
const linkedSensor = await prisma.sensor.findUnique({ where: { chipId } });
if (linkedSensor) return res.json({ apiKey: linkedSensor.apiKey });   // nessuna auth
```

Il chipId non è un segreto: è derivato dal MAC (ARP scan), le ultime cifre sono nell'SSID del portale `RackTemp-XXXXXXXX`, ed è mostrato in chiaro nella dashboard. Chiunque sulla rete ottiene una API key valida e permanente con un `curl`.

Implementa un handoff **one-shot e a scadenza**:

1. Schema — aggiungi a `Sensor`:
   ```prisma
   keyHandoutUntil DateTime?
   keyHandedOut    Boolean   @default(false)
   ```
2. Quando l'admin crea un sensore con `chipId`, o quando chiama `POST /api/discovery/:id/claim`, imposta `keyHandoutUntil = now + 10 min` e `keyHandedOut = false`.
3. `/announce` restituisce `apiKey` **solo se** `keyHandoutUntil > now` **e** `keyHandedOut === false`; subito dopo mette `keyHandedOut = true`. Fuori da quella finestra risponde `204`, esattamente come per un chip sconosciuto (nessuna differenza osservabile).
4. Aggiungi un endpoint `POST /api/sensors/:id/reopen-handoff` (autenticato) che riapre la finestra di 10 minuti, per quando la prima consegna fallisce.
5. Frontend: nella pagina del sensore, un pulsante **"Riapri finestra di pairing"** con un countdown visibile. Nel banner discovery, un indicatore di finestra aperta/chiusa.

**Non cambiare il firmware in questa fase**: il flusso di polling resta identico, cambia solo quando il server risponde con la chiave. Verifica che il firmware gestisca correttamente il caso "204 per sempre" senza andare in loop stretto — se ritenta ogni ciclo senza backoff, aggiungi un backoff esponenziale con cap a 5 minuti (**questa** sì è una modifica al firmware, tienila in un commit separato).

### 3.3 — Confronti a tempo costante

**File:** `backend/src/routes/prtg.ts`, `backend/src/routes/status.ts`

`settings.prtgToken !== key` e `sensor.apiKey !== key` escono al primo byte diverso. Crea un helper condiviso in `backend/src/services/secrets.ts`:

```ts
import { timingSafeEqual } from "crypto";

export function secretEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;   // la lunghezza trapela comunque, è accettabile
  return timingSafeEqual(ba, bb);
}
```

Usalo in entrambi i router.

### 3.4 — API key fuori dalla query string

**File:** `backend/src/routes/ingest.ts`

```ts
const apiKey = req.header("X-Api-Key") ?? (req.query.apiKey as string | undefined);
```

Il fallback in query fa finire la credenziale nei log di ogni reverse proxy. Il firmware usa già l'header. **Togli il fallback da `/api/ingest`.**

Su `/api/prtg/*` e `/api/status/*` la query key **va tenuta** (PRTG e i tool di monitoring vogliono l'URL) — lì aggiungi solo una nota nel README in FASE 8.

**Verifica FASE 3:**
```bash
# handoff: prima chiamata ok, seconda no
curl -s -XPOST localhost:7431/api/discovery/announce -H 'Content-Type: application/json' -d '{"chipId":"TEST123"}'
curl -s -XPOST localhost:7431/api/discovery/announce -H 'Content-Type: application/json' -d '{"chipId":"TEST123"}'
# atteso: la prima con apiKey (se la finestra è aperta), la seconda 204

# ingest solo via header
curl -s -o /dev/null -w '%{http_code}\n' -XPOST "localhost:7431/api/ingest?apiKey=$KEY" \
  -H 'Content-Type: application/json' -d '{"temperature":21.0}'    # atteso: 401
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:7431/api/ingest \
  -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"temperature":21.0}'   # atteso: 201
```

---

## FASE 4 — Firmware e OTA

**Branch:** `security/fase-4-firmware-ota`
**Impatto:** critico. **Rischio:** alto — un errore qui brikka i sensori in campo.

> ⚠️ **Non fare il flash automatico di nulla.** Produci il codice, compilalo con `arduino-cli` se disponibile, e fermati. Il test su hardware lo faccio io.

### 4.1 — Disattiva l'auto-update come default immediato

**File:** `firmware/rack_temp_sensor/rack_temp_sensor.ino`

```cpp
WiFiClient client;   // non WiFiClientSecure
httpUpdate.rebootOnUpdate(true);
t_httpUpdate_return ret = httpUpdate.update(client, cfgServerUrl + "/api/firmware/latest.bin");
```

Nessuna firma, nessun TLS, nessun pinning, su un `serverUrl` che è tipicamente `http://<ip>:7431`. Chi fa ARP o DNS spoofing sulla LAN esegue codice arbitrario e persistente sull'ESP32 — dove in NVS c'è la PSK del WiFi.

**Mitigazione immediata**, prima ancora della firma: metti l'auto-update dietro un `#define OTA_AUTO_UPDATE 0` in cima allo sketch, disattivato di default, con un commento che spiega perché. Chi lo vuole lo abilita consapevolmente.

### 4.2 — Verifica della firma del binario

Implementa la verifica di firma usando il supporto nativo dell'ESP32 Arduino core (`Update.installSignature()` / `UpdaterHashClass` + `UpdaterVerifyClass`).

**Prima di scrivere il codice, verifica sulla documentazione dell'esp32 core installato quale API di signature verification è effettivamente disponibile nella versione in uso** — l'API è cambiata tra le major del core e non voglio codice basato su una firma di metodo plausibile ma inesistente. Se il core installato non la supporta, dimmelo e fermati.

Serve anche:
- uno script `scripts/sign-firmware.sh` che firmi il `.bin` con una chiave privata (Ed25519 o RSA-2048, secondo cosa supporta il core) e produca il file di firma;
- la chiave **pubblica** compilata nello sketch, in un header separato `firmware/rack_temp_sensor/ota_pubkey.h`;
- una nota in `.gitignore` per la chiave privata, e istruzioni in `UPGRADING.md` su come generarla — **la chiave privata non entra mai nel repo né nei workflow**;
- lato server, `POST /api/firmware/` deve accettare e conservare anche il file di firma, e servirlo su `/api/firmware/latest.sig`.

### 4.3 — Portale captive

**File:** `firmware/rack_temp_sensor/rack_temp_sensor.ino`

Due problemi:

1. Il form pre-compila la API key in chiaro:
   ```cpp
   "<input name='apiKey' placeholder='...' value='" + htmlEscape(cfgApiKey) + "'>"
   ```
   Chiunque si connetta all'AP la legge. Cambia in: campo vuoto con placeholder `••••••••` quando una chiave è già salvata, e comportamento "vuoto = mantieni quella attuale", identico a come già fai con la password WiFi.

2. L'AP è **senza password**. Genera una password dal chipId (es. gli 8 caratteri finali) e:
   - stampala sulla seriale al boot;
   - mostrala nel README come "la password dell'AP è l'ID del chip, che trovi sulla seriale".

   Non è un segreto forte, ma trasforma un AP aperto in una barriera che richiede accesso fisico o alla seriale.

3. Chiudi il portale dopo **10 minuti** di inattività e riavvia in modalità normale, invece di lasciarlo aperto a tempo indefinito.

L'escape HTML esistente è corretto — non toccarlo.

---

## FASE 5 — Supply chain e distribuzione

**Branch:** `security/fase-5-supply-chain`

### 5.1 — Watchtower fuori dallo stack di default

**File:** `docker-compose.portainer.yml`, README (solo la sezione Portainer)

Lo stack consigliato monta `/var/run/docker.sock` in un container di terze parti non pinnato (`nickfedor/watchtower:latest`) e fa auto-pull di `:latest`. Accesso al socket Docker = root sull'host. Chiunque comprometta l'account GitHub o un token con `packages:write` ottiene root su ogni macchina che ha seguito il README, in automatico, entro 6 ore.

Interventi:
1. **Togli `watchtower` dallo stack di default.** Sposta il blocco in un file separato `docker-compose.watchtower.yml`, da comporre con `-f` da chi lo vuole.
2. Nel file separato, **pinna il digest** invece di `:latest` (recupera il digest corrente con `docker buildx imagetools inspect nickfedor/watchtower:latest`).
3. Metti `WATCHTOWER_MONITOR_ONLY: "true"` come default suggerito: notifica invece di aggiornare da solo.
4. Aggiungi nel file un commento in testa che spiega esplicitamente il trade-off del socket Docker.

### 5.2 — `:latest` solo sulle release

**File:** `.github/workflows/docker-publish.yml`

Oggi ogni push su `main` ripubblica `ghcr.io/hexlions/racktemp:latest`, che (con Watchtower attivo) finisce in produzione su macchine di terzi entro sei ore. Un commit di mezzogiorno è in campo la sera.

Cambia la logica dei tag:
- push su `main` → `:edge` e `:sha-<short>`
- `release: published` → `:latest`, `:<tag>` e `:sha-<short>`

Aggiorna i due compose e il README di conseguenza (il compose Portainer deve puntare a `:latest`, che ora significa "ultima release", non "ultimo commit").

### 5.3 — Audit automatico

Crea `.github/workflows/audit.yml`: `npm audit --audit-level=high` su `backend/` e `frontend/`, su ogni PR e settimanalmente (`cron: "0 6 * * 1"`), con Node 24. Deve **fallire** la build sulle high.

---

## FASE 6 — Sessioni e bootstrap

**Branch:** `security/fase-6-session-hygiene`

### 6.1 — Bootstrap token al primo avvio

**File:** `backend/src/index.ts`, `backend/src/routes/auth.ts`, `frontend/src/pages/FirstLogin.tsx`

Un'istanza appena deployata risponde con `admin`/`admin` e permette il first-login a chiunque arrivi per primo — che può anche caricare un DB SQLite arbitrario via `/api/auth/restore-backup`.

In `bootstrapAdmin()`, genera un token di 8 caratteri e stampalo nei log. `POST /api/auth/first-login` e `POST /api/auth/restore-backup` devono richiederlo, oltre alla sessione. Il token va invalidato appena il first-login riesce.

Chi non ha accesso a `docker compose logs` / `journalctl -u racktemp` non può completare il setup.

### 6.2 — Coerenza nelle re-autenticazioni

**File:** `backend/src/routes/auth.ts`

- `POST /api/auth/regenerate-recovery-key` non chiede la password corrente né controlla `mustChangePassword`, mentre `/mfa/disable` la chiede giustamente. Chi ruba una sessione può generarsi una recovery key valida e mantenere l'accesso anche dopo il cambio password. Allinealo a `/mfa/disable`.
- `session.pendingMfaUserId` non ha scadenza propria: eredita i 7 giorni del cookie. Aggiungi `pendingMfaExpires = Date.now() + 5*60_000` in `/login` e verificalo in `/mfa/login`.

---

## FASE 7 — Migrazione a Express 5 (opzionale)

**Branch:** `security/fase-7-express-5`

Solo **dopo** che la FASE 2 è mergiata e stabile. Express 5.2.1 gestisce nativamente le reject degli handler async, il che rende il wrapper `ah()` ridondante (l'error handler globale resta).

Breaking change da verificare: `req.query` è un getter (non più assegnabile), path matching cambiato (niente più `*` bare — il fallback SPA `app.get("*")` va riscritto come `app.get("/*splat")` o middleware), `res.send(status)` rimosso.

**Se il fallback SPA si rompe, l'app serve 404 su ogni route del frontend**: testa la navigazione diretta su `/settings`, `/sensor/<id>`, `/reset-password` dopo il bump.

---

## FASE 8 — Documentazione

**Branch:** `security/fase-8-docs`
**Da fare per ultima**, quando le fasi precedenti sono mergiate.

1. **`SECURITY.md`** (in inglese, root del repo): modello di minaccia in due paragrafi, cosa il progetto assume (LAN fidata), cosa non protegge, come segnalare una vulnerabilità.
2. **README, sezione nuova "Security"** (inglese): esporre l'istanza su internet richiede reverse proxy + HTTPS + `COOKIE_SECURE=1` + `TRUST_PROXY_HOPS`; `/metrics` e `/api/version` sono pubblici by design; le key di PRTG/status viaggiano in query string e finiscono nei log del proxy.
3. **`UPGRADING.md`**: rotazione delle API key (FASE 3), chown del volume per il container non-root (FASE 1.4), spostamento di Watchtower (FASE 5), generazione della chiave OTA (FASE 4).
4. **Correggi la description del repo su GitHub**: dice "ESP32-S2 QT Py", il README e il firmware parlano di ESP32-C3 Super Mini.

---

## Smoke test end-to-end

Da eseguire alla fine di ogni fase. Adatta i valori dove serve.

```bash
cd ~/RackTemp && docker compose down -v && docker compose up -d --build && sleep 20

# 1. l'app risponde
curl -sf localhost:7431/api/version | jq .

# 2. login con le credenziali di default
curl -s -c /tmp/rt.txt -XPOST localhost:7431/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq .

# 3. first-login (aggiungi il bootstrap token dopo la FASE 6)
curl -s -b /tmp/rt.txt -c /tmp/rt.txt -XPOST localhost:7431/api/auth/first-login \
  -H 'Content-Type: application/json' \
  -d '{"newUsername":"cosimo","newPassword":"prova-lunga-8"}' | jq .

# 4. crea un sensore e prendi la chiave
KEY=$(curl -s -b /tmp/rt.txt -XPOST localhost:7431/api/sensors \
  -H 'Content-Type: application/json' -d '{"name":"Test","location":"Lab"}' | jq -r .apiKey)
echo "apiKey: $KEY"
# dopo la FASE 3 deve essere 64 caratteri esadecimali, non un cuid da 25 che inizia per "c"

# 5. invia una lettura
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:7431/api/ingest \
  -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"temperature":22.5,"humidity":45.0,"rssi":-55}'   # atteso: 201

# 6. i dati arrivano in dashboard e su /metrics
curl -s -b /tmp/rt.txt localhost:7431/api/sensors | jq '.[0].readings[0]'
curl -s localhost:7431/metrics | grep rack_temp_celsius

# 7. il processo sopravvive a una richiesta malformata
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/rt.txt -XDELETE localhost:7431/api/sensors/nope
curl -sf localhost:7431/api/version >/dev/null && echo "processo vivo"
```

---

## Cosa NON fare

- Non toccare il codice del frontend oltre a quanto esplicitamente indicato (2.2, 3.2). Non c'è XSS, non c'è nulla da sistemare lì.
- Non riscrivere `linux/install.sh`: fa già le cose giuste (utente di sistema senza shell, secret casuale, `chmod 600`, dati fuori da `/opt`).
- Non toccare la regex di `/api/system/backups/:name/download`: `^racktemp-backup-[\w-]+\.sqlite$` è corretta, `\w` esclude già `/`, `\` e `.`.
- Non cambiare il flusso di password reset: la scelta di non fidarsi dell'header `Host` e di ricadere su un token da incollare a mano è quella giusta.
- Non aggiungere framework, ORM alternativi o librerie di validazione: zod e Prisma coprono tutto.
- Non introdurre `try/catch` vuoti o `as any` per far passare il typecheck dopo i bump.
