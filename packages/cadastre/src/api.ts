const API_VERSION = 'v3'
const ADMIN_API_VERSION = 'v3.1'

export type ParcelQuery =
  | { kind: 'administrative'; mahalleId: number; ada: string; parsel: string }
  | { kind: 'point'; latitude: number; longitude: number }

export type ParcelResult = {
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

export type Region = {
  id: number
  name: string
}

export async function fetchParcel(
  q: ParcelQuery,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal }
): Promise<ParcelResult | null> {
  const doFetch = opts?.fetch ?? globalThis.fetch

  let url = ''
  if (q.kind === 'administrative') {
    url = `https://cbsapi.tkgm.gov.tr/megsiswebapi.${API_VERSION}/api/parsel/${q.mahalleId}/${q.ada}/${q.parsel}`
  } else {
    url = `https://cbsapi.tkgm.gov.tr/megsiswebapi.${API_VERSION}/api/parsel/${q.latitude}/${q.longitude}`
  }

  const res = await doFetch(url, { signal: opts?.signal })

  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`TKGM API error: HTTP ${res.status}`)
  }

  const data = await res.json() as any

  // 404 with JSON body {"Message":"Parsel Bulunamadı..."}
  if (data?.Message?.includes('Bulunamadı') || data?.Message?.includes('bulunamadı')) {
    return null
  }

  if (data?.type !== 'Feature' || !data.geometry || !data.properties) {
    return null
  }

  const coords = data.geometry.coordinates[0] as [number, number][]

  let ring = coords.map((c) => ({ longitude: c[0], latitude: c[1] }))
  if (ring.length > 0) {
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first && last && first.latitude === last.latitude && first.longitude === last.longitude) {
      ring.pop()
    }
  }

  const props = data.properties
  return {
    ring,
    il: props.ilAd,
    ilce: props.ilceAd,
    mahalle: props.mahalleAd,
    mahalleId: props.mahalleId,
    ada: props.adaNo,
    parsel: props.parselNo,
    registeredAreaRaw: props.alan, // keeping it raw as per requirements
    nitelik: props.nitelik,
    pafta: props.pafta,
  }
}

export async function fetchIller(opts?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<Region[]> {
  const doFetch = opts?.fetch ?? globalThis.fetch
  const url = `https://parselsorgu.tkgm.gov.tr/app/modules/administrativeQuery/data/ilListe.json`
  
  const res = await doFetch(url, { signal: opts?.signal })
  if (!res.ok) throw new Error(`TKGM API error: HTTP ${res.status}`)
  
  const data = await res.json() as any
  if (!data?.features) throw new Error('Invalid TKGM response format')

  return data.features.map((f: any) => ({
    id: f.properties.id,
    name: f.properties.text,
  }))
}

export async function fetchIlceler(
  ilId: number,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal }
): Promise<Region[]> {
  const doFetch = opts?.fetch ?? globalThis.fetch
  const url = `https://cbsapi.tkgm.gov.tr/megsiswebapi.${ADMIN_API_VERSION}/api/idariYapi/ilceListe/${ilId}`
  
  const res = await doFetch(url, { signal: opts?.signal })
  if (!res.ok) throw new Error(`TKGM API error: HTTP ${res.status}`)
  
  const data = await res.json() as any
  if (!data?.features) throw new Error('Invalid TKGM response format')

  return data.features.map((f: any) => ({
    id: f.properties.id,
    name: f.properties.text,
  }))
}

export async function fetchMahalleler(
  ilceId: number,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal }
): Promise<Region[]> {
  const doFetch = opts?.fetch ?? globalThis.fetch
  const url = `https://cbsapi.tkgm.gov.tr/megsiswebapi.${ADMIN_API_VERSION}/api/idariYapi/mahalleListe/${ilceId}`
  
  const res = await doFetch(url, { signal: opts?.signal })
  if (!res.ok) throw new Error(`TKGM API error: HTTP ${res.status}`)
  
  const data = await res.json() as any
  if (!data?.features) throw new Error('Invalid TKGM response format')

  return data.features.map((f: any) => ({
    id: f.properties.id,
    name: f.properties.text,
  }))
}
