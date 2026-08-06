import {
  composeTransform,
  emitArc,
  emitBulge,
  emitEllipse,
  emitLine,
  IDENTITY,
  insertTransform,
  SegmentSink,
  type Tolerance,
  type Transform2D,
} from './flatten'
import { flattenSpline, type SplineDefinition } from './spline'
import type { CadDrawing, CadLayer, CadParseOptions, CadParseStats } from './types'
import { resolveUnits } from './units'

const DEG_TO_RAD = Math.PI / 180
const DEFAULT_MAX_INSERT_DEPTH = 8
const TAU = Math.PI * 2

/**
 * Default curve accuracy: half a millimetre of sagitta, which is below the
 * line weight of any plan a human will look at and well below anything worth
 * snapping to.
 */
const DEFAULT_ARC_TOLERANCE_METERS = 0.0005

/**
 * Fallback for unitless drawings, as a fraction of each curve's radius. Yields
 * ~50 chords for a full circle at any scale.
 */
const DEFAULT_RELATIVE_TOLERANCE = 0.002

/**
 * The entity types we turn into geometry. Anything else is counted in
 * `stats.skippedTypes` so the import UI can tell the user what was dropped
 * rather than silently losing part of their drawing.
 */
const GEOMETRY_TYPES = new Set<string>([
  'LINE',
  'ARC',
  'CIRCLE',
  'ELLIPSE',
  'SPLINE',
  'LWPOLYLINE',
  'POLYLINE',
  'VERTEX',
  'INSERT',
])

/** Entities whose 10/20 codes repeat to build a point list. */
const POINT_LIST_TYPES = new Set<string>(['LWPOLYLINE', 'SPLINE'])

type Vertex = { x: number; y: number; bulge: number }

/**
 * One entity's group codes, gathered between two code-0 records.
 *
 * A single instance is reused across the whole ENTITIES section — a drawing
 * with 200k entities would otherwise allocate 200k short-lived objects. Block
 * bodies are the exception: those get cloned, because an INSERT replays them
 * later.
 */
type EntityAccumulator = {
  type: string
  layer: string
  blockName: string
  x1: number
  y1: number
  x2: number
  y2: number
  radius: number
  startAngle: number
  endAngle: number
  scaleX: number
  scaleY: number
  rotation: number
  bulge: number
  closed: boolean
  /** Extrusion Z. -1 means the entity is defined in a mirrored OCS. */
  extrusionZ: number
  vertices: Vertex[]
  /** SPLINE only: knot vector, rational weights, and curve degree. */
  knots: number[]
  weights: number[]
  degree: number
}

function newAccumulator(): EntityAccumulator {
  return {
    type: '',
    layer: '0',
    blockName: '',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    radius: 0,
    startAngle: 0,
    endAngle: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    bulge: 0,
    closed: false,
    extrusionZ: 1,
    vertices: [],
    knots: [],
    weights: [],
    degree: 3,
  }
}

function resetAccumulator(acc: EntityAccumulator, type: string): void {
  acc.type = type
  acc.layer = '0'
  acc.blockName = ''
  acc.x1 = 0
  acc.y1 = 0
  acc.x2 = 0
  acc.y2 = 0
  acc.radius = 0
  acc.startAngle = 0
  acc.endAngle = 0
  acc.scaleX = 1
  acc.scaleY = 1
  acc.rotation = 0
  acc.bulge = 0
  acc.closed = false
  acc.extrusionZ = 1
  acc.vertices = []
  acc.knots = []
  acc.weights = []
  acc.degree = 3
}

function controlPolygonLength(points: readonly (readonly [number, number])[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
  }
  return total
}

function cloneAccumulator(acc: EntityAccumulator): EntityAccumulator {
  return {
    ...acc,
    vertices: acc.vertices.map((v) => ({ ...v })),
    knots: [...acc.knots],
    weights: [...acc.weights],
  }
}

type Block = {
  baseX: number
  baseY: number
  entities: EntityAccumulator[]
}

/**
 * Parse an ASCII DXF into flattened line segments.
 *
 * The parser walks the group-code stream once with a cursor rather than
 * splitting into lines: a 13 MB drawing is ~1.3M lines, and materialising that
 * array costs more memory than every segment we produce from it.
 *
 * Binary DXF is not supported — `parseDxf` throws on it. AutoCAD writes ASCII
 * by default and every converter we feed (including `dwg2dxf`) can be told to.
 */
