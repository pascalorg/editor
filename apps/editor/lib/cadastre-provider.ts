import { parseRegisteredArea } from '@pascal-app/cadastre'
import type { ParcelProvider, ParcelQuery, ParcelResult } from '@pascal-app/editor'

/**
 * Error text is written as the exact English source strings the editor's `tr`
 * dictionary is keyed by, so the importer can translate whatever surfaces here
 * without a message-code table in between.
 */
const UNAVAILABLE = 'The land registry service is unavailable right now. Please try again later.'
const UNREACHABLE = 'Could not reach the land registry. Check your connection and try again.'

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(UNREACHABLE)
  }
  if (!response.ok) throw new Error(UNAVAILABLE)
  return response.json()
}

type ProxyParcel = {
  ring: { latitude: number; longitude: number }[]
  il: string
  ilce: string
  mahalle: string
  mahalleId: number
  ada: string
  parsel: string
  registeredAreaRaw?: string
  nitelik?: string
  pafta?: string
}

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

    // The proxy hands back `@pascal-app/cadastre`'s already-parsed shape, not
    // TKGM's GeoJSON — it fetches with `direct: true` and normalises there.
    const data = (await getJson(url.toString(), signal)) as {
      found?: boolean
      parcel?: ProxyParcel
    } | null
    if (!data?.found || !data.parcel) return null

    const parcel = data.parcel
    return {
      ring: parcel.ring ?? [],
      il: parcel.il,
      ilce: parcel.ilce,
      mahalle: parcel.mahalle,
      mahalleId: parcel.mahalleId,
      ada: parcel.ada,
      parsel: parcel.parsel,
      registeredArea: parseRegisteredArea(parcel.registeredAreaRaw),
      attributes: {
        nitelik: parcel.nitelik,
        pafta: parcel.pafta,
      },
    }
  },
  regions: {
    getIller: (signal?: AbortSignal) =>
      getJson('/api/cadastre/regions/il', signal) as Promise<{ id: number; name: string }[]>,
    getIlceler: (ilId: number, signal?: AbortSignal) =>
      getJson(`/api/cadastre/regions/ilce?ilId=${ilId}`, signal) as Promise<
        { id: number; name: string }[]
      >,
    getMahalleler: (ilceId: number, signal?: AbortSignal) =>
      getJson(`/api/cadastre/regions/mahalle?ilceId=${ilceId}`, signal) as Promise<
        { id: number; name: string }[]
      >,
  },
}
