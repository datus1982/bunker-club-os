# Remove the BunkerAgent Windows service (leaves the files, config and logs in place).
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1
param(
  [string]$ServiceName = "BunkerAgent",
  [string]$NssmPath = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ($NssmPath -eq "") {
  $cand = @("$root\nssm.exe", "$root\scripts\nssm.exe", (Get-Command nssm -ErrorAction SilentlyContinue).Source) | Where-Object { $_ -and (Test-Path $_) }
  if ($cand.Count -eq 0) { throw "nssm.exe not found — pass -NssmPath." }
  $NssmPath = $cand[0]
}
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { Write-Host "Service $ServiceName is not installed."; exit 0 }
& $NssmPath stop $ServiceName | Out-Null
& $NssmPath remove $ServiceName confirm
Write-Host "Removed $ServiceName."
