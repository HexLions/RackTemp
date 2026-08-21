#!/usr/bin/env bash
# Uninstalls the RackTemp service. For the data in /var/lib/racktemp it asks
# for confirmation (if the terminal is interactive); by default it keeps it.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Root required: sudo ./uninstall.sh" >&2
  exit 1
fi

echo "== Stopping and removing the service =="
systemctl disable --now racktemp 2>/dev/null || true
rm -f /etc/systemd/system/racktemp.service
systemctl daemon-reload

echo "== Removing /opt/racktemp =="
rm -rf /opt/racktemp

KEEP_DATA=1
if [ -t 0 ]; then
  read -r -p "Also delete the data in /var/lib/racktemp (readings, sensors, thresholds, login)? [y/N] " ans
  case "$ans" in
    [yY]*) KEEP_DATA=0 ;;
  esac
fi

if [ "$KEEP_DATA" -eq 0 ]; then
  rm -rf /var/lib/racktemp
  echo "Data deleted."
else
  echo "Data kept in /var/lib/racktemp (you'll find it again if you reinstall)."
fi

userdel racktemp 2>/dev/null || true

if command -v ufw >/dev/null 2>&1; then
  ufw delete allow 7431/tcp || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --remove-port=7431/tcp || true
  firewall-cmd --reload || true
fi

echo "Done."
