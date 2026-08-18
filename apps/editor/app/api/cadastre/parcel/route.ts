import { fetchParcel, type ParcelQuery } from '@pascal-app/cadastre'
import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = await guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const searchParams = request.nextUrl.searchParams
  let query: ParcelQuery

  const mahalleIdRaw = searchParams.get('mahalleId')
  const latRaw = searchParams.get('lat')
  const lonRaw = searchParams.get('lon')

  if (mahalleIdRaw) {
    const mahalleId = Number(mahalleIdRaw)
    const ada = searchParams.get('ada')
    const parsel = searchParams.get('parsel')

    if (
      !Number.isFinite(mahalleId) ||
      !ada ||
      !parsel ||
      ada.trim() === '' ||
      parsel.trim() === ''
    ) {
      return sceneApiJson(request, { error: 'Invalid administrative parameters' }, { status: 400 })
    }
    query = { kind: 'administrative', mahalleId, ada, parsel }
  } else if (latRaw && lonRaw) {
    const latitude = Number(latRaw)
    const longitude = Number(lonRaw)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return sceneApiJson(request, { error: 'Invalid coordinate parameters' }, { status: 400 })
    }
    query = { kind: 'point', latitude, longitude }
  } else {
    return sceneApiJson(request, { error: 'Missing parameters' }, { status: 400 })
  }

  try {
    const fetchWithCache: typeof fetch = (url, init) => {
      return fetch(url, { ...init, next: { revalidate: 3600 } })
    }

    const parcel = await fetchParcel(query, { fetch: fetchWithCache, direct: true })
    if (!parcel) {
      return sceneApiJson(request, { found: false }, { status: 200 })
    }
    return sceneApiJson(request, { found: true, parcel })
  } catch (error) {
    console.error('Cadastre proxy error:', error)
    return sceneApiJson(
      request,
      { error: 'The land registry service is unavailable right now. Please try again later.' },
      { status: 502 },
    )
  }
}
