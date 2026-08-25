<#
  host-demo.ps1 — run the two portals as production builds and expose them
  on public URLs so they can be opened from any other laptop.

  Usage (from the repo root, PowerShell):
    .\host-demo.ps1            # build if needed, start servers + tunnels, print links
    .\host-demo.ps1 -Rebuild   # force a fresh production build first
    .\host-demo.ps1 -Stop      # stop the servers and tunnels this script started

  Both portals run in mock mode (no database, no backend needed):
    internal-portal → sign in with any fixture account, password "nexraah"
                      e.g. anil@nexraah.in (Ops), meera@nexraah.in (Compliance),
                      krishnan@nexraah.in (Admin)
    vendor-portal   → no sign-in, lands on /loads

  The public *.trycloudflare.com links are free "quick tunnels": they only
  work while this laptop is on and this script's processes are running, and
  the hostname changes every time the tunnel restarts. Re-run the script and
  read the new links from the output (or from .hosting\*.log).
#>
param(
  [switch]$Rebuild,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $repo '.hosting'
New-Item -ItemType Directory -Force $logs | Out-Null
$pidFile = Join-Path $logs 'pids.txt'

$INTERNAL_PORT = 3012   # 3002 is what `pnpm dev` uses; keep them apart
$VENDOR_PORT   = 3001

function Stop-Hosted {
  if (Test-Path $pidFile) {
    Get-Content $pidFile | ForEach-Object {
      try { Stop-Process -Id ([int]$_) -Force -ErrorAction Stop } catch {}
    }
    Remove-Item $pidFile -Force
  }
  # Anything still holding the ports (e.g. started by hand) — leave it alone but say so.
  foreach ($p in @($INTERNAL_PORT, $VENDOR_PORT)) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
    if ($c) { Write-Host "Port $p is still in use by PID $($c.OwningProcess) (not started by this script)." }
  }
  Write-Host 'Stopped.'
}

if ($Stop) { Stop-Hosted; exit 0 }

# ---- build ------------------------------------------------------------------
$internalDist = Join-Path $repo 'apps\internal-portal\.next-prod'
$vendorDist   = Join-Path $repo 'apps\vendor-portal\.next'

if ($Rebuild -or -not (Test-Path (Join-Path $internalDist 'BUILD_ID'))) {
  Write-Host '> Building internal-portal (mock mode) ...'
  $env:NEXT_DIST_DIR = '.next-prod'
  $env:NEXT_PUBLIC_USE_MOCKS = '1'
  Push-Location $repo
  pnpm --filter internal-portal build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'internal-portal build failed' }
  Pop-Location
}
if ($Rebuild -or -not (Test-Path (Join-Path $vendorDist 'BUILD_ID'))) {
  Write-Host '> Building vendor-portal (mock mode) ...'
  $env:NEXT_PUBLIC_MOCK = '1'
  Push-Location $repo
  pnpm --filter vendor-portal build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'vendor-portal build failed' }
  Pop-Location
}

# ---- start ------------------------------------------------------------------
Stop-Hosted | Out-Null
Remove-Item (Join-Path $logs '*.log') -Force -ErrorAction SilentlyContinue
$pids = @()

function Start-Hidden([string]$workDir, [string]$cmd, [string]$log) {
  $p = Start-Process -FilePath 'cmd.exe' -PassThru -WindowStyle Hidden `
    -ArgumentList "/c cd /d `"$workDir`" && $cmd > `"$log`" 2>&1"
  return $p.Id
}

# Prefer the cloudflared.exe that `npx cloudflared` already downloaded and run
# it directly: a tunnel that runs under node (via npx) dies with any
# "kill every node.exe" cleanup someone does to free a port — the servers
# have to be node, the tunnels don't.
$cfExe = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter 'cloudflared.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
$tunnelCmd = if ($cfExe) { "`"$cfExe`" tunnel" } else { 'npx --yes cloudflared tunnel' }

$pids += Start-Hidden (Join-Path $repo 'apps\internal-portal') "set NEXT_DIST_DIR=.next-prod&& npx next start -p $INTERNAL_PORT" (Join-Path $logs 'internal-portal.log')
$pids += Start-Hidden (Join-Path $repo 'apps\vendor-portal')   "npx next start -p $VENDOR_PORT"                                     (Join-Path $logs 'vendor-portal.log')
$pids += Start-Hidden $repo "$tunnelCmd --url http://localhost:$INTERNAL_PORT" (Join-Path $logs 'internal-tunnel.log')
$pids += Start-Hidden $repo "$tunnelCmd --url http://localhost:$VENDOR_PORT"   (Join-Path $logs 'vendor-tunnel.log')
$pids | Set-Content $pidFile

# ---- wait for the tunnel hostnames --------------------------------------------
function Wait-TunnelUrl([string]$log) {
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
      # `(?!api\.)` — the log also mentions https://api.trycloudflare.com, which is not our hostname.
      $m = Select-String -Path $log -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
      if ($m) { return $m.Matches[0].Value }
    }
  }
  return '(tunnel did not come up — see ' + $log + ')'
}

$lan = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
$internalUrl = Wait-TunnelUrl (Join-Path $logs 'internal-tunnel.log')
$vendorUrl   = Wait-TunnelUrl (Join-Path $logs 'vendor-tunnel.log')

Write-Host ''
Write-Host '================ Nexraah demo hosting ================'
Write-Host "Internal portal  (staff)        : $internalUrl"
Write-Host "Vendor portal    (transporters) : $vendorUrl"
Write-Host "Same Wi-Fi only  (no tunnel)    : http://${lan}:$INTERNAL_PORT  and  http://${lan}:$VENDOR_PORT"
Write-Host 'Sign in (internal): anil@nexraah.in / nexraah   (any fixture account, same password)'
Write-Host "Logs: $logs   ·   stop with: .\host-demo.ps1 -Stop"
Write-Host '======================================================'
