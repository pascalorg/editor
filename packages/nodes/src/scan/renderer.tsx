'use client'

import { type ScanNode, useRegistry } from '@pascal-app/core'
import { useAssetUrl, useGLTFKTX2, useViewer } from '@pascal-app/viewer'
import { Suspense, useMemo, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'

export const ScanRenderer = ({ node }: { node: ScanNode }) => {
  const showScans = useViewer((s) => s.showScans)
  const visible = showScans && node.visible
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'scan', ref)

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      scale={[node.scale, node.scale, node.scale]}
      visible={visible}
    >
      {visible && (node.layers?.model ?? true) && node.url && (
        <ScanAsset opacity={node.opacity} url={node.url} />
      )}
    </group>
  )
}

const ScanAsset = ({ url, opacity }: { url: string; opacity: number }) => {
  const resolvedUrl = useAssetUrl(url)

  if (!resolvedUrl) return null

  return (
    <Suspense>
      <ScanModel opacity={opacity} url={resolvedUrl} />
    </Suspense>
  )
}

const ScanModel = ({ url, opacity }: { url: string; opacity: number }) => {
  const gltf = useGLTFKTX2(url) as any
  const scene = gltf.scene

  useMemo(() => {
    const normalizedOpacity = opacity / 100
    const isTransparent = normalizedOpacity < 1

    const updateMaterial = (material: Material) => {
      if (isTransparent) {
        material.transparent = true
        material.opacity = normalizedOpacity
        material.depthWrite = false
      } else {
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true
      }
      material.needsUpdate = true
    }

    scene.traverse((child: any) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh

        // Disable raycasting
        mesh.raycast = () => {}

        // Exclude from bounding box calculations
        mesh.geometry.boundingBox = null
        mesh.geometry.boundingSphere = null
        mesh.frustumCulled = false

        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => {
            updateMaterial(material)
          })
        } else {
          updateMaterial(mesh.material)
        }
      }
    })
  }, [scene, opacity])

  return <primitive object={scene} />
}

export default ScanRenderer
