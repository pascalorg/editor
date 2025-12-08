/**
 * Centralized color palette for the editor
 * All colors are defined as hex values
 */

// Preset state colors
export const COLORS = {
  // Preview states
  previewValid: 0x44ff44,
  previewInvalid: 0xff4444,

  // Action states
  delete: 0xff0000,
  ghost: 0xaaaaaa,

  // Glass
  glass: 0xffffff,

  // Solid colors
  white: 0xffffff,
  black: 0x111111,
  gray: 0x888888,
  pink: 0xffaacc,
  green: 0x44aa44,
  blue: 0x4488ff,
  red: 0xff4444,
  orange: 0xff8844,
  yellow: 0xffdd44,
  purple: 0xaa44ff,

  // Default wall colors
  wallDefault: 0xeeeeee,
  wallFront: 0xf5f5f5,
  wallBack: 0xe0e0e0,

  // Floor/ceiling
  floor: 0xcccccc,
  ceiling: 0xfafafa,
} as const

export type ColorName = keyof typeof COLORS
