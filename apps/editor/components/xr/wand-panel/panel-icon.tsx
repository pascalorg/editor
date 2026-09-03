'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useTexture } from '@react-three/drei'
import { Component, type ReactNode, Suspense } from 'react'
import { SRGBColorSpace } from 'three'
import { XR_WAND_THEME } from './theme'

function TextureIcon({ size, src }: { size: number; src: string }) {
  const texture = useTexture(src)
  texture.colorSpace = SRGBColorSpace
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[0, 0.022, 0.012]}
      renderOrder={6}
      raycast={() => undefined}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial alphaTest={0.05} map={texture} toneMapped={false} transparent />
    </mesh>
  )
}

function ColorIcon({ color, size }: { color: string; size: number }) {
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[0, 0.022, 0.012]}
      renderOrder={6}
      raycast={() => undefined}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  )
}

type TextureIconBoundaryProps = {
  children: ReactNode
  fallback: ReactNode
}

type TextureIconBoundaryState = {
  hasError: boolean
}

class TextureIconBoundary extends Component<TextureIconBoundaryProps, TextureIconBoundaryState> {
  state: TextureIconBoundaryState = { hasError: false }

  static getDerivedStateFromError(): TextureIconBoundaryState {
    return { hasError: true }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
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
    return <ColorIcon color={color} size={size} />
  }

  const fallback = <ColorIcon color={color} size={size} />
  return (
    <TextureIconBoundary fallback={fallback} key={src}>
      <Suspense fallback={fallback}>
        <TextureIcon size={size} src={src} />
      </Suspense>
    </TextureIconBoundary>
  )
}
