'use client'

import type { PointAskSubmit, PointCamera } from '@pascal-app/core'
import { create } from 'zustand'
import { createPin, type PinEvent, type PinModel, reducePin } from '../lib/point-ask/pin-machine'
import type { PointTarget, Rect, ScreenPoint } from '../lib/point-ask/types'

// Point and ask's state (the owner, 8 October). Everything the overlay draws comes from here, and
// everything that changes per frame (positions) is derived from it, not stored in it.

export type WorldBox = { min: [number, number, number]; max: [number, number, number] }

/** A pointed element with its world box, so the overlay can outline and anchor to it. */
export type BubbleTarget = PointTarget & { box: WorldBox | null }

export type PointHit = {
  point: [number, number, number]
  normal: [number, number, number]
  face?: 'interior' | 'exterior' | 'top' | 'bottom'
}

export type PointHover = {
  target: BubbleTarget
  /** The surface the pick came through when it picked its room (the "⌥ the wall" line). */
  ambiguous: boolean
  hit: PointHit
}

export type PointCrop = {
  state: 'none' | 'pending' | 'ready' | 'failed'
  dataUrl?: string
  width?: number
  height?: number
  marked?: boolean
}

/** A dragged rectangle (spec 2.3): drawn while the person drags, then settled until the ask goes or is dismissed. */
export type RegionState = {
  rect: Rect
  sizeLabel: string | null
  settled: boolean
  /** Changes when the shutter fires, so the marquee flashes once. */
  flashKey: number
}

/** What a region bubble is about: the rectangle, the point its tail points at, and what is in it. */
export type BubbleArea = {
  rect: Rect
  click: ScreenPoint
  ids: string[]
  more: number
}

export type PointBubble = {
  targets: BubbleTarget[]
  /** Where the finger landed, world metres: the bubble's tail and the pin's spot. */
  anchor: [number, number, number]
  hit: PointHit
  gesture: 'click' | 'multi' | 'region'
  /** The moment of pointing (pointer-down), ISO. */
  capturedAt: string
  /** The view the person pointed from, recorded at pointer-down. */
  camera: PointCamera | null
  crop: PointCrop
  draft: string
  /** Why the last send did not go (out of credits, no chat): shown in the bubble, the draft kept. */
  error: string | null
  /** A region's rectangle, 0-1 of the canvas, when the gesture was a drag. */
  region?: [number, number, number, number]
  /** Set when the bubble is about a region: it is a view, not a selection, so it has no targets. */
  area?: BubbleArea
}

export type PinRecord = {
  model: PinModel
  /** The spot in the world at send, so the pin shows where it was planted when its target is gone. */
  anchor: [number, number, number]
  /** The same spot in the first target's own frame, so it rides along when Pascal moves the element. */
  local: { nodeId: string; offset: [number, number, number] } | null
  /** "Window · Kitchen, north wall": the chat chip's words. */
  label: string
  levelId: string | null
  before?: PointCrop
  after?: PointCrop
  /** When the pin may retire (ms epoch), set once its turn ends and it is out of the person's way. */
  retireAt: number | null
  /** What was handed to the chat, kept for "Try again". */
  submit?: PointAskSubmit
  createdAt: number
}

