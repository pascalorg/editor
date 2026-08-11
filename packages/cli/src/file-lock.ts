import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { CliError } from './errors.js'

interface LockRecord {
  schemaVersion: 1
  pid: number
  token: string
  createdAt: string
}

const DEFAULT_TIMEOUT_MS = 10_000
const INVALID_LOCK_GRACE_MS = 5_000
const MAX_LOCK_AGE_MS = 30 * 60_000

export async function withFileLock<T>(
  lockPath: string,
  code: string,
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const token = randomUUID()
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS

  while (!(await tryAcquire(lockPath, token))) {
    if (await reclaimStaleLock(lockPath)) continue
    if (Date.now() >= deadline) throw new CliError(code, message)
    await delay(100)
  }

  try {
    return await action()
  } finally {
    await removeOwnedLock(lockPath, token)
  }
}

async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    try {
      const record: LockRecord = {
        schemaVersion: 1,
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }
      await handle.writeFile(`${JSON.stringify(record)}\n`)
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

async function reclaimStaleLock(lockPath: string): Promise<boolean> {
  let ageMs: number
  try {
    ageMs = Date.now() - (await stat(lockPath)).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }

  let record: LockRecord | null = null
  try {
    record = JSON.parse(await readFile(lockPath, 'utf8')) as LockRecord
  } catch {
    if (ageMs < INVALID_LOCK_GRACE_MS) return false
  }

  if (isValidRecord(record) && isProcessRunning(record.pid) && ageMs < MAX_LOCK_AGE_MS) {
    return false
  }

  try {
    await rm(lockPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

function isValidRecord(record: LockRecord | null): record is LockRecord {
  return Boolean(
    record?.schemaVersion === 1 &&
      Number.isSafeInteger(record.pid) &&
      record.pid > 0 &&
      typeof record.token === 'string' &&
      typeof record.createdAt === 'string',
  )
}

async function removeOwnedLock(lockPath: string, token: string): Promise<void> {
  try {
    const record = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockRecord>
    if (record.token === token) await rm(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
