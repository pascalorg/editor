/**
 * A CAD drawing flattened to the only thing the editor consumes: line
 * segments grouped by layer, in drawing units.
 *
 * Everything a DXF can express — arcs, circles, polyline bulges, block
 * references, splines — is reduced to segments at parse time. The editor
 * draws them (2D SVG paths / 3D LineSegments) and snaps to them; it never
 * needs the curve back. Keeping one primitive means the renderer, the
 * bounds math, and the snap index each handle exactly one case.
 */
export type CadDrawing = {
  layers: CadLayer[]
  /**
   * Flat `[x1, y1, x2, y2, ...]` in drawing units, four numbers per segment.
   *
   * `Float64Array` rather than `Float32Array` because survey-referenced
   * drawings carry coordinates in the hundreds of thousands of millimetres,
   * where float32's ~7 significant digits would quantise geometry to
   * centimetres. `toUnderlayBuffer()` recentres on the drawing origin first,
   * which brings the magnitudes back into float32 range for storage.
   */
  segments: Float64Array
  /** Index into `layers`, one entry per segment. */
  segmentLayers: Uint16Array
  bounds: CadBounds
  units: CadUnits
  stats: CadParseStats
}

export type CadLayer = {
  name: string
  /** AutoCAD Color Index. -1 when the layer table did not declare one. */
  colorIndex: number
  /**
   * False when the layer table marks it off (negative code 62) or frozen
   * (code 70 bit 1). Such layers still parse — the import UI lists them so
   * the user can turn them back on — but they start hidden.
   */
  visible: boolean
}

export type CadBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type CadUnits = {
  /** Raw `$INSUNITS` header value, or null when the header omits it. */
  insunits: number | null
  /**
   * Metres per drawing unit, or null when `$INSUNITS` is absent or 0
   * ("unitless"). Null means the import UI must ask the user to calibrate
   * against a known dimension — guessing here silently produces a model at
   * 1000× scale.
   */
  metersPerUnit: number | null
}

export type CadParseStats = {
  /** Entity type → count, as encountered in ENTITIES (block bodies excluded). */
  entityCounts: Record<string, number>
  segmentCount: number
  /** Entity types seen but not understood — surfaced so the UI can warn. */
  skippedTypes: Record<string, number>
  /** INSERTs that exceeded the nesting limit and were dropped. */
  droppedNestedInserts: number
}

export type CadParseOptions = {
  /**
   * Maximum sagitta (chord-to-arc distance) when flattening curves, in
   * drawing units. Smaller means more segments.
   *
   * Omit it. The default derives the budget from `$INSUNITS` so a drawing in
   * millimetres and the same drawing in metres tessellate identically, and
   * falls back to a radius-relative budget when the file is unitless. Pass a
   * value only to deliberately trade accuracy for segment count.
   */
  arcTolerance?: number
  /** Nesting depth for block references. Cycles are cut here. */
  maxInsertDepth?: number
}
