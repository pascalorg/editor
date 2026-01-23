import { type AnyNodeId, type ItemNode, useRegistry, useScene } from '@pascal-app/core'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { Suspense, useEffect, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'

// Shared materials to avoid creating new instances for every mesh
const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xffffff,
  roughness: 0.8,
  metalness: 0,
})

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'skyblue',
  roughness: 0.8,
  metalness: 0,
  transparent: true,
  opacity: 0.25,
})

const getMaterialForOriginal = (original: Material): MeshStandardNodeMaterial => {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
  }
  return defaultMaterial
}

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
        const mesh = child as Mesh
        if (mesh.name === 'cutout') {
          child.visible = false
          return
        }

        mesh.castShadow = true
        mesh.receiveShadow = true

        // Handle both single material and material array cases
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
        } else {
          mesh.material = getMaterialForOriginal(mesh.material)
        }
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
