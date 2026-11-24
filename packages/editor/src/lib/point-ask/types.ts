// Point and ask, scene side (the owner, 8 October): the shapes the pure modules, the store and the
// overlay share. Screen units are CSS pixels in viewport coordinates; world units are metres.

export type ScreenPoint = { x: number; y: number }

export type PointViewport = '3d' | '2d'

export const POINT_ASK_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M13 3C18.523 3 23 7.477 23 13C23 18.523 18.523 23 13 23H4.5C3.672 23 3 22.328 3 21.5V13C3 7.477 7.477 3 13 3Z' fill='%2318191f' stroke='%23ffffff' stroke-width='1.75' stroke-linejoin='round'/><path d='M9.5 11.25H16.5M9.5 14.75H14' stroke='%23ffffff' stroke-width='1.65' stroke-linecap='round'/></svg>\") 4 22, crosshair"

/** A screen rectangle by its edges. */
export type Rect = { x0: number; y0: number; x1: number; y1: number }

/** The capture rectangle projected onto the plane through its centre's surface hit, in world metres. */
export type WorldFootprint = {
  center: [number, number, number]
  normal: [number, number, number]
  /** Clockwise from the captured rectangle's top-left corner. */
  corners: [number, number, number][]
}

/** The sides a bubble can sit on beside its target, or `dock` when the target is off screen. */
export type BubbleSide = 'right' | 'left' | 'below' | 'above' | 'dock'

/** What the bubble's suggestions and placeholder are chosen by (spec 2.4). */
export type PointKind =
  | 'room'
  | 'wall'
  | 'window'
  | 'door'
  | 'item'
  | 'roof'
  | 'stair'
  | 'several'
  | 'area'
  | 'other'

/** One pointed element as the overlay holds it. */
export type PointTarget = {
  /** The node id, authoritative. */
  id: string
  /** The node's type ('zone', 'wall', 'window', ...). */
  type: string
  kind: PointKind
  /** "Kitchen", "Wall, north side of Kitchen", "Sofa". */
  name: string
  /** The chip's size line in the viewer's unit: "14.2 m²", "4.80 × 2.70 m", "1.20 × 1.40 m". */
  size: string
}

/** The pin's states (spec 2.6): a presence on the element while the ask runs, then its receipt. */
export type PinState =
  | 'sent'
  | 'queued'
  | 'working'
  | 'needs-input'
  | 'done'
  | 'answered'
  | 'no-change'
  | 'error'
  | 'undone'
