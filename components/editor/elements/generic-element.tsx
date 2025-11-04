'use client'

import { memo, useMemo } from 'react'
import type { Bounds, ElementSpec, TransformGrid, Visibility, World } from '@/lib/engine'
import { BOUNDS, getBounds, TRANSFORM_GRID, VISIBILITY } from '@/lib/engine'
import { GeometryRenderer, ModelRenderer, SelectionRenderer } from './renderers'

interface GenericElementProps {
  entityId: string
  spec: ElementSpec
  world: World
  isActive: boolean
  isSelected: boolean
  isHovered: boolean
  onClick?: (e: any) => void
  levelYOffset: number
  tileSize: number
}

/**
 * Generic element renderer that uses specs to determine appearance.
 * This component automatically selects the appropriate renderer (model vs geometry)
 * and handles visual state (selection, hover, opacity).
 */
export const GenericElement = memo(
  ({
    entityId,
    spec,
    world,
    isActive,
    isSelected,
    isHovered,
    onClick,
    levelYOffset,
    tileSize,
  }: GenericElementProps) => {
    // Get components from ECS
    const transform = world.getComponent<TransformGrid>(entityId, TRANSFORM_GRID)
    const visibility = world.getComponent<Visibility>(entityId, VISIBILITY)

    // Calculate world position from grid coordinates (before early return)
    const worldPosition: [number, number, number] = useMemo(
      () =>
        transform
          ? [transform.position[0] * tileSize, 0, transform.position[1] * tileSize]
          : [0, 0, 0],
      [transform?.position[0], transform?.position[1], tileSize],
    )

    // Early return if missing essential components or not visible
    if (!(transform && visibility && visibility.visible)) return null

    // Get bounds if available (for selection rendering)
    const bounds = world.getComponent<Bounds>(entityId, BOUNDS) ?? getBounds(entityId, world)

    // Calculate visual state
    const renderConfig = spec.render || {}
    const material = renderConfig.material
    const selectionConfig = renderConfig.selection
    const hoverConfig = renderConfig.hover

    // Determine emissive intensity based on state
    let emissiveIntensity = material?.emissiveIntensity ?? 0
    if (isSelected && isHovered) {
      emissiveIntensity = selectionConfig?.emissiveIntensity ?? 0.6
    } else if (isSelected) {
      emissiveIntensity = selectionConfig?.emissiveIntensity ?? 0.4
    } else if (isHovered) {
      emissiveIntensity = hoverConfig?.emissiveIntensity ?? 0.3
    }

    // Determine which renderer to use
    const hasModel = !!renderConfig.model
    const hasGeometry = !!renderConfig.geometry

    return (
      <group>
        {/* Main element rendering */}
        {hasModel && (
          <ModelRenderer
            levelYOffset={levelYOffset}
            onClick={onClick}
            spec={spec}
            transform={transform}
            visibility={visibility}
            worldPosition={worldPosition}
          />
        )}

        {hasGeometry && (
          <GeometryRenderer
            emissiveIntensity={emissiveIntensity}
            levelYOffset={levelYOffset}
            onClick={onClick}
            spec={spec}
            tileSize={tileSize}
            transform={transform}
            visibility={visibility}
            worldPosition={worldPosition}
          />
        )}

        {/* Selection overlay */}
        {isSelected && bounds && renderConfig.selection && (
          <SelectionRenderer
            bounds={bounds}
            levelYOffset={levelYOffset}
            spec={spec}
            worldPosition={worldPosition}
          />
        )}
      </group>
    )
  },
)

GenericElement.displayName = 'GenericElement'
