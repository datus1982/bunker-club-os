#!/usr/bin/env bash
# =============================================================================
#  bunker-nuc-backup.sh - disaster-recovery backup of the bar's mini PC
# =============================================================================
#  Runs on Stephen's MAC. Pulls the NUC's *identity and configuration* over SSH
#  and writes a dated tarball to ~/BunkerCuration/nuc-backup/.
#
#  It does NOT back up the media library (~1.8 TB on D:). That is re-shippable
#  (see docs/runbooks/nuc-disaster-recovery.md section "Restoring the media").
#  What it backs up is the part that CANNOT be regenerated:
#
#    - Syncthing's device identity  (cert.pem / key.pem / config.xml)
#      -> restoring these makes the Mac re-pair automatically, no re-add dance
#    - the media shell's config.json (device token) + catalog/thumb caches
#    - sshd's host keys + authorized_keys (so `ssh` keeps working, no
#      "REMOTE HOST IDENTIFICATION HAS CHANGED" and no re-provisioning)
#    - an inventory manifest (versions, drives, services, tasks, autostart,
#      autologon, power, Defender, firewall, hardware)
#    - a compressed listing of D:\bunkerClub (paths + sizes + mtimes) so a
#      restore can be verified film-by-film
#
#  READ-ONLY on the PC. It runs PowerShell that only reads; nothing is written,
#  started, stopped or created on the appliance. Safe during service, though a
#  quiet morning is still the polite choice (heartbeat-first discipline).
#
#  Idempotent: run it as often as you like. Keeps the last KEEP tarballs.
#
#  Usage:   scripts/bunker-nuc-backup.sh [--quiet]
#  Env:     BUNKER_NUC_HOST   default admin@100.68.29.108   (tailnet address)
#           BUNKER_NUC_KEY    default ~/.ssh/bunker_pc_ed25519
#           BUNKER_NUC_BACKUP_DIR  default ~/BunkerCuration/nuc-backup
#           BUNKER_NUC_KEEP   default 8
#
#  !! The tarball CONTAINS SECRETS (media device token, Syncthing private key,
#     sshd host private keys). It is written 0600 inside a 0700 directory and
#     must never be committed, emailed, or copied to shared storage.
# =============================================================================

set -uo pipefail

NUC_HOST="${BUNKER_NUC_HOST:-admin@100.68.29.108}"
SSH_KEY="${BUNKER_NUC_KEY:-$HOME/.ssh/bunker_pc_ed25519}"
BACKUP_DIR="${BUNKER_NUC_BACKUP_DIR:-$HOME/BunkerCuration/nuc-backup}"
KEEP="${BUNKER_NUC_KEEP:-8}"
LOG="$BACKUP_DIR/nuc-backup.log"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

STAMP="$(date +%Y%m%d-%H%M%S)"
TARBALL="$BACKUP_DIR/nuc-backup-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

WARNINGS=0
ERRORS=0

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"
}
warn() { WARNINGS=$((WARNINGS + 1)); log "WARN  $*"; }
fail() { ERRORS=$((ERRORS + 1));   log "ERROR $*"; }

STAGE=""
cleanup() { [ -n "$STAGE" ] && rm -rf "$STAGE"; }
trap cleanup EXIT

# --- remote helpers ----------------------------------------------------------
# Feed a PowerShell script on stdin; get its stdout back. Nothing is written on
# the PC - no temp files, no redirects, no state.
#
# Why the base64 dance instead of plain `powershell -Command -`:
#   `-Command -` parses stdin the way an interactive console does and SILENTLY
#   STOPS at the first multi-line block (a `... | ForEach-Object {` spanning
#   lines) - everything after it is dropped with no error and exit status 0.
#   That produced a truncated manifest on the first run here. Encoding the whole
#   script and Invoke-Expression'ing it on the far side executes it as one
#   script, and keeps the ssh command line far below cmd.exe's 8191-char limit
#   (the script itself rides stdin, not the command line).
REMOTE_STUB='powershell -NoProfile -Command "$b=[Console]::In.ReadLine(); Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))"'

remote_ps() {
  local b64
  b64="$(openssl base64 -A)" || return 1
  printf '%s\n' "$b64" \
    | ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 \
          -i "$SSH_KEY" "$NUC_HOST" "$REMOTE_STUB"
}

