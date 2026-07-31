import { ulid } from 'ulid'
import { exec, query, queryOne, type RowDataPacket, transaction } from './db'
import type { Job, JobStatus } from './types'

interface JobRow extends RowDataPacket {
  public_id: string
  kind: string
  site_name: string | null
  status: JobStatus
  progress: number
  error_text: string | null
  attempts: number
  queued_by_email: string
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
}

const SELECT = `
  SELECT j.public_id, j.kind, s.name AS site_name, j.status, j.progress, j.error_text,
         j.attempts, u.email AS queued_by_email, j.queued_at, j.started_at, j.finished_at
    FROM jobs j
    JOIN users u ON u.id = j.queued_by
    LEFT JOIN sites s ON s.id = j.site_id
`

function toJob(row: JobRow): Job {
  return {
    id: row.public_id,
    kind: row.kind,
    siteId: row.site_name,
    status: row.status,
    progress: row.progress,
    errorText: row.error_text,
    attempts: row.attempts,
    queuedBy: row.queued_by_email,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  }
}

export async function listJobs(status?: string): Promise<Job[]> {
  const rows =
    status && status !== 'All'
      ? await query<JobRow>(`${SELECT} WHERE j.status = ? ORDER BY j.queued_at DESC LIMIT 100`, [
          status,
        ])
      : await query<JobRow>(`${SELECT} ORDER BY j.queued_at DESC LIMIT 100`)
  return rows.map(toJob)
}

export async function getJob(publicId: string): Promise<Job | null> {
  const row = await queryOne<JobRow>(`${SELECT} WHERE j.public_id = ?`, [publicId])
  return row ? toJob(row) : null
}

export async function enqueueJob(opts: {
  kind: string
  siteId?: number | null
  payload?: Record<string, unknown> | null
  queuedBy: number
}): Promise<string> {
  const publicId = ulid()
  await exec(
    `INSERT INTO jobs (public_id, kind, payload, site_id, queued_by) VALUES (?, ?, ?, ?, ?)`,
    [
      publicId,
      opts.kind,
      opts.payload ? JSON.stringify(opts.payload) : null,
      opts.siteId ?? null,
      opts.queuedBy,
    ],
  )
  return publicId
}

export async function retryJob(publicId: string): Promise<Job | null> {
  const job = await getJob(publicId)
  if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return null

  await exec(
    `UPDATE jobs
        SET status = 'queued', progress = 0, error_text = NULL,
            started_at = NULL, finished_at = NULL, queued_at = NOW()
      WHERE public_id = ?`,
    [publicId],
  )
  return getJob(publicId)
}

export async function cancelJob(publicId: string): Promise<Job | null> {
  const job = await getJob(publicId)
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return null

  await exec("UPDATE jobs SET status = 'cancelled', finished_at = NOW() WHERE public_id = ?", [
    publicId,
  ])
  return getJob(publicId)
}

/* ——— worker ———
 *
 * FIFO on a single worker, as the contract assumes. Claiming uses
 * `SELECT ... FOR UPDATE SKIP LOCKED` over the (status, queued_at) index, so
 * adding a second worker later needs no change here — two of them simply never
 * hand out the same row.
 *
 * The loop lives in-process because this app is a single Node server. On more
 * than one instance it must move to its own process, or every instance will run
 * its own timer; the claim itself stays correct either way, only the wasted
 * wake-ups multiply.
 */

const TICK_MS = 1500
const PROVISION_STEPS = 5

let worker: ReturnType<typeof setInterval> | undefined

export function startJobWorker(): void {
  if (worker) return
  worker = setInterval(() => {
    void tick().catch((err) => console.error('[jobs] worker tick failed:', err))
  }, TICK_MS)
  // Never hold the process open for the sake of the queue.
  worker.unref?.()
}

async function tick(): Promise<void> {
  await advanceRunning()
  await claimNext()
}

/** Moves one queued job into `running`, oldest first. */
async function claimNext(): Promise<void> {
  const running = await queryOne<RowDataPacket & { n: number }>(
    "SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'",
  )
  if ((running?.n ?? 0) > 0) return // single worker: one job at a time

  await transaction(async (cx) => {
    const [rows] = await cx.execute<Array<RowDataPacket & { id: number }>>(
      `SELECT id FROM jobs
        WHERE status = 'queued'
        ORDER BY queued_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    )
    if (!rows[0]) return
    await cx.execute(
      "UPDATE jobs SET status = 'running', progress = 0, started_at = NOW(), attempts = attempts + 1 WHERE id = ?",
      [rows[0].id],
    )
  })
}

/**
 * Advances the running job's progress. Real work would report its own progress;
 * this stands in for it so the queue, its progress bar and the site "Setting up"
 * state are observable end to end without an editor attached.
 */
async function advanceRunning(): Promise<void> {
  const row = await queryOne<
    RowDataPacket & {
      id: number
      public_id: string
      progress: number
      kind: string
      site_id: number | null
    }
  >(
    "SELECT id, public_id, progress, kind, site_id FROM jobs WHERE status = 'running' ORDER BY started_at LIMIT 1",
  )
  if (!row) return

  const next = Math.min(100, row.progress + Math.ceil(100 / PROVISION_STEPS))

  if (next < 100) {
    await exec('UPDATE jobs SET progress = ? WHERE id = ?', [next, row.id])
    return
  }

  await exec("UPDATE jobs SET status = 'done', progress = 100, finished_at = NOW() WHERE id = ?", [
    row.id,
  ])

  // A finished provisioning job is what flips its site out of `setup`.
  if (row.kind === 'site_provision' && row.site_id) {
    await exec("UPDATE sites SET status = 'active' WHERE id = ? AND status = 'setup'", [
      row.site_id,
    ])
  }
}

/** Cheap change token for the SSE stream — avoids re-sending an identical list. */
export async function jobsFingerprint(): Promise<string> {
  const row = await queryOne<RowDataPacket & { n: number; sum: number | null; last: Date | null }>(
    'SELECT COUNT(*) AS n, SUM(progress) AS sum, MAX(queued_at) AS last FROM jobs',
  )
  return `${row?.n ?? 0}:${row?.sum ?? 0}:${row?.last?.getTime() ?? 0}`
}
