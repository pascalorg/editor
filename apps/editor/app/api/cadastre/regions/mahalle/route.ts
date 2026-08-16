import { NextRequest, NextResponse } from 'next/server'
import { fetchMahalleler } from '@pascal-app/cadastre'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const ilceIdRaw = request.nextUrl.searchParams.get('ilceId')
  const ilceId = Number(ilceIdRaw)
  if (!ilceIdRaw || !Number.isFinite(ilceId)) {
    return sceneApiJson(request, { error: 'Invalid ilceId' }, { status: 400 })
  }

  try {
    const fetchWithCache: typeof fetch = (url, init) => {
      return fetch(url, { ...init, next: { revalidate: 86400 } })
    }

    const regions = await fetchMahalleler(ilceId, { fetch: fetchWithCache, direct: true })
    return sceneApiJson(request, regions)
  } catch (error) {
    console.error('Cadastre proxy error:', error)
    return sceneApiJson(request, { error: 'TKGM servislerine şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.' }, { status: 502 })
  }
}
