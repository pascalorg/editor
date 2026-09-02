/**
 * The Plans API client — an HTTP client like PlanCrafters, with no private
 * path to the sheet engines. Everything logged is what the API returned.
 *
 * Contract (plancrafters-pascal/api, verified 2026-09-02):
 *   GET  /v1/health
 *   POST /v1/plans/validate      { graph }
 *   POST /v1/intake/enrich       { address, gis:true }               → { project, site? }
 *   POST /v1/site/apply-parcel   { graph, site }                     → { applied, parcel, graph }
 *   POST /v1/plans/checks        { graph, project? }                 → { findings, counts }
 *   POST /v1/plans/documents?engine=plancrafters
 *        { graph, project?, options:{ computeEnergy, elevations, sections, projectName, date, drawnBy, coverImage, sheets? } }
 *        → { sheets:[{number,name,svg,manifest?}], skipped, warnings, notices, draft, setSize }
 */
import type { Sheet } from './store'

export type SceneGraph = {
  nodes: Record<string, unknown>
  rootNodeIds: string[]
  collections?: unknown
  materials?: unknown
  installedPlugins?: string[]
}

export type ApiCall = { ok: boolean; status: number; body: Record<string, unknown>; ms: number }

export async function call(base: string, path: string, body?: unknown, method = 'POST'): Promise<ApiCall> {
  const t0 = performance.now()
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = { error: { code: 'not_json', message: text.slice(0, 200) } }
  }
  return { ok: res.ok, status: res.status, body: parsed, ms: Math.round(performance.now() - t0) }
}

export function errorMessage(c: ApiCall): string {
  const e = c.body?.error as { code?: string; message?: string } | undefined
  return e ? `${e.code ?? c.status}: ${e.message ?? ''}`.trim() : `http ${c.status}`
}

/* ------------------------------------------------------ sheet manifest */

export interface Px {
  x: number
  y: number
}
export interface SheetItemMeta {
  i: number
  kind: string
  title?: string
  x: number
  y: number
  w: number
  h: number
}
export interface YardDimMeta {
  side: 'front' | 'rear' | 'left' | 'right'
  lenIn: number
  label: string
  a: Px
  b: Px
  mid: Px
  dir: { x: number; y: number }
}
export interface LotEdgeMeta {
  a: Px
  b: Px
  kind: string
  distIn: number
}
export interface SitePlanMeta {
  xform: { minxIn: number; minyIn: number; pxPerIn: number; offxPx: number; offyPx: number }
  lot: Px[]
  footprint: Px[]
  yards: YardDimMeta[]
  envelope: Px[]
  edges: LotEdgeMeta[]
  setbacks: { front?: number; side?: number; rear?: number; left?: number; right?: number } | null
  setbacksSource: string | null
  established: boolean
}
export interface SheetManifest {
  items: SheetItemMeta[]
  site?: SitePlanMeta
  siteNote?: string
}

/** Is the scene's site already a recorded parcel (GIS-stamped)? */
export function siteIsParcel(graph: SceneGraph): { hasSite: boolean; isParcel: boolean; apn?: string } {
  for (const node of Object.values(graph.nodes)) {
    const n = node as { type?: string; metadata?: Record<string, unknown> }
    if (n?.type !== 'site') continue
    const m = n.metadata ?? {}
    return { hasSite: true, isParcel: m.source === 'gis-parcel', apn: typeof m.apn === 'string' ? m.apn : undefined }
  }
  return { hasSite: false, isParcel: false }
}

export type DocumentsResult = {
  sheets: Sheet[]
  skipped: { id: string; reason: string }[]
  warnings: string[]
  setSize?: number
  draft?: { watermarked: boolean; missing: string[]; because?: string } | null
}

export function parseDocuments(body: Record<string, unknown>): DocumentsResult {
  const rawSheets = (body.sheets as { number: string; name: string; svg: string; manifest?: SheetManifest }[] | undefined) ?? []
  const sheets: Sheet[] = rawSheets.map((s, i) => ({
    id: `${s.number || i}`,
    number: s.number,
    title: s.name,
    svg: s.svg,
    viewBox: (s.svg.match(/viewBox="([^"]+)"/) || [])[1],
    ...(s.manifest ? { manifest: s.manifest } : {}),
  }))
  const skipped = ((body.skipped as { number: string; title?: string; reason: string }[] | undefined) ?? []).map((s) => ({
    id: `${s.number}${s.title ? ' ' + s.title : ''}`,
    reason: s.reason,
  }))
  const warnings = ((body.warnings as string[] | undefined) ?? []).map(String)
  const notices = ((body.notices as string[] | undefined) ?? []).map(String)
  const draft = (body.draft as DocumentsResult['draft']) ?? null
  return { sheets, skipped, warnings: [...warnings, ...notices], setSize: body.setSize as number | undefined, draft }
}
