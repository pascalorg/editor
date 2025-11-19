import type { AnyNodeId } from '@/lib/scenegraph/schema/index'

/**
 * Check if an element is selected
 */
export function isElementSelected(selectedElements: AnyNodeId[], elementId: AnyNodeId): boolean {
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
  selectedElements: AnyNodeId[],
  elementId: AnyNodeId,
  multiSelect: boolean,
): AnyNodeId[] {
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
 * Handle simple element click without range selection support
 * Used for nested elements like doors/windows or groups
 *
 * Figma-style behavior:
 * - Regular click: Select only this element
 * - Shift+click: Add to selection
 * - Cmd/Ctrl+click: Toggle in selection
 */
export function handleSimpleClick(
  selectedElements: AnyNodeId[],
  elementId: AnyNodeId,
  event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
): AnyNodeId[] {
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
