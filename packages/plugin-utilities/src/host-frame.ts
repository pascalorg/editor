import type { AnyNode, MovableParentFrame } from '@pascal-app/core'
import {
  buildingFrameOf,
  findAnyBuilding,
  findBuildingAncestor,
  type LooseNode,
  type LooseNodes,
  localToSite,
  siteToLocal,
} from './site-frame'

/**
 * The seam that makes SITE-coordinate kinds movable with the host's standard
 * move affordance.
 *
 * The host move tool works in the PLAN frame and commits
 * `position: [...cursor]` unconditionally
 * (`move-registry-node-tool.tsx:818`). These kinds store SITE metres, and the
 * plan frame is BUILDING-LOCAL (`site-frame.ts`), so without a conversion
 * every drag would offset the node by the building's own position — poles
 * would jump the moment you touched them.
 *
 * `movable.parentFrame` is exactly that conversion hook: the tool routes the
 * cursor through `planToLocal` before writing, and the stored position back
 * through `localToPlan` to preview. Declaring it also makes the tool preview
 * via `useLiveNodeOverrides` and skip the world-frame floor-collision box,
 * both of which are what we want — a pole is not a floor-placed item, and the
 * live override is what lets a linked run re-derive its endpoint every frame
 * while the pole is still moving.
 *
 * `parentRotationY` returns 0 DELIBERATELY. The tool composes it onto the
 * preview object's `rotation.y`, and these renderers already mount inside the
 * building's transform group (`BuildingRenderer` renders `node.children`
 * inside `<group position rotation>`), so adding the building yaw again would
 * double-count it.
 */
export function siteParentFrame(): MovableParentFrame {
  const frameOf = (parent: AnyNode) => buildingFrameOf({}, parent as unknown as LooseNode)
  return {
    resolveParent: (node, nodes) => {
      const loose = nodes as unknown as LooseNodes
      const parentId = (node as unknown as { parentId?: unknown }).parentId
      const building =
        (typeof parentId === 'string' ? findBuildingAncestor(loose, parentId) : null) ??
        findAnyBuilding(loose)
      // Null → the tool moves in the plan frame, which for a scene with no
      // building IS the site frame. Correct degenerate behaviour.
      return (building as unknown as AnyNode) ?? null
    },
    parentRotationY: () => 0,
    localToPlan: (parent, local) => siteToLocal(frameOf(parent), local),
    planToLocal: (parent, planX, localY, planZ) =>
      localToSite(frameOf(parent), [planX, localY, planZ]),
  }
}
