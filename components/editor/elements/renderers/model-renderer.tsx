'use client'

import { Gltf } from '@react-three/drei'
import { memo } from 'react'
import type { ElementSpec } from '@/lib/engine'
import type { TransformGrid, Visibility } from '@/lib/engine'

interface ModelRendererProps {
  spec: ElementSpec
  transform: TransformGrid
  visibility: Visibility
  worldPosition: [number, number, number]
  levelYOffset: number
  onClick?: (e: any) => void
}

/**
 * Renders elements using 3D models (GLB/GLTF)
 */
export const ModelRenderer = memo(({
  spec,
  transform,
  visibility,
  worldPosition,
  levelYOffset,
  onClick,
}: ModelRendererProps) => {
  const renderConfig = spec.render
  if (!renderConfig?.model) return null

  const { url, scale = 1, upAxis = 'Y' } = renderConfig.model

  // Calculate opacity
  const opacity = visibility.opacity / 100

  return (
    <group
      onClick={onClick}
      position={[worldPosition[0], worldPosition[1] + levelYOffset, worldPosition[2]]}
      rotation={[0, transform.rotation, 0]}
      scale={[scale, scale, scale]}
    >
      <Gltf 
        src={url}
        // Note: Gltf component doesn't support opacity directly
        // Models will use their embedded materials
      />
    </group>
  )
})

ModelRenderer.displayName = 'ModelRenderer'

