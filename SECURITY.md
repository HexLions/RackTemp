# Security

## Threat model

RackTemp is built for a self-hosted deployment on a **trusted home/office LAN**, administered by
a single account. It assumes the network it runs on is not actively hostile — anyone who can
reach the app's port can already see the WiFi network's traffic in general — and focuses its
security work on the things a LAN doesn't protect against on its own: weak or guessable
credentials, session/cookie handling, unattended supply-chain updates (Docker image, Watchtower),
and firmware/OTA integrity for the ESP32 sensors.

**What it does not protect against:** a hostile actor already on the LAN with time and intent
(ARP/DNS spoofing, packet capture) can still disrupt an unencrypted HTTP deployment or intercept
sensor readings in transit; this is a monitoring tool for rack temperature/humidity, not a
system handling regulated or high-value data, and its defenses are scoped accordingly. Exposing
an instance directly to the internet, or onto an untrusted/shared network, needs the extra steps
in the [README](./README.md) — the Security section there covers reverse proxy + HTTPS, or the
built-in self-signed HTTPS toggle. Running it bare on an untrusted network is not a supported
configuration.

**Secrets at rest are not encrypted.** The SQLite database (and any backup taken from it, on-demand
or scheduled) stores the admin password as a bcrypt hash, but stores TOTP secrets, SMTP/Telegram/
Graph credentials, PRTG tokens, and every sensor's API key in plain form. A backup emailed out
(Settings → Backup) carries all of that off the server as an unencrypted attachment — the UI warns
about this next to the toggle, but it's worth restating here: only enable email backups to a
mailbox you trust as much as the server itself, and treat the `.sqlite` file the same as any of
the credentials inside it.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/HexLions/RackTemp/security/advisories/new)
on this repository, or open a regular issue if you'd rather not use that flow (please still avoid
posting exploit details in a public issue for anything more than a low-severity finding — mention
that you have something sensitive to report and a maintainer will follow up for details privately).
There's no bug bounty — this is a single-maintainer hobby project — but reports are read and acted
on.
