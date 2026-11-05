# Local CI gate for Gestion Auto / BookCars.
# Mirrors .github/workflows/p0-regression.yml on the developer machine:
#   backend build + Mongo-backed P0 suites (via __scripts/run-p0-tests.ps1),
#   admin lint + build, frontend lint + build, production dependency audits.
# Differences from the hosted workflow: no Docker service management (the P0
# suites run against the already-running local stack on 127.0.0.1:27018,
# exactly like run-p0-tests.ps1) and no dependency installs unless -Install
# is passed. Every step runs even if an earlier one fails, a pass/fail
# summary is printed at the end, and the exit code is non-zero on failure.
[CmdletBinding()]
param(
  [switch]$Install
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$results = @()
$auditSummaries = @()
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

function Invoke-Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host "=== $Name ==="
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = 0
  try {
    & $Body
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  } catch {
    Write-Host "STEP ERROR: $($_.Exception.Message)"
    $code = 1
  }
  $sw.Stop()
  $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $script:results += [pscustomobject]@{ Step = $Name; ExitCode = $code; Seconds = $secs }
  Write-Host "--- $Name exit=$code (${secs}s) ---"
}

function Copy-EnvIfMissing {
  param([string]$App)
  $envPath = Join-Path $repo "$App/.env"
  $dockerEnv = Join-Path $repo "$App/.env.docker"
  if (-not (Test-Path $envPath) -and (Test-Path $dockerEnv)) {
    Copy-Item $dockerEnv $envPath
    Write-Host "Copied $App/.env.docker -> $App/.env (host-side builds need it)"
  }
}

if ($Install) {
  foreach ($app in 'backend', 'admin', 'frontend') {
    Invoke-Step "npm install ($app)" { npm --prefix (Join-Path $repo $app) install }
  }
}

Copy-EnvIfMissing 'admin'
Copy-EnvIfMissing 'frontend'

Invoke-Step 'Frontend lint' { npm --prefix (Join-Path $repo 'frontend') run lint }
Invoke-Step 'Frontend build' { npm --prefix (Join-Path $repo 'frontend') run build }
Invoke-Step 'Admin lint' { npm --prefix (Join-Path $repo 'admin') run lint }
Invoke-Step 'Admin build' { npm --prefix (Join-Path $repo 'admin') run build }

Invoke-Step 'Backend build + P0 suites (run-p0-tests.ps1)' {
  $psExe = (Get-Process -Id $PID).Path
  & $psExe -NoProfile -File (Join-Path $PSScriptRoot 'run-p0-tests.ps1')
}

foreach ($app in 'backend', 'admin', 'frontend') {
  Invoke-Step "Dependency audit ($app)" {
    $out = npm --prefix (Join-Path $repo $app) audit --omit=dev 2>&1 | Out-String
    Write-Host $out
    $line = ($out -split "`n" | Where-Object { $_ -match 'vulnerabilit' } | Select-Object -Last 1)
    if ($line) { $script:auditSummaries += "${app}: $($line.Trim())" }
  }
}

$totalSw.Stop()
Write-Host ''
Write-Host '================ LOCAL CI SUMMARY ================'
foreach ($r in $results) {
  $status = if ($r.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0,-52} {1}  exit={2}  {3}s" -f $r.Step, $status, $r.ExitCode, $r.Seconds)
}
foreach ($a in $auditSummaries) { Write-Host "audit: $a" }
Write-Host ("Total wall time: {0}s" -f [math]::Round($totalSw.Elapsed.TotalSeconds, 1))
$failed = @($results | Where-Object { $_.ExitCode -ne 0 })
if ($failed.Count -gt 0) {
  Write-Host "LOCAL CI: FAIL ($($failed.Count) step(s) failed)"
  exit 1
}
Write-Host 'LOCAL CI: PASS'
exit 0
