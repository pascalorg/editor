param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

try {
  if ([Console]::IsInputRedirected) {
    $null = [Console]::In.ReadToEnd()
  }
} catch {
}

$browserNames = @(
  "chrome.exe",
  "chrome-headless-shell.exe",
  "chromium.exe",
  "msedge.exe"
)

$automationPattern = [regex]::new(
  "(?i)(--headless|--remote-debugging-pipe|playwright_chromiumdev_profile|ms-playwright|--screenshot=|--dump-dom|ha-pr-(chrome|edge)-profile|puppeteer)",
  [System.Text.RegularExpressions.RegexOptions]::Compiled
)

function Test-BrowserProcess {
  param([object]$Process)

  return $browserNames -contains ([string]$Process.Name).ToLowerInvariant()
}

function Test-AutomationBrowserProcess {
  param([object]$Process)

  if (-not (Test-BrowserProcess -Process $Process)) {
    return $false
  }

  if ([string]$Process.Name -ieq "chrome-headless-shell.exe") {
    return $true
  }

  $commandLine = [string]$Process.CommandLine
  return $automationPattern.IsMatch($commandLine)
}

function Get-BrowserRoot {
  param(
    [object]$Process,
    [hashtable]$ProcessesById
  )

  $root = $Process
  while ($ProcessesById.ContainsKey([int]$root.ParentProcessId)) {
    $parent = $ProcessesById[[int]$root.ParentProcessId]
    if (-not (Test-BrowserProcess -Process $parent)) {
      break
    }

    $root = $parent
  }

  return $root
}

try {
  $allProcesses = @(Get-CimInstance Win32_Process)
  $processesById = @{}
  foreach ($process in $allProcesses) {
    $processesById[[int]$process.ProcessId] = $process
  }

  $candidateRoots = @{}
  foreach ($process in $allProcesses) {
    if (-not (Test-AutomationBrowserProcess -Process $process)) {
      continue
    }

    $root = Get-BrowserRoot -Process $process -ProcessesById $processesById
    $candidateRoots[[int]$root.ProcessId] = $root
  }

  if ($candidateRoots.Count -eq 0) {
    exit 0
  }

  $processesToStop = @{}
  $queue = [System.Collections.Generic.Queue[int]]::new()
  foreach ($rootId in $candidateRoots.Keys) {
    $queue.Enqueue([int]$rootId)
  }

  while ($queue.Count -gt 0) {
    $processId = $queue.Dequeue()
    if ($processesToStop.ContainsKey($processId)) {
      continue
    }

    if (-not $processesById.ContainsKey($processId)) {
      continue
    }

    $process = $processesById[$processId]
    if (-not (Test-BrowserProcess -Process $process)) {
      continue
    }

    $processesToStop[$processId] = $process
    foreach ($child in $allProcesses | Where-Object { [int]$_.ParentProcessId -eq $processId }) {
      if (Test-BrowserProcess -Process $child) {
        $queue.Enqueue([int]$child.ProcessId)
      }
    }
  }

  foreach ($processId in ($processesToStop.Keys | Sort-Object -Descending)) {
    if ($DryRun) {
      continue
    }

    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
} catch {
  exit 0
}
