import { type JobPipeline, createJob, updateJobStatus } from '@pascal-app/core/job-store'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let dxfText: string
  let previewDataUrl: string
  let params: { wallThicknessMin: number; wallThicknessMax: number }
  let pipeline: JobPipeline

  try {
    const body = (await req.json()) as {
      dxfText?: string
      previewDataUrl?: string
      params?: { wallThicknessMin: number; wallThicknessMax: number }
      pipeline?: JobPipeline
    }
    dxfText       = body.dxfText ?? ''
    previewDataUrl = body.previewDataUrl ?? ''
    params        = body.params   ?? { wallThicknessMin: 0.08, wallThicknessMax: 0.4 }
    pipeline      = body.pipeline === 'madori' ? 'madori' : 'geo+ai'
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!dxfText) {
    return NextResponse.json({ error: 'dxfText is required' }, { status: 400 })
  }

  const dxfBuffer = new TextEncoder().encode(dxfText)

  let previewBuffer: Uint8Array
  if (previewDataUrl.startsWith('data:')) {
    const base64 = previewDataUrl.slice(previewDataUrl.indexOf(',') + 1)
    previewBuffer = Buffer.from(base64, 'base64')
  } else {
    previewBuffer = new Uint8Array(0)
  }

  try {
    const job = await createJob(dxfBuffer, previewBuffer, params, pipeline)
    await updateJobStatus(job.jobId, 'processing')
    return NextResponse.json({ jobId: job.jobId, pipeline: job.pipeline })
  } catch (err) {
    console.error('[dxf-jobs] createJob failed:', err)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