# fetch_file <remote-path> <local-path> <required|optional>
# Reads the file as base64 (binary-safe, CRLF-proof) and decodes it here.
fetch_file() {
  local remote="$1" dest="$2" need="${3:-required}"
  mkdir -p "$(dirname "$dest")"
  printf '%s\n' \
    "\$ErrorActionPreference='Stop'; [Convert]::ToBase64String([IO.File]::ReadAllBytes('$remote'))" \
  | remote_ps 2>/dev/null | tr -d '\r\n ' | openssl base64 -d -A > "$dest" 2>/dev/null
  if [ -s "$dest" ]; then
    log "  ok   $(basename "$dest")  ($(wc -c < "$dest" | tr -d ' ') bytes)"
    return 0
  fi
  rm -f "$dest"
  if [ "$need" = "required" ]; then fail "could not read $remote"; else warn "absent (optional): $remote"; fi
  return 1
}

# --- preflight ---------------------------------------------------------------
log "==== NUC backup $STAMP -> $(basename "$TARBALL")"

if [ ! -f "$SSH_KEY" ]; then
  fail "ssh key not found: $SSH_KEY"; exit 1
fi

HOSTNAME_REMOTE="$(printf '%s\n' '$env:COMPUTERNAME' | remote_ps 2>/dev/null | tr -d '\r\n')"
if [ -z "$HOSTNAME_REMOTE" ]; then
  fail "cannot reach $NUC_HOST over SSH (is Tailscale up on this Mac? is the PC on?)"
  exit 1
fi
log "connected to $HOSTNAME_REMOTE as $NUC_HOST"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/nuc-backup.XXXXXX")"
chmod 700 "$STAGE"
ROOT="$STAGE/nuc-backup-$STAMP"
mkdir -p "$ROOT"/{syncthing,media-shell,ssh,inventory}

# Resolve the profile-dependent paths on the PC rather than hardcoding
# "admin.BUNKERCLUB-NUC" - the profile folder name changes if the account is
# ever recreated. One path per line - they contain spaces, so no word splitting.
REMOTE_PATHS="$(printf '%s\n%s\n' \
  '$env:LOCALAPPDATA + "\Syncthing"' \
  '$env:APPDATA + "\Bunker Media Shell"' \
  | remote_ps 2>/dev/null | tr -d '\r')"
ST_HOME="$(printf '%s\n' "$REMOTE_PATHS" | sed -n '1p')"
SHELL_APPDATA="$(printf '%s\n' "$REMOTE_PATHS" | sed -n '2p')"

if [ -z "${ST_HOME:-}" ] || [ -z "${SHELL_APPDATA:-}" ]; then
  fail "could not resolve remote profile paths"; exit 1
fi
log "syncthing home: $ST_HOME"
log "shell appdata:  $SHELL_APPDATA"

# --- 1. Syncthing identity (the crown jewel) ---------------------------------
log "-- syncthing identity"
fetch_file "$ST_HOME\\config.xml"     "$ROOT/syncthing/config.xml"     required
fetch_file "$ST_HOME\\cert.pem"       "$ROOT/syncthing/cert.pem"       required
fetch_file "$ST_HOME\\key.pem"        "$ROOT/syncthing/key.pem"        required
fetch_file "$ST_HOME\\https-cert.pem" "$ROOT/syncthing/https-cert.pem" optional
fetch_file "$ST_HOME\\https-key.pem"  "$ROOT/syncthing/https-key.pem"  optional
# index-v2/ is deliberately NOT backed up - ~95 MB of rebuildable index.

# --- 2. media shell ----------------------------------------------------------
log "-- media shell"
fetch_file "$SHELL_APPDATA\\config.json"        "$ROOT/media-shell/config.json"        required
fetch_file "$SHELL_APPDATA\\catalog-cache.json" "$ROOT/media-shell/catalog-cache.json" optional
fetch_file "$SHELL_APPDATA\\sent-thumbs.json"   "$ROOT/media-shell/sent-thumbs.json"   optional

# --- 3. sshd -----------------------------------------------------------------
log "-- sshd keys and config"
fetch_file 'C:\ProgramData\ssh\administrators_authorized_keys' "$ROOT/ssh/administrators_authorized_keys" required
fetch_file 'C:\ProgramData\ssh\sshd_config'                    "$ROOT/ssh/sshd_config"                    required
for k in ssh_host_ed25519_key ssh_host_ecdsa_key ssh_host_rsa_key; do
  fetch_file "C:\\ProgramData\\ssh\\$k"     "$ROOT/ssh/$k"     optional
  fetch_file "C:\\ProgramData\\ssh\\$k.pub" "$ROOT/ssh/$k.pub" optional
