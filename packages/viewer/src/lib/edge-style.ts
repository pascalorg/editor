// Edge overlay = a screen-space ink pass (see `ink-edges.ts`), driven by this
// mode. `off`/`soft`/`strong` map to ink intensity in the post-processing pass.
export type EdgeMode = 'off' | 'soft' | 'strong'

// Ink line colour follows background luminance — light backgrounds get
// near-black lines, dark backgrounds get near-white. Same rule Mapbox uses for
// label outlines, so edges stay legible across every scene theme.
export function edgeColorFor(background: string): string {
  const hex = background.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luma > 0.5 ? '#1a1d24' : '#dde2eb'
}
