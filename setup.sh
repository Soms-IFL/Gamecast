#!/usr/bin/env bash
# IFL Simulator - Linux setup (VPS, home server, Minecraft box)
# Run from the IFL folder:   bash setup.sh
# Optional flags for unattended use:  --port 3000 --password secret --yes --no-service --no-firewall
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
CONFIG="$DIR/data/config.json"

PORT_ARG=""; PASS_ARG=""; YES=0; NO_SERVICE=0; NO_FIREWALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT_ARG="${2:-}"; shift 2 ;;
    --password) PASS_ARG="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-service) NO_SERVICE=1; shift ;;
    --no-firewall) NO_FIREWALL=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

c_ok="\033[32m"; c_warn="\033[33m"; c_err="\033[31m"; c_head="\033[36m"; c_off="\033[0m"
say()  { printf "%b\n" "$*"; }
ok()   { say "${c_ok}      $*${c_off}"; }
warn() { say "${c_warn}      $*${c_off}"; }
ask() { # ask "question" default -> echoes answer
  local q="$1" def="$2" a
  if [ "$YES" = 1 ]; then echo "$def"; return; fi
  read -r -p "      $q [$def] " a </dev/tty || true
  echo "${a:-$def}"
}
yesno() { # yesno "question" Y|N -> exit status 0 for yes
  local q="$1" def="$2" a hint
  if [ "$YES" = 1 ]; then [ "$def" = Y ]; return; fi
  if [ "$def" = Y ]; then hint="Y/n"; else hint="y/N"; fi
  read -r -p "      $q [$hint] " a </dev/tty || true
  a="${a:-$def}"
  case "$a" in [Yy]*) return 0 ;; *) return 1 ;; esac
}
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi
node_major() {
  if command -v node >/dev/null 2>&1; then node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; else echo 0; fi
}

say ""
say "${c_head}  ==============================================${c_off}"
say "${c_head}    IFL Simulator - International Football League${c_off}"
say "${c_head}    Linux setup${c_off}"
say "${c_head}  ==============================================${c_off}"
say ""

# ---------------------------------------------------------------- 1. Node.js
say "[1/4] Checking for Node.js..."
MAJOR="$(node_major)"
if [ "$MAJOR" -ge 18 ]; then
  ok "Found Node.js v$MAJOR. Good."
else
  if [ "$MAJOR" -gt 0 ]; then warn "Node.js v$MAJOR is too old (need 18 or newer)."; else warn "Node.js is not installed."; fi
  if yesno "Install Node.js LTS now? (uses your package manager, may ask for your sudo password)" Y; then
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get update -y
      $SUDO apt-get install -y ca-certificates curl
      curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO bash -
      $SUDO apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
      $SUDO dnf install -y nodejs
    elif command -v yum >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
      $SUDO yum install -y nodejs
    elif command -v pacman >/dev/null 2>&1; then
      $SUDO pacman -Sy --noconfirm nodejs
    elif command -v apk >/dev/null 2>&1; then
      $SUDO apk add --no-cache nodejs
    else
      warn "Couldn't find a supported package manager."
    fi
  fi
  MAJOR="$(node_major)"
  if [ "$MAJOR" -lt 18 ]; then
    say "${c_err}      Node.js 18+ is still missing. Install it (https://nodejs.org) and run this again.${c_off}"
    exit 1
  fi
  ok "Node.js v$MAJOR installed."
fi
NODE_BIN="$(command -v node)"

# ---------------------------------------------------------------- 2. Settings
say ""
say "[2/4] Settings"
mkdir -p "$DIR/data"
cfg_get() { [ -f "$CONFIG" ] && node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());process.stdout.write(String(c[process.argv[2]]??""))}catch(e){}' "$CONFIG" "$1" || true; }
OLD_PORT="$(cfg_get port)"; OLD_PASS="$(cfg_get adminPassword)"
PORT="$PORT_ARG"
if [ -z "$PORT" ]; then
  while true; do
    PORT="$(ask "Port for the website" "${OLD_PORT:-3000}")"
    if [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ]; then break; fi
    warn "Please enter a number between 1 and 65535."
    YES=0
  done
