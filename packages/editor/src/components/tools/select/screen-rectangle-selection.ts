export type ScreenRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX = 4

const SCREEN_RECTANGLE_SELECTION_FILL_COLOR = 'rgba(129, 140, 248, 0.14)'
const SCREEN_RECTANGLE_SELECTION_BORDER_COLOR = 'rgba(129, 140, 248, 0.9)'
const SCREEN_RECTANGLE_SELECTION_SHADOW_COLOR = 'rgba(129, 140, 248, 0.28)'

export function createScreenRectangleSelectionElement(): HTMLDivElement {
  const element = document.createElement('div')
  element.style.position = 'fixed'
  element.style.display = 'none'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '2147483647'
  element.style.border = `1px solid ${SCREEN_RECTANGLE_SELECTION_BORDER_COLOR}`
  element.style.background = SCREEN_RECTANGLE_SELECTION_FILL_COLOR
  element.style.boxShadow = `0 0 0 1px ${SCREEN_RECTANGLE_SELECTION_SHADOW_COLOR} inset`
  element.style.contain = 'layout paint style'
  return element
}

export function normalizeScreenRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): ScreenRect {
  return {
    minX: Math.min(startX, endX),
    minY: Math.min(startY, endY),
    maxX: Math.max(startX, endX),
    maxY: Math.max(startY, endY),
  }
}

export function screenRectFromDomRect(rect: DOMRect | DOMRectReadOnly): ScreenRect {
  return {
    minX: rect.left,
    minY: rect.top,
    maxX: rect.right,
    maxY: rect.bottom,
  }
}

export function screenRectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return !(b.maxX < a.minX || b.minX > a.maxX || b.maxY < a.minY || b.minY > a.maxY)
}

export function intersectScreenRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const rect = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }

  if (rect.maxX <= rect.minX || rect.maxY <= rect.minY) {
    return null
  }

  return rect
}

export function updateScreenRectangleSelectionElement(element: HTMLDivElement, rect: ScreenRect) {
  element.style.display = 'block'
  element.style.left = `${rect.minX}px`
  element.style.top = `${rect.minY}px`
  element.style.width = `${Math.max(0, rect.maxX - rect.minX)}px`
  element.style.height = `${Math.max(0, rect.maxY - rect.minY)}px`
}

export function hideScreenRectangleSelectionElement(element: HTMLDivElement | null) {
  if (!element) {
    return
  }
  element.style.display = 'none'
  element.style.width = '0px'
  element.style.height = '0px'
}
