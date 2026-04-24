import { type ArchwayNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_DOOR_MATERIAL } from '../../../lib/materials'

export const ArchwayRenderer = ({ node }: { node: ArchwayNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'archway', ref)
  
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  
  const handlers = useNodeEvents(node, 'archway')
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_DOOR_MATERIAL
    return createMaterial(mat)
  }, [node.material])

  return (
    <mesh
      castShadow
      material={material}
      position={node.position}
      receiveShadow
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
