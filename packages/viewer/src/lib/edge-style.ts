// Edge overlay = a screen-space ink pass (see `ink-edges.ts`), driven by this
// mode. `off`/`soft`/`strong` map to ink intensity in the post-processing pass.
export type EdgeMode = 'off' | 'soft' | 'strong'

function lumaOf(background: string): number {
  const hex = background.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Ink line colour follows background luminance — light backgrounds get
// near-black lines (the rule Mapbox uses for label outlines). Dark backgrounds
// get a tint *derived from the background* rather than a near-white constant:
// full-white lines glow harshly against night/twilight scenes, while lifting
// the background's own hue toward white stays legible but reads native to the
// theme.
export function edgeColorFor(background: string): string {
  if (lumaOf(background) > 0.5) return '#1a1d24'
  const hex = background.replace('#', '')
  let out = '#'
  for (let i = 0; i < 3; i++) {
    const c = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255
    out += Math.round((c + (1 - c) * 0.42) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

// Dark scenes additionally run the ink slightly transparent — even a muted
// tint at full alpha reads as glowing wireframe against a low-luma backdrop.
export function edgeOpacityScaleFor(background: string): number {
  return lumaOf(background) > 0.5 ? 1 : 0.7
}
