'use client'

import { Columns } from '@/components/editor/elements/column'
import { Doors } from '@/components/editor/elements/door'
import { Roofs } from '@/components/editor/elements/roof'
import { Windows } from '@/components/editor/elements/window'
import type { Component as EditorComponent, ViewMode } from '@/hooks/use-editor'
import type { SelectedElement } from '@/lib/building-elements'

// Define a map of component types to their corresponding React components.
// This makes it easy to add new building elements in the future.
// Note: Walls are now rendered via NodeRenderer, so they're excluded from this map.
const elementComponentMap = {
  roof: Roofs,
  door: Doors,
  window: Windows,
  column: Columns,
}

type BuildingElementsRendererProps = {
  components: EditorComponent[]
  floorId: string
  isActiveFloor: boolean
  viewMode: ViewMode
  movingCamera: boolean
  tileSize: number
  wallHeight: number
}

/**
 * Dynamically renders building elements for a given floor.
 * This component iterates through the components from the editor state
 * and renders the appropriate React component based on its type.
 */
export function BuildingElementsRenderer({
  components,
  floorId,
  isActiveFloor,
  viewMode,
  movingCamera,
  tileSize,
  wallHeight,
}: BuildingElementsRendererProps) {
  // In viewer mode, selection and control mode changes are disabled.
  const viewerSelectedElements: SelectedElement[] = []
  const noopSetSelectedElements = () => {
    /* No-op in viewer mode */
  }
  const noopSetControlMode = () => {
    /* No-op in viewer mode */
  }
  const controlMode = 'select' as const

  // Filter for components belonging to the current floor that have a renderer.
  const floorComponents = components.filter(
    (c) => c.group === floorId && elementComponentMap[c.type as keyof typeof elementComponentMap],
  )

  return (
    <>
      {floorComponents.map((component) => {
        const ElementComponent =
          elementComponentMap[component.type as keyof typeof elementComponentMap]

        // This check is for type safety and to handle unknown component types.
        if (!ElementComponent) {
          return null
        }

        const commonProps = {
          floorId,
          tileSize,
        }

        // Each component type might have slightly different props.
        // The switch statement handles these variations.
        // Note: Walls are handled by NodeRenderer and should not be passed to this component.
        switch (component.type) {
          case 'roof':
            return (
              <Roofs
                {...commonProps}
                baseHeight={wallHeight}
                controlMode={controlMode}
                hoveredRoofIndex={null}
                isActive={isActiveFloor}
                isCameraEnabled={false}
                isFullView={viewMode === 'full'}
                key={component.id}
                movingCamera={movingCamera}
                onDeleteRoofs={() => {
                  /* No-op in viewer mode */
                }}
                onRoofHover={() => {
                  /* No-op in viewer mode */
                }}
                onRoofRightClick={undefined}
                selectedElements={viewerSelectedElements}
                setControlMode={noopSetControlMode}
                setSelectedElements={noopSetSelectedElements}
              />
            )
          case 'door':
            return (
              <Doors
                {...commonProps}
                isActive={isActiveFloor}
                isFullView={viewMode === 'full'}
                key={component.id}
                wallHeight={wallHeight}
              />
            )
          case 'window':
            return (
              <Windows
                {...commonProps}
                isActive={isActiveFloor}
                isFullView={viewMode === 'full'}
                key={component.id}
                wallHeight={wallHeight}
              />
            )
          case 'column':
            return (
              <Columns
                {...commonProps}
                columnHeight={wallHeight}
                controlMode={controlMode}
                isActive={isActiveFloor}
                isFullView={viewMode === 'full'}
                key={component.id}
                movingCamera={movingCamera}
                selectedElements={viewerSelectedElements}
                setControlMode={noopSetControlMode}
                setSelectedElements={noopSetSelectedElements}
              />
            )
          default:
            return null
        }
      })}
    </>
  )
}
