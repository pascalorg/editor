import { CylinderIcon } from '@phosphor-icons/react'
import { DoorOpen, RectangleVertical, Square, Triangle } from 'lucide-react'
import type { Component, RoofSegment, WallSegment } from '@/hooks/use-editor'

/**
 * Building Element Abstraction Layer
 *
 * Provides polymorphic operations for building elements (walls, roofs, doors, windows, columns, etc.)
 * to ensure consistent behavior across selection, deletion, and visibility.
 */

export type BuildingElementType = 'wall' | 'roof' | 'door' | 'window' | 'column' | 'group'

export interface SelectedElement {
  id: string
  type: BuildingElementType
}

export interface ElementDescriptor {
  type: BuildingElementType
  icon:
    | typeof Square
    | typeof Triangle
    | typeof DoorOpen
    | typeof RectangleVertical
    | typeof CylinderIcon
  labelSingular: string
  labelPlural: string
  itemsKey: 'segments' | 'columns' | 'walls'
}

/**
 * Element type descriptors for UI consistency
 */
export const ELEMENT_DESCRIPTORS: Record<BuildingElementType, ElementDescriptor> = {
  wall: {
    type: 'wall',
    icon: Square,
    labelSingular: 'Wall',
    labelPlural: 'Walls',
    itemsKey: 'segments',
  },
  roof: {
    type: 'roof',
    icon: Triangle,
    labelSingular: 'Roof',
    labelPlural: 'Roofs',
    itemsKey: 'segments',
  },
  door: {
    type: 'door',
    icon: DoorOpen,
    labelSingular: 'Door',
    labelPlural: 'Doors',
    itemsKey: 'segments', // Doors don't have segments but this is for type consistency
  },
  window: {
    type: 'window',
    icon: RectangleVertical,
    labelSingular: 'Window',
    labelPlural: 'Windows',
    itemsKey: 'segments', // Windows don't have segments but this is for type consistency
  },
  column: {
    type: 'column',
    icon: CylinderIcon,
    labelSingular: 'Column',
    labelPlural: 'Columns',
    itemsKey: 'columns',
  },
  group: {
    type: 'group',
    icon: Square, // Using Square as placeholder, actual icon is defined in layers-menu
    labelSingular: 'Room',
    labelPlural: 'Rooms',
    itemsKey: 'walls',
  },
}

/**
 * Get the descriptor for an element type
 */
export function getElementDescriptor(type: BuildingElementType): ElementDescriptor {
  return ELEMENT_DESCRIPTORS[type]
}

/**
 * Get the icon component for an element type
 */
export function getElementIcon(type: BuildingElementType) {
  return ELEMENT_DESCRIPTORS[type].icon
}

/**
 * Generate a display label for an element
 */
export function getElementLabel(type: BuildingElementType, index: number): string {
  const descriptor = ELEMENT_DESCRIPTORS[type]
  return `${descriptor.labelSingular} ${index + 1}`
}

/**
 * Get all segments of a specific element type for a floor
 */
export function getElementsOfType(
  components: Component[],
  floorId: string,
  type: BuildingElementType,
): WallSegment[] | RoofSegment[] | any[] {
  // For groups, return the group components themselves
  if (type === 'group') {
    return components.filter((c) => c.type === 'group' && c.group === floorId)
  }

  const component = components.find((c) => c.type === type && c.group === floorId)
  if (!component) return []

  const descriptor = ELEMENT_DESCRIPTORS[type]
  if (
    descriptor.itemsKey &&
    component.data &&
    typeof component.data === 'object' &&
    descriptor.itemsKey in component.data
  ) {
    const data = component.data as { [key: string]: any }
    return (data[descriptor.itemsKey] as any[]).filter((item: any) => item.visible !== false)
  }

  return []
}

/**
 * Get all segments of a specific element type for a floor (including invisible)
 */
export function getAllElementsOfType(
  components: Component[],
  floorId: string,
  type: BuildingElementType,
): WallSegment[] | RoofSegment[] | any[] {
  // For groups, return the group components themselves (including invisible)
  if (type === 'group') {
    return components.filter((c) => c.type === 'group' && c.group === floorId)
  }

  const component = components.find((c) => c.type === type && c.group === floorId)
  if (!component) return []

  const descriptor = ELEMENT_DESCRIPTORS[type]
  if (
    descriptor.itemsKey &&
    component.data &&
    typeof component.data === 'object' &&
    descriptor.itemsKey in component.data
  ) {
    const data = component.data as { [key: string]: any }
    return data[descriptor.itemsKey] as any[]
  }

  return []
}

/**
 * Toggle visibility for a specific element
 */
export function toggleElementVisibility(
  components: Component[],
  elementId: string,
  type: BuildingElementType,
  floorId: string,
): Component[] {
  return components.map((comp) => {
    if (comp.type === type && comp.group === floorId) {
      const descriptor = ELEMENT_DESCRIPTORS[type]
      const { itemsKey } = descriptor
      if (
        itemsKey &&
        comp.data &&
        typeof comp.data === 'object' &&
        itemsKey in comp.data &&
        Array.isArray((comp.data as any)[itemsKey])
      ) {
        const updatedData = {
          ...comp.data,
          [itemsKey]: (comp.data as any)[itemsKey].map((item: any) =>
            item.id === elementId ? { ...item, visible: !(item.visible ?? true) } : item,
          ),
        }
        return { ...comp, data: updatedData } as Component
      }
    }
    return comp
  })
}

/**
 * Delete multiple elements across different types
 */
