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

function ConvertFrom-Numstat {
  param([string[]]$Lines)

  $result = @{}
  foreach ($line in $Lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $parts = $line -split "`t"
    if ($parts.Count -lt 3 -or $parts[0] -eq "-" -or $parts[1] -eq "-") {
      continue
    }

    $added = 0
    $deleted = 0
    if (-not [int]::TryParse($parts[0], [ref]$added)) {
      continue
    }
    if (-not [int]::TryParse($parts[1], [ref]$deleted)) {
      continue
    }

    $path = ($parts[2..($parts.Count - 1)] -join "`t")
    $result[$path] = $added + $deleted
  }

  return $result
}

function Find-DiffChurn {
  param(
    [string]$Scope,
    [string[]]$DiffArgs
  )

  $largeChangeLineThreshold = 300
  $maxRealChangeRatio = 0.5
  $normal = ConvertFrom-Numstat -Lines (Invoke-GitLines -Arguments ($DiffArgs + @("--numstat", "--")))
  $ignoreWhitespace = ConvertFrom-Numstat -Lines (Invoke-GitLines -Arguments ($DiffArgs + @("-w", "--numstat", "--")))
  $findings = @()

  foreach ($entry in $normal.GetEnumerator()) {
    $path = [string]$entry.Key
    $changed = [int]$entry.Value
    if ($changed -lt $largeChangeLineThreshold) {
      continue
    }

    $realChanged = 0
    if ($ignoreWhitespace.ContainsKey($path)) {
      $realChanged = [int]$ignoreWhitespace[$path]
    }

    if ($realChanged -le [math]::Floor($changed * $maxRealChangeRatio)) {
      $findings += [pscustomobject]@{
        Scope = $Scope
        Path = $path
        Changed = $changed
        RealChanged = $realChanged
      }
    }
  }

  return $findings
}

try {
  $inside = Invoke-GitLines -Arguments @("rev-parse", "--is-inside-work-tree")
  if ($inside.Count -eq 0 -or $inside[0] -notmatch "true") {
    exit 0
  }

  $root = Invoke-GitLines -Arguments @("rev-parse", "--show-toplevel")
  if ($root.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($root[0])) {
    Set-Location -LiteralPath $root[0]
  }

  $findings = @()
  $findings += Find-DiffChurn -Scope "staged" -DiffArgs @("diff", "--cached")
  $findings += Find-DiffChurn -Scope "unstaged" -DiffArgs @("diff")

  if ($findings.Count -eq 0) {
    exit 0
  }

  $details = $findings |
    Sort-Object -Property @{ Expression = { $_.Changed - $_.RealChanged }; Descending = $true } |
    Select-Object -First 5 |
    ForEach-Object {
      "$($_.Scope): $($_.Path) has $($_.Changed) changed lines, $($_.RealChanged) after git diff -w"
    }

  $reason = "Large whitespace-only diff churn detected. $($details -join '; '). Run git diff -w and reduce formatting or line-ending churn before finalizing."
  [Console]::Out.WriteLine((@{
    decision = "block"
    reason = $reason
  } | ConvertTo-Json -Compress))
} catch {
  exit 0
}
