/**
 * What a person pointed at in the scene, and from where: ids first, the picture as evidence.
 *
 * One shape for every surface that can carry it. The editor's Point and ask mode builds it; the
 * chat sends it on the message (`metadata.pointContext`) and tells the agent to act on the ids; the
 * hosted MCP can take the same object as a tool input later. `camera` is `view_scene`'s own
 * `camera` input plus the projection, so the agent can look from the person's eye.
 */
export type PointContext = {
  kind: 'scene-point'
  version: 1
  /** "ask_…", minted where the person pointed: the pin, the chat chip and the turn share it. */
  askId: string
  /** ISO time of the moment of pointing (pointer-down), not of sending. */
  capturedAt: string
  source: 'editor' | 'mcp'
  gesture: 'click' | 'multi' | 'region'
  /** The level in view. */
  level: { id: string; name: string }
  /** Every pointed element, with no cap: a preview limit is for display, not for the agent. */
  targets: PointTarget[]
  /** A region's visible elements, by screen area, top 12; `more` counts the rest. */
  inRegion?: { ids: string[]; more: number }
  camera: PointCamera
  /** [left, top, right, bottom], each 0–1 of the full frame. */
  region?: [number, number, number, number]
  /** The crop. `marked`: the targets are outlined in it. */
  image?: PointImage
  /** The id of the suggestion chip when one was sent as it is. */
  suggestion?: string
}

export type PointTarget = {
  /** Authoritative: read it with `get_node` before changing it. */
  id: string
  /** The node type: 'zone' | 'wall' | 'window' | 'door' | 'item' | … */
  type: string
  /** "Kitchen", "Wall, north side of Kitchen", "Sofa, Oslo 3-seat". */
  name: string
  levelId: string
  /** The room it is in or bounds. */
  zoneId?: string
  /** The wall an opening is in, the item an item stands on. */
  parentId?: string
  /** Where the finger landed, in world metres. */
  hit?: {
    point: [number, number, number]
    normal: [number, number, number]
    face?: 'interior' | 'exterior' | 'top' | 'bottom'
  }
  box: { min: [number, number, number]; max: [number, number, number] }
  /** Metres: wall {length, height, thickness}; zone {area, width, depth}; opening {width, height, sill}; item {width, depth, height}. */
  size: Record<string, number>
}

export type PointCamera = {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  aspect: number
  projection: 'perspective' | 'orthographic'
  /** Orthographic only. */
  viewWidth?: number
}

export type PointImage = {
  /** Where the crop is stored, once the chat has uploaded it. */
  url?: string
  /** The crop as the editor captured it, before it is uploaded. */
  dataUrl?: string
  width: number
  height: number
  marked: boolean
}

/** What the editor hands the chat when the person sends an ask. */
export type PointAskSubmit = {
  askId: string
  /** The person's words. */
  text: string
  context: PointContext
  /** The bubble text's screen rect in CSS px, where the message's flight starts. */
  from: { x: number; y: number; width: number; height: number }
}

/** The chat's answer to a submit. A busy Pascal is `ok: true`: the ask waits as its own turn. */
export type PointAskSubmitResult =
  | { ok: true }
  | { ok: false; code: 'out_of_credits' | 'unavailable' | 'error'; message: string }

/** What the chat tells the pin about the ask's turn. */
export type PointAskStatus = {
  askId: string
  turnId?: string
} /** Pascal is on another turn: the ask waits as its own turn, never steered into it. */ & (
  | { status: 'queued' }
  /** The turn started or its live sentence changed. */
  | { status: 'working'; sentence?: string }
  /** The turn is waiting for the person's answer to a question. */
  | { status: 'asking'; question: string }
  | {
      status: 'ended'
      outcome: 'completed' | 'cancelled' | 'errored'
      /** The turn ended while still waiting on a question. */
      asked: boolean
      /** The turn made at least one successful scene-writing tool call. */
      wroteScene: boolean
      /** The final reply text. */
      answer?: string
      /** What went wrong, in words. */
      error?: string
    }
)

/** What the pin tells the chat: its turn lights on hover and opens on click. */
export type PointAskPin = { askId: string; action: 'hover' | 'leave' | 'open' }
