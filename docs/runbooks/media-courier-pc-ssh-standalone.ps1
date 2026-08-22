# =============================================================================
#  BUNKER MEDIA COURIER - standalone SSH setup                 (run as Admin)
# =============================================================================
#  Finishes step 7 of media-courier-pc-setup.ps1 on machines where
#  Add-WindowsCapability hangs (Windows Update disabled by the kiosk debloat).
#  Installs Microsoft's standalone Win32-OpenSSH MSI instead - no Windows
#  Update involved. Everything else matches step 7 exactly: key-only auth,
#  passwords off, port 22 reachable ONLY from the Tailscale range.
#
#  Safe to re-run. See docs/runbooks/media-courier.md section 8.
# =============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Pinned release (flagged as a full release by the repo despite the tag name;
# verified against the GitHub releases API 2026-08-21).
$MsiUrl = 'https://github.com/PowerShell/Win32-OpenSSH/releases/download/10.0.0.0p2-Preview/OpenSSH-Win64-v10.0.0.0.msi'

Write-Host ""
Write-Host "== Standalone OpenSSH install" -ForegroundColor Cyan

if (Get-Service sshd -ErrorAction SilentlyContinue) {
  Write-Host "  sshd service already exists - skipping MSI."
} else {
  $msi = Join-Path $env:TEMP 'openssh-win64.msi'
  Write-Host "  downloading $MsiUrl"
  Invoke-WebRequest -Uri $MsiUrl -OutFile $msi -UseBasicParsing
  Write-Host "  installing (silent)..."
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "msiexec returned $($p.ExitCode)" }
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
}

Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd -ErrorAction SilentlyContinue

# sshd generates C:\ProgramData\ssh\* on first start - give it a moment.
$sshDir = 'C:\ProgramData\ssh'
$waitUntil = (Get-Date).AddSeconds(30)
while (-not (Test-Path (Join-Path $sshDir 'sshd_config')) -and (Get-Date) -lt $waitUntil) {
  Start-Sleep -Seconds 2
}
if (-not (Test-Path (Join-Path $sshDir 'sshd_config'))) {
  throw "sshd never generated $sshDir\sshd_config - is the sshd service able to start?"
}

# --- key-only auth for administrators ----------------------------------------
$authKeys = Join-Path $sshDir 'administrators_authorized_keys'
$pubKey   = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINL+prAL9gscP9+ww6rbe1k5pn5Bjmk9DE45cq+OkKqF claude@stephens-mac-bunker'
if (-not (Test-Path $authKeys) -or -not (Select-String -Path $authKeys -SimpleMatch $pubKey -Quiet)) {
  Add-Content -Path $authKeys -Value $pubKey -Encoding ascii
  Write-Host "  authorized key added"
} else {
  Write-Host "  authorized key already present"
}
# Locale-proof SIDs; sshd refuses the file without exactly these ACLs.
icacls $authKeys /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null

# --- key-only: no passwords ---------------------------------------------------
$sshdCfgPath = Join-Path $sshDir 'sshd_config'
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
if ($sshdCfg -ne $orig) { Set-Content -Path $sshdCfgPath -Value $sshdCfg -Encoding ascii }
Restart-Service -Name sshd

# --- firewall: tailnet-only ---------------------------------------------------
Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'OpenSSH' } | Disable-NetFirewallRule -ErrorAction SilentlyContinue
$sshRule = 'SSH (Tailscale only)'
if (-not (Get-NetFirewallRule -DisplayName $sshRule -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $sshRule -Direction Inbound -Protocol TCP -LocalPort 22 `
    -RemoteAddress '100.64.0.0/10' -Action Allow | Out-Null
}

Write-Host ""
Write-Host "  SSH READY - key-only, tailnet-only. Tell Claude to test." -ForegroundColor Green
Write-Host ""
