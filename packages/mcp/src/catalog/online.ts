import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { type AssetInput, ItemNode } from '@pascal-app/core/schema'
import { bundledCatalog } from './bundled'
import type { AssetCatalog, CatalogSnapshot } from './types'

export const PASCAL_PUBLIC_CATALOG_URL = 'https://editor.pascal.app/api/plugins/boots/catalog'
const PUBLIC_ASSET_ORIGIN = 'https://byrpxoiotywskoojsrzd.supabase.co'
const MAX_ITEMS = 10_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

type OnlineOptions = {
  dataDir: string
  fetch?: typeof globalThis.fetch
  now?: () => number
  cacheMs?: number
  timeoutMs?: number
  maxResponseBytes?: number
}

type CatalogSetting = { online: boolean; key: string }
type OnlineItems = { items: AssetInput[]; excludedCount: number }

export function createPascalOnlineCatalog(options: OnlineOptions): AssetCatalog {
  const configPath = path.join(options.dataDir, 'catalog.json')
  const now = options.now ?? Date.now
  let cache: (OnlineItems & { key: string; expiresAt: number }) | undefined
  let pending: { key: string; promise: Promise<OnlineItems> } | undefined

  return {
    usesNetwork: true,
    async snapshot(): Promise<CatalogSnapshot> {
      const bundled = await bundledCatalog.snapshot()
      bundled.status = {
        ...bundled.status,
        connectCommand: 'pascal catalog connect',
        message:
          'Using bundled items. Optionally run pascal catalog connect for the free public online catalog; no account is required. Generation uses separate credits.',
      }
      const unavailable = (message: string): CatalogSnapshot => ({
        items: bundled.items,
        status: {
          ...bundled.status,
          mode: 'unavailable',
          onlineCount: 0,
          disconnectCommand: 'pascal catalog disconnect',
          message,
        },
      })
      let setting: CatalogSetting
      try {
        setting = await readSetting(configPath)
      } catch {
        cache = undefined
        return unavailable(
          'The catalog setting is invalid or unreadable. Bundled items remain available; run pascal catalog disconnect to reset it.',
        )
      }
      if (!setting.online) {
        cache = undefined
        return bundled
      }
      try {
        let online: OnlineItems
        let fromCache = false
        if (cache?.key === setting.key && cache.expiresAt > now()) {
          online = cache
          fromCache = true
        } else {
          if (pending?.key !== setting.key) {
            pending = {
              key: setting.key,
              promise: fetchOnlineItems(options),
            }
          }
          const request = pending
          try {
            online = await request.promise
          } finally {
            if (pending === request) pending = undefined
          }
        }
        // A disconnect must win over a fetch that was already in flight.
        const current = await readSetting(configPath)
        if (!current.online) {
          cache = undefined
          return bundled
        }
        if (current.key !== setting.key) {
          cache = undefined
          return unavailable(
            'The catalog setting changed during the request. Retry to use the current selection; bundled items remain available.',
          )
        }
        if (!fromCache)
          cache = { ...online, key: setting.key, expiresAt: now() + (options.cacheMs ?? 60_000) }
        const items = new Map(bundled.items.map((item) => [item.id, item]))
        let excludedCount = online.excludedCount
        for (const item of online.items) {
          if (items.has(item.id)) excludedCount += 1
          else items.set(item.id, item)
        }
        const onlineCount = items.size - bundled.items.length
        return {
          items: structuredClone([...items.values()]),
          status: {
            mode: 'online',
            bundledCount: bundled.items.length,
            onlineCount,
            excludedCount,
            accountLinked: false,
            accountRequired: false,
            disconnectCommand: 'pascal catalog disconnect',
            message: `${onlineCount} additional free public catalog items are available. No account is required. ${excludedCount} invalid or duplicate entries were excluded. Online models require network access; generation uses separate credits.`,
          },
        }
      } catch {
        cache = undefined
        try {
          if (!(await readSetting(configPath)).online) return bundled
        } catch {}
        return unavailable(
          'The online catalog is unavailable. Bundled items remain available; no account is required for public catalog access. Retry pascal catalog status or disconnect.',
        )
      }
    },
  }
}

async function readSetting(configPath: string): Promise<CatalogSetting> {
  try {
    const info = await stat(configPath)
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid catalog setting')
    const raw = await readFile(configPath, 'utf8')
    if (Buffer.byteLength(raw) > 4096) throw new Error('Invalid catalog setting')
    const setting: unknown = JSON.parse(raw)
    if (
      !setting ||
      typeof setting !== 'object' ||
      Array.isArray(setting) ||
      Object.keys(setting).some((key) => key !== 'schemaVersion' && key !== 'online') ||
      (setting as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (setting as { online?: unknown }).online !== 'boolean'
    )
      throw new Error('Invalid catalog setting')
    return {
      online: (setting as { online: boolean }).online,
      key: `${info.ino}:${info.mtimeMs}:${raw}`,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { online: false, key: 'missing' }
    throw error
  }
}

async function fetchOnlineItems(options: OnlineOptions): Promise<OnlineItems> {
  const response = await (options.fetch ?? globalThis.fetch)(PASCAL_PUBLIC_CATALOG_URL, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  })
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new Error('Catalog unavailable')
  }
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body.cancel().catch(() => {})
    throw new Error('Catalog too large')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error('Catalog too large')
      text += decoder.decode(chunk.value, { stream: true })
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const body: unknown = JSON.parse(text + decoder.decode())
  if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items))
    throw new Error('Invalid catalog')
  const rows = (body as { items: unknown[] }).items
  if (rows.length > MAX_ITEMS || rows.length === 0) throw new Error('Invalid catalog size')
  const items: AssetInput[] = []
  let excludedCount = 0
  const seen = new Set<string>()
  for (const row of rows) {
    const item = parsePublicAsset(row)
    if (!item || seen.has(item.id)) excludedCount += 1
    else {
      seen.add(item.id)
      items.push(item)
    }
  }
  if (!items.length) throw new Error('No usable catalog items')
  return { items, excludedCount }
}

function parsePublicAsset(value: unknown): AssetInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  // Check before schema defaults: absent dimensions must never become an invented 1 m cube.
  if (
    !Array.isArray(row.dimensions) ||
    row.dimensions.length !== 3 ||
    row.dimensions.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
  )
    return null
  if (row.isDraft === true || (row.source !== 'library' && row.source !== 'community')) return null
  if (
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    row.id.length > 256 ||
    ['__proto__', 'constructor', 'prototype'].includes(row.id)
  )
    return null
  if (
    !publicAssetUrl(row.src) ||
    (row.thumbnail !== '' && !publicAssetUrl(row.thumbnail)) ||
    (row.floorPlanUrl !== undefined && row.floorPlanUrl !== '' && !publicAssetUrl(row.floorPlanUrl))
  )
    return null
  const result = ItemNode.shape.asset.safeParse(value)
  if (!result.success || result.data.scale.some((n) => n <= 0)) return null
  return result.data
}

function publicAssetUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.origin === PUBLIC_ASSET_ORIGIN &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/storage/v1/object/public/items/')
    )
  } catch {
    return false
  }
}
