/**
 * The Plans API client — an HTTP client like PlanCrafters, with no private
 * path to the sheet engines (the workbench rule). Everything logged is what
 * the API returned.
 *
 * Contract (plancrafters-pascal/api, verified 2026-09-02):
 *   GET  /v1/health
 *   POST /v1/plans/validate      { graph }                          advisory
 *   POST /v1/intake/enrich       { address, gis:true, record? }     → { project, site? }
 *   POST /v1/site/apply-parcel   { graph, site }                    → { applied, parcel, graph }
 *   POST /v1/plans/checks        { graph, project? }                → { findings, counts }
 *   POST /v1/plans/documents?engine=plancrafters
 *        { graph, project?, options:{ computeEnergy:true, projectName?, coverImage? } }
 *        → { sheets:[{number,name,level?,svg}], skipped:[{number,title,reason}], warnings, notices, draft, setSize }
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

/** The scene's own project record node — address, names, state. */
export type ProjectIdentity = {
  name?: string
  address?: string
  state?: string
}

export function readProjectIdentity(graph: SceneGraph): ProjectIdentity {
  const out: ProjectIdentity = {}
  for (const node of Object.values(graph.nodes)) {
    const n = node as { type?: string; name?: string; project?: { identity?: Record<string, unknown>; jurisdiction?: { city?: string; state?: string } } }
    if (n?.type !== 'plancrafters:project') continue
    // the record lives under `project` (features/project/node.ts): identity.{projectName, address:{street,city,state,zip}}
    const id = (n.project?.identity ?? {}) as { projectName?: string; name?: string; address?: { street?: string; city?: string; state?: string; zip?: string } }
    out.name = id.projectName || id.name || n.name
    const a = id.address
    const j = n.project?.jurisdiction
    out.state = a?.state || j?.state
    // an address needs a STREET to be geocodable; city/state alone is a locale, not a site
    if (a?.street) {
      out.address = [a.street, a.city || j?.city, [a.state || j?.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    }
    break
  }
  return out
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
  const rawSheets = (body.sheets as { number: string; name: string; level?: string; svg: string }[] | undefined) ?? []
  const sheets: Sheet[] = rawSheets.map((s, i) => ({
    id: `${s.number || i}`,
    number: s.number,
    title: s.name,
    svg: s.svg,
    viewBox: (s.svg.match(/viewBox="([^"]+)"/) || [])[1],
    notes: [],
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
