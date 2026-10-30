import {
  type AnyNodeId,
  type Assembly,
  isExteriorWallAssembly,
  parseWallTypes,
  projectWallTypes,
  type SiteNode,
  useScene,
  WallTypeDefinition,
} from '@pascal-app/core'
import { useMemo } from 'react'

/**
 * A project's own wall types (`SiteNode.wallTypes`), made and edited from a wall's
 * Assembly controls (`WallTypeMenu`): saved on the site, so they travel with the
 * project and undo like any edit.
 *
 * A placement is the kind of wall a stack builds, read from its layers: `exterior`
 * with a cladding side, `interior` lined alike on both faces. A new type starts from
 * a typical stack of its placement.
 */
export type WallTypePlacement = 'exterior' | 'interior'

function siteOf(state: ReturnType<typeof useScene.getState>): SiteNode | undefined {
  for (const id of state.rootNodeIds) {
    const node = state.nodes[id]
    if (node?.type === 'site') return node
  }
  return undefined
}

/** The project's own wall types, kept current as they are saved, edited or undone. */
export function useProjectWallTypes(): WallTypeDefinition[] {
  const saved = useScene((state) => siteOf(state)?.wallTypes)
  return useMemo(() => parseWallTypes(saved), [saved])
}

/** The placement a stack builds, read from its layers (`isExteriorWallAssembly`). */
export function wallTypePlacementOf(assembly: Assembly): WallTypePlacement {
  return isExteriorWallAssembly(assembly) ? 'exterior' : 'interior'
}

/** The most layers a wall type's stack holds (`Assembly.layers`). */
export const WALL_TYPE_LAYER_LIMIT = 12

/** The most wall types a project keeps on its site (`SiteNode.wallTypes`). */
export const PROJECT_WALL_TYPE_LIMIT = 64

/**
 * Why no new wall type can be made in this project — it keeps `PROJECT_WALL_TYPE_LIMIT`
 * already — or null while it has room: what "New wall type…" and "Duplicate as a new
 * type…" say when they are off.
 */
export function newWallTypeBlockedReason(
  projectTypes: readonly WallTypeDefinition[],
): string | null {
  return projectTypes.length >= PROJECT_WALL_TYPE_LIMIT
    ? `This project keeps ${PROJECT_WALL_TYPE_LIMIT} wall types, the most it can. Delete one to make another.`
    : null
}

/**
 * What saving a project wall type came to: `saved`, or why not — the scene has no
 * site to keep it on, its stack has more layers than a wall type holds, the project
 * keeps as many types as it can and this one is new, or it does not parse.
 */
export type WallTypeSaveResult =
  | 'saved'
  | 'no-site'
  | 'too-many-layers'
  | 'too-many-types'
  | 'invalid'

/** What the wall type editor says when a type was not saved. */
export const WALL_TYPE_SAVE_FAILURE: Record<Exclude<WallTypeSaveResult, 'saved'>, string> = {
  'no-site': 'This project has no site to keep wall types on, so the type was not saved.',
  'too-many-layers': `A wall type holds at most ${WALL_TYPE_LAYER_LIMIT} layers. Remove one to save it.`,
  'too-many-types': `This project keeps ${PROJECT_WALL_TYPE_LIMIT} wall types, the most it can. Delete one to save another.`,
  invalid:
    'These layers do not make a wall type (one framing core, every layer a thickness), so it was not saved.',
}

/**
 * Saves a project wall type on the site, in place of the one with its id or after
 * the others: one undo step, saved and shared with the project. Nothing is written
 * unless it comes to `saved` (`WallTypeSaveResult`): a stack of more than
 * `WALL_TYPE_LAYER_LIMIT` layers, or a new type past `PROJECT_WALL_TYPE_LIMIT`, would
 * leave a site that no longer parses.
 */
export function saveProjectWallType(type: WallTypeDefinition): WallTypeSaveResult {
  const state = useScene.getState()
  const site = siteOf(state)
  if (!site) return 'no-site'
  if ((type.assembly?.layers?.length ?? 0) > WALL_TYPE_LAYER_LIMIT) return 'too-many-layers'
  const parsed = WallTypeDefinition.safeParse(type)
  if (!parsed.success) return 'invalid'
  const current = projectWallTypes(state.nodes, state.rootNodeIds)
  const editing = current.some((entry) => entry.id === type.id)
  if (!editing && current.length >= PROJECT_WALL_TYPE_LIMIT) return 'too-many-types'
  const next = editing
    ? current.map((entry) => (entry.id === type.id ? parsed.data : entry))
    : [...current, parsed.data]
  state.updateNode(site.id as AnyNodeId, { wallTypes: next } as Partial<SiteNode>)
  return 'saved'
}

/** Removes a project wall type from the site. Walls drawn with it keep their stack. */
export function deleteProjectWallType(id: string): void {
  const state = useScene.getState()
  const site = siteOf(state)
  if (!site) return
  const next = projectWallTypes(state.nodes, state.rootNodeIds).filter((type) => type.id !== id)
  state.updateNode(
    site.id as AnyNodeId,
    {
      wallTypes: next.length > 0 ? next : undefined,
    } as Partial<SiteNode>,
  )
}
