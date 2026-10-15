#!/usr/bin/env bash
# Deploy gork on the VM. Run on the VM itself:
#
#   sudo bash /opt/gork/deploy/deploy.sh            # deploy origin/master
#   sudo bash deploy.sh                             # first install (bootstraps /opt/gork)
#
# Steps: ensure the gork user and checkout exist, fast-forward to origin/master,
# install dependencies, build, install the systemd unit, restart, then verify the
# bot actually logged in (not just that systemctl exited 0).
set -euo pipefail
# Braces make bash read the whole script before running it: the git merge below
# can replace this file mid-run.
{
cd /

REPO_URL="https://github.com/Bluefire2/gork.git"
BRANCH="master"
APP_DIR="/opt/gork"
APP_USER="gork"
APP_HOME="/var/lib/gork"   # npm cache etc. live here, outside the checkout
UNIT_NAME="gork.service"
READY_TIMEOUT=60

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# Run a command as the app user, from the app directory.
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $*"; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
command -v git >/dev/null || die "git is not installed"
[ -x /usr/bin/node ] || die "/usr/bin/node not found (the unit's ExecStart expects it there)"
command -v npm >/dev/null || die "npm is not installed"

# --- user and checkout ---------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "creating system user $APP_USER"
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi

if [ ! -d "$APP_DIR/.git" ]; then
  log "cloning $REPO_URL into $APP_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" -H git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

# config.json holds secrets and is gitignored; it must be placed by hand.
if [ ! -f "$APP_DIR/config.json" ]; then
  die "$APP_DIR/config.json is missing. Create it from config.json.example, then:
  sudo chown $APP_USER:$APP_USER $APP_DIR/config.json && sudo chmod 600 $APP_DIR/config.json"
fi
chown "$APP_USER:$APP_USER" "$APP_DIR/config.json"
chmod 600 "$APP_DIR/config.json"

# --- update code ---------------------------------------------------------------
before="$(as_app git rev-parse HEAD)"
log "fetching origin/$BRANCH"
as_app git fetch --quiet origin "$BRANCH"
# --ff-only: refuse to deploy if someone edited files on the VM; fix by hand.
as_app git merge --ff-only --quiet "origin/$BRANCH" \
  || die "local checkout has diverged from origin/$BRANCH; inspect $APP_DIR with git status"
after="$(as_app git rev-parse HEAD)"
log "deploying $(as_app git log -1 --format="'%h %s'") (was ${before:0:7})"

# --- build ---------------------------------------------------------------------
log "installing dependencies"
as_app npm ci --no-audit --no-fund
log "building"
as_app npm run build

# --- install unit and restart --------------------------------------------------
unit_src="$APP_DIR/deploy/$UNIT_NAME"
unit_dst="/etc/systemd/system/$UNIT_NAME"
if ! cmp -s "$unit_src" "$unit_dst"; then
  log "installing $unit_dst"
  install -m 644 "$unit_src" "$unit_dst"
  systemctl daemon-reload
fi
systemctl enable --quiet "$UNIT_NAME"

# Remember where the journal is now, so we only look at logs from this start.
cursor="$(journalctl -u "$UNIT_NAME" -n 1 --show-cursor --quiet | sed -n 's/^-- cursor: //p' || true)"
started_at="$(date '+%Y-%m-%d %H:%M:%S')"
log "restarting $UNIT_NAME"
systemctl reset-failed "$UNIT_NAME" 2>/dev/null || true
systemctl restart "$UNIT_NAME"

# --- verify --------------------------------------------------------------------
# "Bot is ready!" is logged from the ClientReady handler in src/index.ts once the
# Discord login succeeds. Exit 0 from systemctl only means the process started.
log "waiting up to ${READY_TIMEOUT}s for the bot to log in"
for _ in $(seq "$READY_TIMEOUT"); do
  if [ -n "$cursor" ]; then
    logs="$(journalctl -u "$UNIT_NAME" --after-cursor="$cursor" --no-pager -o cat || true)"
  else
    logs="$(journalctl -u "$UNIT_NAME" --since "$started_at" --no-pager -o cat || true)"
  fi
  if grep -q "Bot is ready!" <<<"$logs"; then
    log "OK: $(grep -m1 "Logged in as" <<<"$logs" || echo "bot is ready")"
    log "running commit ${after:0:7}"
    exit 0
  fi
  # Keep waiting while starting or between restarts; stop once it has given up.
  state="$(systemctl show -p ActiveState --value "$UNIT_NAME" || true)"
  case "$state" in active|activating|reloading) ;; *) break ;; esac
  sleep 1
done

echo "[deploy] FAILED: bot did not report ready. Recent logs:" >&2
journalctl -u "$UNIT_NAME" -n 30 --no-pager >&2 || true
exit 1
}
