import type { LngLat } from '@/lib/parcel/project'
import {
  OSM_ATTRIBUTION,
  OSM_DEFAULT_RADIUS_M,
  OVERPASS_ENDPOINTS,
  overpassQuery,
  parseOverpass,
} from '@/lib/parcel/roads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RoadsBody {
  latitude?: number
  longitude?: number
  /** The site polygon's origin (`parcel.originLngLat`), so roads land in the lot's frame. Defaults to the query point. */
  originLngLat?: [number, number]
  radiusM?: number
  timeoutMs?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** One Overpass mirror, one query, one deadline. Resolves the JSON or throws with a short reason. */
async function askMirror(
  url: string,
  query: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort()
  signal.addEventListener('abort', onOuter)
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // The public instances ask for an identifiable client (406 / 429 otherwise).
        'user-agent': 'Pascal lot drop-in (https://pascal.app)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error(`http-${resp.status}`)
    return await resp.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout')
    throw error instanceof Error ? error : new Error('fetch-error')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuter)
  }
}

/**
 * The public mirrors come and go (one refuses connections, another sits on
 * a 504 for half a minute): ask them two at a time, first good answer wins,
 * the loser is aborted, the next pair only runs when both failed.
 */
async function fetchOverpass(
  query: string,
  timeoutMs: number,
): Promise<{ json: unknown } | { reason: string }> {
  const reasons: string[] = []
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 2) {
    const pair = OVERPASS_ENDPOINTS.slice(i, i + 2)
    const race = new AbortController()
    try {
      const json = await Promise.any(
        pair.map((url) => askMirror(url, query, timeoutMs, race.signal)),
      )
      race.abort()
      return { json }
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error]
      for (const e of errors) reasons.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { reason: reasons.join(', ') || 'fetch-failed' }
}

/**
 * POST /api/parcel/roads  { latitude, longitude, originLngLat?, radiusM? }
 *
 * The real streets around a lot from OpenStreetMap (Overpass), projected
 * into the site plan frame in metres. Keyless. Fail-soft: a network miss
 * answers `{ ok: false, reason, roads: [] }` with 502 so the caller can fall
 * back to the most north-facing edge instead of breaking the drop-in.
 */
export async function POST(request: Request) {
  let body: RoadsBody
  try {
    body = (await request.json()) as RoadsBody
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { ok: false, error: 'latitude and longitude are required' },
      { status: 400 },
    )
  }
  const o = body.originLngLat
  const origin: LngLat =
    Array.isArray(o) && Number.isFinite(Number(o[0])) && Number.isFinite(Number(o[1]))
      ? [Number(o[0]), Number(o[1])]
      : [lng, lat]
  const radiusM = clamp(Number(body.radiusM) || OSM_DEFAULT_RADIUS_M, 60, 1200)
  const timeoutMs = clamp(Number(body.timeoutMs) || 15000, 2000, 25000)

  const answer = await fetchOverpass(overpassQuery(lat, lng, radiusM), timeoutMs)
  if (!('json' in answer)) {
    return Response.json({ ok: false, reason: answer.reason, roads: [] }, { status: 502 })
  }

  const roads = parseOverpass(answer.json, origin, { clipRadiusM: radiusM * 1.15 })
  return Response.json({
    ok: true,
    roads,
    attribution: OSM_ATTRIBUTION,
    center: { latitude: lat, longitude: lng },
    originLngLat: origin,
    radiusM,
  })
}
