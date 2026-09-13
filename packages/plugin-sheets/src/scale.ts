/**
 * Sheet scale math.
 *
 * A scale here is the plain world:paper ratio an architect means when they
 * write 1/4" = 1'-0" — twelve inches of building drawn as a quarter inch of
 * paper is 12 / 0.25 = 48. The model is metric (metres), the paper is
 * imperial (inches), so the only constant is 39.3700787 in/m.
 */

export const INCHES_PER_METRE = 39.3700787401575
export const METRES_PER_FOOT = 0.3048

/** World metres → sheet inches at a drawing scale. */
export function worldToSheetInches(metres: number, scale: number): number {
  return (metres * INCHES_PER_METRE) / scale
}

/** Sheet inches → world metres at a drawing scale. */
export function sheetInchesToWorld(inches: number, scale: number): number {
  return (inches * scale) / INCHES_PER_METRE
}

export type ScalePreset = { label: string; scale: number }

/** Architectural scales, plus the civil ones a site plan needs. */
export const SCALE_PRESETS: ScalePreset[] = [
  { label: '1" = 1\'-0"', scale: 12 },
  { label: '3/4" = 1\'-0"', scale: 16 },
  { label: '1/2" = 1\'-0"', scale: 24 },
  { label: '3/8" = 1\'-0"', scale: 32 },
  { label: '1/4" = 1\'-0"', scale: 48 },
  { label: '3/16" = 1\'-0"', scale: 64 },
  { label: '1/8" = 1\'-0"', scale: 96 },
  { label: '3/32" = 1\'-0"', scale: 128 },
  { label: '1/16" = 1\'-0"', scale: 192 },
  { label: '1" = 10\'', scale: 120 },
  { label: '1" = 20\'', scale: 240 },
  { label: '1" = 30\'', scale: 360 },
  { label: '1" = 40\'', scale: 480 },
]

export function scaleLabel(scale: number): string {
  const preset = SCALE_PRESETS.find((p) => p.scale === scale)
  if (preset) return preset.label
  if (scale >= 100) return `1" = ${round(scale / 12)}'`
  return `${round(12 / scale, 4)}" = 1'-0"`
}

function round(value: number, places = 2): number {
  const f = 10 ** places
  return Math.round(value * f) / f
}

/**
 * The largest preset scale at which a world extent still fits a viewport
 * box, so "+ Viewport" lands on a sensible drawing scale instead of one the
 * author has to hunt for. Falls back to the coarsest preset.
 */
export function fitScale(
  worldWidthM: number,
  worldHeightM: number,
  boxWidthIn: number,
  boxHeightIn: number,
  presets: readonly ScalePreset[] = SCALE_PRESETS,
): number {
  const ordered = [...presets].sort((a, b) => a.scale - b.scale)
  for (const { scale } of ordered) {
    if (
      worldToSheetInches(worldWidthM, scale) <= boxWidthIn &&
      worldToSheetInches(worldHeightM, scale) <= boxHeightIn
    ) {
      return scale
    }
  }
  return ordered[ordered.length - 1]?.scale ?? 96
}

/* --------------------------------------------------------- paper */

export type PaperSize = { widthIn: number; heightIn: number; label: string }

export const PAPER_SIZES: Record<'arch-d' | 'arch-c' | 'tabloid', PaperSize> = {
  'arch-d': { widthIn: 36, heightIn: 24, label: 'ARCH D — 36 × 24 in' },
  'arch-c': { widthIn: 24, heightIn: 18, label: 'ARCH C — 24 × 18 in' },
  tabloid: { widthIn: 17, heightIn: 11, label: 'Tabloid — 17 × 11 in' },
}

export function paperSize(size: string | undefined): PaperSize {
  return PAPER_SIZES[(size ?? 'arch-d') as keyof typeof PAPER_SIZES] ?? PAPER_SIZES['arch-d']
}

/**
 * The world window a viewport box shows at a scale, centred on `centre`.
 * Returned in world metres as a bounds rectangle.
 */
export function worldWindow(
  centre: { x: number; y: number },
  boxWidthIn: number,
  boxHeightIn: number,
  scale: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfW = sheetInchesToWorld(boxWidthIn, scale) / 2
  const halfH = sheetInchesToWorld(boxHeightIn, scale) / 2
  return {
    minX: centre.x - halfW,
    minY: centre.y - halfH,
    maxX: centre.x + halfW,
    maxY: centre.y + halfH,
  }
}
