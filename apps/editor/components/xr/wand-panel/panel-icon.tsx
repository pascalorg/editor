'use client'

import { useTexture } from '@react-three/drei'
import { Suspense } from 'react'
import { SRGBColorSpace } from 'three'
import { XR_WAND_THEME } from './theme'

function TextureIcon({ size, src }: { size: number; src: string }) {
  const texture = useTexture(src)
  texture.colorSpace = SRGBColorSpace
  return (
    <mesh position={[0, 0.022, 0.012]} raycast={() => undefined}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial alphaTest={0.05} map={texture} toneMapped={false} transparent />
    </mesh>
  )
}

export function PanelIcon({
  color = XR_WAND_THEME.border,
  size = 0.09,
  src,
}: {
  color?: string
  size?: number
  src?: string
}) {
  if (!src) {
    return (
      <mesh position={[0, 0.022, 0.012]} raycast={() => undefined}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    )
  }
  return (
    <Suspense fallback={<PanelIcon color={color} size={size} />}>
      <TextureIcon size={size} src={src} />
    </Suspense>
  )
}
