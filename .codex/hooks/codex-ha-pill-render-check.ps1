param(
  [string]$BaseUrl = $env:PASCAL_EDITOR_URL,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

try {
  if ([Console]::IsInputRedirected) {
    $null = [Console]::In.ReadToEnd()
  }
} catch {
}

function Invoke-GitLines {
  param([string[]]$Arguments)

  $output = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0 -or $null -eq $output) {
    return @()
  }

  return @($output)
}

function Write-Block {
  param([string]$Reason)

  [Console]::Out.WriteLine((@{
    decision = "block"
    reason = $Reason
  } | ConvertTo-Json -Compress))
}

try {
  $inside = @(Invoke-GitLines -Arguments @("rev-parse", "--is-inside-work-tree"))
  if ($inside.Count -eq 0 -or $inside[0] -notmatch "true") {
    exit 0
  }

  $root = @(Invoke-GitLines -Arguments @("rev-parse", "--show-toplevel"))
  if ($root.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($root[0])) {
    Set-Location -LiteralPath $root[0]
  }

  $changedPaths = @()
  $changedPaths += Invoke-GitLines -Arguments @("diff", "--name-only", "--")
  $changedPaths += Invoke-GitLines -Arguments @("diff", "--cached", "--name-only", "--")
  $changedPaths = @($changedPaths | Sort-Object -Unique)
  if ($changedPaths.Count -eq 0) {
    exit 0
  }

  $relevantPattern = [regex]::new(
    "(?i)(^apps/editor/app/page\.tsx$|home-assistant|smart-home|room-control|ha-pill)",
    [System.Text.RegularExpressions.RegexOptions]::Compiled
  )
  $relevantPaths = @($changedPaths | Where-Object { $relevantPattern.IsMatch($_) })
  if ($relevantPaths.Count -eq 0) {
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = "http://localhost:3002"
  }
  $BaseUrl = $BaseUrl.TrimEnd("/")

  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/health" -TimeoutSec 5
  } catch {
    Write-Block "HA pill rendered-browser hook skipped because $BaseUrl is not serving /api/health. Start the editor on 3002 or set PASCAL_EDITOR_URL before finalizing HA pill changes."
    exit 0
  }

  $scriptPath = Join-Path $PWD ".codex\hooks\codex-ha-pill-render-check.mjs"
  $output = & node $scriptPath --url $BaseUrl 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Block "HA pill rendered-browser persistence check failed. $($output -join "`n")"
    exit 0
  }

  if (-not $Quiet) {
    foreach ($line in $output) {
      [Console]::Out.WriteLine($line)
    }
  }
} catch {
  Write-Block "HA pill rendered-browser persistence hook crashed: $($_.Exception.Message)"
  exit 0
}
