import { type DoorNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_DOOR_MATERIAL } from '../../../lib/materials'

export const DoorRenderer = ({ node }: { node: DoorNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'door', ref)
  const handlers = useNodeEvents(node, 'door')
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  // Mark this node dirty on mount so DoorSystem regenerates its
  // geometry on the next frame. Without this, the DoorRenderer keeps
  // its zero-size placeholder box forever whenever the <Viewer>
  // remounts (e.g. entering preview mode, switching view modes), and
  // the door visually disappears — DoorSystem only processes nodes in
  // the dirtyNodes set. See WallRenderer for the same pattern.
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_DOOR_MATERIAL
    return createMaterial(mat)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

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