fi
if [ "$PORT" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then warn "Ports below 1024 need root. Consider 3000 or 8080."; fi

PASS="$PASS_ARG"
if [ -z "$PASS" ]; then
  if [ -n "$OLD_PASS" ] && yesno "Keep the current admin password?" Y; then
    PASS="$OLD_PASS"
  else
    if [ "$YES" = 1 ]; then PASS=""; else read -r -p "      Choose an admin password (leave empty to generate one) " PASS </dev/tty || true; fi
    if [ -z "$PASS" ]; then
      PASS="$(node -e 'const c="abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(const b of require("crypto").randomBytes(12))s+=c[b%c.length];process.stdout.write(s)')"
      ok "Generated admin password: $PASS"
    fi
  fi
fi
IFL_PORT="$PORT" IFL_PASS="$PASS" node -e '
  const fs = require("fs"), f = process.argv[1];
  let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8").trim()); } catch (e) {}
  c.port = +process.env.IFL_PORT; c.host = c.host || "0.0.0.0"; c.adminPassword = process.env.IFL_PASS;
  fs.writeFileSync(f, JSON.stringify(c, null, 2));' "$CONFIG"
chmod 600 "$CONFIG"
ok "Saved to data/config.json"

cat > "$DIR/start.sh" <<EOF
#!/usr/bin/env bash
# Start the IFL Simulator in this terminal (Ctrl+C to stop).
cd "\$(dirname "\$0")"
exec node server.js
EOF
chmod +x "$DIR/start.sh"
ok "Created start.sh"

# ---------------------------------------------------------------- 3. Background service
say ""
say "[3/4] Background service"
SERVICE=0
if [ "$NO_SERVICE" = 0 ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  if yesno "Run the league as a background service (starts on boot, restarts if it crashes)?" Y; then
    RUN_USER="$(id -un)"
    if [ "$RUN_USER" = root ]; then warn "You're running as root; the service will run as root. A normal user account is safer."; fi
    UNIT="[Unit]
Description=IFL Simulator (International Football League)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$NODE_BIN $DIR/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target"
    echo "$UNIT" | $SUDO tee /etc/systemd/system/ifl.service >/dev/null
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable ifl >/dev/null 2>&1
    $SUDO systemctl restart ifl
    sleep 2
    if $SUDO systemctl is-active --quiet ifl; then ok "Service 'ifl' is running and will start on boot."; SERVICE=1
    else warn "The service didn't start. Check: sudo journalctl -u ifl -n 50"; fi
  fi
else
  warn "No systemd here (or skipped). Use ./start.sh to run it; keep it alive with screen or tmux."
fi

# ---------------------------------------------------------------- 4. Firewall
say ""
say "[4/4] Firewall"
if [ "$NO_FIREWALL" = 0 ]; then
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    if yesno "Open TCP port $PORT in ufw?" Y; then $SUDO ufw allow "$PORT/tcp" >/dev/null && ok "Opened port $PORT in ufw."; fi
  elif command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    if yesno "Open TCP port $PORT in firewalld?" Y; then $SUDO firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null && $SUDO firewall-cmd --reload >/dev/null && ok "Opened port $PORT in firewalld."; fi
  else
    ok "No active ufw/firewalld firewall found."
  fi
fi
say "      On a cloud VPS, also allow TCP $PORT in the provider's firewall / security group."

# ---------------------------------------------------------------- Done
IPS="$(hostname -I 2>/dev/null || true)"
say ""
say "${c_ok}  Setup complete!${c_off}"
say ""
say "    Open the league:   http://localhost:$PORT"
for ip in $IPS; do case "$ip" in *:*) ;; *) say "    Network address:   http://$ip:$PORT" ;; esac; done
say "    Admin password:    saved in data/config.json"
if [ "$SERVICE" = 1 ]; then
  say "    Status:            sudo systemctl status ifl"
  say "    Live log:          sudo journalctl -u ifl -f"
  say "    Restart / stop:    sudo systemctl restart ifl   /   sudo systemctl stop ifl"
else
  say "    Start it:          ./start.sh"
fi
say ""
