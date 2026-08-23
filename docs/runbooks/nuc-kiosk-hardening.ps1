# ============================================================================
# Bunker Club - media kiosk hardening
# ============================================================================
#  VENDORED PINNED COPY. Upstream is Stephen's own public gist:
#    https://gist.github.com/datus1982/e5ecf0d1a6b557f5bc91802239b0674e
#  Author: Stephen Tyler (Bunker Club). Copied verbatim 2026-08-23 apart from
#  this header and the $MediaDir parameterisation noted below.
#
#  It lives in the repo because a disaster-recovery kit must not depend on a
#  gist still being there, still being public, and still saying the same thing
#  on the day the machine is dead. If the gist is updated, re-vendor this file.
#
#  Verified against the live NUC 2026-08-23: every observable effect of this
#  script matches the running appliance (High performance plan active,
#  standby/monitor idle = 0, hibernation off, WSearch not running, Defender
#  exclusion D:\bunkerClub present).
#
#  Run AFTER the Raphi debloat script. Target: the bar's mini Windows PC.
#  Leaves alone: Bunker Media Shell, RemotePC, Windows Update, Defender
#  (adds one media-folder exclusion), audio/graphics/capture drivers.
#
#  RUN AS ADMINISTRATOR:
#    1. Right-click Start -> "Terminal (Admin)" (or PowerShell as Admin)
#    2. Set-ExecutionPolicy Bypass -Scope Process -Force
#    3. .\nuc-kiosk-hardening.ps1 [-MediaDir 'E:\bunkerClub']
#  Reboot when it finishes. Idempotent - safe to run again.
# ============================================================================
#Requires -RunAsAdministrator

# CHANGE FROM THE GIST: $MediaDir is a real parameter instead of an edit-me
# variable, so bunker-nuc-rebuild.ps1 can pass the drive letter it resolved.
# The default is identical to the gist's.
param(
  [string]$MediaDir = "D:\bunkerClub"
)

function Step($name, [scriptblock]$action) {
  Write-Host "==> $name" -ForegroundColor Cyan
  try { & $action; Write-Host "    OK" -ForegroundColor Green }
  catch { Write-Host "    SKIPPED/FAILED: $($_.Exception.Message)" -ForegroundColor Yellow }
}

function SetReg($path, $name, $value, $type = "DWord") {
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  New-ItemProperty -Path $path -Name $name -Value $value -PropertyType $type -Force | Out-Null
}

# ---- 1. Xbox Game Bar / Game DVR: fully off (overlay + background capture) ----
Step "Disable Xbox Game Bar + Game DVR" {
  SetReg "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR" "AppCaptureEnabled" 0
  SetReg "HKCU:\System\GameConfigStore" "GameDVR_Enabled" 0
  SetReg "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" "AllowGameDVR" 0
}
Step "Remove Xbox apps" {
  "Microsoft.XboxGamingOverlay","Microsoft.XboxGameOverlay","Microsoft.XboxSpeechToTextOverlay",
  "Microsoft.Xbox.TCUI","Microsoft.XboxApp","Microsoft.GamingApp","Microsoft.XboxIdentityProvider" |
    ForEach-Object { Get-AppxPackage $_ -AllUsers -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue }
}

# ---- 2. Windows Search: never index 1.6TB of movies ----
Step "Disable Windows Search service" {
  Stop-Service WSearch -Force -ErrorAction SilentlyContinue
  Set-Service WSearch -StartupType Disabled
}

# ---- 3. Power: high performance, nothing sleeps, USB never suspends ----
Step "High-performance power plan" {
  powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null
  if ($LASTEXITCODE -ne 0) { powercfg -setactive SCHEME_MIN }
}
Step "Screen/sleep/disk timeouts -> never" {
  powercfg -change monitor-timeout-ac 0
  powercfg -change standby-timeout-ac 0
  powercfg -change disk-timeout-ac 0
}
Step "USB selective suspend -> disabled (capture card + media drive live on USB)" {
  powercfg -setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
  powercfg -setactive SCHEME_CURRENT
}

# ---- 4. Hibernation + Fast Startup off (honest cold boots, reliable USB enumeration) ----
Step "Disable hibernation + Fast Startup" {
  powercfg /h off
  SetReg "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" "HiberbootEnabled" 0
}

# ---- 5. Defender: exclude the media folder from real-time scanning ----
Step "Defender exclusion for $MediaDir (Defender itself stays ON)" {
  Add-MpPreference -ExclusionPath $MediaDir
}

# ---- 6. Consumer app removal (keeps Edge, which is a system component) ----
Step "Remove consumer apps (Teams, Phone Link, News, Office hub, etc.)" {
  "MSTeams","MicrosoftTeams","Microsoft.YourPhone","Microsoft.BingNews","Microsoft.BingWeather",
  "Microsoft.GetHelp","Microsoft.Getstarted","Microsoft.MicrosoftOfficeHub","Microsoft.People",
  "Microsoft.Todos","Microsoft.ZuneMusic","Microsoft.ZuneVideo","Clipchamp.Clipchamp",
  "Microsoft.MicrosoftSolitaireCollection","Microsoft.Copilot","Microsoft.Windows.Copilot" |
    ForEach-Object { Get-AppxPackage $_ -AllUsers -ErrorAction SilentlyContinue | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue }
}
Step "Uninstall OneDrive" {
  Stop-Process -Name OneDrive -Force -ErrorAction SilentlyContinue
  $od = "$env:SystemRoot\SysWOW64\OneDriveSetup.exe"
  if (-not (Test-Path $od)) { $od = "$env:SystemRoot\System32\OneDriveSetup.exe" }
  if (Test-Path $od) { Start-Process $od "/uninstall" -Wait }
}
Step "Uninstall Kodi (autostart already disabled; this ends its updater noise)" {
  winget uninstall --id XBMCFoundation.Kodi -e --silent --accept-source-agreements 2>$null
  if ($LASTEXITCODE -ne 0) { winget uninstall Kodi --silent 2>$null }
}

# ---- 7. Background churn off ----
Step "Storage Sense off" {
  SetReg "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy" "01" 0
}
Step "Delivery Optimization -> direct download only (no P2P serving)" {
  SetReg "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization" "DODownloadMode" 0
}
Step "Edge: no startup boost, no background running" {
  SetReg "HKLM:\SOFTWARE\Policies\Microsoft\Edge" "StartupBoostEnabled" 0
  SetReg "HKLM:\SOFTWARE\Policies\Microsoft\Edge" "BackgroundModeEnabled" 0
}

# ---- 8. Quiet + lean UI ----
Step "All toast notifications off (nothing photobombs a movie)" {
  SetReg "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications" "ToastEnabled" 0
}
Step "Screen saver off" {
  SetReg "HKCU:\Control Panel\Desktop" "ScreenSaveActive" "0" "String"
}
Step "Visual effects -> best performance" {
  SetReg "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects" "VisualFXSetting" 2
}

Write-Host ""
Write-Host "================= DONE - REBOOT TO APPLY =================" -ForegroundColor Green
Write-Host ""
Write-Host "Still manual (can't be scripted safely):" -ForegroundColor Yellow
Write-Host "  1. BIOS: Restore on AC Power Loss -> Power On"
Write-Host "  2. Auto-login: Sign-in options -> Windows-Hello-only OFF, then netplwiz"
Write-Host "  3. Windows Update -> Active hours ~10 AM - 2 AM"
Write-Host "  4. Task Manager -> Startup apps: ONLY Bunker Media Shell + RemotePC enabled"
Write-Host "  5. (Optional) Disk Management: pin the USB drive to letter D:"
