# =============================================================================
#  BUNKER MEDIA COURIER - mini-PC setup                        (run ONCE, as Admin)
# =============================================================================
#  Installs and wires up everything the bar's media PC needs to receive movies
#  from Stephen's Mac:
#
#    1. Syncthing (pinned build) into C:\Syncthing
#    2. a logon-triggered Scheduled Task so it starts with the auto-login
#    3. the "bunkerclub-media" folder pointed at the media shell's library,
#       type sendreceive with ignoreDelete = TRUE  (deletes NEVER apply here)
#    4. a Windows Firewall allow rule for syncthing.exe
#    5. Tailscale (for remote hands) - this one step opens a browser to log in
#    6. OpenSSH Server, key-only, reachable ONLY over Tailscale - lets Claude
#       run maintenance on this PC from Stephen's Mac (owner-requested)
#
#  It finishes by printing three lines. SEND THOSE LINES BACK.
#
#  Re-running is safe: it reuses an existing install/config instead of
#  duplicating anything.
#
#  See docs/runbooks/media-courier.md for the whole picture.
# =============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- pinned versions --------------------------------------------------------
# Syncthing is PINNED so this script can't be surprised by a future release.
# To bump: check https://api.github.com/repos/syncthing/syncthing/releases/latest
# and set $SyncthingVersion to the new tag. The asset name pattern
# "syncthing-windows-amd64-<tag>.zip" was verified against the real releases API
# (2026-08-21). Keep it within one minor of the Mac's Syncthing.
$SyncthingVersion = 'v2.1.3'
$SyncthingUrl     = "https://github.com/syncthing/syncthing/releases/download/$SyncthingVersion/syncthing-windows-amd64-$SyncthingVersion.zip"

# Tailscale "latest" redirects to the current stable MSI (verified 2026-08-21:
# -> tailscale-setup-1.102.3-amd64.msi). Using the redirecting URL keeps it current.
$TailscaleUrl     = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'

# ---- fixed identities -------------------------------------------------------
$MacDeviceId  = '646HY4I-MVL5OWS-P4HO4WW-ZI7AKCG-EWEPKTY-YOFFOYC-X2OX37N-3OML3AR'
$MacDeviceName= 'Stephen Mac'
$FolderId     = 'bunkerclub-media'
$FolderLabel  = 'Bunker Club Media'
$InstallDir   = 'C:\Syncthing'
$TaskName     = 'Syncthing (Bunker Courier)'
$FwRuleName   = 'Syncthing (Bunker Courier)'
$GuiBase      = 'http://127.0.0.1:8384'

function Say  ($m) { Write-Host "  $m" }
function Head ($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " BUNKER MEDIA COURIER - mini-PC setup" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 0. Must be elevated (firewall rule + MSI install need it)
# -----------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ""
  Write-Host "  STOP - this needs an ADMINISTRATOR PowerShell." -ForegroundColor Red
  Write-Host "  Close this window. Right-click the Start button ->" -ForegroundColor Red
  Write-Host "  'Terminal (Admin)' or 'Windows PowerShell (Admin)', then run it again." -ForegroundColor Red
  Write-Host ""
  return
}

# -----------------------------------------------------------------------------
# 1. Install Syncthing
# -----------------------------------------------------------------------------
Head "1/7  Syncthing $SyncthingVersion"
$exe = Join-Path $InstallDir 'syncthing.exe'

$needInstall = $true
if (Test-Path $exe) {
  try {
    $have = (& $exe --version 2>&1 | Out-String)
    if ($have -match [regex]::Escape($SyncthingVersion)) {
      Say "already installed ($SyncthingVersion) - skipping download."
      $needInstall = $false
    } else {
      Say "found a different build; replacing it."
    }
  } catch { Say "existing syncthing.exe did not report a version; replacing it." }
}