done

# --- 4. inventory manifest ---------------------------------------------------
log "-- inventory manifest"
remote_ps > "$ROOT/inventory/manifest.txt" 2>/dev/null <<'PSMANIFEST'
$ErrorActionPreference='SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
Write-Output "BUNKER NUC INVENTORY - generated $(Get-Date -Format s)"
Write-Output ""
Write-Output "== IDENTITY =="
Write-Output ("  hostname        : {0}" -f $env:COMPUTERNAME)
Write-Output ("  os              : {0} build {1}" -f $os.Caption, $os.Version)
Write-Output ("  timezone        : {0}" -f (Get-TimeZone).Id)
Write-Output ("  last boot       : {0}" -f $os.LastBootUpTime)
Write-Output ("  model           : {0} / {1}" -f $cs.Manufacturer, $cs.Model)
Write-Output ("  cpu             : {0}" -f (Get-CimInstance Win32_Processor).Name)
Write-Output ("  ram gb          : {0}" -f [math]::Round($cs.TotalPhysicalMemory/1GB,1))
Write-Output ("  bios            : {0}" -f (Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion)
Write-Output ""
Write-Output "== DRIVES =="
Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -eq 3 | ForEach-Object {
  Write-Output ("  {0} {1,-6} {2,8:N1} GB total {3,8:N1} GB free  label='{4}'" -f $_.DeviceID,$_.FileSystem,($_.Size/1GB),($_.FreeSpace/1GB),$_.VolumeName)
}
Get-CimInstance Win32_DiskDrive | ForEach-Object {
  Write-Output ("  physical: {0,-30} {1,8:N1} GB  {2}" -f $_.Model,($_.Size/1GB),$_.InterfaceType)
}
Write-Output ""
Write-Output "== KEY SOFTWARE VERSIONS =="
$shellExe = "$env:LOCALAPPDATA\Programs\Bunker Media Shell\Bunker Media Shell.exe"
if (Test-Path $shellExe) { Write-Output ("  media shell exe : {0}" -f (Get-Item $shellExe).VersionInfo.ProductVersion) }
Write-Output ("  syncthing       : {0}" -f ((& 'C:\Syncthing\syncthing.exe' --version 2>&1) -join ' '))
Write-Output ("  tailscale       : {0}" -f ((& 'C:\Program Files\Tailscale\tailscale.exe' version 2>&1 | Select-Object -First 1)))
Write-Output ""
Write-Output "== INSTALLED PROGRAMS =="
$up = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
Get-ItemProperty $up | Where-Object { $_.DisplayName } |
  Select-Object DisplayName,DisplayVersion,Publisher | Sort-Object DisplayName -Unique |
  ForEach-Object { Write-Output ("  {0,-62} {1,-18} {2}" -f $_.DisplayName,$_.DisplayVersion,$_.Publisher) }
Write-Output ""
Write-Output "== SERVICES (auto-start, non-Microsoft path) =="
Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName -notmatch 'WINDOWS\\system32|WINDOWS\\System32' } |
  Sort-Object Name | ForEach-Object { Write-Output ("  {0,-40} {1,-8} {2}" -f $_.Name,$_.State,$_.PathName) }
