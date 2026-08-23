# =============================================================================
#  bunker-nuc-rebuild.ps1 - rebuild the bar's mini PC from a backup tarball
# =============================================================================
#
#  *** UNTESTED ON METAL. ***
#  Every path, URL, version and command in here was cross-checked against the
#  LIVE NUC on 2026-08-23, and the file parses cleanly. But it has never been
#  run end-to-end on a fresh Windows machine, because there is no spare box to
#  run it on. Treat the first real run as a supervised procedure with the
#  runbook open, not as a fire-and-forget installer. Read
#  docs/runbooks/nuc-disaster-recovery.md first.
#
#  WHAT IT DOES
#    Takes a fresh, already-installed Windows 11 machine with the media drive
#    attached, plus a backup tarball from scripts/bunker-nuc-backup.sh, and
#    turns it back into the Bunker appliance:
#      1. kiosk hardening          (vendored copy of the owner's gist)
#      2. OpenSSH                  (the proven standalone MSI script)
#         + restores the OLD HOST KEYS so the Mac sees the same machine
#      3. Tailscale                (silent MSI; auth is interactive or -AuthKey)
#      4. Syncthing                + RESTORES THE DEVICE IDENTITY BEFORE THE
#                                    FIRST START, so the Mac re-pairs by itself
#      5. Bunker Media Shell       + restores config.json (slug + device token)
#      6. verification pass
#
#  WHAT IT CANNOT DO - see the runbook's "What can't be scripted" section:
#    installing Windows, the Tailscale login (unless you mint an auth key),
#    the netplwiz auto-logon dialog, the BIOS power-on-after-failure setting,
#    and restoring the ~1.8 TB media library itself.
#
#  USAGE (Administrator PowerShell, on the NEW machine):
#    Set-ExecutionPolicy Bypass -Scope Process -Force
#    .\bunker-nuc-rebuild.ps1 -Backup D:\nuc-backup-20260823-115518.tar.gz
#
#  The backup tarball, this script, docs/runbooks/nuc-kiosk-hardening.ps1 and
#  docs/runbooks/media-courier-pc-ssh-standalone.ps1 must all be reachable from
#  the new machine (a USB stick is the expected delivery). By default the two
#  helper scripts are looked for next to this one and in a sibling
#  docs\runbooks\ folder.
#
#  !! The backup tarball CONTAINS SECRETS (media device token, Syncthing
#     private key, sshd host private keys). Wipe the USB stick afterwards.
# =============================================================================
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  # The nuc-backup-*.tar.gz produced by scripts/bunker-nuc-backup.sh
  [Parameter(Mandatory = $true)][string]$Backup,

  # Where the media library lives on THIS machine. Overridden automatically by
  # the mediaDir in the restored config.json when that path exists.
  [string]$MediaDir = 'D:\bunkerClub',

  # Optional Tailscale pre-auth key (mint one at
  # login.tailscale.com/admin/settings/keys). Without it, `tailscale up` opens
  # a browser and someone has to sign in as datus1982.
  [string]$TailscaleAuthKey = '',

  [switch]$SkipHardening,
  [switch]$SkipShell,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- pinned versions / URLs -------------------------------------------------
# Syncthing PINNED to what the live NUC runs (verified 2026-08-23: v2.1.3).
# Keep it within one minor of the Mac's Syncthing. To bump, check
# https://api.github.com/repos/syncthing/syncthing/releases/latest
$SyncthingVersion = 'v2.1.3'
$SyncthingUrl     = "https://github.com/syncthing/syncthing/releases/download/$SyncthingVersion/syncthing-windows-amd64-$SyncthingVersion.zip"

# Tailscale "latest" redirects to the current stable MSI (the NUC runs 1.102.3).
$TailscaleUrl     = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'

# Media shell v0.2.0. The ZIP is the PRIMARY path on purpose: the NSIS installer
# persistently failed its own CRC check on this exact machine class in the field
# (2026-07-20), byte-perfect file, /NCRC and Defender-off both tried. The ZIP
# carries the identical 8bb7c3c build. Both URLs were confirmed 200 on
# 2026-08-23.
$ShellZipUrl      = 'https://ysrqvdutayirpoibdlbf.supabase.co/storage/v1/object/public/signage/shell/BunkerMediaShell-0.2.0-win.zip'
$ShellExeUrl      = 'https://ysrqvdutayirpoibdlbf.supabase.co/storage/v1/object/public/signage/shell/BunkerMediaShell-Setup-0.2.0.exe'