if ($needInstall) {
  # A running instance would lock the exe - stop it first.
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
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
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $InstallDir -Recurse -Force
  Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue
  Say "installed to $InstallDir"
}
if (-not (Test-Path $exe)) { throw "syncthing.exe is missing after install: $exe" }

# -----------------------------------------------------------------------------
# 2. Find the media library folder
# -----------------------------------------------------------------------------
Head "2/7  Locating the media library"
$mediaRoot = $null

# (a) The media shell's own config.json is the authority. Its documented
#     resolution order puts the userData copy at %APPDATA%\<productName>\.
$cfgCandidates = @(
  (Join-Path $env:APPDATA 'Bunker Media Shell\config.json')
)
$cfgCandidates += (Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'config.json' `
                    -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$cfgCandidates += (Get-ChildItem -Path $env:APPDATA -Filter 'config.json' `
                    -Recurse -Depth 2 -ErrorAction SilentlyContinue |
                   Where-Object { $_.FullName -match 'Bunker' } | ForEach-Object { $_.FullName })

foreach ($c in ($cfgCandidates | Where-Object { $_ } | Select-Object -Unique)) {
  if (-not (Test-Path $c)) { continue }
  try {
    $j = Get-Content $c -Raw | ConvertFrom-Json
    if ($j.mediaDir -and (Test-Path $j.mediaDir)) {
      $mediaRoot = (Resolve-Path $j.mediaDir).Path
      Say "from the media shell config: $c"
      break
    }
  } catch { }
}

# (b) Fallback: scan fixed/removable drives for a top-level bunkerClub folder
#     with a real library inside it (>= 10 subfolders).
if (-not $mediaRoot) {
  Say "no shell config found - scanning drives for a bunkerClub library..."
  foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\$' })) {
    foreach ($p in @((Join-Path $d.Root 'bunkerClub'), (Join-Path $d.Root 'bunkerClub\bunkerClub'))) {
      if (Test-Path $p) {
        $n = (Get-ChildItem $p -Directory -ErrorAction SilentlyContinue).Count
        if ($n -ge 10) { $mediaRoot = (Resolve-Path $p).Path; Say "found $mediaRoot ($n playlist folders)"; break }
      }
    }
    if ($mediaRoot) { break }
  }
}

# (c) Last resort: ask.
if (-not $mediaRoot) {
  Warn "Could not find the media library automatically."
  Warn "It is the folder whose subfolders are the playlists (the one the shell watches)."
  $ans = Read-Host "  Paste the full path to the media folder"
  if ($ans -and (Test-Path $ans)) { $mediaRoot = (Resolve-Path $ans).Path }
  else { throw "no usable media folder path given - nothing was changed" }
}
Say "MEDIA LIBRARY: $mediaRoot"
Say ("playlist folders: " + (Get-ChildItem $mediaRoot -Directory -ErrorAction SilentlyContinue).Count)

# -----------------------------------------------------------------------------
# 3. Scheduled Task (starts at logon; this PC auto-logs-in)
# -----------------------------------------------------------------------------
Head "3/7  Autostart task"
# --no-console hides the console window (a Windows-only Syncthing flag);
# --no-browser stops it opening the GUI on the kiosk screen.
$action  = New-ScheduledTaskAction -Execute $exe -Argument 'serve --no-console --no-browser' -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings= New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
             -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Limited -Force | Out-Null
Say "registered '$TaskName' (at logon)"

if (-not (Get-Process syncthing -ErrorAction SilentlyContinue)) {
  Start-ScheduledTask -TaskName $TaskName
  Say "started"
} else {
  Say "already running"
}

# -----------------------------------------------------------------------------
# 4. Read the API key, wait for the REST API
# -----------------------------------------------------------------------------
Head "4/7  Waiting for Syncthing's local API"

