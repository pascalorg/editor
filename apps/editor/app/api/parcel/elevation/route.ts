import { parcelService } from '@/lib/parcel/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ElevationBody {
  /** `{ lat, lng }` points — the shape `server-parcel.cjs#elevation` expects. */
  points?: { lat?: number; lng?: number }[]
  deadlineMs?: number
}

/** POST /api/parcel/elevation { points: [{lat, lng}, ...] } — USGS, keyless. */
export async function POST(request: Request) {
  let body: ElevationBody
  try {
    body = (await request.json()) as ElevationBody
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const points = Array.isArray(body.points) ? body.points.slice(0, 256) : []
  if (points.length === 0) {
    return Response.json({ ok: false, error: 'points[] is required' }, { status: 400 })
  }

  try {
    const results = await parcelService.elevation(
      points as never,
      body.deadlineMs ? { deadlineMs: body.deadlineMs } : undefined,
    )
    return Response.json({ ok: true, results })
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