export function parseDxf(source: string, options: CadParseOptions = {}): CadDrawing {
  if (source.startsWith('AutoCAD Binary DXF')) {
    throw new Error('Binary DXF is not supported — re-export the drawing as ASCII DXF.')
  }

  const maxInsertDepth = options.maxInsertDepth ?? DEFAULT_MAX_INSERT_DEPTH
  let insunits: number | null = null

  // Resolved once the ENTITIES section opens, by which point the header has
  // been read. An explicit option always wins; otherwise a declared unit turns
  // the default millimetre budget into drawing units, and a unitless drawing
  // falls back to a radius-relative budget.
  let arcTolerance: Tolerance = {
    absolute: options.arcTolerance ?? null,
    relative: DEFAULT_RELATIVE_TOLERANCE,
  }

  function resolveArcTolerance(): void {
    if (options.arcTolerance !== undefined) return
    const metersPerUnit = resolveUnits(insunits).metersPerUnit
    arcTolerance = {
      absolute: metersPerUnit === null ? null : DEFAULT_ARC_TOLERANCE_METERS / metersPerUnit,
      relative: DEFAULT_RELATIVE_TOLERANCE,
    }
  }

  const sink = new SegmentSink()
  const layerIndex = new Map<string, number>()
  const layers: CadLayer[] = []
  const blocks = new Map<string, Block>()
  const stats: CadParseStats = {
    entityCounts: {},
    segmentCount: 0,
    skippedTypes: {},
    droppedNestedInserts: 0,
  }

  function layerFor(name: string): number {
    const existing = layerIndex.get(name)
    if (existing !== undefined) return existing
    // A layer referenced by an entity but absent from the LAYER table. Real
    // files do this; treat it as a visible default-coloured layer rather than
    // dropping the geometry.
    const index = layers.length
    layerIndex.set(name, index)
    layers.push({ name, colorIndex: -1, visible: true })
    return index
  }

  // ── Emission ────────────────────────────────────────────────────────────

  function emitEntity(entity: EntityAccumulator, transform: Transform2D, depth: number): void {
    // A negative extrusion Z means the entity's own coordinate system is
    // mirrored about the Y axis. This is how AutoCAD stores mirrored blocks
    // and flipped text; ignoring it lands the geometry on the wrong side of
    // the drawing. Arbitrary (non axis-aligned) extrusions are rare in plan
    // drawings and fall back to the unmirrored case.
    const local: Transform2D =
      entity.extrusionZ < 0
        ? composeTransform(transform, { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        : transform

    const layer = layerFor(entity.layer)

    switch (entity.type) {
      case 'LINE':
        emitLine(sink, layer, entity.x1, entity.y1, entity.x2, entity.y2, local)
        return

      case 'CIRCLE':
        emitArc(sink, layer, entity.x1, entity.y1, entity.radius, 0, TAU, arcTolerance, local)
        return

      case 'ARC': {
        // DXF arcs always sweep counter-clockwise from start to end angle, so
        // an end angle below the start wraps rather than sweeping backwards.
        const start = entity.startAngle * DEG_TO_RAD
        const end = entity.endAngle * DEG_TO_RAD
        let sweep = end - start
        while (sweep <= 0) sweep += TAU
        emitArc(sink, layer, entity.x1, entity.y1, entity.radius, start, sweep, arcTolerance, local)
        return
      }

      case 'ELLIPSE':
        emitEllipse(
          sink,
          layer,
          entity.x1,
          entity.y1,
          // The major axis is stored as a vector RELATIVE to the centre.
          entity.x2,
          entity.y2,
          entity.radius,
          entity.startAngle,
          entity.endAngle,
          arcTolerance,
          local,
        )
        return

      case 'SPLINE': {
        const spline: SplineDefinition = {
          controlPoints: entity.vertices.map((v) => [v.x, v.y] as const),
          weights: entity.weights,
          knots: entity.knots,
          degree: entity.degree,
          closed: entity.closed,
        }
        if (spline.controlPoints.length < 2) return

        // Splines carry no radius, so a relative tolerance has nothing to be
        // relative to; fall back to the control polygon's own scale.
        const budget =
          arcTolerance.absolute ??
          controlPolygonLength(spline.controlPoints) * arcTolerance.relative

        const points = flattenSpline(spline, Math.max(budget, 1e-9))
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i]!
          const b = points[i + 1]!
          emitLine(sink, layer, a[0], a[1], b[0], b[1], local)
        }
        if (entity.closed && points.length > 2) {
          const first = points[0]!
          const last = points[points.length - 1]!
          emitLine(sink, layer, last[0], last[1], first[0], first[1], local)
        }
        return
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = entity.vertices
        if (verts.length < 2) return
        const last = entity.closed ? verts.length : verts.length - 1
        for (let i = 0; i < last; i++) {
          const a = verts[i]!
          const b = verts[(i + 1) % verts.length]!
          if (a.bulge === 0) {
            emitLine(sink, layer, a.x, a.y, b.x, b.y, local)
          } else {
            emitBulge(sink, layer, a.x, a.y, b.x, b.y, a.bulge, arcTolerance, local)
          }
        }
        return
      }

      case 'INSERT': {
        const block = blocks.get(entity.blockName)
        if (!block) return
        if (depth >= maxInsertDepth) {
          stats.droppedNestedInserts++
          return
        }
        // The block's base point is the origin its body is drawn around, so it
        // has to be subtracted before the INSERT's own placement is applied.
        const placement = composeTransform(
          insertTransform(
            entity.x1,
            entity.y1,
            entity.scaleX,
            entity.scaleY,
            entity.rotation * DEG_TO_RAD,
          ),
          { a: 1, b: 0, c: 0, d: 1, e: -block.baseX, f: -block.baseY },
        )
        const composed = composeTransform(local, placement)
        for (const child of block.entities) {
          emitEntity(child, composed, depth + 1)
        }
        return
      }
    }
  }

  // ── Stream walk ─────────────────────────────────────────────────────────

  const accumulator = newAccumulator()
  let section = ''
  let tableName = ''
  let headerVar = ''
  let currentBlock: Block | null = null
  /** POLYLINE waits for its VERTEX children, so it can't flush on its own. */
  let pendingPolyline: EntityAccumulator | null = null
  let pendingLayer: CadLayer | null = null
  /** LWPOLYLINE interleaves 10/20 pairs; a 20 completes the vertex a 10 began. */
  let vertexX = 0
  let hasVertexX = false

  function finishPendingLayer(): void {
    if (!pendingLayer) return
    if (!layerIndex.has(pendingLayer.name)) {
      layerIndex.set(pendingLayer.name, layers.length)
      layers.push(pendingLayer)
    } else {
      // The table entry is authoritative over the placeholder an earlier
      // entity reference created.
      const index = layerIndex.get(pendingLayer.name)!
      layers[index] = pendingLayer
    }
    pendingLayer = null
  }

  function flushEntity(): void {
    const type = accumulator.type
    if (!type) return

    if (section === 'TABLES') {
      if (type === 'LAYER') finishPendingLayer()
      return
    }

    if (type === 'VERTEX') {
      if (pendingPolyline) {
        pendingPolyline.vertices.push({
          x: accumulator.x1,
          y: accumulator.y1,
          bulge: accumulator.bulge,
        })
      }
      return
    }

    // Any entity other than VERTEX terminates an open POLYLINE, SEQEND or not.
    if (pendingPolyline && type !== 'POLYLINE') {
      dispatch(pendingPolyline)
      pendingPolyline = null
    }

    if (type === 'POLYLINE') {
      pendingPolyline = cloneAccumulator(accumulator)
      return
    }

    if (!GEOMETRY_TYPES.has(type)) {
      if (section === 'ENTITIES') stats.skippedTypes[type] = (stats.skippedTypes[type] ?? 0) + 1
      return
    }

    dispatch(accumulator)
  }

  function dispatch(entity: EntityAccumulator): void {
    if (currentBlock) {
      currentBlock.entities.push(entity === accumulator ? cloneAccumulator(entity) : entity)
      return
    }
    if (section !== 'ENTITIES') return
    stats.entityCounts[entity.type] = (stats.entityCounts[entity.type] ?? 0) + 1
    emitEntity(entity, IDENTITY, 0)
  }

  const length = source.length
  let cursor = 0

  function nextLine(): string | null {
    if (cursor >= length) return null
    let end = source.indexOf('\n', cursor)
    if (end === -1) end = length
    let stop = end
    // DXF written on Windows carries CRLF; a stray \r turns every string value
    // into a near-miss (`"DUVAR\r" !== "DUVAR"`) and every number into NaN.
    if (stop > cursor && source.charCodeAt(stop - 1) === 13) stop--
    const line = source.slice(cursor, stop)
    cursor = end + 1
    return line
  }

  for (;;) {
    const codeLine = nextLine()
    if (codeLine === null) break
    const valueLine = nextLine()
    if (valueLine === null) break

    const code = Number.parseInt(codeLine, 10)
    if (Number.isNaN(code)) continue
    const value = valueLine

    if (code === 0) {
      flushEntity()

      if (value === 'SECTION') {
        section = ''
        headerVar = ''
        resetAccumulator(accumulator, '')
        continue
      }
      if (value === 'ENDSEC') {
        section = ''
        tableName = ''
        headerVar = ''
        currentBlock = null
        resetAccumulator(accumulator, '')
        continue
      }
      if (value === 'EOF') break

      if (value === 'ENDBLK') {
        currentBlock = null
        resetAccumulator(accumulator, '')
        continue
      }
      if (value === 'TABLE') {
        tableName = ''
      }
      if (value === 'ENDTAB') {
        tableName = ''
      }
      if (value === 'LAYER' && section === 'TABLES' && tableName === 'LAYER') {
        pendingLayer = { name: '', colorIndex: -1, visible: true }
      }

      resetAccumulator(accumulator, value)
      hasVertexX = false
      continue
    }

    // Code 2 is overloaded: section name, table name, block name on both BLOCK
    // and INSERT, and layer name inside the LAYER table. Order matters here.
    if (code === 2) {
      if (section === '') {
        section = value
        if (section === 'ENTITIES') resolveArcTolerance()
        continue
      }
      if (accumulator.type === 'TABLE') {
        tableName = value
        continue
      }
      if (pendingLayer && accumulator.type === 'LAYER') {
        pendingLayer.name = value
        continue
      }
      if (accumulator.type === 'BLOCK') {
        currentBlock = { baseX: 0, baseY: 0, entities: [] }
        blocks.set(value, currentBlock)
        continue
      }
      accumulator.blockName = value
      continue
    }

    if (code === 9) {
      headerVar = value
      continue
    }

    switch (code) {
      case 8:
        accumulator.layer = value
        continue
      case 10: {
        const x = Number.parseFloat(value)
        if (POINT_LIST_TYPES.has(accumulator.type)) {
          vertexX = x
          hasVertexX = true
        } else if (accumulator.type === 'BLOCK' && currentBlock) {
          currentBlock.baseX = x
        } else {
          accumulator.x1 = x
        }
        continue
      }
      case 20: {
        const y = Number.parseFloat(value)
        if (POINT_LIST_TYPES.has(accumulator.type)) {
          if (hasVertexX) {
            accumulator.vertices.push({ x: vertexX, y, bulge: 0 })
            hasVertexX = false
          }
        } else if (accumulator.type === 'BLOCK' && currentBlock) {
          currentBlock.baseY = y
        } else {
          accumulator.y1 = y
        }
        continue
      }
      case 11:
        accumulator.x2 = Number.parseFloat(value)
        continue
      case 21:
        accumulator.y2 = Number.parseFloat(value)
        continue
      case 40:
        // Overloaded: a knot for SPLINE, the minor/major ratio for ELLIPSE,
        // the radius for ARC and CIRCLE.
        if (accumulator.type === 'SPLINE') accumulator.knots.push(Number.parseFloat(value))
        else accumulator.radius = Number.parseFloat(value)
        continue
      case 41:
        if (accumulator.type === 'SPLINE') accumulator.weights.push(Number.parseFloat(value))
        else if (accumulator.type === 'ELLIPSE') accumulator.startAngle = Number.parseFloat(value)
        else accumulator.scaleX = Number.parseFloat(value)
        continue
      case 42: {
        const bulge = Number.parseFloat(value)
        if (accumulator.type === 'ELLIPSE') {
          accumulator.endAngle = bulge
        } else if (accumulator.type === 'LWPOLYLINE') {
          // A bulge belongs to the vertex it follows.
          const last = accumulator.vertices[accumulator.vertices.length - 1]
          if (last) last.bulge = bulge
        } else if (accumulator.type === 'INSERT') {
          accumulator.scaleY = bulge
        } else {
          accumulator.bulge = bulge
        }
        continue
      }
      case 50:
        if (accumulator.type === 'INSERT') accumulator.rotation = Number.parseFloat(value)
        else accumulator.startAngle = Number.parseFloat(value)
        continue
      case 51:
        accumulator.endAngle = Number.parseFloat(value)
        continue
      case 62:
        if (pendingLayer) {
          const colorIndex = Number.parseInt(value, 10)
          pendingLayer.colorIndex = Math.abs(colorIndex)
          // AutoCAD stores "layer off" as a negated colour index.
          if (colorIndex < 0) pendingLayer.visible = false
        }
        continue
      case 71:
        if (accumulator.type === 'SPLINE') accumulator.degree = Number.parseInt(value, 10)
        continue
      case 70:
        if (headerVar === '$INSUNITS') {
          insunits = Number.parseInt(value, 10)
          headerVar = ''
        } else if (pendingLayer) {
          // Bit 1 = frozen.
          if ((Number.parseInt(value, 10) & 1) !== 0) pendingLayer.visible = false
        } else if (
          accumulator.type === 'LWPOLYLINE' ||
          accumulator.type === 'POLYLINE' ||
          accumulator.type === 'SPLINE'
        ) {
          accumulator.closed = (Number.parseInt(value, 10) & 1) !== 0
        }
        continue
      case 230:
        accumulator.extrusionZ = Number.parseFloat(value)
        continue
    }
  }

  flushEntity()
  if (pendingPolyline) dispatch(pendingPolyline)
  finishPendingLayer()

  stats.segmentCount = sink.length

  return {
    layers,
    segments: sink.segments(),
    segmentLayers: sink.segmentLayers(),
    bounds: sink.bounds(),
    units: resolveUnits(insunits),
    stats,
  }
}
