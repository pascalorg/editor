import { type ScanNode, useRegistry } from '@pascal-app/core'
import { Clone } from '@react-three/drei/core/Clone'
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
  const { scene } = useGLTFKTX2(url)

  useMemo(() => {
    const normalizedOpacity = opacity / 100
    const isTransparent = normalizedOpacity < 1

    const updateMaterial = (material: Material) => {
      if (isTransparent) {
        material.transparent = true
        material.opacity = normalizedOpacity
      } else {
        material.transparent = false
        material.opacity = 1
      }
      material.needsUpdate = true
    }

    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh

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

  return <Clone object={scene} />
}
