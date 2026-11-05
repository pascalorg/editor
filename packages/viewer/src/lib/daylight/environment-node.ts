import { clamp, mix, smoothstep, vec3 } from 'three/tsl'
import { type Node, type NodeBuilder, TempNode } from 'three/webgpu'

type Sampler = (direction: any) => any
type EnvironmentContext = {
  getUV?: (node: Node, builder: NodeBuilder) => Node
  getTextureLevel?: (node: Node) => Node
}

function isDiffuseLevel(node: Node | undefined): boolean {
  const constant = node as (Node & { isConstNode?: boolean; value?: unknown }) | undefined
  return constant?.isConstNode === true && constant.value === 1
}

/**
 * Environment lighting evaluated analytically from the sky function (no PMREM bake), so time of
 * day and weather change the image-based lighting instantly. Diffuse lookups get the smooth
 * sampler; rough specular blends towards it.
 */
export class DaylightEnvironmentNode extends TempNode<'vec3'> {
  constructor(
    private readonly specular: Sampler,
    private readonly diffuse: Sampler,
  ) {
    super('vec3')
  }

  override setup(builder: NodeBuilder): Node {
    const context = (builder as NodeBuilder & { context: EnvironmentContext }).context
    const direction = context.getUV?.(this, builder)
    if (!direction) return vec3(0)
    const level = context.getTextureLevel?.(this)
    if (isDiffuseLevel(level)) return this.diffuse(direction)
    if (!level) return this.specular(direction)
    const roughness = clamp(level as any, 0, 1)
    return mix(this.diffuse(direction), this.specular(direction), smoothstep(0.5, 0.32, roughness))
  }
}
