const DEFAULT_BASE_URL = 'http://127.0.0.1:3002'
const DEFAULT_SCENE_ID = 'thermal-power-reference-layout-v2-smoke'

const baseUrl = (process.env.DEV_SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
const sceneId = process.env.DEV_SMOKE_SCENE_ID || DEFAULT_SCENE_ID

function readPositiveInt(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const totalTimeoutMs = readPositiveInt('DEV_SMOKE_TOTAL_TIMEOUT_MS', 10 * 60_000)
const smokeStartedAt = Date.now()

const checks = [
  {
    name: 'health',
    path: '/api/health',
    timeoutMs: readPositiveInt('DEV_SMOKE_HEALTH_TIMEOUT_MS', 20_000),
    retries: readPositiveInt('DEV_SMOKE_HEALTH_RETRIES', 12),
  },
  {
    name: 'home',
    path: '/',
    timeoutMs: readPositiveInt('DEV_SMOKE_HOME_TIMEOUT_MS', 30_000),
    retries: readPositiveInt('DEV_SMOKE_HOME_RETRIES', 12),
  },
  {
    name: 'scene',
    path: `/scene/${encodeURIComponent(sceneId)}`,
    timeoutMs: readPositiveInt('DEV_SMOKE_SCENE_TIMEOUT_MS', 60_000),
    retries: readPositiveInt('DEV_SMOKE_SCENE_RETRIES', 12),
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRemainingBudgetMs() {
  return totalTimeoutMs - (Date.now() - smokeStartedAt)
}

function assertWithinTotalBudget() {
  const remainingMs = getRemainingBudgetMs()
  if (remainingMs <= 0) {
    throw new Error(`dev server smoke exceeded total timeout ${totalTimeoutMs}ms`)
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  assertWithinTotalBudget()
  const controller = new AbortController()
  const effectiveTimeoutMs = Math.min(timeoutMs, getRemainingBudgetMs())
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`
  let lastError

  for (let attempt = 1; attempt <= check.retries; attempt += 1) {
    assertWithinTotalBudget()
    const startedAt = Date.now()

    try {
      const response = await fetchWithTimeout(url, check.timeoutMs)
      const elapsedMs = Date.now() - startedAt

      if (response.ok) {
        console.log(`${check.name}: ${response.status} in ${elapsedMs}ms`)
        await response.arrayBuffer()
        return
      }

      lastError = new Error(`${check.name}: HTTP ${response.status}`)
      await response.arrayBuffer()
    } catch (error) {
      lastError = error
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError)
    console.log(`${check.name}: attempt ${attempt}/${check.retries} failed: ${message}`)
    assertWithinTotalBudget()
    await sleep(Math.min(5_000 * attempt, 30_000, getRemainingBudgetMs()))
  }

  throw lastError ?? new Error(`${check.name}: failed`)
}

try {
  for (const check of checks) {
    await runCheck(check)
  }

  console.log(`dev server smoke passed: ${baseUrl} in ${Date.now() - smokeStartedAt}ms`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`dev server smoke failed: ${baseUrl}`)
  console.error(message)
  process.exitCode = 1
}
