import { type AnyNodeId, type ItemNode, useRegistry, useScene } from '@pascal-app/core'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { resolveCdnUrl } from '../../../lib/asset-url'

// Shared materials to avoid creating new instances for every mesh
const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
})

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightgray',
  roughness: 0.8,
  metalness: 0,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
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
    <group position={node.position} rotation={node.rotation} ref={ref} visible={node.visible}>
      <Suspense fallback={<PreviewModel node={node} />}>
        <ModelRenderer node={node} />
      </Suspense>
    </group>
  )
}

const previewMaterial = new MeshStandardNodeMaterial({
  color: '#cccccc',
  roughness: 1,
  metalness: 0,
  depthTest: false,
})

const previewOpacity = smoothstep(0.42, 0.55, positionLocal.y.add(time.mul(-0.2)).mul(10).fract())

previewMaterial.opacityNode = previewOpacity
previewMaterial.transparent = true

const PreviewModel = ({ node }: { node: ItemNode }) => {
  return (
    <mesh position-y={node.asset.dimensions[1] / 2} material={previewMaterial}>
      <boxGeometry
        args={[node.asset.dimensions[0], node.asset.dimensions[1], node.asset.dimensions[2]]}
      />
    </mesh>
  )
}

const ModelRenderer = ({ node }: { node: ItemNode }) => {
  const { scene, nodes } = useGLTF(resolveCdnUrl(node.asset.src) || '')

  if (nodes.cutout) {
    nodes.cutout.visible = false
  }

  const handlers = useNodeEvents(node, 'item')

  useEffect(() => {
    if (!node.parentId) return
    useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
  }, [node.parentId])

  useMemo(() => {
    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh
        if (mesh.name === 'cutout') {
          child.visible = false
          return
        }

        let hasGlass = false

        // Handle both single material and material array cases
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
          hasGlass = mesh.material.some((mat) => mat.name === 'glass')
        } else {
          mesh.material = getMaterialForOriginal(mesh.material)
          hasGlass = mesh.material.name === 'glass'
        }
        mesh.castShadow = !hasGlass
        mesh.receiveShadow = !hasGlass
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
