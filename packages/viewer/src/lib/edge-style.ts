// Edge-overlay styling, adapted from the `experiences/aesthetic` prototype
// (`scene/style.ts`). `threshold` is the EdgesGeometry crease angle (degrees) —
// only adjacent faces deviating by more than this emit a line, so a box yields
// its 12 silhouette/crease edges and nothing else. `linewidth` is screen-space
// pixels (the overlay uses Line2 / LineSegments2, so width is honored).

export type EdgeMode = 'off' | 'soft' | 'strong'

export type EdgeStyle = {
  opacity: number
  threshold: number
  linewidth: number
}

export function edgeStyleFor(mode: EdgeMode): EdgeStyle {
  switch (mode) {
    case 'soft':
      return { opacity: 0.4, threshold: 25, linewidth: 1.5 }
    case 'strong':
      return { opacity: 0.95, threshold: 12, linewidth: 2 }
    default:
      return { opacity: 0, threshold: 30, linewidth: 1 }
  }
}

// Line colour follows background luminance — light backgrounds get near-black
// lines, dark backgrounds get near-white. Same rule Mapbox uses for label
// outlines, so edges stay legible across every scene theme.
export function edgeColorFor(background: string): string {
  const hex = background.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luma > 0.5 ? '#1a1d24' : '#dde2eb'
}
