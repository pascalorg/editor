import { type ScanNode, useRegistry } from '@pascal-app/core'
import { Suspense, useMemo, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { useAssetUrl } from '../../../hooks/use-asset-url'
import { useGLTFKTX2 } from '../../../hooks/use-gltf-ktx2'

export const ScanRenderer = ({ node }: { node: ScanNode }) => {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'scan', ref)

  const resolvedUrl = useAssetUrl(node.url)

  return (
    <group
      ref={ref}
      position={node.position}
      rotation={node.rotation}
      scale={[node.scale, node.scale, node.scale]}
    >
      {resolvedUrl && (
        <Suspense>
          <ScanModel url={resolvedUrl} opacity={node.opacity} />
        </Suspense>
      )}
    </group>
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
        material.depthWrite = false;
      } else {
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true;
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
