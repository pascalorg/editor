import type { ParcelProvider, ParcelQuery, ParcelResult } from '@pascal-app/editor'

export const cadastreProvider: ParcelProvider = {
  id: 'tkgm-proxy',
  search: async (query: ParcelQuery, signal?: AbortSignal): Promise<ParcelResult | null> => {
    const url = new URL('/api/cadastre/parcel', window.location.origin)
    if (query.kind === 'administrative') {
      url.searchParams.set('mahalleId', query.mahalleId.toString())
      url.searchParams.set('ada', query.ada)
      url.searchParams.set('parsel', query.parsel)
    } else {
      url.searchParams.set('lat', query.latitude.toString())
      url.searchParams.set('lon', query.longitude.toString())
    }

    const response = await fetch(url.toString(), { signal })
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Cadastre search failed: ${response.statusText}`)
    }

    const data = await response.json()
    if (!data || !data.properties) return null

    // Transform raw TKGM format to Editor ParcelResult
    // Geometry should be in LonLat
    const ring = data.geometry?.coordinates?.[0]?.[0]?.map((coord: [number, number]) => ({
      longitude: coord[0],
      latitude: coord[1]
    })) || []

    return {
      ring,
      label: `${data.properties.ilAd} / ${data.properties.ilceAd} / ${data.properties.mahalleAd} / ${data.properties.adaNo} ada ${data.properties.parselNo} parsel`,
      registeredAreaRaw: data.properties.alan,
      attributes: {
        zeminKmdurumu: data.properties.zeminKmdurumu,
        mevkii: data.properties.mevkii,
        nitelik: data.properties.nitelik,
        pafta: data.properties.pafta,
      }
    }
  },
  regions: {
    getIller: async (signal?: AbortSignal) => {
      const res = await fetch('/api/cadastre/regions/il', { signal })
      if (!res.ok) throw new Error('Failed to fetch iller')
      return res.json()
    },
    getIlceler: async (ilId: number, signal?: AbortSignal) => {
      const res = await fetch(`/api/cadastre/regions/ilce?ilId=${ilId}`, { signal })
      if (!res.ok) throw new Error('Failed to fetch ilceler')
      return res.json()
    },
    getMahalleler: async (ilceId: number, signal?: AbortSignal) => {
      const res = await fetch(`/api/cadastre/regions/mahalle?ilceId=${ilceId}`, { signal })
      if (!res.ok) throw new Error('Failed to fetch mahalleler')
      return res.json()
    }
  }
}

