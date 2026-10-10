// Point and ask, scene side (the owner, 8 October): the shapes the pure modules, the store and the
// overlay share. Screen units are CSS pixels in viewport coordinates; world units are metres.

export type ScreenPoint = { x: number; y: number }

/** A screen rectangle by its edges. */
export type Rect = { x0: number; y0: number; x1: number; y1: number }

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
