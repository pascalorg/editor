import { type AnyNodeId, type ItemNode, useRegistry, useScene } from '@pascal-app/core'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { Suspense, useEffect, useRef } from 'react'
import type { Group, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)

  return (
    <group position={node.position} rotation={node.rotation} ref={ref}>
      <Suspense>
        <ModelRenderer node={node} />
      </Suspense>
    </group>
  )
}

const ModelRenderer = ({ node }: { node: ItemNode }) => {
  const { scene, nodes } = useGLTF(node.asset.src)

  if (nodes.cutout) {
    nodes.cutout.visible = false
  }

  const handlers = useNodeEvents(node, 'item')

  useEffect(() => {
    if (!node.parentId) return
    useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
  }, [node.parentId])

  useEffect(() => {
    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        child.material = new MeshStandardNodeMaterial({
          color: 0xffffff,
          roughness: 0.8,
          metalness: 0,
        })
      }
    })
  }, [scene])

  return (
    <Clone
      object={scene}
      scale={node.asset.scale}
      position={node.asset.offset}
      rotation={node.asset.rotation}
      {...handlers}
    />
  )
}
