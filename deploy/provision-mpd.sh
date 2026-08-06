#!/usr/bin/env bash
# Einmalige Einrichtung des MPD-Containers music.home.arpa (CT 114, 10.0.10.21).
# Aufruf aus dem Projektverzeichnis:  ./deploy/provision-mpd.sh
# Musik kommt per NFS vom NAS (10.0.10.107:/Volume1/Media). Der Host mountet den
# Export (bereits in /etc/fstab als /mnt/nas/media) und reicht das Unterverzeichnis
# Music als Read-only-Bind-Mount in den unprivilegierten Container.
set -euo pipefail
PVE=root@10.0.10.10
CTID=114
CT_IP=10.0.10.21

ssh "$PVE" 'bash -se' <<'REMOTE'
set -euo pipefail

# --- NFS-Mount auf dem Host sicherstellen ---
mountpoint -q /mnt/nas/media || mount /mnt/nas/media
test -d /mnt/nas/media/Music || { echo "FEHLER: /mnt/nas/media/Music nicht lesbar (Squash auf dem NAS?)"; exit 1; }

# --- Container anlegen (idempotent: überspringen, wenn vorhanden) ---
if ! pct status 114 &>/dev/null; then
  pct create 114 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst \
    --hostname music.home.arpa --unprivileged 1 \
    --cores 1 --memory 512 --swap 0 \
    --rootfs local-lvm:8 \
    --net0 name=eth0,bridge=vmbr0,ip=10.0.10.21/24,gw=10.0.10.1 \
    --nameserver 10.0.10.11 --onboot 1
fi
# Aufräumen vom ursprünglichen In-Container-NFS-Ansatz, falls vorhanden
pct set 114 --delete features 2>/dev/null || true
grep -q '^mp0:' /etc/pve/lxc/114.conf \
  || pct set 114 --mp0 volume=/mnt/nas/media/Music,mp=/var/lib/mpd/music,ro=1
pct start 114 2>/dev/null || true
REMOTE

# --- MPD installieren und konfigurieren ---
ssh "$PVE" 'bash -se' <<'REMOTE'
set -euo pipefail
pct exec 114 -- bash -se <<'CT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Reste des In-Container-NFS-Ansatzes entfernen
sed -i '\|10.0.10.107:/Volume1/Media|d' /etc/fstab
umount /mnt/media 2>/dev/null || true
rmdir /mnt/media 2>/dev/null || true

apt update && apt install -y mpd mpc
systemctl stop mpd || true

cat > /etc/mpd.conf <<'CONF'
music_directory     "/var/lib/mpd/music"
playlist_directory  "/var/lib/mpd/playlists"
db_file             "/var/lib/mpd/database"
log_file            "/var/log/mpd/mpd.log"
pid_file            "/run/mpd/pid"
state_file          "/var/lib/mpd/state"
sticker_file        "/var/lib/mpd/sticker.sql"
user                "mpd"
bind_to_address     "0.0.0.0"
port                "6600"
auto_update         "yes"

audio_output {
    type        "httpd"
    name        "HTTP-Stream"
    encoder     "vorbis"
    port        "8000"
    bitrate     "192"
    format      "44100:16:2"
    always_on   "yes"
}
CONF

mkdir -p /var/lib/mpd/playlists
chown -R mpd:audio /var/lib/mpd 2>/dev/null || true
systemctl enable --now mpd
CT
REMOTE

# --- Verifikation ---
echo "--- mpc status ---"
ssh "$PVE" 'pct exec 114 -- mpc status' || true
echo "--- Musikdateien als mpd-User lesbar? ---"
ssh "$PVE" "pct exec 114 -- su -s /bin/sh mpd -c 'ls /var/lib/mpd/music | head -5'"
echo
echo "Provisionierung fertig. Noch manuell: Pi-hole-Record music.home.arpa -> $CT_IP"
echo "sowie Snapshot von CT $CTID in Proxmox anlegen."
