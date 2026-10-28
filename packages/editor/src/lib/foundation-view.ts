import {
  type AnyNode,
  type AnyNodeId,
  buildingFoundationNodes,
  FoundationNode,
  foundationViewOf,
  isHouseOutline,
  type LevelNode,
  traceFoundationOutlines,
  useScene,
} from '@pascal-app/core'
import { markPerfAction, useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'

/**
 * The level list's Foundation row: select the level footings go on with nothing picked on it (the
 * panel then shows the foundation's settings), and turn the foundation view on, last, since
 * selecting another level ends it. `false` for a building with no level.
 */
export function enterFoundationView(buildingId: string): boolean {
  const view = foundationViewOf(useScene.getState().nodes, buildingId)
  if (!view.levelId) return false
  const viewer = useViewer.getState()
  if (view.levelId !== viewer.selection.levelId) markPerfAction('level-switch', view.levelId)
  viewer.setSelection({
    buildingId: buildingId as NonNullable<typeof viewer.selection.buildingId>,
    levelId: view.levelId as LevelNode['id'],
  })
  useEditor.getState().clearRoom()
  useViewer.getState().setFoundationView(true)
  return true
}

/** Arm the Footing tool, as Build › Advanced › Footing does, keeping the last Strip / Pad choice. */
export function armFootingTool(): void {
  const editor = useEditor.getState()
  editor.setPhase('building')
  editor.armToolMode({ mode: 'build', tool: 'footing' })
}

/** Arm the Foundation tool: draw an outline from scratch, corner by corner. */
export function armFoundationTool(): void {
  const editor = useEditor.getState()
  editor.setPhase('building')
  editor.armToolMode({ mode: 'build', tool: 'foundation' })
}

/**
 * The building's outlines of the house's own foundation (`isHouseOutline`): while it has none, the
 * foundation follows the outside walls. A porch's or a patio's slab drawn on its own is not one.
 */
export function houseFoundationOutlines(
  nodes: Parameters<typeof buildingFoundationNodes>[0],
  buildingId: string,
): FoundationNode[] {
  return buildingFoundationNodes(nodes, buildingId).filter(isHouseOutline)
}

/**
 * The house's foundation outlines set to the walls' outside faces (`traceFoundationOutlines`), as
 * one undo step: the outlines it has take the traced shapes, in order; the traced loops left over
 * become new outlines on the level footings go on; outlines left over go. Outlines poured on their
 * own (a porch slab) stay as they are. Returns the outlines' ids, or an empty list where the walls
 * close no loop (nothing changes then).
 */
export function traceFoundationFromWalls(buildingId: string): string[] {
  const nodes = useScene.getState().nodes
  const traced = traceFoundationOutlines(nodes, buildingId)
  const levelId = foundationViewOf(nodes, buildingId).levelId
  if (traced.length === 0 || !levelId) return []
  const existing = houseFoundationOutlines(nodes, buildingId)
  const count = Object.values(nodes).filter((node) => node.type === 'foundation').length
  const update = existing.slice(0, traced.length).map((node, index) => ({
    id: node.id as AnyNodeId,
    data: { polygon: traced[index]! } as Partial<AnyNode>,
  }))
  const create = traced.slice(existing.length).map((polygon, index) => ({
    node: FoundationNode.parse({
      name: `Foundation ${count + index + 1}`,
      polygon,
    }) as AnyNode,
    parentId: levelId as AnyNodeId,
  }))
  const remove = existing.slice(traced.length).map((node) => node.id as AnyNodeId)
  useScene.getState().applyNodeChanges({ create, update, delete: remove })
  return [...update.map((change) => change.id), ...create.map((change) => change.node.id)]
}

/**
 * "Edit the outline": the foundation, traced from the walls into outlines of its own, picked so
 * their corners and sides can be dragged. Its outlines stop following the walls from here on.
 */
export function editFoundationOutline(buildingId: string): boolean {
  const existing = houseFoundationOutlines(useScene.getState().nodes, buildingId)
  const ids =
    existing.length > 0 ? existing.map((node) => node.id) : traceFoundationFromWalls(buildingId)
  if (ids.length === 0) return false
  useViewer.getState().setSelection({ selectedIds: [ids[0] as AnyNodeId] })
  return true
}

/**
 * "Follow the walls": the house's own foundation outlines go, in one undo step, so the foundation
 * is traced from the outside walls again and moves with them. Outlines poured on their own stay.
 */
export function followWallsForFoundation(buildingId: string): void {
  const outlines = houseFoundationOutlines(useScene.getState().nodes, buildingId)
  if (outlines.length === 0) return
  const ids = new Set<string>(outlines.map((node) => node.id))
  const viewer = useViewer.getState()
  if (viewer.selection.selectedIds.some((id) => ids.has(id)))
    viewer.setSelection({ selectedIds: [] })
  useScene.getState().applyNodeChanges({ delete: [...ids] as AnyNodeId[] })
}
