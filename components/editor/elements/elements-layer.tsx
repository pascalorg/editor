'use client'

import { memo, useMemo } from 'react'
import type { World, Hierarchy, ElementTag } from '@/lib/engine'
import { ELEMENT, HIERARCHY, VISIBILITY } from '@/lib/engine'
import type { SelectedElement } from '@/lib/building-elements'
import { ElementRenderer } from './element-renderer'

interface ElementsLayerProps {
  floorId: string
  world: World
  isActive: boolean
  selectedElements: SelectedElement[]
  setSelectedElements: (elements: SelectedElement[]) => void
  controlMode: string
  setControlMode: (mode: 'select' | 'building' | 'delete' | 'guide') => void
  movingCamera: boolean
  levelYOffset: number
  tileSize: number
}

/**
 * Renders all elements for a given floor using the generic rendering system.
 * Queries the ECS World and dynamically renders each entity based on its spec.
 */
export const ElementsLayer = memo((props: ElementsLayerProps) => {
  const { world, floorId } = props
  
  // Query all visible entities for this floor
  const entities = useMemo(() => {
    // Get all entities with required components
    const allEntities = world.query(ELEMENT, HIERARCHY, VISIBILITY)
    
    // Filter to entities belonging to this floor
    return allEntities.filter(entityId => {
      const hierarchy = world.getComponent<Hierarchy>(entityId, HIERARCHY)
      // Check if this entity's level matches the floor
      // Note: For direct children of level, parent should be the level ID
      // For nested entities, we need to check the levelId property
      return hierarchy?.levelId === floorId || hierarchy?.parent === floorId
    })
  }, [world, floorId])
  
  // Debug logging
  if (process.env.NODE_ENV === 'development' && entities.length > 0) {
    console.log(`[ElementsLayer] Rendering ${entities.length} entities for floor ${floorId}`)
  }
  
  return (
    <group>
      {entities.map(entityId => (
        <ElementRenderer
          key={entityId}
          entityId={entityId}
          world={world}
          {...props}
        />
      ))}
    </group>
  )
})

ElementsLayer.displayName = 'ElementsLayer'

