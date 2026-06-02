import { type JobStatus, updateJobStatus } from '@pascal-app/core/job-store'
import { type NextRequest, NextResponse } from 'next/server'

const VALID_STATUSES = new Set<JobStatus>([
  'pending', 'validating', 'processing', 'merged', 'imported', 'failed',
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params

  let status: JobStatus
  try {
    const body = (await req.json()) as { status?: string }
    if (!body.status || !VALID_STATUSES.has(body.status as JobStatus)) {
      return NextResponse.json({ error: 'Invalid or missing status' }, { status: 400 })
    }
    status = body.status as JobStatus
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    await updateJobStatus(jobId, status)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Job not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    console.error(`[dxf-jobs] status update failed for job ${jobId}:`, err)
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}
