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

## Watchtower is no longer part of the default Portainer stack (FASE 5.1)

If you deployed `docker-compose.portainer.yml` before this change, it
included a `watchtower` service that auto-pulled and restarted
`rack-temp-monitor` on every new image. That service has moved to its own
file, [`docker-compose.watchtower.yml`](./docker-compose.watchtower.yml),
deployed separately — re-applying the updated `docker-compose.portainer.yml`
removes Watchtower from that stack. If you still want auto-updates, deploy
the new file as its own Portainer stack alongside the existing one; its
default (`WATCHTOWER_MONITOR_ONLY: "true"`) only notifies instead of
auto-applying — set it to `"false"` to keep the old auto-apply behavior.

Also from this phase: `ghcr.io/hexlions/racktemp:latest` now only moves on
a published release, not on every push to `main` — pull explicitly if you
were relying on `:latest` tracking the newest commit; that's now `:edge`.

## OTA firmware updates now check a SHA256 the server reports (FASE 4.2)

Only relevant if you've set `OTA_AUTO_UPDATE 1` in the firmware (off by
default). After upgrading the backend, re-upload the current `.bin` from
Settings → Firmware — the server now hashes it and serves that hash
alongside the version check. A sensor running firmware built before this
change doesn't call `setSHA256sum()` at all, so it's unaffected either way;
one reflashed after this change will refuse to self-update if the server
doesn't report a hash (fails closed rather than flashing an unverified
download), which only happens if the `.bin` was uploaded before this
backend version.
