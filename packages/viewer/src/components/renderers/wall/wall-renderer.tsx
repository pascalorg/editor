import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { getVisibleWallMaterials } from '../../../systems/wall/wall-materials'
import { NodeRenderer } from '../node-renderer'

function createEmptyWallGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([], 3))
  geometry.addGroup(0, 0, 0)
  geometry.addGroup(0, 0, 1)
  geometry.addGroup(0, 0, 2)
  return geometry
}

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(createEmptyWallGeometry, [])
  const collisionPlaceholderGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([], 3))
    return geometry
  }, [])

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
      collisionPlaceholderGeometry.dispose()
    }
  }, [collisionPlaceholderGeometry, placeholderGeometry])

  const handlers = useNodeEvents(node, 'wall')
  const material = getVisibleWallMaterials(node)

  return (
    <mesh
      castShadow
      geometry={placeholderGeometry}
      material={material}
      receiveShadow
      ref={ref}
      visible={node.visible}
    >
      <mesh
        geometry={collisionPlaceholderGeometry}
        name="collision-mesh"
        visible={false}
        {...handlers}
      />

      {node.children.map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}
