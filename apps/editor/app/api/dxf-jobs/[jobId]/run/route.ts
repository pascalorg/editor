import { appendRun, updateJobStatus, writeRunOutput } from '@pascal-app/core/job-store'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params

  let coordsJSON: unknown
  let mergedData: unknown
  let semanticFile: string | null
  let channelBSkipped: boolean

  try {
    const body = (await req.json()) as {
      coordsJSON?: unknown
      mergedData?: unknown
      semanticFile?: string | null
      channelBSkipped?: boolean
    }
    coordsJSON = body.coordsJSON
    mergedData = body.mergedData
    semanticFile = body.semanticFile ?? null
    channelBSkipped = body.channelBSkipped ?? false
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!coordsJSON || !mergedData) {
    return NextResponse.json({ error: 'coordsJSON and mergedData are required' }, { status: 400 })
  }

  try {
    const runAt = new Date().toISOString()
    const [coordsFile, mergedFile] = await Promise.all([
      writeRunOutput(jobId, 'coords', coordsJSON),
      writeRunOutput(jobId, 'merged', mergedData),
    ])

    await appendRun(jobId, {
      runAt,
      coordsFile,
      semanticFile,
      mergedFile,
      channelBSkipped,
      error: null,
    })

    await updateJobStatus(jobId, 'merged')

    return NextResponse.json({ ok: true, coordsFile, mergedFile })
  } catch (err) {
    console.error(`[dxf-jobs] run failed for job ${jobId}:`, err)
    return NextResponse.json({ error: 'Failed to save run output' }, { status: 500 })
  }
}
