import type { AssetInput } from '@pascal-app/core/schema'

export type CatalogStatus = {
  mode: 'bundled' | 'online' | 'unavailable'
  bundledCount: number
  onlineCount: number
  excludedCount?: number
  accountLinked: false
  accountRequired: false
  connectCommand?: string
  disconnectCommand?: string
  message: string
}

export type CatalogSnapshot = {
  items: AssetInput[]
  status: CatalogStatus
}

export interface AssetCatalog {
  readonly usesNetwork: boolean
  snapshot(): Promise<CatalogSnapshot>
}
