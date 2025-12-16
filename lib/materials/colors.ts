/**
 * Centralized color palette for the editor
 * All colors are defined as hex values
 */

// Preset state colors
export const COLORS = {
  // Preview states
  previewValid: '#4cde4c',
  previewInvalid: 0xff_44_44,

  // Action states
  delete: 0xff_00_00,
  ghost: 0xaa_aa_aa,

  // Glass
  glass: 0xff_ff_ff,

  // Solid colors
  white: 0xff_ff_ff,
  black: 0x11_11_11,
  gray: 0x88_88_88,
  pink: 0xff_aa_cc,
  green: 0x44_aa_44,
  blue: 0x44_88_ff,
  red: 0xff_44_44,
  orange: 0xff_88_44,
  yellow: 0xff_dd_44,
  purple: 0xaa_44_ff,

  // Default wall colors
  wallDefault: 0xee_ee_ee,
  wallFront: 0xf5_f5_f5,
  wallBack: 0xe0_e0_e0,

  // Floor/ceiling
  floor: 0xcc_cc_cc,
  ceiling: 0xfa_fa_fa,
} as const

export type ColorName = keyof typeof COLORS
