import { hardCutsForElement, jointsForElement, toCastableElement } from '@pascal-app/core/formwork'
import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  type ConstructionJointNode,
  generateId,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core/schema'

/**
 * The construction joints an element's pour split implies.
 *
 * The split is what creates them: cutting a wall or a column into three lifts
 * creates two horizontal joints, each of which has to be roughened and has
 * starters running through it. Emitting them as nodes is what makes that work
 * visible, payable, and editable — a user who wants a waterstop in one of them
 * needs something to select.
 *
 * Parented to the level rather than the element because a joint is an
 * interface: a lift joint happens to name one element, but the kind is shared
 * with the element-to-element joints that name two, and hanging those off either
 * side would make the other side's shutter wrong.
 */

/**
 * Solver-placed joints not already in `levelNodes`, so calling this twice does
 * not stack duplicates. Existing joints are matched by position rather than by
 * id: the solver's output for an unchanged wall is the same set of positions,
 * and a joint the user has since edited (added a waterstop to, say) must
 * survive a regenerate rather than be replaced by a default one.
 */
export function buildSolverJointNodes(
  host: WallNode | ColumnNode | SlabNode,
  levelNodes: AnyNode[] = [],
): ConstructionJointNode[] {
  const element = toCastableElement(host as AnyNode)
  if (!element) return []

  const existing = new Set<string>()
  for (const node of levelNodes) {
    if (node.type !== 'construction-joint') continue
    if (!node.elementIds.includes(host.id)) continue
    existing.add(positionKey(node.elevation, node.along))
  }

  const out: ConstructionJointNode[] = []
  for (const spec of jointsForElement(
    element,
    {},
    hardCutsForElement(host.id as AnyNodeId, levelNodes),
  )) {
    const key = positionKey(spec.elevation, spec.along)
    if (existing.has(key)) continue
    existing.add(key)
    out.push({
      object: 'node',
      id: generateId('construction-joint'),
      type: 'construction-joint',
      parentId: host.parentId,
      visible: true,
      metadata: {},
      children: [],
      kind: spec.kind,
      elementIds: spec.elementIds,
      elevation: spec.elevation,
      along: spec.along,
      treatments: spec.treatments,
      solverPlaced: spec.solverPlaced,
    })
  }
  return out
}

/** Millimetre resolution — below that two joints are the same joint. */
function positionKey(elevation: number | undefined, along: number | undefined): string {
  const round = (value: number | undefined) =>
    value === undefined ? 'none' : Math.round(value * 1000)
  return `${round(elevation)}|${round(along)}`
}
