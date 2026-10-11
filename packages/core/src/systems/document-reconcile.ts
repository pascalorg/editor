import { structureChangeBatch } from '../commands/structure/shared'
import {
  createSnapshotSpatialGrid,
  type SpatialGridManager,
  withSpatialGrid,
} from '../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../lib/node-ancestry'
import { changedStructureLevelIds } from '../lib/space-detection'
import { applyStructureReconciliation } from '../lib/structure-commit'
import type { SceneNodes } from '../lib/structure-kernel'
import type { AnyNode, AnyNodeId } from '../schema'
import { generateId } from '../schema/base'
import { pauseSceneHistory, resumeSceneHistory } from '../store/history-control'
import type { SceneStore } from '../store/use-scene'
import { planOwnedFloorOpenings } from './owned-floor-openings'
import { reconcileOwnedFloorOpeningChanges } from './reconcile-owned-floor-openings'
import { isRoofElevationInput, planRoofElevationUpdates } from './roof/roof-elevation'
import { changedStairOpeningOwners } from './stair/stair-opening-sync'
import { syncStairRises } from './stair/stair-rise'

/** Kinds whose change re-sizes a straight stair's flights or re-cuts its floor openings. */
export function isStairOpeningInput(node: AnyNode | undefined): boolean {
  return (
    node?.type === 'building' ||
    node?.type === 'ceiling' ||
    node?.type === 'level' ||
    node?.type === 'slab' ||
    node?.type === 'stair' ||
    node?.type === 'stair-segment'
  )
}

/** Kinds whose change re-cuts an elevator's (and so every owner's) floor openings. */
export function isElevatorOpeningInput(node: AnyNode | undefined): boolean {
  return (
    node?.type === 'building' ||
    node?.type === 'ceiling' ||
    node?.type === 'elevator' ||
    node?.type === 'level' ||
    node?.type === 'slab'
  )
}

/** Whether any node of an input kind differs between two versions of a scene. */
export function changedInputs(
  before: SceneNodes,
  after: SceneNodes,
  isInput: (node: AnyNode | undefined) => boolean,
): boolean {
  if (before === after) return false
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[id]
    const next = after[id]
    if (previous !== next && (isInput(previous) || isInput(next))) return true
  }
  return false
}

export type DocumentReconcileOptions = {
  /**
   * The view the passes read a version of the nodes through: a detached scene's tracked view, so
   * their reads are recorded. Applied to every version a pass compares, so identity holds between.
   */
  read?: (nodes: SceneNodes) => SceneNodes
  /** Re-derive every level's structure, not only the levels whose structure changed since `before`. */
  allLevels?: boolean
  /** The support index the passes query; by default one built from the store's own nodes. */
  grid?: () => SpatialGridManager
}

/**
 * Every derived write the document owes after an edit, in one synchronous pass, so a patch taken
 * afterwards is complete and applying it to the editor leaves its systems nothing to write:
 *
 * - room structure (zones, auto ceilings, floor plates) for the levels whose structure changed,
 *   as space detection derives it for a batch;
 * - stair rises and the floor openings stairs and elevators own, as the opening systems do;
 * - the elevation of wall-supported roofs, as the roof system does.
 *
 * The opening and roof systems still run in the editor (on a microtask, for edits made by hand);
 * they plan with the same functions, so after this pass they find nothing to do. Writes are
 * history-paused: they join the triggering edit's undo step. Support queries read an index built
 * from the store's nodes, never the editor's previews.
 */
export function reconcileDocument(
  store: SceneStore,
  before: SceneNodes,
  options: DocumentReconcileOptions = {},
): void {
  const read = options.read ?? ((nodes: SceneNodes) => nodes)
  const nodes = () => store.getState().nodes as SceneNodes
  const view = () => read(nodes())
  let cached: { nodes: SceneNodes; grid: SpatialGridManager } | null = null
  const grid =
    options.grid ??
    (() => {
      const current = nodes()
      if (cached?.nodes !== current)
        cached = { nodes: current, grid: createSnapshotSpatialGrid(nodes, resolveLevelId) }
      return cached.grid
    })
  // The kernel and opening planners read the store's nodes through `read`; their writes go to it.
  const readingStore = {
    getState: () => ({ ...store.getState(), nodes: view() as Record<AnyNodeId, AnyNode> }),
  }
  const write = (apply: () => void) => {
    pauseSceneHistory(store)
    try {
      apply()
    } finally {
      resumeSceneHistory(store)
    }
  }
  const applyOpenings = (changes: ReturnType<typeof planOwnedFloorOpenings>) => {
    if (!changes.length) return
    const previous = nodes()
    write(() => {
      store.getState().applyNodeChanges(structureChangeBatch(changes))
      reconcileOwnedFloorOpeningChanges(readingStore, read(previous), changes)
    })
  }

  withSpatialGrid(grid, () => {
    const levelIds = options.allLevels ? undefined : changedStructureLevelIds(before, nodes())
    if (!levelIds || levelIds.length)
      write(() =>
        applyStructureReconciliation(readingStore, {
          levelIds,
          previousNodes: options.allLevels ? undefined : read(before),
          mintId: generateId,
        }),
      )

    let stairsFrom = before
    let elevatorsFrom = before
    let roofsFrom = before
    // Each pass can feed another (a stair's openings change slabs, slabs carry roofs); a pass runs
    // again only on a change to its own inputs, so this settles in a few rounds.
    for (let round = 0; round < 8; round++) {
      const start = nodes()
      if (changedInputs(stairsFrom, start, isStairOpeningInput)) {
        const from = stairsFrom
        stairsFrom = start
        const rises = syncStairRises(view() as Record<string, AnyNode>)
        if (rises.length) write(() => store.getState().updateNodes(rises))
        // Which stairs this edit moved is the edit's own bookkeeping; the re-cut reads the scene.
        const owners = changedStairOpeningOwners(
          from as Record<string, AnyNode>,
          nodes() as Record<string, AnyNode>,
        )
        applyOpenings(
          planOwnedFloorOpenings(view() as Record<string, AnyNode>, { ownerIds: owners }),
        )
        stairsFrom = nodes()
      }
      if (changedInputs(elevatorsFrom, nodes(), isElevatorOpeningInput)) {
        applyOpenings(planOwnedFloorOpenings(view() as Record<string, AnyNode>))
        elevatorsFrom = nodes()
      }
      if (changedInputs(roofsFrom, nodes(), isRoofElevationInput)) {
        const roofs = planRoofElevationUpdates(view())
        if (roofs.length) write(() => store.getState().updateNodes(roofs))
        roofsFrom = nodes()
      }
      if (nodes() === start) break
    }
  })
}
