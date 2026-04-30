import { type GuideNode, useRegistry } from '@pascal-app/core'
import { useLoader } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type Texture, TextureLoader } from 'three'
import { float, texture } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useAssetUrl } from '../../../hooks/use-asset-url'
import useViewer from '../../../store/use-viewer'

export const GuideRenderer = ({ node }: { node: GuideNode }) => {
  const showGuides = useViewer((s) => s.showGuides)
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'guide', ref)

  const resolvedUrl = useAssetUrl(node.url)

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={[0, node.rotation[1], 0]}
      visible={showGuides && node.showIn3d === true}
    >
      {resolvedUrl && (
        <Suspense>
          <GuidePlane opacity={node.opacity} scale={node.scale} url={resolvedUrl} />
        </Suspense>
      )}
    </group>
  )
}

const GuidePlane = ({ url, scale, opacity }: { url: string; scale: number; opacity: number }) => {
  const tex = useLoader(TextureLoader, url) as Texture

  const { width, height, material } = useMemo(() => {
    const img = tex.image as HTMLImageElement | ImageBitmap
    const w = img.width || 1
    const h = img.height || 1
    const aspect = w / h

    // Default: 10 meters wide, height from aspect ratio
    const planeWidth = 10 * scale
    const planeHeight = (10 / aspect) * scale

    const normalizedOpacity = opacity / 100

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: texture(tex),
      opacityNode: float(normalizedOpacity),
      side: DoubleSide,
      depthWrite: false,
    })

    return { width: planeWidth, height: planeHeight, material: mat }
  }, [tex, scale, opacity])

  return (
    <mesh
      frustumCulled={false}
      material={material}
      raycast={() => {}}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[width, height]} boundingBox={null} boundingSphere={null} />
    </mesh>
  )
}