Write-Output ""
Write-Output "== SCHEDULED TASKS (non-Microsoft) =="
Get-ScheduledTask | Where-Object { $_.TaskPath -notmatch '^\\Microsoft' } | Sort-Object TaskName | ForEach-Object {
  $act = ($_.Actions | ForEach-Object { ($_.Execute + ' ' + $_.Arguments).Trim() }) -join ' ; '
  $trg = ($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task','' }) -join ','
  Write-Output ("  [{0}] {1}{2}  user={3} run={4} trig={5}" -f $_.State,$_.TaskPath,$_.TaskName,$_.Principal.UserId,$_.Principal.RunLevel,$trg)
  Write-Output ("        -> {0}" -f $act)
}
Write-Output ""
Write-Output "== AUTOSTART (Run keys + Startup folders) =="
foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run')) {
  Write-Output ("  [{0}]" -f $k)
  $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
  if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { Write-Output ("      {0} = {1}" -f $_.Name,$_.Value) } }
}
foreach ($d in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup","$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup")) {
  Write-Output ("  [startup folder] {0}" -f $d)
  Get-ChildItem $d -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object { Write-Output ("      {0}" -f $_.Name) }
}
Write-Output ""
Write-Output "== AUTOLOGON =="
$w = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
Write-Output ("  AutoAdminLogon   : {0}" -f $w.AutoAdminLogon)
Write-Output ("  DefaultUserName  : {0}" -f $w.DefaultUserName)
Write-Output ("  DefaultDomainName: {0}" -f $w.DefaultDomainName)
Write-Output ("  Shell            : {0}" -f $w.Shell)
Write-Output ("  password stored in registry: {0}  (netplwiz keeps it as an LSA secret - NOT recoverable here, re-enter by hand on rebuild)" -f [bool]$w.DefaultPassword)
Write-Output ""
Write-Output "== LOCAL USERS =="
Get-LocalUser | ForEach-Object { Write-Output ("  {0,-20} enabled={1}" -f $_.Name,$_.Enabled) }
Write-Output ""
Write-Output "== POWER =="
Write-Output ("  {0}" -f (powercfg /getactivescheme))
Write-Output "  sleep idle (0 = never):"
(powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Select-String 'Current AC|Current DC') | ForEach-Object { Write-Output ("      " + $_.ToString().Trim()) }
Write-Output "  display idle (0 = never):"
(powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE 2>&1 | Select-String 'Current AC|Current DC') | ForEach-Object { Write-Output ("      " + $_.ToString().Trim()) }
Write-Output ""
Write-Output "== DEFENDER =="
Write-Output ("  realtime protection : {0}" -f (Get-MpComputerStatus).RealTimeProtectionEnabled)
Write-Output ("  exclusion paths     : {0}" -f ((Get-MpPreference).ExclusionPath -join '; '))
Write-Output ""
Write-Output "== FIREWALL (inbound allow, project-relevant) =="
Get-NetFirewallRule -Direction Inbound -Action Allow -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'SSH|Syncthing|Tailscale|Bunker|Dante|Sennheiser|RemotePC' } |
  Sort-Object DisplayName | ForEach-Object { Write-Output ("  [{0}] {1}  profile={2}" -f $_.Enabled,$_.DisplayName,$_.Profile) }
Write-Output ""
Write-Output "== NETWORK =="
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  ForEach-Object { Write-Output ("  {0,-18} {1}/{2}" -f $_.InterfaceAlias,$_.IPAddress,$_.PrefixLength) }
Write-Output "  tailscale peers:"
(& 'C:\Program Files\Tailscale\tailscale.exe' status 2>&1) | ForEach-Object { Write-Output ("      " + $_) }
Write-Output ""
Write-Output "== SYNCTHING FOLDER SHAPE (secrets omitted) =="
[xml]$cfg = Get-Content "$env:LOCALAPPDATA\Syncthing\config.xml" -ErrorAction SilentlyContinue
if ($cfg) {
  foreach ($f in $cfg.configuration.folder) {
    Write-Output ("  folder id={0} label='{1}' path='{2}' type={3} ignoreDelete={4} rescanIntervalS={5} paused={6}" -f $f.id,$f.label,$f.path,$f.type,$f.ignoreDelete,$f.rescanIntervalS,$f.paused)
  }
  foreach ($d in $cfg.configuration.device) {
    Write-Output ("  device {0} name='{1}'" -f $d.id,$d.name)
  }
  Write-Output ("  gui address={0} apikey-present={1}" -f $cfg.configuration.gui.address,[bool]$cfg.configuration.gui.apikey)
}
Write-Output ""
Write-Output "== MEDIA LIBRARY =="
$mediaDir = 'D:\bunkerClub'
try {
  $cj = Get-Content "$env:APPDATA\Bunker Media Shell\config.json" -Raw -ErrorAction Stop | ConvertFrom-Json
  if ($cj.mediaDir) { $mediaDir = $cj.mediaDir }
  Write-Output ("  shell slug      : {0}" -f $cj.slug)
  Write-Output ("  shell mediaDir  : {0}" -f $cj.mediaDir)
  Write-Output ("  shell port      : {0}" -f $cj.port)
  Write-Output ("  catalogUrl      : {0}" -f $cj.catalogUrl)
  Write-Output ("  appUrl          : {0}" -f $cj.appUrl)
  Write-Output ("  deviceToken     : <present, {0} chars - value deliberately not printed>" -f $cj.deviceToken.Length)
} catch { Write-Output "  (config.json unreadable)" }
$mf = Get-ChildItem $mediaDir -Recurse -File -ErrorAction SilentlyContinue
$sum = ($mf | Measure-Object Length -Sum).Sum
Write-Output ("  files           : {0}" -f $mf.Count)
Write-Output ("  bytes           : {0}  ({1:N1} GiB)" -f $sum, ($sum/1GB))
Write-Output ("  playlist folders: {0}" -f (Get-ChildItem $mediaDir -Directory -ErrorAction SilentlyContinue).Count)
PSMANIFEST

