<#
.SYNOPSIS
  GA-P10-OPS-BACKUP-AUTO-01 - Local backup automation for the Gestion Auto dev stack.

.DESCRIPTION
  Takes a timestamped mongodump archive of the dev database into
  artifacts/recovery/, verifies it by restoring it into a throwaway scratch
  database and comparing per-collection document counts against the source,
  drops the scratch database, applies a simple local retention rule, and
  writes a JSON summary next to the archive.

  Method follows GA-P10-RECOVERY-02: the tools run inside the running mongo
  container (docker exec) and use the backend's own database URI, which this
  script reads from the backend container's environment and passes through
  the GA_DB_URI environment variable of the exec session only. The URI is
  never printed, logged, or written to any file.

  Retention: only archives produced by THIS script are prunable - identified
  by a sibling backup-<timestamp>.json summary. The newest -Retention
  automation archives are kept; older automation archives are deleted.
  Summary JSON files are never pruned (they are the audit log), and archives
  without a sibling summary (e.g. the GA-P10-RECOVERY-02 rehearsal archives)
  are never touched.

  Scheduling is intentionally NOT installed by this script. See SETUP.md
  ("Local backups") for the documented, owner-gated Task Scheduler example.
  Nothing is sent off-host.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File __scripts\backup-local.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File __scripts\backup-local.ps1 -Retention 5 -SkipVerify
#>
param(
  [int]$Retention = 7,
  [switch]$SkipVerify
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RecoveryDir = Join-Path $RepoRoot 'artifacts\recovery'
$MongoContainer = 'bookcars-mongo-1'
$BackendContainer = 'bookcars-bc-backend-1'
$SourceDb = 'bookcars'

function Fail([string]$Message) {
  Write-Host "BACKUP FAILED: $Message"
  exit 1
}

function Invoke-MongoSh([string]$Command) {
  $out = docker exec -e "GA_DB_URI=$script:DbUri" $MongoContainer sh -c $Command
  if ($LASTEXITCODE -ne 0) { Fail "docker exec failed: $Command" }
  return $out
}

# --- Resolve the backend's database URI without ever printing it -----------
$envLines = docker exec $BackendContainer env
if ($LASTEXITCODE -ne 0) { Fail "cannot read the backend container environment (is the stack up?)" }
$script:DbUri = $null
foreach ($line in $envLines) {
  $idx = $line.IndexOf('=')
  if ($idx -gt 0) {
    $value = $line.Substring($idx + 1)
    if ($value.StartsWith('mongodb://') -or $value.StartsWith('mongodb+srv://')) { $script:DbUri = $value; break }
  }
}
if (-not $script:DbUri) { Fail 'no mongodb URI found in the backend container environment' }

if (-not (Test-Path $RecoveryDir)) { New-Item -ItemType Directory -Path $RecoveryDir | Out-Null }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archiveName = "bookcars-$timestamp.archive.gz"
$archiveHostPath = Join-Path $RecoveryDir $archiveName
$summaryName = "backup-$timestamp.json"
$summaryPath = Join-Path $RecoveryDir $summaryName
$scratchDb = "bookcars_verify_$($timestamp -replace '-', '')"
$startedAt = Get-Date

# --- Helper JS (written to temp files, copied into the mongo container) ----
$countsJsPath = Join-Path $env:TEMP "ga-counts-$timestamp.js"
$dropJsPath = Join-Path $env:TEMP "ga-drop-$timestamp.js"

function Get-Counts([string]$DbName) {
  $js = "const d = db.getSiblingDB('$DbName'); const o = {}; d.getCollectionNames().forEach((c) => { o[c] = d.getCollection(c).countDocuments() }); print(JSON.stringify(o))"
  Set-Content -Path $countsJsPath -Value $js -Encoding ASCII
  docker cp $countsJsPath "$($MongoContainer):/tmp/ga-counts.js" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'docker cp of the counts script failed' }
  $out = Invoke-MongoSh 'mongosh "$GA_DB_URI" --quiet /tmp/ga-counts.js'
  $jsonLine = $out | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
  if (-not $jsonLine) { Fail "no counts returned for database $DbName" }
  return $jsonLine | ConvertFrom-Json
}

function Counts-ToMap($CountsObject) {
  $map = @{}
  foreach ($prop in $CountsObject.PSObject.Properties) { $map[$prop.Name] = [int]$prop.Value }
  return $map
}

# --- 1. Source counts, then dump -------------------------------------------
$sourceCounts = Counts-ToMap (Get-Counts $SourceDb)
$sourceTotal = ($sourceCounts.Values | Measure-Object -Sum).Sum

