import type { InstancedBufferAttribute } from 'three'
import { color, float, instancedDynamicBufferAttribute, mrt, output, uv, vec4 } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

const DUST_COLOR = '#d9cdb8'

/**
 * A soft disc on a quad, faded per sprite by `alpha`. It draws into the scene pass so walls in front
 * hide it, and writes nothing to that pass's normals and diffuse colour (alpha 0 under their material
 * blending): the ink reads the normals, and the whole quad, not just its disc, was an edge there.
 * `output` is named too: a pass without MRT draws what this node names and nothing else.
 */
export function createDustMaterial(alpha: InstancedBufferAttribute) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.colorNode = color(DUST_COLOR)
  const edge = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1)
  material.opacityNode = edge.mul(edge).mul(instancedDynamicBufferAttribute(alpha, 'float'))
  material.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  return material
}