if [ -s "$ROOT/inventory/manifest.txt" ]; then
  log "  ok   manifest.txt  ($(wc -l < "$ROOT/inventory/manifest.txt" | tr -d ' ') lines)"
else
  fail "manifest generation produced nothing"
fi

# --- 5. media library listing ------------------------------------------------
log "-- media library listing"
remote_ps 2>/dev/null > "$STAGE/media-listing.tsv" <<'PSLISTING'
$ErrorActionPreference='SilentlyContinue'
$mediaDir = 'D:\bunkerClub'
try {
  $cj = Get-Content "$env:APPDATA\Bunker Media Shell\config.json" -Raw -ErrorAction Stop | ConvertFrom-Json
  if ($cj.mediaDir) { $mediaDir = $cj.mediaDir }
} catch {}
$root = $mediaDir.TrimEnd('\') + '\'
Write-Output "relative_path`tbytes`tmtime_utc"
Get-ChildItem $mediaDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("{0}`t{1}`t{2}" -f $_.FullName.Replace($root,''), $_.Length, $_.LastWriteTimeUtc.ToString('s'))
}
PSLISTING

if [ -s "$STAGE/media-listing.tsv" ]; then
  tr -d '\r' < "$STAGE/media-listing.tsv" | gzip -9 > "$ROOT/inventory/media-listing.tsv.gz"
  log "  ok   media-listing.tsv.gz  ($(( $(wc -l < "$STAGE/media-listing.tsv") - 1 )) files listed)"
else
  warn "media listing came back empty (is D: mounted?)"
fi

# --- 6. README inside the tarball -------------------------------------------
cat > "$ROOT/README.txt" <<READMEEOF
BUNKER NUC DISASTER-RECOVERY BACKUP
taken $STAMP from $HOSTNAME_REMOTE via $NUC_HOST

*** THIS ARCHIVE CONTAINS SECRETS. Do not commit it, mail it, or put it on
*** shared storage. Media device token, Syncthing private key, sshd host keys.

  syncthing/     device identity. Restore BEFORE the first Syncthing start on
                 the rebuilt machine - the device ID is derived from cert.pem,
                 so restoring it means the Mac already knows this peer and the
                 pairing survives untouched.
  media-shell/   config.json holds slug + device token + mediaDir. The two
                 caches only save a rescan; they are not required.
  ssh/           host keys + administrators_authorized_keys. Restoring the host
                 keys avoids the scary host-key-changed warning on the Mac.
  inventory/     manifest.txt  - what was installed, running and configured
                 media-listing.tsv.gz - every media file, size and mtime, for
                 verifying a restored library

Rebuild procedure: docs/runbooks/nuc-disaster-recovery.md
READMEEOF

# --- 7. pack + rotate --------------------------------------------------------
if [ "$ERRORS" -gt 0 ]; then
  fail "aborting before packing - $ERRORS required item(s) missing"
  log "==== FAILED ($ERRORS errors, $WARNINGS warnings)"
  exit 1
fi

( cd "$STAGE" && tar czf "$TARBALL" "nuc-backup-$STAMP" ) || { fail "tar failed"; exit 1; }
chmod 600 "$TARBALL"
SIZE="$(du -h "$TARBALL" | cut -f1 | tr -d ' ')"
log "packed $TARBALL ($SIZE)"

# rotation - keep the newest $KEEP
COUNT="$(ls -1 "$BACKUP_DIR"/nuc-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$BACKUP_DIR"/nuc-backup-*.tar.gz | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" && log "pruned $(basename "$old")"
  done
fi

log "==== OK  ($WARNINGS warnings) - $COUNT+ archives retained, keeping $KEEP"
exit 0
