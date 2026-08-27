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
