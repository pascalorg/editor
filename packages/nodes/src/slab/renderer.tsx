'use client'

import {
  FLOOR_SCRIPT_LIFT,
  type SlabNode,
  slabScriptSurface,
  useScene,
  type ZoneFloorScript,
} from '@pascal-app/core'
import { ParametricNodeRenderer } from '@pascal-app/viewer'
import { FinishScriptModel } from '../shared/finish-script-model'

/**
 * The slab its geometry builds, and its surface script's build beside it rather than inside: the
 * slab's group is rebuilt by its geometry and packed into the level's surface batch, which would
 * freeze or drop a model loaded into it.
 */
const SlabRenderer = ({ node }: { node: SlabNode }) => (
  <>
    <ParametricNodeRenderer node={node} />
    {node.surfaceScript ? <SlabSurfaceScriptModel node={node} script={node.surfaceScript} /> : null}
  </>
)

/** The slab's surface finish its script built: in the level's plan, its y = 0 on the slab's top. */
function SlabSurfaceScriptModel({ node, script }: { node: SlabNode; script: ZoneFloorScript }) {
  const surface = useScene((state) => slabScriptSurface(state.nodes, node.id))
  if (surface === null) return null
  return (
    <group position-y={surface + FLOOR_SCRIPT_LIFT} visible={node.visible !== false}>
      <FinishScriptModel ownerId={node.id} parentId={node.parentId} script={script} />
    </group>
  )
}

export default SlabRenderer
