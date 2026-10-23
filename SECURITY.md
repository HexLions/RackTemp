# Security

## Threat model

RackTemp is built for a self-hosted deployment on a **trusted home/office LAN**, administered by
a single account. It assumes the network it runs on is not actively hostile — anyone who can
reach the app's port can already see the WiFi network's traffic in general — and focuses its
security work on the things a LAN doesn't protect against on its own: weak or guessable
credentials, session/cookie handling, unattended supply-chain updates (Docker image, Watchtower),
and firmware/OTA integrity for the ESP32 sensors.

**What it does not protect against:** a hostile actor already on the LAN with time and intent
(ARP/DNS spoofing) can still disrupt the deployment or attempt a MITM against a sensor that
hasn't pinned the server's certificate fingerprint (see below); this is a monitoring tool for
rack temperature/humidity, not a system handling regulated or high-value data, and its defenses
are scoped accordingly. Exposing an instance directly to the internet, or onto an
untrusted/shared network, needs the extra steps in the [README](./README.md) — the Security
section there covers putting a reverse proxy in front. Running it bare on an untrusted network is
not a supported configuration.

**The server is HTTPS-only** (self-signed certificate, generated automatically, no toggle to turn
it off — see the README's [HTTPS](./README.md#-https) section) and the sensor firmware is
HTTPS-only to match. Because the certificate is self-signed, transport encryption alone doesn't
authenticate the server the way a browser's CA-chain check would; the firmware additionally
supports **certificate fingerprint pinning** (see
[HTTPS and certificate pinning](./README.md#-https-and-certificate-pinning)) — optional per
sensor (pasted into its setup portal), and the one thing that actually closes the active-MITM gap
on that leg. Without a fingerprint pinned, a sensor's traffic is still encrypted (defeats passive
packet capture) but not authenticated against an attacker able to actively intercept the
connection.

**Firmware updates (OTA).** The sketch ships with `OTA_AUTO_UPDATE 1`: once a day a sensor asks
`/api/firmware/latest` for the current version and the MD5 of its `.bin`, and flashes the `.bin`
if the version differs. That request goes through the same fingerprint check as every other one;
the `.bin` download does not (arduino-esp32's `HTTPUpdate` opens its own connection, with no point
to check the certificate), so the file is only as trustworthy as the MD5 it is checked against:

- **Fingerprint pinned:** an attacker on the network can't change the reported MD5, so a `.bin`
  swapped in transit fails the check.
- **No fingerprint pinned:** an attacker able to spoof the server address answers both requests
  and gets their own firmware flashed.
- **Either way, firmware images are not signed.** Whoever controls the server, or an admin
  account (uploading firmware needs an admin session), decides what every sensor with
  auto-update on will flash.

Pin the fingerprint on every sensor, or set `OTA_AUTO_UPDATE 0` and reflash over USB to update, if
that isn't acceptable for your network.

**Secrets at rest.** The admin password is a bcrypt hash. Genuine third-party credentials — TOTP
secret, SMTP password, Telegram bot token, Microsoft Graph client secret — are encrypted
(AES-256-GCM, key file separate from `SESSION_SECRET`; see `backend/src/services/fieldEncryption.ts`).
Sensor API keys and the PRTG poll token are stored in plain form on purpose: they're checked on
every single ingest/PRTG-poll request (a hot path) and are already shown back to the admin in the
UI for copying, same bearer-token threat model either way — encrypting them adds a decrypt on
every request for no real reduction in blast radius. A backup taken from the database (on-demand,
scheduled, or emailed via Settings → Backup) carries all of the above off the server as-is,
including the plaintext sensor API keys/PRTG token — the UI warns about this next to the emailed-
backup toggle, but it's worth restating here: only enable email backups to a mailbox you trust as
much as the server itself, and treat the `.sqlite` file the same as any of the credentials inside it.

## Supply chain

- **Published Docker images are signed** (Sigstore/cosign, keyless via GitHub's own OIDC token —
  no private key stored anywhere) as of the workflow in
  [`docker-publish.yml`](./.github/workflows/docker-publish.yml). Verify a pulled image with:
  ```bash
  cosign verify ghcr.io/hexlions/racktemp:latest \
    --certificate-identity-regexp 'https://github.com/HexLions/RackTemp/.github/workflows/docker-publish.yml@.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```
  Images also carry SLSA build provenance and an SBOM (attached at push time), and are scanned for
  known CVEs on every publish (Trivy, results in this repo's Security → Code scanning tab).
- **Dependabot** ([`dependabot.yml`](./.github/dependabot.yml)) opens PRs for vulnerable/outdated
  npm dependencies (backend, frontend) and GitHub Actions, weekly. `audit.yml` separately runs
  `npm audit` on every PR and weekly, so a vulnerable dependency is flagged even between Dependabot
  runs.
- **CodeQL** (SAST) runs on every PR and weekly against both the backend and frontend TypeScript.
- **Watchtower is optional and holds the Docker socket.**
  [`docker-compose.watchtower.yml`](./docker-compose.watchtower.yml) is a separate stack, not part
  of the default deployment. It mounts `/var/run/docker.sock`, and whatever holds that socket
  controls the Docker daemon: root on the host, even in its default monitor-only mode. Its image is
  pinned by digest, so it only changes when the digest in that file is bumped by hand. If that
  access isn't acceptable, don't deploy it and update by hand (or through the Portainer webhook in
  Settings → Updates).

## Password strength

New passwords (first login, change password, both reset flows) are checked against
HaveIBeenPwned's breach database if `HIBP_PASSWORD_CHECK=1` is set — a k-anonymity range query
(only the first 5 hex chars of the password's SHA1 hash ever leave this server; see
`backend/src/services/pwnedPassword.ts`). **Off by default**: this app is otherwise fully
self-hosted with no required outbound internet access, and this feature means an outbound HTTPS
call on every password change — deliberately opt-in rather than a silent default, so an
air-gapped install or one that shouldn't make that call doesn't have to. The check fails open
(doesn't block the password change) on any network/API error.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/HexLions/RackTemp/security/advisories/new)
on this repository, or open a regular issue if you'd rather not use that flow (please still avoid
posting exploit details in a public issue for anything more than a low-severity finding — mention
that you have something sensitive to report and a maintainer will follow up for details privately).
There's no bug bounty — this is a single-maintainer hobby project — but reports are read and acted
on.
