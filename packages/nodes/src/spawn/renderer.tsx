'use client'

import {
  type AnyNodeId,
  type SpawnNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { createDefaultMaterial, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import { Color, type Group, Shape } from 'three'

const SPAWN_COLOR = new Color('#818cf8')

/**
 * Registry-driven spawn renderer. Behaviorally identical to the legacy
 * `@pascal-app/viewer/components/renderers/spawn/spawn-renderer.tsx` — same
 * geometry and event surface. When the spawn definition lands
 * in `builtinPlugin.nodes`, the Phase 0 dispatch shims switch the renderer
 * here and the legacy one is short-circuited.
 *
 * Lives in `@pascal-app/nodes` (not viewer) so the kind owns its own render
 * code. Phase 5's batch migration applies the same pattern to every node.
 */
const SpawnRenderer = ({ node }: { node: SpawnNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'spawn')
  const liveOverride = useLiveNodeOverrides((state) => state.get(node.id as AnyNodeId))
  const effectiveNode = useMemo(
    () => (liveOverride ? ({ ...node, ...liveOverride } as SpawnNode) : node),
    [node, liveOverride],
  )
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const shading = useViewer((state) => state.shading)

  useRegistry(node.id, 'spawn', ref)

  const material = useMemo(() => {
    const next = createDefaultMaterial('#818cf8', 0.42, shading) as ReturnType<
      typeof createDefaultMaterial
    > & {
      emissive?: Color
      emissiveIntensity?: number
      metalness?: number
    }
    next.emissive?.copy(SPAWN_COLOR)
    if ('emissiveIntensity' in next) next.emissiveIntensity = 0.08
    if ('metalness' in next) next.metalness = 0.03
    next.needsUpdate = true
    return next
  }, [shading])

  const arrowShape = useMemo(() => {
    const shape = new Shape()
    shape.moveTo(0, 0.24)
    shape.lineTo(-0.18, -0.14)
    shape.lineTo(0.18, -0.14)
    shape.closePath()
    return shape
  }, [])

  return (
    <group
      position={liveTransform?.position ?? effectiveNode.position}
      ref={ref}
      rotation={[0, liveTransform?.rotation ?? effectiveNode.rotation, 0]}
      visible={!walkthroughMode && effectiveNode.visible !== false}
    >
      <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} {...handlers}>
        <ringGeometry args={[0.34, 0.48, 48]} />
        <primitive attach="material" object={material} />
      </mesh>

      <mesh position={[0, 0.1, -0.52]} rotation={[-Math.PI / 2, 0, 0]} {...handlers}>
        <shapeGeometry args={[arrowShape]} />
        <primitive attach="material" object={material} />
      </mesh>

      <mesh position={[0, 0.41, 0]} {...handlers}>
        <boxGeometry args={[0.3, 0.54, 0.16]} />
        <primitive attach="material" object={material} />
      </mesh>

      <mesh position={[0, 0.83, 0]} {...handlers}>
        <boxGeometry args={[0.18, 0.18, 0.18]} />
        <primitive attach="material" object={material} />
      </mesh>
    </group>
  )
}

export default SpawnRenderer
