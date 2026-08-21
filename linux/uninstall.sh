#!/usr/bin/env bash
# Disinstalla il servizio RackTemp. Per i dati in /var/lib/racktemp chiede
# conferma (se il terminale è interattivo); di default li mantiene.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Serve root: sudo ./uninstall.sh" >&2
  exit 1
fi

echo "== Fermo e rimuovo il servizio =="
systemctl disable --now racktemp 2>/dev/null || true
rm -f /etc/systemd/system/racktemp.service
systemctl daemon-reload

echo "== Rimuovo /opt/racktemp =="
rm -rf /opt/racktemp

KEEP_DATA=1
if [ -t 0 ]; then
  read -r -p "Cancellare anche i dati in /var/lib/racktemp (letture, sensori, soglie, login)? [y/N] " ans
  case "$ans" in
    [yY]*) KEEP_DATA=0 ;;
  esac
fi

if [ "$KEEP_DATA" -eq 0 ]; then
  rm -rf /var/lib/racktemp
  echo "Dati cancellati."
else
  echo "Dati mantenuti in /var/lib/racktemp (reinstallando li ritrovi)."
fi

userdel racktemp 2>/dev/null || true

if command -v ufw >/dev/null 2>&1; then
  ufw delete allow 7431/tcp || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --remove-port=7431/tcp || true
  firewall-cmd --reload || true
fi

echo "Fatto."
