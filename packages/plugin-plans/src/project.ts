/**
 * The project record — who, where, for whom — SAVED IN THE SCENE.
 *
 * It lives on the site node's metadata (`metadata.plancrafters.project`) so
 * it travels with the scene file, and it is the same shape the Plans API's
 * `project` body field takes (plancrafters-pascal features/project/schema.ts:
 * every field optional, so a partial record is always valid). Site
 * enrichment fills jurisdiction / climate / codes into it; what a person
 * typed always wins over what a lookup derived.
 */
import { useScene } from '@pascal-app/core'

export interface Address {
  street?: string
  city?: string
  state?: string
  zip?: string
}
export interface ProjectRecord {
  identity?: {
    projectName?: string
    projectNumber?: string
    apn?: string
    address?: Address
    owner?: { name?: string; license?: string }
    designer?: { name?: string; license?: string }
    projectType?: string
  }
  firms?: {
    designer?: { company?: string; contact?: string; phone?: string; email?: string; license?: string; logoText?: string }
    engineer?: { company?: string; contact?: string; phone?: string; email?: string; license?: string; discipline?: string }
    owner?: { name?: string; license?: string }
  }
  jurisdiction?: { city?: string; county?: string; state?: string }
  documentStatus?: 'preliminary' | 'permit-set' | 'construction-set'
  revisions?: { id?: string; date?: string; description?: string; by?: string }[]
  [k: string]: unknown
}

type AnyNode = Record<string, unknown> & { id: string; type: string }
const KEY = 'plancrafters'

function scene() {
  return useScene.getState() as unknown as {
    nodes: Record<string, AnyNode>
    updateNode: (id: string, data: Record<string, unknown>) => void
  }
}

function siteNode(): AnyNode | undefined {
  return Object.values(scene().nodes).find((n) => n.type === 'site')
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Deep merge; `over` wins wherever it has a value (empty strings count as "no value"). */
export function merge<T>(base: T, over: unknown): T {
  if (!isObj(over)) return (over === undefined || over === '' ? base : (over as T))
  const out: Record<string, unknown> = isObj(base) ? { ...(base as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === '') continue
    out[k] = isObj(v) ? merge(out[k], v) : v
  }
  return out as T
}

export function readProjectRecord(): ProjectRecord {
  const site = siteNode()
  const meta = (site?.metadata ?? {}) as Record<string, unknown>
  const pc = (meta[KEY] ?? {}) as Record<string, unknown>
  if (isObj(pc.project)) return pc.project as ProjectRecord
  // legacy: a plancrafters:project node on the graph
  for (const n of Object.values(scene().nodes)) {
    if (n.type === 'plancrafters:project' && isObj(n.project)) return n.project as ProjectRecord
  }
  return {}
}

export function writeProjectRecord(rec: ProjectRecord): void {
  const site = siteNode()
  if (!site) return
  const meta = (site.metadata ?? {}) as Record<string, unknown>
  const pc = isObj(meta[KEY]) ? (meta[KEY] as Record<string, unknown>) : {}
  scene().updateNode(site.id, { metadata: { ...meta, [KEY]: { ...pc, project: rec, updatedAt: new Date().toISOString() } } })
}

/** Apply a partial record on top of what is saved (typed values win). */
export function updateProject(patch: ProjectRecord): void {
  writeProjectRecord(merge(readProjectRecord(), patch))
}

/** Fold a record the API derived (enrichment) UNDER what a person typed. */
export function absorbDerivedRecord(derived: unknown): void {
  if (!isObj(derived)) return
  writeProjectRecord(merge(derived as ProjectRecord, readProjectRecord()))
}

export function addressLine(rec: ProjectRecord): string {
  const a = rec.identity?.address
  if (!a?.street) return ''
  return [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export interface ProjectSummary {
  name: string
  address: string
  apn?: string
  jurisdiction?: string
  designer?: string
  firm?: string
  owner?: string
  status: 'preliminary' | 'permit-set' | 'construction-set'
  /** Fields the title block needs that are still empty. */
  missing: string[]
}

export function summarize(rec: ProjectRecord): ProjectSummary {
  const j = rec.jurisdiction
  const missing: string[] = []
  if (!rec.identity?.projectName) missing.push('project name')
  if (!rec.identity?.address?.street) missing.push('address')
  if (!rec.identity?.designer?.name && !rec.firms?.designer?.company) missing.push('designer')
  if (!rec.identity?.owner?.name) missing.push('owner')
  return {
    name: rec.identity?.projectName ?? '',
    address: addressLine(rec),
    apn: rec.identity?.apn,
    jurisdiction: j?.city ?? j?.county ?? j?.state,
    designer: rec.identity?.designer?.name,
    firm: rec.firms?.designer?.company,
    owner: rec.identity?.owner?.name,
    status: rec.documentStatus ?? 'preliminary',
    missing,
  }
}

/** True when the record has anything worth sending. */
export function hasRecord(rec: ProjectRecord): boolean {
  return Object.keys(rec).length > 0
}
