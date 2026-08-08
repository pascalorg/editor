import {
  hardCutsForElement,
  type PourUnit,
  pourUnitsForElement,
  toCastableElement,
} from '@pascal-app/core/formwork'
import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  type FormworkAssemblyNode,
  generateId,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core/schema'

/**
 * Pure constructors for the formwork assemblies hosted on a castable element.
 * No store, no React — safe to call from a client action (`useScene.getState()
 * .createNode(...)`) or directly against a plain `SceneGraph` on the
 * server (AI chat route).
 *
 * Position/rotation stay at identity for every host, but for three different
 * reasons, and `buildFormworkGeometry` builds in the local space each one
 * inherits:
 * - **Wall** — `WallRenderer` renders hosted children *inside* the wall's own
 *   `<mesh>`, and `WallSystem` already sets that mesh's position to
 *   `wall.start` and `rotation.y` to the wall's heading. Re-applying start and
 *   angle here would double-transform the shutter.
 * - **Column** — `ColumnRenderer`'s group already carries `node.position` and
 *   `node.rotation`, so the assembly builds in column-local space centred on
 *   the origin.
 * - **Slab** — a slab has no `position` at all; its renderer's group sits at
 *   the origin and the polygon is already in level coordinates, so the deck
 *   builds there directly.
 */

export type CastableHostNode = WallNode | ColumnNode | SlabNode

function assemblyFor(
  host: CastableHostNode,
  segmentIndex: number,
  liftIndex: number,
): FormworkAssemblyNode {
  return {
    object: 'node',
    id: generateId('formwork-assembly'),
    type: 'formwork-assembly',
    parentId: host.id,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    segmentIndex,
    liftIndex,
    panelWidth: 0.6,
    fillerPosition: 'middle',
    avoidedPanelIds: [],
    designOverrides: {},
    partOverrides: {},
  }
}

/**
 * One assembly covering the whole element as a single pour. Correct for most
 * walls, for every slab, and the only honest answer for an element with no
 * lift cap set.
 */
export function buildFormworkNode(host: CastableHostNode): FormworkAssemblyNode {
  return assemblyFor(host, 0, 0)
}

/**
 * One assembly per pour unit of `host`.
 *
 * A shutter is erected, poured, and struck as a unit, so a 9 m wall or column
 * capped at 3 m lifts needs three of them and not one 9 m one that could never
 * be built. `levelNodes` is needed because the split reads the element's
 * expansion and isolation joints, which are level children rather than children
 * of the element.
 */
export function buildFormworkNodes(
  host: CastableHostNode,
  levelNodes: AnyNode[] = [],
): FormworkAssemblyNode[] {
  const units = pourUnitsForHost(host, levelNodes)
  if (units.length === 0) return [buildFormworkNode(host)]
  return units.map((unit) => assemblyFor(host, unit.segmentIndex, unit.liftIndex))
}

/**
 * How the element will be split, without building anything. The panel needs
 * this to say how many shutters the button is about to create — an element that
 * silently gains six assemblies from one click is a surprise worth pre-empting.
 */
export function pourUnitsForHost(host: CastableHostNode, levelNodes: AnyNode[] = []): PourUnit[] {
  const element = toCastableElement(host as AnyNode)
  if (!element) return []
  return pourUnitsForElement(element, {}, hardCutsForElement(host.id as AnyNodeId, levelNodes))
}

/** A pour unit's identity: what makes two shutters the same shutter. */
const scopeKey = (segmentIndex: number, liftIndex: number) => `${segmentIndex}:${liftIndex}`

export interface FormworkReconciliation {
  /** Assemblies whose pour unit still exists. Untouched — same id, same overrides. */
  keep: FormworkAssemblyNode[]
  /** Pour units with no assembly yet. Newly built, so new ids. */
  create: FormworkAssemblyNode[]
  /**
   * Assemblies whose pour unit no longer exists, and the duplicates of ones that
   * do. Every per-part decision recorded on these dies with them, so a caller
   * that deletes them silently is discarding somebody's work.
   */
  orphan: FormworkAssemblyNode[]
}

/**
 * What this host's shutters should be, against what they currently are.
 *
 * The reason this is not just "build them again" is that a shutter is a place a
 * person keeps decisions. `partOverrides` says which panel the yard is actually
 * sending and which prop is already on site, keyed by mark, and rebuilding the
 * assembly from scratch throws all of it away. So a pour unit that still exists
 * keeps the node it already has, id and overrides intact; only genuinely new
 * units are built.
 *
 * The three outcomes exist because a pour can change in three directions and
 * they are not symmetrical. Capping a 9 m wall at 3 m lifts *adds* two shutters
 * to a scene that had one — and until this existed, nothing added them: the AI
 * appended a second copy of lift 0 and the panel's button was disabled, so the
 * wall reported three pours and billed for one. Removing the cap *orphans* two,
 * and that is a deletion of recorded work, which is why they are returned rather
 * than dropped. And re-running the whole thing when nothing moved must be a
 * no-op, or the routine that repairs a scene is the routine that corrupts it.
 *
 * Duplicates already in the scene reconcile down to one, so this heals a graph
 * that the un-guarded append left with two lift 0s. The survivor is the one
 * carrying the most overrides: between two otherwise identical shutters, the one
 * somebody has edited is the one that holds information.
 */
export function reconcileFormworkNodes(
  host: CastableHostNode,
  existing: readonly FormworkAssemblyNode[],
  levelNodes: AnyNode[] = [],
): FormworkReconciliation {
  const units = pourUnitsForHost(host, levelNodes)
  const wanted = new Map<string, { segmentIndex: number; liftIndex: number }>()
  if (units.length === 0) {
    // Same fallback as `buildFormworkNodes`: a host the splitter cannot read is
    // still formed as one pour rather than left with nothing to select.
    wanted.set(scopeKey(0, 0), { segmentIndex: 0, liftIndex: 0 })
  } else {
    for (const unit of units) {
      wanted.set(scopeKey(unit.segmentIndex, unit.liftIndex), {
        segmentIndex: unit.segmentIndex,
        liftIndex: unit.liftIndex,
      })
    }
  }

  const overrideCount = (assembly: FormworkAssemblyNode) =>
    Object.keys(assembly.partOverrides ?? {}).length

  const keep: FormworkAssemblyNode[] = []
  const orphan: FormworkAssemblyNode[] = []
  const claimed = new Map<string, FormworkAssemblyNode>()
  for (const assembly of existing) {
    const key = scopeKey(assembly.segmentIndex, assembly.liftIndex)
    if (!wanted.has(key)) {
      orphan.push(assembly)
      continue
    }
    const sitting = claimed.get(key)
    if (!sitting) {
      claimed.set(key, assembly)
      continue
    }
    if (overrideCount(assembly) > overrideCount(sitting)) {
      claimed.set(key, assembly)
      orphan.push(sitting)
    } else {
      orphan.push(assembly)
    }
  }

  const create: FormworkAssemblyNode[] = []
  for (const [key, scope] of wanted) {
    const sitting = claimed.get(key)
    if (sitting) keep.push(sitting)
    else create.push(assemblyFor(host, scope.segmentIndex, scope.liftIndex))
  }
  return { keep, create, orphan }
}
