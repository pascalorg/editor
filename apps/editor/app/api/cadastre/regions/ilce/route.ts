import { fetchIlceler } from '@pascal-app/cadastre'
import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = await guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const ilIdRaw = request.nextUrl.searchParams.get('ilId')
  const ilId = Number(ilIdRaw)
  if (!ilIdRaw || !Number.isFinite(ilId)) {
    return sceneApiJson(request, { error: 'Invalid ilId' }, { status: 400 })
  }

  try {
    const fetchWithCache: typeof fetch = (url, init) => {
      return fetch(url, { ...init, next: { revalidate: 86400 } })
    }

    const regions = await fetchIlceler(ilId, { fetch: fetchWithCache, direct: true })
    return sceneApiJson(request, regions)
  } catch (error) {
    console.error('Cadastre proxy error:', error)
    return sceneApiJson(
      request,
      { error: 'The land registry service is unavailable right now. Please try again later.' },
      { status: 502 },
    )
  }
}
