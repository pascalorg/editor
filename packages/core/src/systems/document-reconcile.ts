import { structureChangeBatch } from '../commands/structure/shared'
import {
  type SpatialGridManager,
  supportIndexOf,
  withSpatialGrid,
} from '../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../lib/node-ancestry'
import { structureLevelsForChange } from '../lib/space-detection'
import { applyStructureReconciliation } from '../lib/structure-commit'
import type { SceneNodes } from '../lib/structure-kernel'
import type { AnyNode, AnyNodeId } from '../schema'
import { generateId } from '../schema/base'
import { roofsKeptOverStorey } from '../services/roof-move'
import { pauseSceneHistory, resumeSceneHistory } from '../store/history-control'
import { withoutLivePreviews } from '../store/live-previews'
import type { SceneStore } from '../store/use-scene'
import { planOwnedFloorOpenings } from './owned-floor-openings'
import { reconcileOwnedFloorOpeningChanges } from './reconcile-owned-floor-openings'
import {
  isRoofElevationInput,
  planRoofElevationUpdates,
  roofsAffectedBy,
} from './roof/roof-elevation'
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
  options: { ignoreChildLists?: boolean } = {},
): boolean {
  if (before === after) return false
  const differs = (previous: AnyNode | undefined, next: AnyNode | undefined) =>
    previous !== next &&
    (isInput(previous) || isInput(next)) &&
    !(options.ignoreChildLists && onlyChildListChanged(previous, next))
  for (const id in after) if (differs(before[id], after[id])) return true
  for (const id in before) if (!(id in after) && differs(before[id], undefined)) return true
  return false
}

/** Only a node's child list changed: its children's own changes are what passes react to. */
function onlyChildListChanged(previous: AnyNode | undefined, next: AnyNode | undefined) {
  if (!(previous && next)) return false
  const a = previous as Record<string, unknown>
  const b = next as Record<string, unknown>
  for (const key in b) if (key !== 'children' && a[key] !== b[key]) return false
  for (const key in a) if (key !== 'children' && !(key in b)) return false
  return true
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
 * - the elevation of wall-supported roofs, and of a roof kept over the storey it covers when its
 *   level moves, as the roof system does.
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
  const grid = options.grid ?? (() => supportIndexOf(store, resolveLevelId))
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

  withoutLivePreviews(() =>
    withSpatialGrid(grid, () => {
      const levelIds = options.allLevels ? undefined : structureLevelsForChange(before, nodes())
      if (!levelIds || levelIds.length)
        write(() =>
          applyStructureReconciliation(readingStore, {
            levelIds,
            previousNodes: options.allLevels ? undefined : read(before),
            mintId: generateId,
          }),
        )

      // A parent's child list is bookkeeping: what was added or removed is an input of its own.
      const settled = { ignoreChildLists: true }
      let stairsFrom = before
      let elevatorsFrom = before
      let roofsFrom = before
      // Each pass can feed another (a stair's openings change slabs, slabs carry roofs); a pass runs
      // again only on a change to its own inputs, so this settles in a few rounds.
      for (let round = 0; round < 8; round++) {
        const start = nodes()
        if (changedInputs(stairsFrom, start, isStairOpeningInput, settled)) {
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
        if (changedInputs(elevatorsFrom, nodes(), isElevatorOpeningInput, settled)) {
          applyOpenings(planOwnedFloorOpenings(view() as Record<string, AnyNode>))
          elevatorsFrom = nodes()
        }
        // A roof's own child list is an input: a segment added reshapes its footprint.
        const current = nodes()
        const changed: string[] = []
        for (const id in current)
          if (
            current[id] !== roofsFrom[id] &&
            (current[id]?.type === 'roof' || !onlyChildListChanged(roofsFrom[id], current[id]))
          )
            changed.push(id)
        for (const id in roofsFrom) if (!(id in current)) changed.push(id)
        const roofInput = (node: AnyNode | undefined) =>
          isRoofElevationInput(node) || node?.type === 'roof-segment'
        if (changed.some((id) => roofInput(roofsFrom[id]) || roofInput(current[id]))) {
          const roofs = [
            ...roofsKeptOverStorey(roofsFrom, view()),
            ...planRoofElevationUpdates(view(), roofsAffectedBy(roofsFrom, current, changed)),
          ]
          if (roofs.length) write(() => store.getState().updateNodes(roofs))
          roofsFrom = nodes()
        }
        if (nodes() === start) break
      }
    }),
  )
}
