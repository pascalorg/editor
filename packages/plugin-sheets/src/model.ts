/**
 * The scene is the document. Everything the Sheets workspace shows is read
 * straight out of `useScene` and every edit is a normal scene mutation, so
 * sheets travel with the scene file and ride the editor's undo stack.
 *
 * Nothing here touches the network, and nothing here imports React — the
 * generator and the tests use these functions directly.
 */
import { useScene } from '@pascal-app/core'
import {
  DEFAULT_VIEWPORT_LAYERS,
  ProjectRecordNode,
  SheetNode,
  ViewportNode,
  type ViewportLayers,
} from './schema'

export type AnyNodeLike = Record<string, unknown> & { id: string; type: string }
export type NodeMap = Record<string, AnyNodeLike>

export type SceneLike = {
  nodes: NodeMap
  updateNode: (id: string, data: Record<string, unknown>) => void
  applyNodeChanges: (changes: {
    create?: { node: unknown; parentId?: string }[]
    update?: { id: string; data: Record<string, unknown> }[]
    delete?: string[]
  }) => void
  deleteNodes: (ids: string[]) => void
}

export function scene(): SceneLike {
  return useScene.getState() as unknown as SceneLike
}

export function sceneNodes(): NodeMap {
  return scene().nodes
}

/* ------------------------------------------------------------ lookup */

export function siteNode(nodes: NodeMap): AnyNodeLike | undefined {
  return Object.values(nodes).find((n) => n?.type === 'site')
}

export function projectRecord(nodes: NodeMap): ProjectRecordNode | undefined {
  return Object.values(nodes).find((n) => n?.type === 'sheets:project-record') as
    | ProjectRecordNode
    | undefined
}

export function sheets(nodes: NodeMap): SheetNode[] {
  return (Object.values(nodes).filter((n) => n?.type === 'sheets:sheet') as SheetNode[])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.number.localeCompare(b.number))
}

export function viewports(nodes: NodeMap, sheetId: string): ViewportNode[] {
  const sheet = nodes[sheetId] as SheetNode | undefined
  const order = sheet?.items ?? []
  const all = Object.values(nodes).filter(
    (n) => n?.type === 'sheets:viewport' && (n as ViewportNode).sheetId === sheetId,
  ) as ViewportNode[]
  return all.slice().sort((a, b) => rank(order, a.id) - rank(order, b.id))
}

