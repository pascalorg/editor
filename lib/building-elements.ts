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

// Simplified: just store the ID, we can look up type from nodeIndex when needed
export type SelectedElement = string

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
 * Check if an element is selected
 */
export function isElementSelected(selectedElements: SelectedElement[], elementId: string): boolean {
  return selectedElements.includes(elementId)
}

/**
 * Toggle element selection (with multi-select support)
 *
 * Figma-style behavior:
 * - multiSelect=false (regular click): Always select only this element, deselect all others
 * - multiSelect=true (Shift/Cmd+click): Toggle this element in/out of selection
 */
export function toggleElementSelection(
  selectedElements: SelectedElement[],
  elementId: string,
  multiSelect: boolean,
): SelectedElement[] {
  const isSelected = isElementSelected(selectedElements, elementId)

  if (multiSelect) {
    // Add/remove from selection (toggle)
    if (isSelected) {
      return selectedElements.filter((id) => id !== elementId)
    }
    return [...selectedElements, elementId]
  }

  // Single select: Always replace selection with only this element
  return [elementId]
}

/**
 * Select range of elements (Figma-style)
 * Selects from the last selected item to the clicked item, replacing selection
 */
export function selectElementRange(
  selectedElements: SelectedElement[],
  segments: Array<{ id: string }>,
  clickedId: string,
): SelectedElement[] {
  const clickedIndex = segments.findIndex((seg) => seg.id === clickedId)
  if (clickedIndex === -1) return selectedElements

  if (selectedElements.length === 0) {
    // No existing selection, just select the clicked element
    return [clickedId]
  }

  // Get the last selected element
  const lastSelectedId = selectedElements[selectedElements.length - 1]
  const lastSelectedIndex = segments.findIndex((seg) => seg.id === lastSelectedId)

  if (lastSelectedIndex === -1) {
    // Fallback: just select the clicked element
    return [clickedId]
  }

  // Select all elements between last selected and clicked
  const start = Math.min(lastSelectedIndex, clickedIndex)
  const end = Math.max(lastSelectedIndex, clickedIndex)

  // Create range selection (replaces all previous selections)
  const rangeSelections: SelectedElement[] = []
  for (let i = start; i <= end; i++) {
    rangeSelections.push(segments[i].id)
  }

  return rangeSelections
}

/**
 * Clear all selections
 */
export function clearSelection(): SelectedElement[] {
  return []
}

/**
 * Handle element click with proper multi-select and range-select support
 * This matches the behavior in layers-menu.tsx
 */
export function handleElementClick(options: {
  selectedElements: SelectedElement[]
  segments: Array<{ id: string }>
  elementId: string
  event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
}): SelectedElement[] {
  const { selectedElements, segments, elementId, event } = options

  if (event.metaKey || event.ctrlKey) {
    // Cmd/Ctrl+click: toggle selection
    return toggleElementSelection(selectedElements, elementId, true)
  }

  if (event.shiftKey && selectedElements.length > 0) {
    // Shift+click: select range
    return selectElementRange(selectedElements, segments, elementId)
  }

  // Regular click: single select
  return toggleElementSelection(selectedElements, elementId, false)
}

/**
 * Handle simple element click without range selection support
 * Used for nested elements like doors/windows or groups
 *
 * Figma-style behavior:
 * - Regular click: Select only this element
 * - Shift+click: Add to selection
 * - Cmd/Ctrl+click: Toggle in selection
 */
export function handleSimpleClick(
  selectedElements: SelectedElement[],
  elementId: string,
  event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
): SelectedElement[] {
  if (event.metaKey || event.ctrlKey) {
    // Cmd/Ctrl+click: toggle selection
    return toggleElementSelection(selectedElements, elementId, true)
  }

  if (event.shiftKey) {
    // Shift+click: add to selection (don't remove if already selected)
    const isSelected = isElementSelected(selectedElements, elementId)
    if (!isSelected) {
      return [...selectedElements, elementId]
    }
    return selectedElements
  }

  // Regular click: single select
  return toggleElementSelection(selectedElements, elementId, false)
}