# `syncthing paths` prints the real config location; fall back to the usual spots.
$cfgXml = $null
try {
  $paths = (& $exe paths 2>&1 | Out-String) -split "`r?`n"
  for ($i = 0; $i -lt ($paths.Count - 1); $i++) {
    if ($paths[$i] -match 'Configuration file') { $cfgXml = $paths[$i+1].Trim(); break }
  }
} catch { }
if (-not $cfgXml) { $cfgXml = Join-Path $env:LOCALAPPDATA 'Syncthing\config.xml' }
Say "config: $cfgXml"

$deadline = (Get-Date).AddSeconds(120)
while (-not (Test-Path $cfgXml) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (-not (Test-Path $cfgXml)) {
  foreach ($alt in @((Join-Path $env:LOCALAPPDATA 'Syncthing\config.xml'), (Join-Path $env:APPDATA 'Syncthing\config.xml'))) {
    if (Test-Path $alt) { $cfgXml = $alt; break }
  }
}
if (-not (Test-Path $cfgXml)) { throw "Syncthing never wrote a config.xml - is it running? (Task Manager -> syncthing.exe)" }

$apiKey = ([xml](Get-Content $cfgXml -Raw)).configuration.gui.apikey
if (-not $apiKey) { throw "could not read the API key out of $cfgXml" }
$hdr = @{ 'X-API-Key' = $apiKey }

$ready = $false
$deadline = (Get-Date).AddSeconds(120)
while (-not $ready -and (Get-Date) -lt $deadline) {
  try { Invoke-RestMethod -Uri "$GuiBase/rest/system/ping" -Headers $hdr -TimeoutSec 5 | Out-Null; $ready = $true }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { throw "Syncthing's API at $GuiBase never came up" }
$status = Invoke-RestMethod -Uri "$GuiBase/rest/system/status" -Headers $hdr
$myId   = $status.myID
Say "API up. This PC's device ID: $myId"

# -----------------------------------------------------------------------------
# 5. Device + folder via REST
#    POST on a config collection adds a new entry OR replaces the one with the
#    same ID, so this whole section is idempotent.
# -----------------------------------------------------------------------------
Head "5/7  Pairing config"

# --- the Mac ---
$devJson = @"
{
  "deviceID": "$MacDeviceId",
  "name": "$MacDeviceName",
  "addresses": ["dynamic"],
  "compression": "metadata",
  "introducer": false,
  "paused": false
}
"@
Invoke-RestMethod -Uri "$GuiBase/rest/config/devices" -Headers $hdr -Method Post `
  -ContentType 'application/json' -Body $devJson | Out-Null
Say "device '$MacDeviceName' added"

# --- the folder ---
#  type          sendreceive  - this PC PULLS from the Mac.
#  ignoreDelete  TRUE         - the load-bearing setting. A delete on the Mac
#                               (or a mis-click on 'Override Changes' there) is
#                               NEVER applied here. The bar library only grows.
#  hashers 1 / rescan 24h     - the first scan has to hash the whole existing
#                               library off the USB drive; keeping it to one
#                               hasher and a daily rescan protects the USB bus
#                               that the media shell is also probing over.
$pathJson = ($mediaRoot | ConvertTo-Json)   # gives a correctly \\-escaped JSON string
$folderJson = @"
{
  "id": "$FolderId",
  "label": "$FolderLabel",
  "path": $pathJson,
  "type": "sendreceive",
  "ignoreDelete": true,
  "fsWatcherEnabled": true,
  "fsWatcherDelayS": 10,
  "rescanIntervalS": 86400,
  "hashers": 1,
  "ignorePerms": true,
  "paused": false,
  "devices": [ { "deviceID": "$myId" }, { "deviceID": "$MacDeviceId" } ]
}
"@
Invoke-RestMethod -Uri "$GuiBase/rest/config/folders" -Headers $hdr -Method Post `
  -ContentType 'application/json' -Body $folderJson | Out-Null

$check = Invoke-RestMethod -Uri "$GuiBase/rest/config/folders/$FolderId" -Headers $hdr
Say ("folder '{0}' -> {1}" -f $check.id, $check.path)
Say ("  type={0}  ignoreDelete={1}  devices={2}" -f $check.type, $check.ignoreDelete, $check.devices.Count)
if ($check.type -ne 'sendreceive' -or -not $check.ignoreDelete) {
  throw "folder did not come back with the expected settings - do NOT proceed, re-run this script"
}

# --- firewall ---
if (-not (Get-NetFirewallRule -DisplayName $FwRuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $FwRuleName -Direction Inbound -Program $exe `
    -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
  Say "firewall rule added"
} else {
  Say "firewall rule already present"
}

# -----------------------------------------------------------------------------
# 6. Tailscale (remote hands)
# -----------------------------------------------------------------------------
Head "6/7  Tailscale"
$tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $tsExe)) {
  $msi = Join-Path $env:TEMP 'tailscale-setup.msi'
  Say "downloading $TailscaleUrl"
  Invoke-WebRequest -Uri $TailscaleUrl -OutFile $msi -UseBasicParsing
  Say "installing (silent)..."
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Warn "msiexec returned $($p.ExitCode) - check Tailscale manually" }
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
} else {
  Say "already installed"
}

$tsLine = 'not reported'
if (Test-Path $tsExe) {
  Write-Host ""
  Write-Host "  >>> A BROWSER WINDOW WILL OPEN NOW - log in to Tailscale." -ForegroundColor Yellow
  Write-Host "      (This is the one step that needs you. Everything else is done.)" -ForegroundColor Yellow
  Write-Host ""
  try { & $tsExe up 2>&1 | ForEach-Object { Say $_ } } catch { Warn "tailscale up: $_" }
  try { $tsLine = (& $tsExe status --self=true 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { }
}

# -----------------------------------------------------------------------------
# 7. OpenSSH Server - key-only, reachable ONLY over the tailnet
#    Lets Claude (from Stephen's Mac) run maintenance on this PC without
#    paste-blocks: shell log checks, restarts, media surgery. Owner-requested.
# -----------------------------------------------------------------------------
Head "7/7  Remote access (SSH over Tailscale)"

# The courier (steps 1-6) is already fully configured at this point. Nothing in
# this section is allowed to kill the script - a failure here is warned and
# skipped so the final SEND-BACK printout always appears. (Re-running the whole
# script retries this section safely.)
try {

$sshCap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if (-not $sshCap) {
  Warn "this Windows build has no OpenSSH.Server capability - skipping SSH setup"
} else {
  if ($sshCap.State -ne 'Installed') {
    Say "installing OpenSSH Server (Windows capability)..."
    Add-WindowsCapability -Online -Name $sshCap.Name | Out-Null
  } else {
    Say "OpenSSH Server already installed"
  }

  Set-Service -Name sshd -StartupType Automatic
  Start-Service -Name sshd -ErrorAction SilentlyContinue

  # sshd generates C:\ProgramData\ssh\* on first start - give it a moment.
  $sshDir = 'C:\ProgramData\ssh'
  $waitUntil = (Get-Date).AddSeconds(30)
  while (-not (Test-Path (Join-Path $sshDir 'sshd_config')) -and (Get-Date) -lt $waitUntil) {
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }

  # --- key-only auth for administrators -------------------------------------
  # This PC's user is an admin, so sshd reads administrators_authorized_keys
  # (the default sshd_config's 'Match Group administrators' block), NOT the
  # per-user file. The key pair lives on Stephen's Mac (~/.ssh/bunker_pc_ed25519).
  $authKeys = 'C:\ProgramData\ssh\administrators_authorized_keys'
  $pubKey   = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINL+prAL9gscP9+ww6rbe1k5pn5Bjmk9DE45cq+OkKqF claude@stephens-mac-bunker'
  if (-not (Test-Path $authKeys) -or -not (Select-String -Path $authKeys -SimpleMatch $pubKey -Quiet)) {
    Add-Content -Path $authKeys -Value $pubKey -Encoding ascii
    Say "authorized key added"
  } else {
    Say "authorized key already present"
  }
  # sshd REFUSES this file unless it is locked to Administrators + SYSTEM with
  # inheritance off. SIDs (S-1-5-32-544 / S-1-5-18) are used so this works on
  # any locale, not just English.
  icacls $authKeys /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
  Say "ACLs set (Administrators + SYSTEM only)"

  # --- key-only: no passwords ------------------------------------------------
  $sshdCfgPath = Join-Path $sshDir 'sshd_config'
  if (-not (Test-Path $sshdCfgPath)) { throw "sshd never generated $sshdCfgPath - is the sshd service able to start?" }
  $sshdCfg = Get-Content $sshdCfgPath -Raw
  $orig = $sshdCfg
  if ($sshdCfg -match '(?m)^#?\s*PasswordAuthentication\b.*$') {
    $sshdCfg = $sshdCfg -replace '(?m)^#?\s*PasswordAuthentication\b.*$', 'PasswordAuthentication no'
  } else {
    $sshdCfg = $sshdCfg + "`r`nPasswordAuthentication no`r`n"
  }
  if ($sshdCfg -match '(?m)^#?\s*PubkeyAuthentication\b.*$') {
    $sshdCfg = $sshdCfg -replace '(?m)^#?\s*PubkeyAuthentication\b.*$', 'PubkeyAuthentication yes'
  } else {
    $sshdCfg = $sshdCfg + "PubkeyAuthentication yes`r`n"
  }
  if ($sshdCfg -ne $orig) {
    Set-Content -Path $sshdCfgPath -Value $sshdCfg -Encoding ascii
    Say "sshd_config: PasswordAuthentication no / PubkeyAuthentication yes"
  } else {
    Say "sshd_config already key-only"
  }
  Restart-Service -Name sshd

  # --- firewall: SSH is a tailnet-only door ----------------------------------
  # The capability install creates a wide-open port-22 rule; kill it and allow
  # only the Tailscale CGNAT range. SSH is NOT reachable from the bar LAN.
  Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue |
    Disable-NetFirewallRule -ErrorAction SilentlyContinue
  $sshRule = 'SSH (Tailscale only)'
  if (-not (Get-NetFirewallRule -DisplayName $sshRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $sshRule -Direction Inbound -Protocol TCP -LocalPort 22 `
      -RemoteAddress '100.64.0.0/10' -Action Allow | Out-Null
    Say "firewall: port 22 allowed from the tailnet only"
  } else {
    Say "firewall rule already present"
  }
}

} catch {
  Warn "SSH setup did not complete: $_"
  Warn "Everything else (Syncthing courier + Tailscale) is fully configured."
  Warn "Re-run this same script any time to retry the SSH part."
}

$tsIp = 'unknown'
if (Test-Path $tsExe) {
  try { $tsIp = (& $tsExe ip -4 2>&1 | Select-Object -First 1 | Out-String).Trim() } catch { }
}

# -----------------------------------------------------------------------------
# DONE
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "###############################################################" -ForegroundColor Green
Write-Host "#                                                             #" -ForegroundColor Green
Write-Host "#   SETUP COMPLETE.  ONE THING LEFT:                          #" -ForegroundColor Green
Write-Host "#                                                             #" -ForegroundColor Green
Write-Host "#   >>>>>  SEND THESE LINES BACK TO CLAUDE  <<<<<             #" -ForegroundColor Green
Write-Host "#                                                             #" -ForegroundColor Green
Write-Host "###############################################################" -ForegroundColor Green
Write-Host ""
Write-Host "PC-DEVICE-ID: $myId" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "PC-TAILSCALE-IP: $tsIp" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "PC-USERNAME: $env:USERNAME" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host ""
Write-Host "  Tailscale: $tsLine"
Write-Host "  Media library: $mediaRoot"
Write-Host "  Syncthing GUI (on this PC): $GuiBase"
Write-Host ""
Write-Host "  Nothing will sync until that device ID is added on the Mac side."
Write-Host ""
