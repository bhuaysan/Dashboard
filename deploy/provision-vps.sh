#!/usr/bin/env bash
# Einmalig als root auf dem VPS ausführen. Keine Secrets einlesen oder ausgeben.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Bitte einmalig mit sudo ausführen.' >&2; exit 1; }
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null
docker compose version >/dev/null
id ben >/dev/null
if ! command -v nft >/dev/null; then
  apt-get update
  apt-get install -y nftables
fi
command -v visudo >/dev/null
install -d -o ben -g ben -m 0750 /opt/dashboard /opt/dashboard/releases /opt/dashboard/backups /var/lib/dashboard /var/lib/dashboard/static
install -d -o root -g ben -m 0750 /etc/dashboard
install -d -o root -g root -m 0755 /usr/local/libexec
if [[ ! -e /etc/dashboard/dashboard.env ]]; then
  (umask 027; cat > /etc/dashboard/dashboard.env <<'ENV'
PORT=7777
DASHBOARD_CONFIG=/data/config.json
DASHBOARD_STATIC=/data/static
DASHBOARD_WRITE_ALLOW=100.113.131.20,100.113.29.51
DASHBOARD_WRITE_HOSTS=100.113.86.223:8080,netcup.netbird.selfhosted:8080
ENV
  )
  chown root:ben /etc/dashboard/dashboard.env
fi
install -o root -g root -m 0644 dashboard-vps.nft /etc/dashboard/firewall.nft
/usr/sbin/nft --check -f /etc/dashboard/firewall.nft
install -o root -g root -m 0755 dashboard-vps-run /usr/local/libexec/dashboard-vps-run
install -o root -g root -m 0644 dashboard-vps.service dashboard-vps-firewall.service /etc/systemd/system/
# Nur die Bedienung des neuen Dienstes erlauben, keine allgemeine sudo-Freigabe.
sudoers_file="$(mktemp)"
trap 'rm -f -- "$sudoers_file"' EXIT
printf '%s\n' 'ben ALL=(root) NOPASSWD: /usr/bin/systemctl restart dashboard-vps.service, /usr/bin/systemctl stop dashboard-vps.service' > "$sudoers_file"
visudo -cf "$sudoers_file"
install -o root -g root -m 0440 "$sudoers_file" /etc/sudoers.d/dashboard-vps
systemctl daemon-reload
systemctl enable dashboard-vps-firewall.service dashboard-vps.service
systemctl restart dashboard-vps-firewall.service
if [[ -f /opt/dashboard/current/compose.vps.yaml ]]; then
  systemctl restart dashboard-vps.service
fi
printf '%s\n' 'VPS vorbereitet. Das Deployment kann jetzt als ben erfolgen.'
