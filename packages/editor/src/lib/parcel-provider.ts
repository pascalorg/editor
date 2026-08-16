export type LonLat = { longitude: number; latitude: number }

export type ParcelQuery =
  | { kind: 'administrative'; mahalleId: number; ada: string; parsel: string }
  | { kind: 'point'; latitude: number; longitude: number }

export type ParcelResult = {
  ring: LonLat[]
  label: string // "Ankara / Çankaya / 2705 ada 15 parsel"
  registeredAreaRaw?: string
  attributes: Record<string, string>
}

export type RegionSource = {
  getIller(signal?: AbortSignal): Promise<{ id: number; name: string }[]>
  getIlceler(ilId: number, signal?: AbortSignal): Promise<{ id: number; name: string }[]>
  getMahalleler(ilceId: number, signal?: AbortSignal): Promise<{ id: number; name: string }[]>
}

export type ParcelProvider = {
  id: string
  search(query: ParcelQuery, signal?: AbortSignal): Promise<ParcelResult | null>
  regions?: RegionSource
}
