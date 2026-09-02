import { outerRingMetres, type PlanPoint, ringsToPlanFeet } from '@/lib/parcel/project'
import { parcelService, type ParcelResult } from '@/lib/parcel/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ResolveBody {
  address?: string
  /** Optional coordinates from a picked autocomplete suggestion — skips geocoding. */
  latitude?: number
  longitude?: number
  state?: string
}

/**
 * POST /api/parcel/resolve  { address, latitude?, longitude?, state? }
 *
 * Returns the lot ring in the site plan frame: origin at the geocoded point,
 * x east, z south, METRES (`polygonM`) plus the raw feet rings (`ringsFt`) and
 * the source lng/lat rings for provenance.
 */
export async function POST(request: Request) {
  let body: ResolveBody
  try {
    body = (await request.json()) as ResolveBody
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const address = String(body.address ?? '').trim()
  const hasCoords = Number.isFinite(body.latitude) && Number.isFinite(body.longitude)
  if (!address && !hasCoords) {
    return Response.json({ ok: false, error: 'address is required' }, { status: 400 })
  }

  let result: ParcelResult | null = null
  try {
    result = hasCoords
      ? await parcelService.parcelAt(Number(body.latitude), Number(body.longitude), {
          state: body.state,
        })
      : await parcelService.parcel(address)
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }

  if (!result?.geometry?.rings?.length) {
    return Response.json({ ok: false, error: 'no parcel found for that address' }, { status: 404 })
  }

  const { latitude, longitude } = result.coordinates
  const origin: [number, number] = [longitude, latitude]
  const ringsFt = ringsToPlanFeet(result.geometry.rings, origin)
  const polygonM: PlanPoint[] = outerRingMetres(ringsFt)

  if (polygonM.length < 3) {
    return Response.json({ ok: false, error: 'parcel geometry was unusable' }, { status: 502 })
  }

  const p = result.parcel ?? {}
  const notes: string[] = []
  if (p.note) notes.push(String(p.note))
  if (result.source === 'approximate') {
    notes.push('approximate rectangle — no parcel polygon in the registry for this point')
  }
  notes.push(
    'DRAFT — parcel geometry from a public GIS service is not a survey. Confirm corners and setbacks against a recorded plat.',
  )

  return Response.json({
    ok: true,
    apn: p.apn ?? '',
    county: p.county ?? '',
    state: p.state ?? '',
    zip: p.zip ?? '',
    zoning: p.zoning ?? '',
    lotAreaSqFt: p.lotAreaSqFt ?? 0,
    lotWidthFt: p.lotWidthFt ?? 0,
    lotDepthFt: p.lotDepthFt ?? 0,
    lotPerimeterFt: p.lotPerimeterFt ?? 0,
    originLngLat: origin,
    geocodedBy: result.source,
    matchPrecision: result.source === 'approximate' ? 'approximate' : 'parcel',
    notes,
    address: result.address ?? null,
    polygonM,
    ringsFt,
    ringsLngLat: result.geometry.rings,
    bounds: result.geometry.bounds,
  })
}
