import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { fetchParcel } from '@pascal-app/cadastre'
import { readSiteBuildable } from '@pascal-app/core'
import type { AnyNode, SiteNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { safeFetch } from '../lib/safe-fetch.js'
import type { SceneOperations } from '../operations/scene-operations.js'
import { publishLiveSceneSnapshot } from './live-sync.js'

export const searchParcelSchema = z.object({
  query: z.union([
    z.object({
      kind: z.literal('administrative'),
      mahalleId: z.number(),
      ada: z.string(),
      parsel: z.string(),
    }),
    z.object({
      kind: z.literal('point'),
      latitude: z.number(),
      longitude: z.number(),
    }),
  ]),
})

export const applyParcelSchema = z.object({
  parcelData: z.any().describe('The full parcel result returned by search_parcel'),
  northOffset: z
    .number()
    .optional()
    .describe('True north bearing offset in degrees (0 = north up)'),
})

export const setSetbacksSchema = z.object({
  defaultSetback: z.number().min(0).optional(),
  edges: z
    .array(
      z.object({
        index: z
          .string()
          .describe('The index of the edge in the polygon (0, 1, 2, ...). Stringified number.'),
        role: z.enum(['road', 'side', 'rear']),
        distance: z.number().min(0),
      }),
    )
    .optional(),
})

export const getBuildableAreaSchema = z.object({})

const tkgmFetchAdapter = async (url: any, init?: any): Promise<Response> => {
  if (typeof url !== 'string') url = url.toString()
  try {
    const result = await safeFetch(url)
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(result.buffer.toString('utf-8')),
    } as Response
  } catch (err: any) {
    // safeFetch throws McpError with status in its data or message
    if (err instanceof McpError && (err.data as any)?.status === 404) {
      return { ok: false, status: 404 } as Response
    }
    throw err
  }
}

export async function executeSearchParcel(params: z.infer<typeof searchParcelSchema>) {
  try {
    const result = await fetchParcel(params.query, { fetch: tkgmFetchAdapter, direct: true })
    if (!result) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Arsa bulunamadı. Girdiğiniz parametreleri kontrol edin.',
          },
        ],
        isError: true,
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `TKGM API hatası: ${error.message}` }],
      isError: true,
    }
  }
}

export async function executeApplyParcelToSite(
  params: z.infer<typeof applyParcelSchema>,
  operations: SceneOperations,
) {
  const site = operations.getSiteNode()
  if (!site) {
    throw new McpError(ErrorCode.InvalidParams, 'Sahne içinde site (arsa) düğümü bulunamadı.')
  }

  const result = params.parcelData
  if (!result?.ring || !Array.isArray(result.ring)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Geçersiz parcelData. search_parcel sonucunu aynen iletmelisiniz.',
    )
  }

  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity
  for (const pt of result.ring) {
    if (pt.longitude < minLon) minLon = pt.longitude
    if (pt.longitude > maxLon) maxLon = pt.longitude
    if (pt.latitude < minLat) minLat = pt.latitude
    if (pt.latitude > maxLat) maxLat = pt.latitude
  }

  const centerLon = (minLon + maxLon) / 2
  const centerLat = (minLat + maxLat) / 2

  const latScale = 111320
  const lonScale = 111320 * Math.cos((centerLat * Math.PI) / 180)

  const localPoints = result.ring.map((pt: any) => {
    const dx = (pt.longitude - centerLon) * lonScale
    const dz = -(pt.latitude - centerLat) * latScale
    return [dx, dz] as [number, number]
  })

  const parcelRecord = {
    source: 'tkgm' as const,
    il: result.il,
    ilce: result.ilce,
    mahalle: result.mahalle,
    mahalleId: result.mahalleId,
    ada: result.ada,
    parsel: result.parsel,
    registeredArea: result.registeredAreaRaw ? parseFloat(result.registeredAreaRaw) : undefined,
    nitelik: result.nitelik,
    pafta: result.pafta,
    fetchedAt: new Date().toISOString(),
    edited: false,
  }

  operations.updateNode(site.id, {
    polygon: {
      type: 'polygon',
      points: localPoints,
    },
    parcel: parcelRecord,
    latitude: centerLat,
    longitude: centerLon,
    northOffset: params.northOffset ?? (site as any).northOffset ?? 0,
  })

  operations.undo(0) // push history entry via applyPatch or something? updateNode already pushes

  await publishLiveSceneSnapshot(operations, 'apply_parcel_to_site')

  return {
    content: [
      { type: 'text' as const, text: 'Parsel sahneye uygulandı. Site poligonu güncellendi.' },
    ],
  }
}

export async function executeSetSetbacks(
  params: z.infer<typeof setSetbacksSchema>,
  operations: SceneOperations,
) {
  const site = operations.getSiteNode() as SiteNode | null
  if (!site) {
    throw new McpError(ErrorCode.InvalidParams, 'Sahne içinde site (arsa) düğümü bulunamadı.')
  }

  const currentSetbacks = site.setbacks || {}
  const newSetbacks = { ...currentSetbacks }

  if (params.edges) {
    for (const edge of params.edges) {
      newSetbacks[edge.index] = {
        role: edge.role,
        distance: edge.distance,
      }
    }
  }

  const updates: Partial<SiteNode> = {
    setbacks: newSetbacks,
  }

  if (params.defaultSetback !== undefined) {
    updates.defaultSetback = params.defaultSetback
  }

  operations.updateNode(site.id, updates as Partial<AnyNode>)

  await publishLiveSceneSnapshot(operations, 'set_setbacks')

  return {
    content: [{ type: 'text' as const, text: 'Çekme mesafeleri güncellendi.' }],
  }
}

export function executeGetBuildableArea(
  params: z.infer<typeof getBuildableAreaSchema>,
  operations: SceneOperations,
) {
  const site = operations.getSiteNode() as SiteNode | null
  if (!site) {
    throw new McpError(ErrorCode.InvalidParams, 'Sahne içinde site (arsa) düğümü bulunamadı.')
  }

  const buildable = readSiteBuildable(site.polygon?.points, site)

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(buildable, null, 2) }],
  }
}

export function registerParcelTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  operations: SceneOperations,
) {
  server.tool(
    'search_parcel',
    'Search for a parcel (arazi/arsa) in TKGM by district/island/parcel or coordinates. Does NOT modify the scene.',
    searchParcelSchema.shape,
    async (params) => {
      return executeSearchParcel(params as any)
    },
  )

  server.tool(
    'apply_parcel_to_site',
    'Applies a found parcel to the site node in the scene. Will replace the site polygon and update its location data.',
    applyParcelSchema.shape,
    async (params) => {
      return executeApplyParcelToSite(params as any, operations)
    },
  )

  server.tool(
    'set_setbacks',
    'Sets setbacks (çekme mesafesi) for the site edges (road, side, rear) and an optional default setback.',
    setSetbacksSchema.shape,
    async (params) => {
      return executeSetSetbacks(params as any, operations)
    },
  )

  server.tool(
    'get_buildable_area',
    'Gets the buildable area derived from the site polygon and setbacks (yapılaşma alanı).',
    getBuildableAreaSchema.shape,
    async (params) => {
      return executeGetBuildableArea(params as any, operations)
    },
  )
}