$dumpTimer = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-MongoSh "mongodump --uri=`"`$GA_DB_URI`" --archive=/tmp/$archiveName --gzip" | Out-Null
$dumpTimer.Stop()
docker cp "$($MongoContainer):/tmp/$archiveName" $archiveHostPath | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'docker cp of the archive failed' }
Invoke-MongoSh "rm -f /tmp/$archiveName" | Out-Null
$archiveBytes = (Get-Item $archiveHostPath).Length
Write-Host "Archive written: $archiveName ($archiveBytes bytes, source $sourceTotal documents in $($sourceCounts.Count) collections)"

# --- 2. Verify: restore into a scratch database and compare counts ---------
$verify = $null
if (-not $SkipVerify) {
  docker cp $archiveHostPath "$($MongoContainer):/tmp/$archiveName" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'docker cp of the archive for verification failed' }
  $restoreTimer = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-MongoSh "mongorestore --uri=`"`$GA_DB_URI`" --archive=/tmp/$archiveName --gzip --nsFrom 'bookcars.*' --nsTo '$scratchDb.*'" | Out-Null
  $restoreTimer.Stop()
  Invoke-MongoSh "rm -f /tmp/$archiveName" | Out-Null

  $scratchCounts = Counts-ToMap (Get-Counts $scratchDb)
  $mismatches = @()
  $allCollections = @($sourceCounts.Keys) + @($scratchCounts.Keys) | Sort-Object -Unique
  foreach ($name in $allCollections) {
    $a = if ($sourceCounts.ContainsKey($name)) { $sourceCounts[$name] } else { 0 }
    $b = if ($scratchCounts.ContainsKey($name)) { $scratchCounts[$name] } else { 0 }
    if ($a -ne $b) { $mismatches += "$name (source $a vs restored $b)" }
  }
  $parity = $mismatches.Count -eq 0

  $dropJs = "db.getSiblingDB('$scratchDb').dropDatabase(); print(db.getSiblingDB('$scratchDb').getCollectionNames().length)"
  Set-Content -Path $dropJsPath -Value $dropJs -Encoding ASCII
  docker cp $dropJsPath "$($MongoContainer):/tmp/ga-drop.js" | Out-Null
  $dropOut = Invoke-MongoSh 'mongosh "$GA_DB_URI" --quiet /tmp/ga-drop.js'
  $remaining = ($dropOut | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
  $scratchDropped = "$remaining" -eq '0'

  $verify = [ordered]@{
    scratchDatabase = $scratchDb
    restoreSeconds = [Math]::Round($restoreTimer.Elapsed.TotalSeconds, 2)
    parity = $parity
    mismatches = $mismatches
    restoredTotal = ($scratchCounts.Values | Measure-Object -Sum).Sum
    scratchDropped = $scratchDropped
  }
  Write-Host "Verification: parity=$parity, scratch dropped=$scratchDropped"
  if (-not $parity) { Fail "count parity failed: $($mismatches -join '; ')" }
  if (-not $scratchDropped) { Fail 'scratch database was not fully dropped' }
}

# --- 3. Retention: prune older automation archives only ---------------------
$automationArchives = Get-ChildItem $RecoveryDir -Filter 'bookcars-*.archive.gz' | Where-Object {
  if ($_.Name -match '^bookcars-(.+)\.archive\.gz$') { ($_.Name -eq $archiveName) -or (Test-Path (Join-Path $RecoveryDir "backup-$($Matches[1]).json")) } else { $false }
} | Sort-Object Name -Descending
$pruned = @()
if ($automationArchives.Count -gt $Retention) {
  foreach ($old in ($automationArchives | Select-Object -Skip $Retention)) {
    Remove-Item $old.FullName -Force
    $pruned += $old.Name
  }
}
if ($pruned.Count) { Write-Host "Retention pruned: $($pruned -join ', ')" }

# --- 4. Summary artifact ------------------------------------------------------
$summary = [ordered]@{
  slice = 'GA-P10-OPS-BACKUP-AUTO-01'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  archive = $archiveName
  archiveBytes = $archiveBytes
  dumpSeconds = [Math]::Round($dumpTimer.Elapsed.TotalSeconds, 2)
  sourceDatabase = $SourceDb
  sourceCollections = $sourceCounts.Count
  sourceDocuments = $sourceTotal
  sourceCounts = $sourceCounts
  verification = $verify
  retention = [ordered]@{ keep = $Retention; pruned = $pruned }
  wallSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
  note = 'Local dev backup only. Nothing was sent off-host; scheduling and off-host retention are owner gates (see SETUP.md).'
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8
Remove-Item $countsJsPath, $dropJsPath -Force -ErrorAction SilentlyContinue
Write-Host "Summary written: $summaryName"
Write-Host 'BACKUP OK'
exit 0
