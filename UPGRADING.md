# Upgrading

Notes for existing installations affected by breaking or semi-breaking changes
in security remediation work. Ordered by the phase that introduced them.

## Docker: container now runs as a non-root user (FASE 1.4)

The `rack-temp-monitor` container now runs as `node` (uid 1000) instead of
root. If your `rack-temp-data` volume was created by an earlier version
(root-owned files), the app will fail to write to it after upgrading.

Fix, before starting the new version:

```bash
docker compose down
docker run --rm -v rack-temp-data:/data alpine chown -R 1000:1000 /data
docker compose up -d
```

If you're not sure whether this applies to you: it's harmless to run even if
the volume is already owned correctly.

## Sensor API keys / PRTG token: rotate the weak (cuid-based) ones (FASE 3.1)

Sensor API keys and the PRTG integration token used to default to `cuid()` —
not meant to be unguessable credential material (it's k-sortable, embeds a
timestamp and a process/host fingerprint). New sensors/tokens are now
generated with 32 random bytes instead.

Existing installations aren't rotated automatically — run this once after
upgrading:

```bash
cd backend
npm run rotate-keys
```

It only touches keys still in the old cuid format (safe to re-run; does
nothing on a second run) and prints each rotated sensor's new key. **Every
sensor it rotates needs that new key pasted into its setup portal** (hold
BOOT for 2s after boot to reopen it) — until then, that sensor's readings
will be rejected (401) since the server no longer recognizes its old key.
Same for the PRTG token, if it gets rotated: update it in your PRTG sensor
URL(s).
