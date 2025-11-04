'use client'

import { memo, useCallback, useState } from 'react'
import type { World, ElementTag } from '@/lib/engine'
import { ELEMENT, elementRegistry } from '@/lib/engine'
import { isElementSelected, handleElementClick, type SelectedElement } from '@/lib/building-elements'
import { GenericElement } from './generic-element'

interface ElementRendererProps {
  entityId: string
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
 * Renders any element type by looking up its spec from the registry.
 * Handles selection state and click interactions.
 */
export const ElementRenderer = memo(({ 
  entityId, 
  world,
  isActive,
  selectedElements,
  setSelectedElements,
  controlMode,
  setControlMode,
  movingCamera,
  levelYOffset,
  tileSize 
}: ElementRendererProps) => {
  // Get element type from ECS
  const element = world.getComponent<ElementTag>(entityId, ELEMENT)
  if (!element) return null
  
  // Look up spec from registry
  const spec = elementRegistry.getSpec(element.kind)
  if (!spec) {
    console.warn(`[ElementRenderer] No spec found for element type: ${element.kind}`)
    return null
  }
  
  // Determine selection/hover state
  const isSelected = isElementSelected(selectedElements, entityId, element.kind)
  const [isHovered, setIsHovered] = useState(false)
  
  // Generic click handler
  const handleClick = useCallback((e: any) => {
    // Don't handle clicks in certain modes
    if (
      !isActive ||
      movingCamera ||
      controlMode === 'delete' ||
      controlMode === 'guide'
    ) {
      return
    }

    e.stopPropagation()

    // Get all entities of this type for selection cycling
    const allEntities = world.query(ELEMENT)
      .filter(id => {
        const el = world.getComponent<ElementTag>(id, ELEMENT)
        return el?.kind === element.kind
      })
      .map(id => ({ id }))

    // Handle element selection
    const updatedSelection = handleElementClick({
      selectedElements,
      segments: allEntities,
      elementId: entityId,
      type: element.kind,
      event: e,
    })
    setSelectedElements(updatedSelection)

    // Switch to select mode if not already
    if (controlMode !== 'select') {
      setControlMode('select')
    }
  }, [
    entityId,
    element.kind,
    selectedElements,
    setSelectedElements,
    controlMode,
    setControlMode,
    isActive,
    movingCamera,
    world,
  ])
  
  return (
    <GenericElement
      entityId={entityId}
      isActive={isActive}
      isHovered={isHovered}
      isSelected={isSelected}
      levelYOffset={levelYOffset}
      onClick={handleClick}
      spec={spec}
      tileSize={tileSize}
      world={world}
    />
  )
})

ElementRenderer.displayName = 'ElementRenderer'