# ---- fixed identities (must match the courier runbook) ----------------------
$MacDeviceId   = '646HY4I-MVL5OWS-P4HO4WW-ZI7AKCG-EWEPKTY-YOFFOYC-X2OX37N-3OML3AR'
$FolderId      = 'bunkerclub-media'
$SyncthingDir  = 'C:\Syncthing'
$SyncthingTask = 'Syncthing (Bunker Courier)'
$FwRuleName    = 'Syncthing (Bunker Courier)'

$ShellDir      = Join-Path $env:LOCALAPPDATA 'Programs\Bunker Media Shell'
$ShellData     = Join-Path $env:APPDATA 'Bunker Media Shell'
$SshDir        = 'C:\ProgramData\ssh'

# ---- output helpers ---------------------------------------------------------
$script:Warnings = New-Object System.Collections.ArrayList
function Head ($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Say  ($m) { Write-Host "   $m" }
function Ok   ($m) { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "   !   $m" -ForegroundColor Yellow; [void]$script:Warnings.Add($m) }

function Find-Helper([string]$name) {
  # Look next to this script, then in a sibling docs\runbooks, then two levels
  # up (repo root layout: <repo>\scripts\this.ps1 + <repo>\docs\runbooks\x.ps1).
  $here = Split-Path -Parent $PSCommandPath
  $candidates = @(
    (Join-Path $here $name),
    (Join-Path $here "docs\runbooks\$name"),
    (Join-Path (Split-Path -Parent $here) "docs\runbooks\$name"),
    (Join-Path $here "..\docs\runbooks\$name")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return (Resolve-Path $c).Path } }
  return $null
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " BUNKER NUC REBUILD   (UNTESTED ON METAL - follow the runbook)"  -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

# =============================================================================
# 0. Preflight - unpack and sanity-check the backup before touching anything
# =============================================================================
Head "0/7  Backup"

if (-not (Test-Path $Backup)) { throw "backup not found: $Backup" }
$Backup = (Resolve-Path $Backup).Path
Say "using $Backup"

# tar.exe (bsdtar) ships with Windows 10 1803+ and handles .tar.gz natively.
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
  throw "tar.exe not found. -Backup must point at the .tar.gz itself; a pre-extracted 'nuc-backup-*' folder is not accepted. Install tar (it ships with Windows 10 1803+) or use a machine that has it, then re-run."
}

$work = Join-Path $env:TEMP ("nuc-restore-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
& tar.exe -xzf "$Backup" -C "$work"
if ($LASTEXITCODE -ne 0) { throw "tar failed to extract $Backup" }

$R = Get-ChildItem $work -Directory | Where-Object { $_.Name -like 'nuc-backup-*' } | Select-Object -First 1
if (-not $R) { throw "the tarball did not contain a nuc-backup-* folder" }
$R = $R.FullName
Say "extracted to $R"

$required = @(
  'syncthing\config.xml','syncthing\cert.pem','syncthing\key.pem',
  'media-shell\config.json',
  'ssh\administrators_authorized_keys'
)
foreach ($f in $required) {
  $p = Join-Path $R $f
  if (-not (Test-Path $p) -or (Get-Item $p).Length -eq 0) { throw "backup is incomplete or empty: $f" }
}
Ok "backup contents verified"

# The restored config.json is the authority on slug / token / media path.
$shellCfgJson = Get-Content (Join-Path $R 'media-shell\config.json') -Raw
$shellCfg     = $shellCfgJson | ConvertFrom-Json
Say ("slug={0}  port={1}  mediaDir(from backup)={2}" -f $shellCfg.slug, $shellCfg.port, $shellCfg.mediaDir)

# Resolve the media directory for THIS machine. The drive letter can differ.
if ($shellCfg.mediaDir -and (Test-Path $shellCfg.mediaDir)) {
  $MediaDir = $shellCfg.mediaDir
} elseif (-not (Test-Path $MediaDir)) {
  Warn "neither the backup's mediaDir ($($shellCfg.mediaDir)) nor -MediaDir ($MediaDir) exists on this machine."
  Warn "Attach the media drive, or pin it to the old letter in Disk Management, then re-run."
  foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\$' })) {
    $cand = Join-Path $d.Root 'bunkerClub'
    if (Test-Path $cand) { Warn "  candidate found: $cand" }
  }
}
Say "MEDIA LIBRARY: $MediaDir"

