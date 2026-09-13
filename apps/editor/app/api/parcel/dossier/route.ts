/**
 * POST /api/parcel/dossier  { address?, latitude?, longitude?, layers?, geometry?, adjacent? }
 *
 * The Pascal Map location dossier (https://map.pascal.app/api/docs) — one
 * lookup for the parcel (with its FRONTAGE and neighbours), flood, zoning,
 * code basis, elevation, utilities, soils, wetlands, structures and
 * boundaries. The key stays here on the server (`MAP_API_KEY`); the client
 * never sees it. Without a key the route answers `{ ok: false, reason }`
 * with 200 so the lot drop-in falls back to the parcel / roads / elevation
 * routes quietly. The upstream error envelope, 429's Retry-After and the
 * 90 s dossier budget are passed through as reasons, never swallowed.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAP_API = process.env.MAP_API_BASE ?? 'https://map.pascal.app/api'
/** The sections the plan set acts on — everything but weather / tax / market / permits. */
const DEFAULT_LAYERS = [
  'parcel',
  'zoning',
  'flood',
  'code_basis',
  'elevation',
  'utilities',
  'soils',
  'wetlands',
  'structures',
  'boundaries',
]
/** The docs ask for up to 90 s for a full dossier. */
const TIMEOUT_MS = 90_000

interface DossierBody {
  address?: string
  latitude?: number
  longitude?: number
  layers?: string[]
  geometry?: boolean
  adjacent?: boolean
}

export async function POST(request: Request) {
  let body: DossierBody
  try {
    body = (await request.json()) as DossierBody
  } catch {
    return Response.json({ ok: false, reason: 'invalid JSON body' }, { status: 400 })
  }
  const key = process.env.MAP_API_KEY
  if (!key) return Response.json({ ok: false, reason: 'no MAP_API_KEY on the server' })
  const address = String(body.address ?? '').trim()
  const hasCoords = Number.isFinite(body.latitude) && Number.isFinite(body.longitude)
  if (!address && !hasCoords) {
    return Response.json({ ok: false, reason: 'address or coordinates required' }, { status: 400 })
  }
  const params = new URLSearchParams()
  // the address geocodes at rooftop precision; coordinates are exact — the
  // lot panel's presets carry both, and the address is the better key
  if (address) params.set('address', address)
  else params.set('ll', `${body.latitude},${body.longitude}`)
  const layers = Array.isArray(body.layers) && body.layers.length > 0 ? body.layers : DEFAULT_LAYERS
  params.set('layers', layers.join(','))
  params.set('include_geometry', body.geometry === false ? 'false' : 'true')
  params.set('include_adjacent', body.adjacent === false ? 'false' : 'true')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const upstream = await fetch(`${MAP_API}/v1/location?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const text = await upstream.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      return Response.json({ ok: false, reason: `Pascal Map answered ${upstream.status} without JSON` })
    }
    if (!upstream.ok) {
      const err = (json as { error?: { code?: string; message?: string; request_id?: string } }).error
      const retry = upstream.headers.get('retry-after')
      return Response.json({
        ok: false,
        reason: `Pascal Map ${err?.code ?? upstream.status}: ${err?.message ?? 'request failed'}${retry ? ` (retry after ${retry} s)` : ''}`,
        code: err?.code ?? String(upstream.status),
        requestId: err?.request_id,
        retryAfterS: retry ? Number(retry) : undefined,
      })
    }
    return Response.json({ ok: true, dossier: json })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return Response.json({
      ok: false,
      reason: aborted ? `Pascal Map did not answer within ${TIMEOUT_MS / 1000} s` : (error instanceof Error ? error.message : 'dossier lookup failed'),
    })
  } finally {
    clearTimeout(timer)
  }
}