type PointAskState = {
  active: boolean
  /** A tap latched the mode; a hold keeps it only while the key is down. */
  latched: boolean
  hover: PointHover | null
  alt: boolean
  shift: boolean
  bubble: PointBubble | null
  /** Drafts kept per first target until the mode leaves ("no, that one" keeps the words). */
  drafts: Record<string, string>
  pins: Record<string, PinRecord>
  pinOrder: string[]
  /** The host's "Playful touches" setting: false turns the flash, ripples and sounds off. */
  playful: boolean
  /** Pascal is on a turn, so a new ask will wait its turn (the Send button says Queue). */
  busy: boolean
  /** The pin whose card is open (hover or focus of the pin, or its own 4 s opening). */
  cardFor: string | null
  /** The rectangle being dragged or just released. */
  region: RegionState | null
  /** How the last bubble left, so the exit can fold into a pin (send) or just shrink (dismiss). */
  closeKind: 'send' | 'dismiss'

  setActive: (active: boolean, latched?: boolean) => void
  setLatched: (latched: boolean) => void
  setRegion: (region: RegionState | null) => void
  setModifiers: (alt: boolean, shift: boolean) => void
  setHover: (hover: PointHover | null) => void
  openBubble: (bubble: PointBubble) => void
  patchBubble: (patch: Partial<PointBubble>) => void
  closeBubble: (kind?: 'send' | 'dismiss') => void
  rememberDraft: (key: string, text: string) => void
  addPin: (pin: PinRecord) => void
  patchPin: (askId: string, patch: Partial<Omit<PinRecord, 'model'>>) => void
  dispatchPin: (askId: string, event: PinEvent) => void
  removePin: (askId: string) => void
  setPlayful: (playful: boolean) => void
  setBusy: (busy: boolean) => void
  openCard: (askId: string | null) => void
}

export const usePointAsk = create<PointAskState>((set) => ({
  active: false,
  latched: false,
  hover: null,
  alt: false,
  shift: false,
  bubble: null,
  drafts: {},
  pins: {},
  pinOrder: [],
  playful: true,
  busy: false,
  cardFor: null,
  closeKind: 'dismiss',
  region: null,

  setActive: (active, latched = false) =>
    set((state) =>
      active === state.active && latched === state.latched
        ? state
        : active
          ? { active, latched }
          : { active: false, latched: false, hover: null, bubble: null, region: null, drafts: {} },
    ),
  setLatched: (latched) => set((state) => (state.latched === latched ? state : { latched })),
  setRegion: (region) => set((state) => (state.region === region ? state : { region })),
  setModifiers: (alt, shift) =>
    set((state) => (state.alt === alt && state.shift === shift ? state : { alt, shift })),
  setHover: (hover) =>
    set((state) => {
      if (state.hover === hover) return state
      if (state.hover && hover && state.hover.target.id === hover.target.id) {
        const same =
          state.hover.ambiguous === hover.ambiguous &&
          state.hover.hit.point.every((v, i) => v === hover.hit.point[i])
        if (same) return state
      }
      return { hover }
    }),
  openBubble: (bubble) => set({ bubble }),
  patchBubble: (patch) =>
    set((state) => (state.bubble ? { bubble: { ...state.bubble, ...patch } } : state)),
  closeBubble: (kind = 'dismiss') =>
    set((state) => (state.bubble ? { bubble: null, closeKind: kind } : state)),
  rememberDraft: (key, text) =>
    set((state) => {
      if ((state.drafts[key] ?? '') === text) return state
      const drafts = { ...state.drafts }
      if (text) drafts[key] = text
      else delete drafts[key]
      return { drafts }
    }),
  addPin: (pin) =>
    set((state) => ({
      pins: { ...state.pins, [pin.model.askId]: pin },
      pinOrder: [...state.pinOrder.filter((id) => id !== pin.model.askId), pin.model.askId],
    })),
  patchPin: (askId, patch) =>
    set((state) => {
      const pin = state.pins[askId]
      return pin ? { pins: { ...state.pins, [askId]: { ...pin, ...patch } } } : state
    }),
  dispatchPin: (askId, event) =>
    set((state) => {
      const pin = state.pins[askId]
      if (!pin) return state
      const model = reducePin(pin.model, event)
      return model === pin.model ? state : { pins: { ...state.pins, [askId]: { ...pin, model } } }
    }),
  removePin: (askId) =>
    set((state) => {
      if (!state.pins[askId]) return state
      const pins = { ...state.pins }
      delete pins[askId]
      return { pins, pinOrder: state.pinOrder.filter((id) => id !== askId) }
    }),
  setPlayful: (playful) => set((state) => (state.playful === playful ? state : { playful })),
  setBusy: (busy) => set((state) => (state.busy === busy ? state : { busy })),
  openCard: (askId) => set((state) => (state.cardFor === askId ? state : { cardFor: askId })),
}))

export { createPin }
