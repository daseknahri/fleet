# Runs the authoritative Mongo-backed P0 test suites against 127.0.0.1:27018.
# Loads backend/.env.docker, then overrides BC_DB_URI to the host-published port.
[CmdletBinding()]
param(
  [string]$DbUri = 'mongodb://admin:admin@127.0.0.1:27018/bookcars?authSource=admin&appName=bookcars&replicaSet=rs0&directConnection=true',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo 'backend/.env.docker'

if (-not (Test-Path $envFile)) { throw "Missing $envFile" }

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq '' -or $line.StartsWith('#')) { return }
  $idx = $line.IndexOf('=')
  if ($idx -lt 1) { return }
  $key = $line.Substring(0, $idx).Trim()
  $val = $line.Substring($idx + 1).Trim()
  if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) {
    $val = $val.Substring(1, $val.Length - 2)
  }
  Set-Item -Path "Env:$key" -Value $val
}

$env:BC_DB_URI = $DbUri
$env:NODE_ENV = 'test'
$env:NODE_OPTIONS = '--experimental-vm-modules'

if (-not $SkipBuild) {
  Write-Host '=== backend build ==='
  # Build the runnable ESM artifact with production Babel import extensions.
  # Jest itself is switched to test mode only after the artifact exists.
  $env:NODE_ENV = 'development'
  npm --prefix (Join-Path $repo 'backend') run build
  if ($LASTEXITCODE -ne 0) { throw "backend build failed ($LASTEXITCODE)" }
}

$suites = @(
  '__tests__/contractEvidence.integration.test.ts',
  '__tests__/contractLifecycle.test.ts',
  '__tests__/p0RouteAuthorizationFinancial.integration.test.ts',
  '__tests__/maintenanceReceiptSchedule.integration.test.ts',
  '__tests__/reportReconciliation.integration.test.ts',
  '__tests__/securityBaseline.integration.test.ts',
  '__tests__/providerCurrent.integration.test.ts'
)

Write-Host '=== P0 suites ==='
$env:NODE_ENV = 'test'
Push-Location (Join-Path $repo 'backend')
try {
  npx jest --config jest.config.json --runInBand --no-coverage --forceExit @suites
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
Write-Host "P0_EXIT=$code"
exit $code
