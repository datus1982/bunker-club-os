# Install bunker-agent as a Windows service on the NUC using NSSM (the Non-Sucking Service Manager).
# Run from an elevated PowerShell in the apps\bunker-agent folder AFTER `npm ci && npm run build`
# and after config.json exists next to package.json (see README).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -NssmPath "C:\tools\nssm.exe"
#
# What it does: registers a service "BunkerAgent" that runs `node dist\index.js` from this folder,
# auto-starts at boot, restarts on crash (5 s), and appends stdout/stderr to logs\service-*.log.
# The agent itself also keeps a rotating logs\agent.log. Nothing here touches the Q-SYS Core.
param(
  [string]$ServiceName = "BunkerAgent",
  [string]$NssmPath = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not (Test-Path "$root\dist\index.js")) { throw "dist\index.js not found — run `npm ci` and `npm run build` in $root first." }
if (-not (Test-Path "$root\config.json")) { throw "config.json not found in $root — copy config.example.json and fill it in (see README)." }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not on PATH — install Node.js 20+ (LTS) first." }

if ($NssmPath -eq "") {
  $cand = @("$root\nssm.exe", "$root\scripts\nssm.exe", (Get-Command nssm -ErrorAction SilentlyContinue).Source) | Where-Object { $_ -and (Test-Path $_) }
  if ($cand.Count -eq 0) { throw "nssm.exe not found. Put nssm.exe beside this script (or on PATH), or pass -NssmPath. Get it from https://nssm.cc/ (2.24+)." }
  $NssmPath = $cand[0]
}

New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service $ServiceName already exists — stopping and updating it."
  & $NssmPath stop $ServiceName | Out-Null
} else {
  & $NssmPath install $ServiceName $node "dist\index.js"
}
& $NssmPath set $ServiceName AppDirectory $root
& $NssmPath set $ServiceName Application $node
& $NssmPath set $ServiceName AppParameters "dist\index.js"
& $NssmPath set $ServiceName DisplayName "Bunker Agent (Q-SYS read-only mirror)"
& $NssmPath set $ServiceName Description "Bunker Club OS NUC agent: mirrors the Q-SYS Core read-back set into Supabase audio_live. This version writes nothing to the Core."
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName AppStdout "$root\logs\service-out.log"
& $NssmPath set $ServiceName AppStderr "$root\logs\service-err.log"
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 5242880
& $NssmPath set $ServiceName AppEnvironmentExtra "BUNKER_AGENT_CONFIG=$root\config.json"
& $NssmPath start $ServiceName

Start-Sleep -Seconds 3
Get-Service -Name $ServiceName | Format-List Name, Status, StartType
Write-Host "Installed. Tail the agent log with:  Get-Content -Wait $root\logs\agent.log"
