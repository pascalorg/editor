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
