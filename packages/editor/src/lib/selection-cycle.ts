/**
 * Tab steps the selection through everything stacked under the pointer in the
 * floor plan, top first: where walls
 * overlap, or a short wall lies inside a longer one or under a marker, a click
 * takes the top one and Tab the ones below it in turn. Shift+Tab steps back.
 */

import type { AnyNodeId } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

let pointer: { x: number; y: number } | null = null
let tracking = false

/** Start following the pointer, so a Tab knows where it is. Idempotent. */
export function trackSelectionCyclePointer(): void {
  if (tracking || typeof window === 'undefined') return
  tracking = true
  const follow = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  }
  window.addEventListener('pointermove', follow, { capture: true, passive: true })
  window.addEventListener('pointerdown', follow, { capture: true, passive: true })
}

/** The plan nodes under a screen point, topmost first, each once. */
export function floorplanNodesAt(x: number, y: number): string[] {
  if (typeof document === 'undefined') return []
  const ids: string[] = []
  for (const element of document.elementsFromPoint(x, y)) {
    if (!element.closest('[data-floorplan-scene]')) continue
    const entry = element.closest<SVGGElement>('.floorplan-registry-entry[data-node-id]')
    const id = entry?.dataset.nodeId
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * The id a Tab selects among `stack` (topmost first): the one after the
 * current selection, or before it for Shift+Tab, wrapping round; the top one
 * when the selection is not in the stack.
 */
export function nextInStack(
  stack: readonly string[],
  selected: readonly string[],
  back: boolean,
): string | null {
  if (stack.length === 0) return null
  const index = selected.length === 1 ? stack.indexOf(selected[0]!) : -1
  if (index < 0) return stack[0]!
  return stack[(index + (back ? stack.length - 1 : 1)) % stack.length]!
}

/** Select the next object under the pointer in the floor plan. True when Tab was used. */
export function cycleSelectionAtPointer(back: boolean): boolean {
  if (!pointer) return false
  const stack = floorplanNodesAt(pointer.x, pointer.y)
  const viewer = useViewer.getState()
  const next = nextInStack(stack, viewer.selection.selectedIds, back)
  if (!next) return false
  viewer.setSelection({ selectedIds: [next as AnyNodeId] })
  return true
}