if ($WhatIfOnly) {
  Head "WhatIfOnly - stopping here. Nothing was changed."
  Say "Backup unpacked at $R for inspection; delete it when done."
  return
}

# =============================================================================
# 1. Kiosk hardening
# =============================================================================
Head "1/7  Kiosk hardening"
if ($SkipHardening) {
  Say "skipped (-SkipHardening)"
} else {
  $hard = Find-Helper 'nuc-kiosk-hardening.ps1'
  if (-not $hard) {
    Warn "nuc-kiosk-hardening.ps1 not found next to this script - SKIPPING."
    Warn "Copy it from docs/runbooks/ and run it by hand: .\nuc-kiosk-hardening.ps1 -MediaDir '$MediaDir'"
  } else {
    Say "running $hard"
    & $hard -MediaDir $MediaDir
    Ok "hardening pass complete (a reboot is owed before you call it done)"
  }
}

# =============================================================================
# 2. OpenSSH - reuse the field-proven standalone installer, then restore keys
# =============================================================================
Head "2/7  OpenSSH (remote hands)"
$sshScript = Find-Helper 'media-courier-pc-ssh-standalone.ps1'
if (-not $sshScript) {
  Warn "media-courier-pc-ssh-standalone.ps1 not found - SKIPPING SSH."
  Warn "Without it there is no remote access to this machine. Copy it from"
  Warn "docs/runbooks/ and run it, then re-run this script to restore the keys."
} else {
  Say "running $sshScript"
  # Deliberately NOT reimplemented here. That script is what actually
  # provisioned the real PC (2026-08-21) after Add-WindowsCapability hung on
  # the debloated Windows Update. It installs Microsoft's standalone
  # Win32-OpenSSH MSI, adds the Mac's public key, turns passwords off, and
  # scopes port 22 to the Tailscale range. It is idempotent.
  & $sshScript

  # Restore the ORIGINAL host keys. Without this the Mac greets the rebuilt
  # machine with REMOTE HOST IDENTIFICATION HAS CHANGED and refuses to connect
  # until someone edits known_hosts - exactly the friction a DR kit exists to
  # avoid.
  if (Get-Service sshd -ErrorAction SilentlyContinue) {
    Stop-Service sshd -ErrorAction SilentlyContinue
    $restored = 0
    Get-ChildItem (Join-Path $R 'ssh') -File | Where-Object { $_.Name -like 'ssh_host_*' } | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $SshDir $_.Name) -Force
      $restored++
      # Private host keys must be readable only by SYSTEM + Administrators or
      # sshd refuses to start. Locale-proof SIDs, same idiom as the SSH script.
      if ($_.Name -notlike '*.pub') {
        icacls (Join-Path $SshDir $_.Name) /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
      }
    }
    Ok "restored $restored host key file(s)"
    Start-Service sshd
    Start-Sleep -Seconds 2
    if ((Get-Service sshd).Status -ne 'Running') {
      Warn "sshd did not come back up after the host-key restore. Check the ACLs on $SshDir and the sshd event log."
    } else {
      Ok "sshd running with the original host identity"
    }
  }
}

# =============================================================================
# 3. Tailscale
# =============================================================================
Head "3/7  Tailscale"
$tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $tsExe)) {
  $msi = Join-Path $env:TEMP 'tailscale-setup.msi'
  Say "downloading $TailscaleUrl"
  Invoke-WebRequest -Uri $TailscaleUrl -OutFile $msi -UseBasicParsing
  Say "installing (silent)..."
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Warn "msiexec returned $($p.ExitCode) - check Tailscale by hand" }
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
} else {
  Say "already installed"
}

