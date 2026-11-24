'use client'

import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  color,
  float,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  step,
  uniform,
  uv,
} from 'three/tsl'
import { InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from 'three/webgpu'
import { SCENE_LAYER } from '../../lib/layers'

/** A point's diameter, in metres where it is: big enough to read a room by. */
export const POINT_DISC_SIZE = 0.02
const UNCOLORED_POINT = '#8fb8d8'
const NO_RAYCAST = () => undefined

export type PointDiscCloudProps = {
  /** xyz per point. May hold room for more points than `count`. */
  positions: Float32Array
  /** rgb in 0..1 per point, laid out as `positions`; without it every point takes one colour. */
  colors?: Float32Array | null
  /** Points drawn, from the start of the arrays. Defaults to every point `positions` holds. */
  count?: number
  /**
   * For arrays a host writes into in place: bump it to re-upload them. Giving one marks the
   * buffers dynamic; a cloud built once leaves it out.
   */
  version?: number
  /** Disc diameter in metres. */
  size?: number
  /** The Three.js layer to draw on (see `lib/layers.ts`); the scene's by default. */
  layer?: number
  name?: string
}

/**
 * Points as one instanced sprite of round, camera-facing discs sized in world space. WebGPU draws
 * point primitives one pixel wide whatever their size, so a cloud that should read at a glance uses
 * sprites instead, as the light glows do. Node materials run on the WebGL 2 fallback backend too.
 */
export function PointDiscCloud({
  colors = null,
  count,
  layer = SCENE_LAYER,
  name = 'point-disc-cloud',
  positions,
  size = POINT_DISC_SIZE,
  version,
}: PointDiscCloudProps) {
  const dynamic = version !== undefined
  const built = useMemo(() => {
    // Each factory also sets its attribute's usage, static or dynamic.
    const instanced = dynamic ? instancedDynamicBufferAttribute : instancedBufferAttribute
    const positionAttribute = new InstancedBufferAttribute(positions, 3)
    const colorAttribute = colors ? new InstancedBufferAttribute(colors, 3) : null
    const sizeUniform = uniform(POINT_DISC_SIZE)
    const material = new SpriteNodeMaterial()
    material.positionNode = instanced(positionAttribute)
    material.colorNode = colorAttribute ? instanced(colorAttribute, 'vec3') : color(UNCOLORED_POINT)
    material.scaleNode = sizeUniform
    // A disc: the quad's corners cut away.
    material.opacityNode = step(uv().sub(0.5).length(), float(0.5))
    material.alphaTest = 0.5
    const sprite = new Sprite(material)
    sprite.count = 0
    sprite.frustumCulled = false
    sprite.raycast = NO_RAYCAST
    return { colorAttribute, material, positionAttribute, sizeUniform, sprite }
  }, [colors, dynamic, positions])
  useEffect(
    () => () => {
      built.material.dispose()
      built.positionAttribute.dispose()
      built.colorAttribute?.dispose()
    },
    [built],
  )
  useLayoutEffect(() => {
    built.sizeUniform.value = size
  }, [built, size])
  useLayoutEffect(() => {
    built.sprite.name = name
    built.sprite.layers.set(layer)
  }, [built, layer, name])
  useLayoutEffect(() => {
    built.sprite.count = Math.min(count ?? Infinity, Math.floor(positions.length / 3))
    if (version === undefined) return
    built.positionAttribute.needsUpdate = true
    if (built.colorAttribute) built.colorAttribute.needsUpdate = true
  }, [built, count, positions, version])
  return <primitive object={built.sprite} />
}
