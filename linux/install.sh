#!/usr/bin/env bash
# Installa RackTemp come servizio systemd. Va eseguito (come root) dalla
# cartella estratta dal tarball racktemp-linux-x64.tar.gz — usa i percorsi
# relativi a se stesso (node/, backend/, racktemp.service accanto a questo
# script), non serve essere in una posizione particolare del filesystem.
#
# Idempotente: rieseguirlo (es. dopo aver estratto una versione più recente
# del tarball) aggiorna il programma senza toccare i dati esistenti in
# /var/lib/racktemp né rigenerare il SESSION_SECRET già presente.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Serve root: sudo ./install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/racktemp"
DATA_DIR="/var/lib/racktemp/data"
ENV_FILE="$INSTALL_DIR/backend/.env"

echo "== Utente di servizio =="
if ! id racktemp >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin racktemp
  echo "Creato utente di sistema 'racktemp'."
else
  echo "Utente 'racktemp' già presente."
fi

echo "== Copia file programma in $INSTALL_DIR =="
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/node" "$INSTALL_DIR/"
mkdir -p "$INSTALL_DIR/backend"
cp -r "$SCRIPT_DIR/backend/dist" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/public" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/node_modules" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/prisma" "$INSTALL_DIR/backend/"
cp "$SCRIPT_DIR/backend/package.json" "$INSTALL_DIR/backend/package.json"

echo "== Dati in $DATA_DIR =="
mkdir -p "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "== Genero configurazione (.env) =="
  SESSION_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c48 /dev/urandom | base64)"
  cat > "$ENV_FILE" <<EOF
PORT=7431
DATABASE_URL=file:$DATA_DIR/db.sqlite
SESSION_SECRET=$SESSION_SECRET
DEPLOY_TARGET=linux
EOF
  chmod 600 "$ENV_FILE"
else
  echo ".env esistente, non lo tocco (aggiornamento, non prima installazione)."
fi

chown -R racktemp:racktemp "$INSTALL_DIR" /var/lib/racktemp

echo "== Servizio systemd =="
cp "$SCRIPT_DIR/racktemp.service" /etc/systemd/system/racktemp.service
systemctl daemon-reload
systemctl enable --now racktemp

echo "== Firewall (best-effort) =="
if command -v ufw >/dev/null 2>&1; then
  ufw allow 7431/tcp || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=7431/tcp || true
  firewall-cmd --reload || true
fi

echo ""
echo "Fatto. RackTemp su http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):7431"
echo "Stato:      systemctl status racktemp"
echo "Log:        journalctl -u racktemp -f"
echo "Primo accesso: admin / admin (te lo fa cambiare subito)."