if (Test-Path $tsExe) {
  # !! EVERY native call here is wrapped. Under $ErrorActionPreference='Stop',
  #    PowerShell 5.1 turns anything a native exe writes to stderr under `2>&1`
  #    into a TERMINATING RemoteException - and a freshly installed, not-yet-
  #    signed-in tailscale writes to stderr. Unwrapped, the script would die on
  #    this line on the exact path it exists for (a fresh rebuild with no
  #    -TailscaleAuthKey), BEFORE restoring the Syncthing identity in step 4.
  #    Tailscale login is a documented manual step; it must warn and continue.
  #    Same idiom as the `syncthing --version` probe in step 4.
  $tsNeedsLogin = $false
  $tsState      = ''
  try   { $tsState = (& $tsExe status 2>&1 | Out-String) }
  catch { $tsState = "$($_.Exception.Message)"; $tsNeedsLogin = $true }

  if ($tsNeedsLogin -or $tsState -match 'Logged out|NeedsLogin|not running') {
    if ($TailscaleAuthKey) {
      Say "bringing the tailnet up with the supplied auth key"
      try { & $tsExe up --authkey $TailscaleAuthKey --hostname bunkerclub-nuc --unattended }
      catch {
        Warn "tailscale up failed: $($_.Exception.Message)"
        Warn "Sign in by hand later:  & '$tsExe' up --hostname bunkerclub-nuc --unattended"
      }
    } else {
      Warn "Tailscale is not signed in. THIS IS ONE OF THE MANUAL STEPS - the"
      Warn "rebuild carries on without it; nothing below depends on the tailnet."
      Warn "Sign in later:  & '$tsExe' up --hostname bunkerclub-nuc --unattended"
      Warn "and sign in as datus1982 in the browser that opens."
    }
  }

  try { Say ("tailnet IPv4: " + ((& $tsExe ip -4 2>&1) -join ' ')) }
  catch { Say "tailnet IPv4: none yet (Tailscale is not signed in - see above)" }
}

# =============================================================================
# 4. Syncthing - install, then RESTORE IDENTITY BEFORE THE FIRST START
# =============================================================================
Head "4/7  Syncthing"

$stExe = Join-Path $SyncthingDir 'syncthing.exe'
$needInstall = $true
if (Test-Path $stExe) {
  try {
    if ((& $stExe --version 2>&1 | Out-String) -match [regex]::Escape($SyncthingVersion)) {
      Say "already installed ($SyncthingVersion)"; $needInstall = $false
    }
  } catch { }
}
if ($needInstall) {
  Get-ScheduledTask -TaskName $SyncthingTask -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
  Get-Process syncthing -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $zip = Join-Path $env:TEMP "syncthing-$SyncthingVersion.zip"
  $ext = Join-Path $env:TEMP "syncthing-$SyncthingVersion-x"
  Say "downloading $SyncthingUrl"
  Invoke-WebRequest -Uri $SyncthingUrl -OutFile $zip -UseBasicParsing
  if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $ext -Force
  $src = Get-ChildItem -Path $ext -Directory | Select-Object -First 1
  if (-not $src) { throw "the Syncthing zip did not contain the expected folder" }
  New-Item -ItemType Directory -Path $SyncthingDir -Force | Out-Null
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $SyncthingDir -Recurse -Force
  Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue
  Ok "installed to $SyncthingDir"
}

