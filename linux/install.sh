#!/usr/bin/env bash
# Installs RackTemp as a systemd service. Must be run (as root) from the
# folder extracted from the racktemp-linux-x64.tar.gz tarball — it uses paths
# relative to itself (node/, backend/, racktemp.service next to this
# script), there's no need to be in any particular location on the filesystem.
#
# Idempotent: rerunning it (e.g. after extracting a newer version
# of the tarball) updates the program without touching the existing data in
# /var/lib/racktemp nor regenerating the SESSION_SECRET that's already there.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Root required: sudo ./install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/racktemp"
DATA_DIR="/var/lib/racktemp/data"
ENV_FILE="$INSTALL_DIR/backend/.env"

echo "== Service user =="
if ! id racktemp >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin racktemp
  echo "Created system user 'racktemp'."
else
  echo "User 'racktemp' already present."
fi

echo "== Copying program files to $INSTALL_DIR =="
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/node" "$INSTALL_DIR/"
mkdir -p "$INSTALL_DIR/backend"
cp -r "$SCRIPT_DIR/backend/dist" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/public" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/node_modules" "$INSTALL_DIR/backend/"
cp -r "$SCRIPT_DIR/backend/prisma" "$INSTALL_DIR/backend/"
cp "$SCRIPT_DIR/backend/package.json" "$INSTALL_DIR/backend/package.json"

echo "== Data in $DATA_DIR =="
mkdir -p "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "== Generating configuration (.env) =="
  SESSION_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c48 /dev/urandom | base64)"
  cat > "$ENV_FILE" <<EOF
PORT=7431
DATABASE_URL=file:$DATA_DIR/db.sqlite
SESSION_SECRET=$SESSION_SECRET
DEPLOY_TARGET=linux
EOF
  chmod 600 "$ENV_FILE"
else
  echo "Existing .env, leaving it alone (update, not first install)."
fi

chown -R racktemp:racktemp "$INSTALL_DIR" /var/lib/racktemp

echo "== systemd service =="
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
echo "Done. RackTemp at http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):7431"
echo "Status:     systemctl status racktemp"
echo "Log:        journalctl -u racktemp -f"
echo "First login: admin / admin (you'll be asked to change it right away)."
