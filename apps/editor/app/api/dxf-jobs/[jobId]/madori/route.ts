// Server-side only — Node.js APIs allowed.
//
// POST /api/dxf-jobs/[jobId]/madori
//   Runs the 3dMadori pipeline for an existing job:
//     1. Read original.dxf from the job folder
//     2. Call the 3dMadori /analyze-dxf API
//     3. Save the returned XML to madori_<hhmmss>.xml  ← the audit-trail file
//     4. Parse XML → MergeResult (parseMadori)
//     5. Save merged_<hhmmss>.json
//     6. Build + persist the Pascal scene
//     7. Update job.json (status, sceneId)
//
// POST /api/dxf-jobs/[jobId]/madori?rerun=1
//   Skips steps 1–3 (reuses madori_latest.xml) and re-runs steps 4–7.
//   Use when you want to re-import without calling the external API again.

import {
  appendRun,
  getJob,
  readMadoriXml,
  readOriginalDxf,
  setJobSceneId,
  updateJobStatus,
  writeMadoriXml,
  writeRunOutput,
} from '@pascal-app/core/job-store'
import { parseMadori } from '@pascal-app/core/importers'
import { type NextRequest, NextResponse } from 'next/server'
import { buildAndSaveScene } from '@/lib/dxf-scene-builder'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Read from env; falls back to localhost for local dev.
const MADORI_API_URL  = process.env['MADORI_API_URL']  ?? 'http://localhost:8000'
const MADORI_API_KEY  = process.env['MADORI_API_KEY']  ?? ''

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params
  const rerun = request.nextUrl.searchParams.get('rerun') === '1'

  // Verify the job exists
  let job: Awaited<ReturnType<typeof getJob>>
  try {
    job = await getJob(jobId)
  } catch (err) {
    return NextResponse.json({ error: `Job not found: ${jobId}` }, { status: 404 })
  }

  await updateJobStatus(jobId, 'processing')

  let xml: string

  if (rerun) {
    // Re-run: read already-saved XML
    try {
      xml = await readMadoriXml(jobId)
    } catch {
      return NextResponse.json(
        { error: 'madori_latest.xml not found — run without ?rerun=1 first' },
        { status: 400 },
      )
    }
  } else {
    // Fresh run: call 3dMadori /analyze-dxf with the original DXF file
    let dxfBuffer: Buffer
    try {
      dxfBuffer = await readOriginalDxf(jobId)
    } catch {
      return NextResponse.json({ error: 'original.dxf not found in job folder' }, { status: 400 })
    }

    const formData = new FormData()
    formData.append('file', new Blob([dxfBuffer], { type: 'application/octet-stream' }), 'original.dxf')

    let analyzeRes: Response
    try {
      analyzeRes = await fetch(`${MADORI_API_URL}/analyze-dxf`, {
        method:  'POST',
        headers: MADORI_API_KEY ? { 'x-api-key': MADORI_API_KEY } : {},
        body:    formData,
        signal:  AbortSignal.timeout(60_000),  // 60 s timeout
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJobStatus(jobId, 'failed')
      return NextResponse.json({ error: `analyze-dxf call failed: ${msg}` }, { status: 502 })
    }

    if (!analyzeRes.ok) {
      const body = await analyzeRes.text().catch(() => '')
      await updateJobStatus(jobId, 'failed')
      return NextResponse.json(
        { error: `analyze-dxf returned ${analyzeRes.status}`, detail: body },
        { status: 502 },
      )
    }

    let analyzeData: { xml?: string; [k: string]: unknown }
    try {
      analyzeData = (await analyzeRes.json()) as typeof analyzeData
    } catch {
      await updateJobStatus(jobId, 'failed')
      return NextResponse.json({ error: 'analyze-dxf response is not valid JSON' }, { status: 502 })
    }

    xml = analyzeData.xml ?? ''
    if (!xml) {
      await updateJobStatus(jobId, 'failed')
      return NextResponse.json({ error: 'analyze-dxf returned empty XML' }, { status: 502 })
    }

    // Step 3: persist XML (audit trail — allows re-run without re-calling API)
    try {
      await writeMadoriXml(jobId, xml)
    } catch (err) {
      // Non-fatal: log and continue — the import can still succeed
      console.warn(`[madori] writeMadoriXml failed for job ${jobId}:`, err)
    }
  }

  // Step 4: parse XML → MergeResult
  const { mergeResult, coords, warnings } = parseMadori(xml)

  if (mergeResult.walls.length === 0) {
    await updateJobStatus(jobId, 'failed')
    return NextResponse.json(
      { error: 'parseMadori produced no walls — check the DXF layer (基本構造（躯体）)', warnings },
      { status: 422 },
    )
  }

  // Step 5: persist merged JSON
  const runAt = new Date().toISOString()
  let mergedFile: string | null = null
  try {
    mergedFile = await writeRunOutput(jobId, 'merged', mergeResult)
  } catch (err) {
    console.warn(`[madori] writeRunOutput failed for job ${jobId}:`, err)
  }

  // Step 6: build + save Pascal scene
  let sceneResult: Awaited<ReturnType<typeof buildAndSaveScene>>
  try {
    sceneResult = await buildAndSaveScene(mergeResult, coords, {
      name:      job.jobId,   // caller can rename the scene later
      operation: 'madori_import',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await updateJobStatus(jobId, 'failed')
    return NextResponse.json({ error: `Scene save failed: ${msg}` }, { status: 500 })
  }

  // Step 7: update job record
  try {
    await appendRun(jobId, {
      runAt,
      coordsFile:     null,
      semanticFile:   null,
      mergedFile,
      channelBSkipped: true,
      madoriXmlFile:  rerun ? null : 'madori_latest.xml',
      error:          null,
    })
    await setJobSceneId(jobId, sceneResult.sceneId)
    await updateJobStatus(jobId, 'imported')
  } catch (err) {
    // Job bookkeeping failure is non-fatal — scene was already saved
    console.warn(`[madori] job record update failed for ${jobId}:`, err)
  }

  return NextResponse.json({
    sceneId:      sceneResult.sceneId,
    wallCount:    sceneResult.wallCount,
    openingCount: sceneResult.openingCount,
    zoneCount:    sceneResult.zoneCount,
    warnings:     sceneResult.warnings,
  })
}