export function deleteElements(
  components: Component[],
  selectedElements: SelectedElement[],
  floorId: string,
): Component[] {
  // Group elements by type for efficient deletion
  const elementsByType = selectedElements.reduce(
    (acc, elem) => {
      if (!acc[elem.type]) acc[elem.type] = new Set()
      acc[elem.type].add(elem.id)
      return acc
    },
    {} as Record<string, Set<string>>,
  )

  // First, filter out door and window components entirely (they are individual components, not segments)
  const doorIdsToDelete = elementsByType['door'] || new Set()
  const windowIdsToDelete = elementsByType['window'] || new Set()
  let filteredComponents = components.filter(
    (comp) =>
      !(
        (comp.type === 'door' && comp.group === floorId && doorIdsToDelete.has(comp.id)) ||
        (comp.type === 'window' && comp.group === floorId && windowIdsToDelete.has(comp.id))
      ),
  )

  // Then, handle walls, roofs, and columns which are segments/items within components
  return filteredComponents.map((comp) => {
    if (
      comp.group === floorId &&
      elementsByType[comp.type] &&
      comp.type !== 'door' &&
      comp.type !== 'window'
    ) {
      const idsToDelete = elementsByType[comp.type]
      const descriptor = ELEMENT_DESCRIPTORS[comp.type as BuildingElementType]
      const { itemsKey } = descriptor

      if (
        itemsKey &&
        comp.data &&
        typeof comp.data === 'object' &&
        itemsKey in comp.data &&
        Array.isArray((comp.data as any)[itemsKey])
      ) {
        const updatedData = {
          ...comp.data,
          [itemsKey]: (comp.data as any)[itemsKey].filter((item: any) => !idsToDelete.has(item.id)),
        }
        return { ...comp, data: updatedData } as Component
      }
    }
    return comp
  })
}

/**
 * Check if an element is selected
 */
export function isElementSelected(
  selectedElements: SelectedElement[],
  elementId: string,
  type: BuildingElementType,
): boolean {
  return selectedElements.some((e) => e.type === type && e.id === elementId)
}

/**
 * Toggle element selection (with multi-select support)
 */
export function toggleElementSelection(
  selectedElements: SelectedElement[],
  elementId: string,
  type: BuildingElementType,
  multiSelect: boolean,
): SelectedElement[] {
  const isSelected = isElementSelected(selectedElements, elementId, type)

  if (multiSelect) {
    // Add/remove from selection
    if (isSelected) {
      return selectedElements.filter((e) => !(e.type === type && e.id === elementId))
    }
    return [...selectedElements, { id: elementId, type }]
  }

  // Single select: replace selection (keep selection if clicking same item)
  if (isSelected) {
    // Keep the current selection if clicking the same item
    return selectedElements
  }
  return [{ id: elementId, type }]
}

/**
 * Select range of elements of the same type
 */
export function selectElementRange(
  selectedElements: SelectedElement[],
  segments: Array<{ id: string }>,
  clickedId: string,
  type: BuildingElementType,
): SelectedElement[] {
  const clickedIndex = segments.findIndex((seg) => seg.id === clickedId)
  if (clickedIndex === -1) return selectedElements

  // Find all selected elements of the same type
  const selectedIndices = selectedElements
    .filter((e) => e.type === type)
    .map((e) => segments.findIndex((seg) => seg.id === e.id))
    .filter((idx) => idx !== -1)

  if (selectedIndices.length === 0) {
    // No existing selection of this type, just select the clicked element
    return [...selectedElements, { id: clickedId, type }]
  }

  // Find closest selected element
  const closestSelectedIndex = selectedIndices.reduce((closest, current) => {
    const currentDist = Math.abs(current - clickedIndex)
    const closestDist = Math.abs(closest - clickedIndex)
    return currentDist < closestDist ? current : closest
  })

  // Select all elements between closest and clicked
  const start = Math.min(closestSelectedIndex, clickedIndex)
  const end = Math.max(closestSelectedIndex, clickedIndex)

  // Keep existing selections of other types
  const otherTypeSelections = selectedElements.filter((e) => e.type !== type)

  // Add range of this type
  const rangeSelections: SelectedElement[] = []
  for (let i = start; i <= end; i++) {
    rangeSelections.push({ id: segments[i].id, type })
  }

  return [...otherTypeSelections, ...rangeSelections]
}

/**
 * Get count of selected elements by type
 */
export function getSelectedCountByType(
  selectedElements: SelectedElement[],
  type: BuildingElementType,
): number {
  return selectedElements.filter((e) => e.type === type).length
}

/**
 * Clear all selections
 */
export function clearSelection(): SelectedElement[] {
  return []
}

/**
 * Get all selected element IDs of a specific type
 */
export function getSelectedIdsOfType(
  selectedElements: SelectedElement[],
  type: BuildingElementType,
): string[] {
  return selectedElements.filter((e) => e.type === type).map((e) => e.id)
}

/**
 * Handle element click with proper multi-select and range-select support
 * This matches the behavior in layers-menu.tsx
 */
export function handleElementClick(options: {
  selectedElements: SelectedElement[]
  segments: Array<{ id: string }>
  elementId: string
  type: BuildingElementType
  event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
}): SelectedElement[] {
  const { selectedElements, segments, elementId, type, event } = options

  if (event.metaKey || event.ctrlKey) {
    // Cmd/Ctrl+click: toggle selection
    return toggleElementSelection(selectedElements, elementId, type, true)
  }

  if (event.shiftKey && selectedElements.length > 0) {
    // Shift+click: select range
    return selectElementRange(selectedElements, segments, elementId, type)
  }

  // Regular click: single select
  return toggleElementSelection(selectedElements, elementId, type, false)
}
