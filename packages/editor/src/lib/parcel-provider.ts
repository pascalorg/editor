export type LonLat = { longitude: number; latitude: number }

export type ParcelQuery =
  | { kind: 'administrative'; mahalleId: number; ada: string; parsel: string }
  | { kind: 'point'; latitude: number; longitude: number }

export type ParcelResult = {
  ring: LonLat[]
  /**
   * The identity fields the site node's `parcel` record needs. Structured
   * rather than one composed "Ankara / Çankaya / 2705 ada 15 parsel" line,
   * because the panel has to render each part under its own translated label —
   * and because a point query has no form input to recover them from.
   */
  il: string
  ilce: string
  mahalle: string
  mahalleId: number
  ada: string
  parsel: string
  /**
   * Registry-recorded area in m², already a number. Providers normalise their
   * own registry's formatting; the editor never sees a localised string.
   */
  registeredArea?: number
  attributes: Record<string, string | undefined>
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
