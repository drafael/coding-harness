param(
  [Parameter(Mandatory = $false)]
  [string]$OutputDirectory = "native/build/windows-job-helper"
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $runtimeRoot "native/windows-job-helper.c"
$output = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot $OutputDirectory))
$first = Join-Path $output "first"
$second = Join-Path $output "second"
$artifact = Join-Path $output "artifact"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe is unavailable"
}
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) {
  throw "Visual Studio x64 C++ tools are unavailable"
}
$developerShell = Join-Path $installation "Common7/Tools/VsDevCmd.bat"
if (-not (Test-Path $developerShell)) {
  throw "Visual Studio developer shell is unavailable"
}

Remove-Item -Recurse -Force $output -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $first, $second, $artifact | Out-Null

function Build-Helper([string]$directory) {
  $executable = Join-Path $directory "job-helper.exe"
  $object = Join-Path $directory "job-helper.obj"
  $command = "`"$developerShell`" -no_logo -arch=amd64 -host_arch=amd64 && cl.exe /nologo /W4 /WX /O2 /MT /GS /guard:cf /Fo`"$object`" /Fe`"$executable`" `"$source`" /link advapi32.lib /Brepro /guard:cf /DYNAMICBASE /NXCOMPAT"
  & $env:ComSpec /d /s /c $command | Out-Host
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $executable)) {
    throw "MSVC failed to build the Windows Job Object helper"
  }
  return $executable
}

$firstExecutable = Build-Helper $first
$secondExecutable = Build-Helper $second
$firstHash = (Get-FileHash -Algorithm SHA256 $firstExecutable).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -Algorithm SHA256 $secondExecutable).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) {
  throw "Windows Job Object helper builds are not reproducible: $firstHash != $secondHash"
}

$bytes = [System.IO.File]::ReadAllBytes($firstExecutable)
if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
  throw "Windows Job Object helper is not a PE image"
}
$peOffset = [BitConverter]::ToUInt32($bytes, 0x3c)
if ($peOffset + 6 -gt $bytes.Length -or [BitConverter]::ToUInt16($bytes, [int]$peOffset + 4) -ne 0x8664) {
  throw "Windows Job Object helper is not an x64 PE image"
}

$artifactExecutable = Join-Path $artifact "job-helper.exe"
$artifactManifest = Join-Path $artifact "job-helper.json"
Copy-Item $firstExecutable $artifactExecutable
$toolset = (& $env:ComSpec /d /s /c "`"$developerShell`" -no_logo -arch=amd64 -host_arch=amd64 && cl.exe /Bv 2>&1" | Out-String).Trim()
$sourceCommit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA.ToLowerInvariant() } else { (& git rev-parse HEAD).Trim().ToLowerInvariant() }
$workflowRunId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { "local-untrusted" }
$workflowRunAttempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { "local-untrusted" }
$workflowSha = if ($env:AUTOPILOT_WORKFLOW_SHA) { $env:AUTOPILOT_WORKFLOW_SHA.ToLowerInvariant() } else { $sourceCommit }
$trustedWorkflow = $env:GITHUB_ACTIONS -eq "true" -and $env:GITHUB_EVENT_NAME -eq "workflow_dispatch" `
  -and $env:GITHUB_REPOSITORY -eq "drafael/coding-harness" -and $env:GITHUB_WORKFLOW -eq "Autopilot Windows Job Object helper"
$sourceHash = (Get-FileHash -Algorithm SHA256 $source).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  schemaVersion = 1
  platform = "win32"
  architecture = "x64"
  protocolVersion = 1
  provenance = if ($trustedWorkflow) { "github-actions-workflow-dispatch" } else { "local-untrusted" }
  sourceCommit = $sourceCommit
  sourceSha256 = $sourceHash
  workflowRunId = $workflowRunId
  workflowRunAttempt = $workflowRunAttempt
  workflowSha = $workflowSha
  workflowName = if ($env:GITHUB_WORKFLOW) { $env:GITHUB_WORKFLOW } else { "local-untrusted" }
  workflowRef = if ($env:GITHUB_WORKFLOW_REF) { $env:GITHUB_WORKFLOW_REF } else { "local-untrusted" }
  workflowEvent = if ($env:GITHUB_EVENT_NAME) { $env:GITHUB_EVENT_NAME } else { "local-untrusted" }
  repository = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { "local-untrusted" }
  toolset = $toolset
  sha256 = $firstHash
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8NoBOM $artifactManifest

$checkedDirectory = Join-Path $runtimeRoot "native/bin/win32-x64"
$checkedExecutable = Join-Path $checkedDirectory "job-helper.exe"
$checkedManifest = Join-Path $checkedDirectory "job-helper.json"
if (Test-Path $checkedExecutable) {
  if (-not (Test-Path $checkedManifest)) {
    throw "checked Windows helper is missing its manifest"
  }
  $checkedHash = (Get-FileHash -Algorithm SHA256 $checkedExecutable).Hash.ToLowerInvariant()
  if ($checkedHash -ne $firstHash) {
    throw "checked Windows helper differs from the reproducible build: $checkedHash != $firstHash"
  }
}

Write-Host "Windows Job Object helper SHA-256: $firstHash"
Write-Host "Windows Job Object helper source commit: $sourceCommit"
Write-Host "Windows Job Object helper source SHA-256: $sourceHash"
Write-Host "Windows Job Object helper workflow run: $workflowRunId"
Write-Host "Windows Job Object helper toolset: $toolset"
Write-Host "Artifact directory: $artifact"