# --- THE LOAD-BEARING BIT ----------------------------------------------------
# Syncthing's device ID is the SHA-256 of its TLS certificate; the official docs
# say cert.pem + key.pem "form the basis for the device ID". Dropping the old
# cert.pem, key.pem and config.xml in BEFORE Syncthing ever runs means the
# rebuilt machine comes up as the SAME device the Mac already knows and already
# shares the folder with. No new device ID, no "add this device" dance on the
# Mac, no re-share, no re-accept. Let Syncthing start first and it generates a
# fresh identity that you then cannot get rid of without this same restore.
#
# The index database (index-v2\) is deliberately NOT restored - it is derived
# state. Syncthing will rehash the library on first run, which is slow (hours,
# off a USB drive) but correct. See the runbook.
$stHome = Join-Path $env:LOCALAPPDATA 'Syncthing'
if (Get-Process syncthing -ErrorAction SilentlyContinue) {
  Warn "Syncthing is already running - stopping it so the identity can be restored cleanly."
  Get-ScheduledTask -TaskName $SyncthingTask -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
  Get-Process syncthing -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

$virgin = -not (Test-Path (Join-Path $stHome 'cert.pem'))
New-Item -ItemType Directory -Path $stHome -Force | Out-Null
if (-not $virgin) {
  Warn "this machine already has a Syncthing identity at $stHome - it is being REPLACED by the backup's."
  $bak = Join-Path $stHome ("pre-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $bak -Force | Out-Null
  Get-ChildItem $stHome -File | Where-Object { $_.Name -match '\.pem$|^config\.xml' } |
    ForEach-Object { Copy-Item $_.FullName $bak -Force }
  Say "previous identity copied to $bak"
}
foreach ($f in @('cert.pem','key.pem','config.xml','https-cert.pem','https-key.pem')) {
  $src = Join-Path $R "syncthing\$f"
  if (Test-Path $src) { Copy-Item $src (Join-Path $stHome $f) -Force; Say "restored $f" }
}

# The restored config.xml points the folder at the OLD drive letter. Fix it if
# this machine mounted the library somewhere else.
[xml]$stCfg = Get-Content (Join-Path $stHome 'config.xml') -Raw
$folder = $stCfg.configuration.folder | Where-Object { $_.id -eq $FolderId }
if ($folder -and $folder.path -ne $MediaDir) {
  Warn ("folder path in the backup is '{0}' but the library is at '{1}' - rewriting it." -f $folder.path, $MediaDir)
  $folder.path = $MediaDir
  # !! NOT $stCfg.Save(<path>) - XmlDocument.Save(string) writes a UTF-8 BOM.
  #    This is the one file whose restoration the whole script is built around;
  #    it is not worth discovering on the bad day whether Syncthing's Go XML
  #    parser shrugs at a BOM. Same discipline as config.json below: changed
  #    file => BOM-less UTF-8, via an XmlWriter with UTF8Encoding($false).
  $xmlSettings = New-Object System.Xml.XmlWriterSettings
  $xmlSettings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $xmlSettings.Indent   = $true
  $xw = [System.Xml.XmlWriter]::Create((Join-Path $stHome 'config.xml'), $xmlSettings)
  try { $stCfg.Save($xw) } finally { $xw.Close() }
}
if ($folder) {
  Say ("folder {0}: path={1} type={2} ignoreDelete={3}" -f $folder.id, $folder.path, $folder.type, $folder.ignoreDelete)
  if ($folder.type -ne 'sendreceive' -or $folder.ignoreDelete -ne 'true') {
    Warn "folder is NOT sendreceive+ignoreDelete. That combination is what stops a Mac-side delete from wiping the bar. Fix it in the GUI before letting it sync."
  }
} else {
  Warn "the restored config.xml has no '$FolderId' folder - the courier will not work until that is fixed."
}

# Autostart at logon (this PC auto-logs-in as the kiosk user).
$action  = New-ScheduledTaskAction -Execute $stExe -Argument 'serve --no-console --no-browser' -WorkingDirectory $SyncthingDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings= New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
             -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $SyncthingTask -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Limited -Force | Out-Null
Ok "registered scheduled task '$SyncthingTask'"

if (-not (Get-NetFirewallRule -DisplayName $FwRuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $FwRuleName -Direction Inbound -Program $stExe `
    -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
  Ok "firewall rule added"
}

Start-ScheduledTask -TaskName $SyncthingTask
Say "started - waiting for the local API..."
$apiKey = $stCfg.configuration.gui.apikey
$hdr = @{ 'X-API-Key' = $apiKey }

# Where the GUI/REST API actually listens, per the RESTORED config - not a
# hardcoded literal. If the bar's Syncthing is ever moved off 8384, hardcoding
# would time out the readiness probe and report a perfectly healthy Syncthing as
# dead. A wildcard bind (0.0.0.0 / ::) is dialled on loopback.
$guiAddr = "$($stCfg.configuration.gui.address)".Trim()
if (-not $guiAddr) { $guiAddr = '127.0.0.1:8384' }
if ($guiAddr -match '^(?:0\.0\.0\.0|\[?::\]?)(:\d+)$') { $guiAddr = '127.0.0.1' + $Matches[1] }
$guiScheme = if ("$($stCfg.configuration.gui.tls)" -eq 'true') { 'https' } else { 'http' }
$guiBase   = if ($guiAddr -match '^https?://') { $guiAddr.TrimEnd('/') } else { "${guiScheme}://$guiAddr" }

$ready = $false
$deadline = (Get-Date).AddSeconds(120)
while (-not $ready -and (Get-Date) -lt $deadline) {
  try { Invoke-RestMethod -Uri "$guiBase/rest/system/ping" -Headers $hdr -TimeoutSec 5 | Out-Null; $ready = $true }
  catch { Start-Sleep -Seconds 3 }
}
if (-not $ready) {
  Warn "Syncthing's API never came up on $guiBase. Check Task Manager for syncthing.exe."
} else {
  $myId = (Invoke-RestMethod -Uri "$guiBase/rest/system/status" -Headers $hdr).myID
  Say "this machine's Syncthing device ID: $myId"
  # Prove the identity actually carried over: the restored config.xml lists this
  # device under <device>, so the ID must be one of them.
  $known = @($stCfg.configuration.device | ForEach-Object { $_.id })
  if ($known -contains $myId) {
    Ok "IDENTITY PRESERVED - the Mac already knows this device, no re-pairing needed"
  } else {
    Warn "device ID $myId is NOT in the restored config. The identity did NOT carry over."
    Warn "The Mac will have to add this new ID by hand (docs/runbooks/media-courier.md section 4)."
  }
  if ($known -notcontains $MacDeviceId) {
    Warn "the Mac's device ID is missing from the config - add it per media-courier.md section 4."
  }
}

# =============================================================================
# 5. Bunker Media Shell
# =============================================================================
Head "5/7  Bunker Media Shell"
if ($SkipShell) {
  Say "skipped (-SkipShell)"
} else {
  $installed = Test-Path (Join-Path $ShellDir 'Bunker Media Shell.exe')
  if ($installed) {
    Say "already present at $ShellDir"
  } else {
    # ZIP first, deliberately - see the note by $ShellZipUrl.
    $zip = Join-Path $env:TEMP 'BunkerMediaShell-win.zip'
    Say "downloading the shell (ZIP, ~150 MB) - this is the path that worked in the field"
    try {
      Invoke-WebRequest -Uri $ShellZipUrl -OutFile $zip -UseBasicParsing
      Get-Process 'Bunker Media Shell' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Path $ShellDir -Force | Out-Null
      $ext = Join-Path $env:TEMP 'BunkerMediaShell-x'
      if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $ext -Force
      # The zip may contain the app files at the root or one level down.
      $src = if (Test-Path (Join-Path $ext 'Bunker Media Shell.exe')) { $ext }
             else { (Get-ChildItem $ext -Directory | Select-Object -First 1).FullName }
      Copy-Item -Path (Join-Path $src '*') -Destination $ShellDir -Recurse -Force
      Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue
      Ok "shell unpacked to $ShellDir"
    } catch {
      Warn "ZIP install failed: $($_.Exception.Message)"
      Warn "Fall back to the installer by hand: $ShellExeUrl"
      Warn "(if it fails its own integrity check, that is the known CRC quirk - use the ZIP)"
    }
  }

  if (Test-Path (Join-Path $ShellDir 'Bunker Media Shell.exe')) {
    New-Item -ItemType Directory -Path $ShellData -Force | Out-Null

    # Restore config.json - slug, device token, catalog URL. If the library
    # landed on a different drive letter, rewrite mediaDir to match reality
    # rather than shipping a config that points at nothing.
    #
    # !! NEVER write this file with Set-Content -Encoding UTF8. PowerShell 5.1
    #    emits a UTF-8 BOM, and the shell parses this file with
    #    JSON.parse(fs.readFileSync(p,'utf8')) (apps/media-shell/src/config.js),
    #    which throws on a leading BOM - you would get the loud red config-error
    #    screen and a dark bar TV. Unchanged file => byte-for-byte copy.
    #    Changed file => BOM-less UTF-8 via UTF8Encoding($false).
    $cfgDest = Join-Path $ShellData 'config.json'
    if ($shellCfg.mediaDir -eq $MediaDir) {
      Copy-Item (Join-Path $R 'media-shell\config.json') $cfgDest -Force
      Ok "config.json restored byte-for-byte (slug=$($shellCfg.slug), token present)"
    } else {
      Warn ("rewriting config.json mediaDir '{0}' -> '{1}'" -f $shellCfg.mediaDir, $MediaDir)
      $shellCfg.mediaDir = $MediaDir
      $json = $shellCfg | ConvertTo-Json -Depth 5
      [IO.File]::WriteAllText($cfgDest, $json, (New-Object System.Text.UTF8Encoding($false)))
      Ok "config.json restored with the new mediaDir (slug=$($shellCfg.slug), token present)"
    }

    # The caches only save a rescan - nice to have, never required.
    foreach ($c in @('catalog-cache.json','sent-thumbs.json')) {
      $src = Join-Path $R "media-shell\$c"
      if (Test-Path $src) { Copy-Item $src (Join-Path $ShellData $c) -Force; Say "restored $c (saves a full rescan)" }
    }

    # Autostart: the same per-user Run key electron-builder writes.
    New-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' `
      -Name 'electron.app.Bunker Media Shell' `
      -Value (Join-Path $ShellDir 'Bunker Media Shell.exe') -PropertyType String -Force | Out-Null
    Ok "autostart Run key set"
  }
}

# =============================================================================
# 6. Verification
# =============================================================================
Head "6/7  Verification"

if (Get-Process syncthing -ErrorAction SilentlyContinue) { Ok "syncthing running" } else { Warn "syncthing NOT running" }
if ((Get-Service sshd -ErrorAction SilentlyContinue).Status -eq 'Running') { Ok "sshd running" } else { Warn "sshd NOT running" }
if (Test-Path $MediaDir) {
  $n = (Get-ChildItem $MediaDir -Recurse -File -ErrorAction SilentlyContinue).Count
  Say "media files present: $n"
  $listing = Join-Path $R 'inventory\media-listing.tsv.gz'
  if (Test-Path $listing) {
    Say "the backup's listing (inventory\media-listing.tsv.gz) has the expected file set -"
    Say "compare it once the library is back to confirm nothing is missing."
  }
} else {
  Warn "media directory $MediaDir does not exist - the shell will show its config-error screen"
}

if (-not $SkipShell -and (Test-Path (Join-Path $ShellDir 'Bunker Media Shell.exe'))) {
  Say "starting the shell..."
  Start-Process (Join-Path $ShellDir 'Bunker Media Shell.exe')
  Start-Sleep -Seconds 12
  try {
    $h = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $shellCfg.port) -TimeoutSec 10
    Ok ("shell health: ok={0} fileCount={1} version={2}" -f $h.ok, $h.fileCount, $h.version)
  } catch {
    Warn "shell health endpoint did not answer on port $($shellCfg.port) yet - it may still be scanning. Check again in a few minutes."
  }
}

# =============================================================================
# 7. What is still on you
# =============================================================================
Head "7/7  STILL MANUAL - none of this can be scripted"
Write-Host ""
Write-Host "  1. BIOS: Restore on AC Power Loss -> Power On." -ForegroundColor Yellow
Write-Host "     Without it the bar screen stays dark after any power blip."
Write-Host "  2. Auto-logon: Settings -> Accounts -> Sign-in options -> turn OFF"
Write-Host "     'For improved security, only allow Windows Hello sign-in', then run"
Write-Host "     netplwiz and untick 'Users must enter a user name and password'."
Write-Host "     The old password is NOT in the backup - Windows keeps it as an LSA"
Write-Host "     secret, not in the registry. You have to type it."
if (-not $TailscaleAuthKey) {
Write-Host "  3. Tailscale login as datus1982 (see step 3 above)." -ForegroundColor Yellow
}
Write-Host "  4. The media library. This script restores identity and config only."
Write-Host "     See the runbook's 'Restoring the media' section for the three"
Write-Host "     options and how long each one really takes."
Write-Host "  5. Reboot, then confirm: both TVs live, the signage heartbeat fresh,"
Write-Host '     and "ssh -i ~/.ssh/bunker_pc_ed25519 admin@<tailnet-ip>" from the Mac'
Write-Host "     WITHOUT a host-key warning (that is the proof the key restore worked)."
Write-Host ""

if ($script:Warnings.Count -gt 0) {
  Write-Host "  $($script:Warnings.Count) warning(s) above - read them before you walk away." -ForegroundColor Yellow
} else {
  Write-Host "  No warnings." -ForegroundColor Green
}
Write-Host ""
Write-Host "  Delete $work (and wipe the USB stick) - it holds the device token" -ForegroundColor Yellow
Write-Host "  and the Syncthing private key." -ForegroundColor Yellow
Write-Host ""
