'use client'

import { type ScanNode, useRegistry } from '@pascal-app/core'
import { useAssetUrl, useGLTFKTX2, useViewer } from '@pascal-app/viewer'
import { Suspense, useMemo, useRef } from 'react'
import { type Group, type Material, Mesh } from 'three'

export const ScanRenderer = ({ node }: { node: ScanNode }) => {
  const showScans = useViewer((s) => s.showScans)
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'scan', ref)

  const resolvedUrl = useAssetUrl(node.url)

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      scale={[node.scale, node.scale, node.scale]}
      visible={showScans}
    >
      {resolvedUrl && (
        <Suspense>
          <ScanModel opacity={node.opacity} url={resolvedUrl} />
        </Suspense>
      )}
    </group>
  )
}

const ScanModel = ({ url, opacity }: { url: string; opacity: number }) => {
  // `useGLTF` is typed to also accept an array of paths (returning an
  // array); we always pass a single URL, so narrow to the object form.
  const result = useGLTFKTX2(url)
  const gltf = Array.isArray(result) ? result[0] : result
  const scene = gltf?.scene

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

    scene?.traverse((child) => {
      if (child instanceof Mesh) {
        const mesh = child

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

  if (!scene) return null
  return <primitive object={scene} />
}

export default ScanRenderer
