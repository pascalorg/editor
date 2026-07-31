import { fail, handler, ok } from '@panel/lib/api'
import { requireSession } from '@panel/lib/auth/guard'
import { listJobs, startJobWorker } from '@panel/lib/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/jobs?status= — the queue, newest first. */
export const GET = handler(async (request: Request) => {
  const guard = await requireSession()
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired')

  startJobWorker()
  const status = new URL(request.url).searchParams.get('status') ?? undefined
  return ok({ jobs: await listJobs(status) })
})