function rank(order: readonly string[], id: string): number {
  const i = order.indexOf(id)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

export function levels(nodes: NodeMap): AnyNodeLike[] {
  return Object.values(nodes)
    .filter((n) => n?.type === 'level')
    .sort((a, b) => ((a.level as number) ?? 0) - ((b.level as number) ?? 0))
}

export function levelLabel(node: AnyNodeLike | undefined): string {
  if (!node) return 'Level'
  const name = (node.name as string | undefined)?.trim()
  if (name) return name
  return `Level ${(node.level as number) ?? 0}`
}

/* -------------------------------------------------- project record */

/**
 * Read the project record, creating it on first use — and folding in
 * whatever `plugin-plans` left on `site.metadata.plancrafters.project` so a
 * scene that was set up under the old flow arrives complete.
 */
export function readOrCreateProjectRecord(): ProjectRecordNode {
  const nodes = sceneNodes()
  const existing = projectRecord(nodes)
  if (existing) return existing
  const site = siteNode(nodes)
  const seed = migrateLegacyProject(site)
  const node = ProjectRecordNode.parse({ ...seed, parentId: site?.id ?? null })
  scene().applyNodeChanges({ create: [{ node, parentId: site?.id }] })
  return node
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * `site.metadata.plancrafters.project` → a project-record seed. Shape from
 * `packages/plugin-plans/src/project.ts` (identity / firms / jurisdiction /
 * documentStatus / revisions). Anything missing stays at its schema default.
 */
export function migrateLegacyProject(site: AnyNodeLike | undefined): Record<string, unknown> {
  const meta = isObj(site?.metadata) ? site.metadata : {}
  const pc = isObj(meta.plancrafters) ? meta.plancrafters : {}
  const p = isObj(pc.project) ? pc.project : undefined
  if (!p) return {}
  const identity = isObj(p.identity) ? p.identity : {}
  const address = isObj(identity.address) ? identity.address : {}
  const firms = isObj(p.firms) ? p.firms : {}
  const designerFirm = isObj(firms.designer) ? firms.designer : {}
  const engineerFirm = isObj(firms.engineer) ? firms.engineer : {}
  const identityDesigner = isObj(identity.designer) ? identity.designer : {}
  const identityOwner = isObj(identity.owner) ? identity.owner : {}
  const jurisdiction = isObj(p.jurisdiction) ? p.jurisdiction : {}
  const status = p.documentStatus
  return {
    identity: {
      projectName: str(identity.projectName),
      projectNumber: str(identity.projectNumber),
      apn: str(identity.apn),
      address: {
        street: str(address.street),
        city: str(address.city),
        state: str(address.state),
        zip: str(address.zip),
      },
    },
    designer: {
      name: str(identityDesigner.name),
      license: str(identityDesigner.license) || str(designerFirm.license),
    },
    firm: {
      company: str(designerFirm.company),
      phone: str(designerFirm.phone),
      email: str(designerFirm.email),
      logoText: str(designerFirm.logoText),
    },
    owner: { name: str(identityOwner.name) },
    engineer: { company: str(engineerFirm.company), license: str(engineerFirm.license) },
    jurisdiction: {
      city: str(jurisdiction.city),
      county: str(jurisdiction.county),
      state: str(jurisdiction.state),
    },
    documentStatus:
      status === 'permit-set' || status === 'construction-set' ? status : 'preliminary',
    revisions: Array.isArray(p.revisions)
      ? p.revisions.filter(isObj).map((r) => ({
          id: str(r.id),
          date: str(r.date),
          description: str(r.description),
          by: str(r.by),
        }))
      : [],
  }
}

/**
 * The site's address, if WS1 resolved one, as the fallback the title block
 * uses when the record has no address typed into it yet.
 */
export function siteAddress(nodes: NodeMap): {
  street: string
  city: string
  state: string
  zip: string
  apn: string
  /** The parcel record's county, as the resolver wrote it ("Hillsborough"). */
  county: string
} {
  const site = siteNode(nodes)
  const address = isObj(site?.address) ? site.address : {}
  const parcel = isObj(site?.parcel) ? site.parcel : {}
  return {
    street: str(address.street),
    city: str(address.city),
    state: str(address.state),
    zip: str(address.zip),
    apn: str(parcel.apn),
    county: str(parcel.county),
  }
}

export type SiteAddressFallback = ReturnType<typeof siteAddress>

/**
 * The jurisdiction line the cover and every title block print. The record's
 * typed jurisdiction wins; otherwise it is derived from what the parcel
 * resolver wrote onto the site (city from the address, county and state from
 * the parcel record) — the same facts the notes sheets already cite the
 * adopted code from. Empty when neither source has anything.
 */
export function jurisdictionLine(
  record:
    | {
        jurisdiction?: { city?: string; county?: string; state?: string }
        identity?: { address?: { city?: string; state?: string } }
      }
    | undefined,
  fallback: SiteAddressFallback | undefined,
): string {
  const j = record?.jurisdiction
  const declared = [j?.city, j?.county, j?.state].filter(Boolean).join(', ')
  if (declared) return declared
  const city = record?.identity?.address?.city || fallback?.city || ''
  const state = record?.identity?.address?.state || fallback?.state || ''
  const rawCounty = fallback?.county ?? ''
  const county = rawCounty ? (/county/i.test(rawCounty) ? rawCounty : `${rawCounty} County`) : ''
  return [city, county, state].filter(Boolean).join(', ')
}

export function updateProjectRecord(patch: Record<string, unknown>): void {
  const record = readOrCreateProjectRecord()
  scene().updateNode(record.id, patch)
}

/* --------------------------------------------------------- mutation */

export function addSheet(input: Partial<SheetNode>): SheetNode {
  const nodes = sceneNodes()
  const site = siteNode(nodes)
  const existing = sheets(nodes)
  const node = SheetNode.parse({
    order: existing.length,
    ...input,
    parentId: site?.id ?? null,
  })
  scene().applyNodeChanges({ create: [{ node, parentId: site?.id }] })
  return node
}

export function addViewport(input: Partial<ViewportNode> & { sheetId: string }): ViewportNode {
  const nodes = sceneNodes()
  const node = ViewportNode.parse({
    layers: DEFAULT_VIEWPORT_LAYERS,
    ...input,
    parentId: input.sheetId,
  })
  const sheet = nodes[input.sheetId] as SheetNode | undefined
  scene().applyNodeChanges({
    create: [{ node, parentId: input.sheetId }],
    update: sheet ? [{ id: sheet.id, data: { items: [...(sheet.items ?? []), node.id] } }] : [],
  })
  return node
}

export function updateViewport(id: string, patch: Partial<ViewportNode>): void {
  scene().updateNode(id, patch as Record<string, unknown>)
}

export function setViewportLayers(id: string, layers: ViewportLayers): void {
  scene().updateNode(id, { layers } as Record<string, unknown>)
}

export function removeViewport(id: string): void {
  const nodes = sceneNodes()
  const vp = nodes[id] as ViewportNode | undefined
  const sheet = vp ? (nodes[vp.sheetId] as SheetNode | undefined) : undefined
  scene().applyNodeChanges({
    delete: [id],
    update: sheet
      ? [{ id: sheet.id, data: { items: (sheet.items ?? []).filter((x) => x !== id) } }]
      : [],
  })
}

export function removeSheet(id: string): void {
  const nodes = sceneNodes()
  const ids = [id, ...viewports(nodes, id).map((v) => v.id)]
  scene().applyNodeChanges({ delete: ids })
}
