import { type GuideNode, useRegistry } from '@pascal-app/core'
import { Suspense, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type Texture, TextureLoader } from 'three'
import { float, texture } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useLoader } from '@react-three/fiber'
import { useAssetUrl } from '../../../hooks/use-asset-url'

export const GuideRenderer = ({ node }: { node: GuideNode }) => {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'guide', ref)

  const resolvedUrl = useAssetUrl(node.url)

  return (
    <group
      ref={ref}
      position={node.position}
      rotation={[0, node.rotation[1], 0]}
    >
      {resolvedUrl && (
        <Suspense>
          <GuidePlane url={resolvedUrl} scale={node.scale} opacity={node.opacity} />
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <planeGeometry args={[width, height]} />
    </mesh>
  )
}
