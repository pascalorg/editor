// The numbers Point and ask moves by, in one place: the direction's tokens
// (chat-juice-direction.md), the choreography section of point-and-ask-spec.md, and where the two
// differ, the prototype's (pascal-builds.html), which the owner played and called the bar.

export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'

export type SpringTokens = { damping: number; response: number }

/** Critically damped: the default for anything a person can touch. */
export const SPRING: SpringTokens = { damping: 1, response: 0.35 }
/** A little bounce, only for things that carry momentum. */
export const MOMENTUM: SpringTokens = { damping: 0.8, response: 0.35 }
/** The outline's four corners travelling between targets. */
export const CORNER_SPRING: SpringTokens = { damping: 1, response: 0.16 }

// Durations (ms).
export const PRESS_MS = 120
export const ENTER_MS = 180
export const CARD_MS = 220
/** An exit is quicker than an entrance. */
export const BUBBLE_CLOSE_MS = 150
export const CARD_CLOSE_MS = 120
export const PIN_RETIRE_FADE_MS = 180
export const CHECK_STROKE_MS = 240
export const CHECK_PULSE_MS = 380
export const PIN_DROP_MS = 320
export const PIN_RING_MS = 560
export const PIN_RING_DELAY_MS = 160
// The prototype's flash, longer than the spec's 120 ms: a shutter has to be seen to be felt.
export const REGION_FLASH_MS = 280
export const SUGGESTION_STAGGER_MS = 30
export const SUGGESTION_DELAY_MS = 40
export const CHIP_FADE_MS = 120

// Thresholds and dwell (ms or px).
export const CLICK_SLOP_PX = 6
export const DWELL_MS = 120
export const SIDE_HYSTERESIS_MS = 150
export const TAP_LATCH_MS = 200
export const CARD_AUTO_MS = 4000
export const CARD_CLOSE_DELAY_MS = 400
export const PIN_RETIRE_MS = 8000
export const THIN_TARGET_PX = 6

// Layout (px).
export const BUBBLE_W = 320
export const BUBBLE_GAP = 16
export const VIEWPORT_INSET = 12
export const BIG_BOX_DISC = 48
export const MAX_TARGETS = 12
export const PIN_DISC = 24
export const PIN_HIT = 32
export const PIN_HIT_TOUCH = 44
export const CARD_W = 250
export const CHIP_OFFSET = 14

// Motion shapes.
/** The bubble grows from the click: 0.92 -> 1 with opacity and a 4 px blur (the prototype's, not the spec's 0.96). */
export const BUBBLE_OPEN_SCALE = 0.92
export const BUBBLE_OPEN_BLUR_PX = 4
export const PIN_DROP_PX = 8
export const CHIP_RISE_PX = 4
