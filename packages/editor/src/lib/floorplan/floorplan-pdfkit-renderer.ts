import { type FloorplanGeometry, type FloorplanPoint, loadAssetUrl } from '@pascal-app/core'
import {
  type ArchitecturalDimensionLayout,
  computeArchitecturalDimensionLayout,
} from '../../components/editor-2d/renderers/floorplan-dimension-renderer'
import {
  documentCircleGeometryAttrs,
  documentRectGeometryAttrs,
  resolveDocumentAnnotationGroupChildren,
} from '../../components/editor-2d/renderers/floorplan-geometry-renderer'
import { resolveFloorplanLabelAngle } from '../../components/editor-2d/renderers/floorplan-label-angle'
import type { FloorplanExportBounds } from './floorplan-export'
import { readFloorplanGeometryMetadata } from './floorplan-extension'
import type { FloorplanPdfDocument } from './floorplan-pdfkit-document'

const DIMENSION_LINE_WIDTH_PT = 0.5
const DIMENSION_TICK_WIDTH_PT = 0.75
const DIMENSION_TEXT_FONT_FAMILY = 'Courier'
const DIMENSION_TEXT_FONT_SIZE_PT = 8
const DIMENSION_TEXT_FONT_WEIGHT = 400
const DIMENSION_BASELINE_OFFSET_PT = 5
const DEFAULT_ANNOTATION_FONT_SIZE_PT = 8
const ROOM_NUMBER_FONT_SIZE_PT = 7
const ROOM_DETAIL_FONT_SIZE_PT = 5.5
const MARK_FONT_SIZE_PT = 7

type DimensionGeometry = Extract<FloorplanGeometry, { kind: 'dimension' }>
type DimensionStringGeometry = Extract<FloorplanGeometry, { kind: 'dimension-string' }>
type StyledGeometry = Extract<
  FloorplanGeometry,
  { kind: 'path' | 'polygon' | 'polyline' | 'rect' | 'circle' | 'line' }
>

type RenderContext = {
  annotationLabelShiftIndex: number
  annotationLabelShifts: readonly FloorplanPoint[]
  annotationLayer: boolean
  sceneRotationDeg: number
  unitsPerPoint: number
}

export type FloorplanPdfKitPlacement = {
  x: number
  y: number
  width: number
  height: number
}

export async function renderFloorplanGeometryToPdfKit(
  doc: FloorplanPdfDocument,
  geometry: FloorplanGeometry,
  options: {
    annotationLabelShifts?: readonly FloorplanPoint[]
    annotationLayer: boolean
    placement: FloorplanPdfKitPlacement
    rotationDeg: number
    viewport: FloorplanExportBounds
  },
): Promise<void> {
  const pointsPerUnit = options.placement.width / options.viewport.width
  if (!Number.isFinite(pointsPerUnit) || pointsPerUnit <= 0) return

  const raw = doc.raw
  raw.save()
  raw.translate(options.placement.x, options.placement.y)
  raw.scale(pointsPerUnit)
  raw.translate(-options.viewport.x, -options.viewport.y)
  raw.rotate(options.rotationDeg, { origin: [0, 0] })
  await renderGeometry(doc, geometry, {
    annotationLabelShiftIndex: 0,
    annotationLabelShifts: options.annotationLabelShifts ?? [],
    annotationLayer: options.annotationLayer,
    sceneRotationDeg: options.rotationDeg,
    unitsPerPoint: 1 / pointsPerUnit,
  })
  raw.restore()
}

async function renderGeometry(
  doc: FloorplanPdfDocument,
  geometry: FloorplanGeometry,
  context: RenderContext,
): Promise<void> {
  const raw = doc.raw
  switch (geometry.kind) {
    case 'path':
      raw.save().path(geometry.d)
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'polygon':
      if (geometry.points.length < 2) return
      raw.save().polygon(...geometry.points.map(([x, y]) => [x, y] as [number, number]))
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'polyline':
      if (geometry.points.length < 2) return
      raw.save().moveTo(geometry.points[0]![0], geometry.points[0]![1])
      for (const [x, y] of geometry.points.slice(1)) raw.lineTo(x, y)
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'rect':
      raw.save()
      {
        const attrs = documentRectGeometryAttrs(
          geometry,
          context.annotationLayer ? context.unitsPerPoint : undefined,
        )
        if ((attrs.rx ?? 0) > 0 || (attrs.ry ?? 0) > 0) {
          raw.roundedRect(
            attrs.x,
            attrs.y,
            attrs.width,
            attrs.height,
            Math.max(attrs.rx ?? 0, attrs.ry ?? 0),
          )
        } else {
          raw.rect(attrs.x, attrs.y, attrs.width, attrs.height)
        }
      }
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'circle':
      raw
        .save()
        .circle(
          geometry.cx,
          geometry.cy,
          documentCircleGeometryAttrs(
            geometry,
            context.annotationLayer ? context.unitsPerPoint : undefined,
          ).r,
        )
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'line':
      raw.save().moveTo(geometry.x1, geometry.y1).lineTo(geometry.x2, geometry.y2)
      paintStyledGeometry(raw, geometry, context)
      raw.restore()
      return
    case 'text':
      drawGeometryText(doc, geometry, context)
      return
    case 'dimension':
      drawDimension(doc, geometry, context)
      return
    case 'dimension-string':
      drawDimensionString(doc, geometry, context)
      return
    case 'dimension-label':
      drawDimensionLabel(doc, geometry, context)
      return
    case 'equal-spacing-badge':
      drawEqualSpacingBadge(doc, geometry, context)
      return
    case 'image':
      await drawImage(doc, geometry)
      return
    case 'group':
      raw.save()
      if (geometry.transform?.translate) {
        raw.translate(geometry.transform.translate[0], geometry.transform.translate[1])
      }
      if (geometry.transform?.rotate !== undefined) {
        raw.rotate((geometry.transform.rotate * 180) / Math.PI, { origin: [0, 0] })
      }
      for (const child of resolveDocumentAnnotationGroupChildren(
        geometry.children,
        context.annotationLayer ? context.unitsPerPoint : undefined,
      )) {
        await renderGeometry(doc, child, context)
      }
      raw.restore()
      return
    default:
      return
  }
}

function paintStyledGeometry(
  raw: FloorplanPdfDocument['raw'],
  geometry: StyledGeometry,
  context: RenderContext,
): void {
  const fill = geometry.fill && geometry.fill !== 'none' ? geometry.fill : null
  const stroke = geometry.stroke && geometry.stroke !== 'none' ? geometry.stroke : null
  const opacity = geometry.opacity ?? 1
  const fillOpacity = (geometry.fillOpacity ?? 1) * opacity
  const strokeOpacity = (geometry.strokeOpacity ?? 1) * opacity

  if (fill) raw.fillColor(fill).fillOpacity(fillOpacity)
  if (stroke) {
    raw.strokeColor(stroke).strokeOpacity(strokeOpacity)
    raw.lineWidth(resolveStrokeWidth(geometry, context))
    if (geometry.strokeLinecap) raw.lineCap(geometry.strokeLinecap)
    if (geometry.strokeLinejoin) raw.lineJoin(geometry.strokeLinejoin)
    applyDash(
      raw,
      geometry.strokeDasharray,
      geometry.vectorEffect === 'non-scaling-stroke',
      context,
    )
  }

  if (fill && stroke) raw.fillAndStroke(fill, stroke)
  else if (fill) raw.fill(fill)
  else if (stroke) raw.stroke(stroke)
}

function resolveStrokeWidth(geometry: StyledGeometry, context: RenderContext): number {
  if (context.annotationLayer) return DIMENSION_LINE_WIDTH_PT * context.unitsPerPoint
  if (geometry.vectorEffect === 'non-scaling-stroke') {
    return (geometry.strokeWidth ?? 1) * context.unitsPerPoint
  }
  return geometry.strokeWidth ?? DIMENSION_LINE_WIDTH_PT * context.unitsPerPoint
}

function applyDash(
  raw: FloorplanPdfDocument['raw'],
  dasharray: string | undefined,
  nonScaling: boolean,
  context: RenderContext,
): void {
  if (!dasharray) {
    raw.undash()
    return
  }
  const values = dasharray
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  if (values.length === 0) return
  const scale = nonScaling ? context.unitsPerPoint : 1
  raw.dash(values[0]! * scale, { space: (values[1] ?? values[0]!) * scale })
}

function drawGeometryText(
  doc: FloorplanPdfDocument,
  geometry: Extract<FloorplanGeometry, { kind: 'text' }>,
  context: RenderContext,
): void {
  const dimensionValue =
    readFloorplanGeometryMetadata(geometry).annotationRole === 'automatic-dimension'
  const fontSize = context.annotationLayer
    ? (dimensionValue ? DIMENSION_TEXT_FONT_SIZE_PT : annotationTextSizePt(geometry)) *
      context.unitsPerPoint
    : geometry.fontSize
  const outlinedForScreen = geometry.paintOrder === 'stroke' && !!geometry.stroke
  const fill =
    outlinedForScreen && geometry.fill?.toLocaleLowerCase() === '#ffffff'
      ? (geometry.stroke ?? '#111827')
      : (geometry.fill ?? '#171717')
  drawNativeText(doc, {
    angleDeg: geometry.upright ? -context.sceneRotationDeg : 0,
    anchor: geometry.textAnchor ?? 'start',
    fill,
    fontFamily: dimensionValue ? DIMENSION_TEXT_FONT_FAMILY : geometry.fontFamily,
    fontSize,
    fontWeight: dimensionValue ? DIMENSION_TEXT_FONT_WEIGHT : geometry.fontWeight,
    opacity: geometry.opacity,
    text: geometry.text,
    x: geometry.x,
    y: geometry.y,
  })
}

function annotationTextSizePt(geometry: Extract<FloorplanGeometry, { kind: 'text' }>): number {
  switch (readFloorplanGeometryMetadata(geometry).annotationRole) {
    case 'room-label':
      if (geometry.fontSize >= 0.18) return DEFAULT_ANNOTATION_FONT_SIZE_PT
      if (geometry.fontSize >= 0.145) return ROOM_NUMBER_FONT_SIZE_PT
      return ROOM_DETAIL_FONT_SIZE_PT
    case 'column-center':
    case 'stair-annotation':
      return MARK_FONT_SIZE_PT
    default:
      return DEFAULT_ANNOTATION_FONT_SIZE_PT
  }
}

function drawDimension(
  doc: FloorplanPdfDocument,
  geometry: DimensionGeometry,
  context: RenderContext,
): void {
  const layout = computeArchitecturalDimensionLayout(
    geometry,
    context.sceneRotationDeg,
    context.unitsPerPoint,
  )
  if (!layout) return
  drawDimensionLayout(doc, geometry, layout, context)
}

function drawDimensionString(
  doc: FloorplanPdfDocument,
  geometry: DimensionStringGeometry,
  context: RenderContext,
): void {
  const entries = geometry.segments.flatMap((segment) => {
    const dimension: DimensionGeometry = {
      kind: 'dimension',
      start: segment.start,
      end: segment.end,
      dimensionStart: segment.dimensionStart,
      dimensionEnd: segment.dimensionEnd,
      offsetNormal: geometry.offsetNormal,
      offsetDistance: geometry.offsetDistance,
      extensionOvershoot: geometry.extensionOvershoot,
      extensionStartGap: geometry.extensionStartGap,
      terminator: geometry.terminator,
      textPosition: geometry.textPosition,
      text: segment.text,
      stroke: geometry.stroke,
    }
    const layout = computeArchitecturalDimensionLayout(
      dimension,
      context.sceneRotationDeg,
      context.unitsPerPoint,
    )
    return layout ? [{ dimension, layout }] : []
  })
  if (entries.length === 0) return

  const extensionLines = new Map<string, readonly [FloorplanPoint, FloorplanPoint]>()
  const terminators = new Map<
    string,
    { point: FloorplanPoint; toward: FloorplanPoint; layout: ArchitecturalDimensionLayout }
  >()
  for (const { layout } of entries) {
    extensionLines.set(pointKey(layout.dimensionStart), [
      layout.extensionStart,
      layout.extensionStartTip,
    ])
    extensionLines.set(pointKey(layout.dimensionEnd), [layout.extensionEnd, layout.extensionEndTip])
    terminators.set(pointKey(layout.dimensionStart), {
      point: layout.dimensionStart,
      toward: layout.dimensionEnd,
      layout,
    })
    terminators.set(pointKey(layout.dimensionEnd), {
      point: layout.dimensionEnd,
      toward: layout.dimensionStart,
      layout,
    })
  }

  const stroke = geometry.stroke ?? '#334155'
  for (const [start, end] of extensionLines.values())
    drawDimensionLine(doc, start, end, stroke, context)
  for (const { layout } of entries) {
    drawDimensionLine(doc, layout.dimensionLineStart, layout.dimensionLineEnd, stroke, context)
  }
  for (const terminator of terminators.values()) {
    drawDimensionTerminator(
      doc,
      geometry.terminator ?? 'architectural-tick',
      terminator.point,
      terminator.toward,
      terminator.layout,
      stroke,
      context,
    )
  }
  for (const { dimension, layout } of entries)
    drawDimensionText(doc, dimension, layout, stroke, context)
}

function drawDimensionLayout(
  doc: FloorplanPdfDocument,
  geometry: DimensionGeometry,
  layout: ArchitecturalDimensionLayout,
  context: RenderContext,
): void {
  const stroke = geometry.stroke ?? '#334155'
  drawDimensionLine(doc, layout.extensionStart, layout.extensionStartTip, stroke, context)
  drawDimensionLine(doc, layout.extensionEnd, layout.extensionEndTip, stroke, context)
  drawDimensionLine(doc, layout.dimensionLineStart, layout.dimensionLineEnd, stroke, context)
  drawDimensionTerminator(
    doc,
    geometry.terminator ?? 'architectural-tick',
    layout.dimensionStart,
    layout.dimensionEnd,
    layout,
    stroke,
    context,
  )
  drawDimensionTerminator(
    doc,
    geometry.terminator ?? 'architectural-tick',
    layout.dimensionEnd,
    layout.dimensionStart,
    layout,
    stroke,
    context,
  )
  drawDimensionText(doc, geometry, layout, stroke, context)
}

function drawDimensionLine(
  doc: FloorplanPdfDocument,
  start: FloorplanPoint,
  end: FloorplanPoint,
  stroke: string,
  context: RenderContext,
  widthPt = DIMENSION_LINE_WIDTH_PT,
): void {
  doc.raw
    .save()
    .strokeColor(stroke)
    .strokeOpacity(1)
    .lineCap('butt')
    .lineWidth(widthPt * context.unitsPerPoint)
    .moveTo(start[0], start[1])
    .lineTo(end[0], end[1])
    .stroke()
    .restore()
}

function drawDimensionTerminator(
  doc: FloorplanPdfDocument,
  terminator: NonNullable<DimensionGeometry['terminator']>,
  point: FloorplanPoint,
  toward: FloorplanPoint,
  layout: ArchitecturalDimensionLayout,
  stroke: string,
  context: RenderContext,
): void {
  const direction = normalized(point, toward)
  if (!direction) return
  const tickHalfLength = Math.hypot(layout.tickHalfVector[0], layout.tickHalfVector[1])
  if (terminator === 'dot') {
    doc.raw
      .save()
      .fillColor(stroke)
      .circle(point[0], point[1], tickHalfLength * 0.45)
      .fill()
      .restore()
    return
  }
  if (terminator === 'filled-arrow' || terminator === 'open-arrow') {
    const base = addScaled(point, direction, tickHalfLength * 1.7)
    const normal: FloorplanPoint = [-direction[1], direction[0]]
    const wing = tickHalfLength * 0.65
    const left: FloorplanPoint = [base[0] + normal[0] * wing, base[1] + normal[1] * wing]
    const right: FloorplanPoint = [base[0] - normal[0] * wing, base[1] - normal[1] * wing]
    if (terminator === 'filled-arrow') {
      doc.raw
        .save()
        .fillColor(stroke)
        .polygon([point[0], point[1]], [left[0], left[1]], [right[0], right[1]])
        .fill()
        .restore()
      return
    }
    drawDimensionLine(doc, point, left, stroke, context, DIMENSION_TICK_WIDTH_PT)
    drawDimensionLine(doc, point, right, stroke, context, DIMENSION_TICK_WIDTH_PT)
    return
  }
  const [tickX, tickY] = layout.tickHalfVector
  drawDimensionLine(
    doc,
    [point[0] - tickX, point[1] - tickY],
    [point[0] + tickX, point[1] + tickY],
    stroke,
    context,
    DIMENSION_TICK_WIDTH_PT,
  )
}

function drawDimensionText(
  doc: FloorplanPdfDocument,
  geometry: DimensionGeometry,
  layout: ArchitecturalDimensionLayout,
  stroke: string,
  context: RenderContext,
): void {
  const fontSize = DIMENSION_TEXT_FONT_SIZE_PT * context.unitsPerPoint
  const y =
    geometry.textPosition === 'centered'
      ? fontSize * 0.35
      : -DIMENSION_BASELINE_OFFSET_PT * context.unitsPerPoint

  const raw = doc.raw
  const shift = nextAnnotationLabelShift(context)
  raw
    .save()
    .translate(layout.labelPoint[0], layout.labelPoint[1])
    .rotate(layout.labelAngleDeg)
    .translate(shift[0], shift[1])
  drawNativeText(doc, {
    anchor: 'middle',
    fill: stroke,
    fontFamily: DIMENSION_TEXT_FONT_FAMILY,
    fontSize,
    fontWeight: DIMENSION_TEXT_FONT_WEIGHT,
    text: geometry.text,
    x: 0,
    y,
  })
  raw.restore()
}

function drawDimensionLabel(
  doc: FloorplanPdfDocument,
  geometry: Extract<FloorplanGeometry, { kind: 'dimension-label' }>,
  context: RenderContext,
): void {
  const unitsPerPoint = context.unitsPerPoint
  const fontSize = DIMENSION_TEXT_FONT_SIZE_PT * unitsPerPoint
  const padX = 6 * unitsPerPoint
  const padY = 3 * unitsPerPoint
  const textWidth = geometry.text.length * 6.2 * unitsPerPoint
  const plateWidth = textWidth + padX * 2
  const plateHeight = fontSize + padY * 2
  const angle = resolveFloorplanLabelAngle(
    geometry.angle,
    context.sceneRotationDeg,
    geometry.screenUpright,
  )
  const offset = -(geometry.offsetPx ?? 0) * unitsPerPoint
  const shift = nextAnnotationLabelShift(context)
  const raw = doc.raw
  raw
    .save()
    .translate(geometry.cx, geometry.cy)
    .rotate(angle)
    .translate(shift[0], shift[1] + offset)
  raw
    .fillColor('#ffffff')
    .fillOpacity(0.92)
    .roundedRect(-plateWidth / 2, -plateHeight / 2, plateWidth, plateHeight, 3 * unitsPerPoint)
    .fill()
  drawNativeText(doc, {
    anchor: 'middle',
    fill: '#111827',
    fontFamily: DIMENSION_TEXT_FONT_FAMILY,
    fontSize,
    fontWeight: DIMENSION_TEXT_FONT_WEIGHT,
    text: geometry.text,
    x: 0,
    y: 0,
  })
  raw.restore()
}

function drawEqualSpacingBadge(
  doc: FloorplanPdfDocument,
  geometry: Extract<FloorplanGeometry, { kind: 'equal-spacing-badge' }>,
  context: RenderContext,
): void {
  const fontSize = 7 * context.unitsPerPoint
  const width = Math.max(
    14 * context.unitsPerPoint,
    geometry.text.length * fontSize * 0.62 + 6 * context.unitsPerPoint,
  )
  const height = 12 * context.unitsPerPoint
  const angle = resolveFloorplanLabelAngle(geometry.angle, context.sceneRotationDeg)
  const raw = doc.raw
  raw.save().translate(geometry.point[0], geometry.point[1]).rotate(angle)
  raw
    .fillColor('#ffffff')
    .roundedRect(-width / 2, -height / 2, width, height, height / 2)
    .fill()
  drawNativeText(doc, {
    anchor: 'middle',
    fill: '#334155',
    fontFamily: 'Courier',
    fontSize,
    fontWeight: 600,
    text: geometry.text,
    x: 0,
    y: 0,
  })
  raw.restore()
}

function drawNativeText(
  doc: FloorplanPdfDocument,
  options: {
    angleDeg?: number
    anchor: 'start' | 'middle' | 'end'
    fill: string
    fontFamily?: string
    fontSize: number
    fontWeight?: number | string
    opacity?: number
    text: string
    x: number
    y: number
  },
): void {
  const raw = doc.raw
  const normalizedFamily = options.fontFamily?.toLocaleLowerCase() ?? ''
  const family =
    normalizedFamily.includes('mono') || normalizedFamily.includes('courier')
      ? 'Courier'
      : 'Helvetica'
  const numericWeight = Number.parseInt(String(options.fontWeight ?? 400), 10)
  const bold =
    options.fontWeight === 'bold' || (Number.isFinite(numericWeight) && numericWeight >= 500)
  raw.save().translate(options.x, options.y)
  if (options.angleDeg) raw.rotate(options.angleDeg)
  raw
    .font(bold ? `${family}-Bold` : family)
    .fontSize(options.fontSize)
    .fillColor(options.fill)
  raw.fillOpacity(options.opacity ?? 1)
  const width = raw.widthOfString(options.text, { lineBreak: false })
  const x = options.anchor === 'middle' ? -width / 2 : options.anchor === 'end' ? -width : 0
  raw.text(options.text, x, -options.fontSize * 0.42, { lineBreak: false })
  raw.restore()
}

async function drawImage(
  doc: FloorplanPdfDocument,
  geometry: Extract<FloorplanGeometry, { kind: 'image' }>,
): Promise<void> {
  try {
    const url = await loadAssetUrl(geometry.url)
    if (!url) return
    const response = await fetch(url)
    if (!response.ok) return
    const dataUrl = await blobToDataUrl(await response.blob())
    const raw = doc.raw
    raw.save().translate(geometry.center[0], geometry.center[1])
    if (geometry.rotation) raw.rotate((geometry.rotation * 180) / Math.PI)
    raw.opacity(geometry.opacity ?? 1)
    const options =
      geometry.preserveAspectRatio === 'none'
        ? { width: geometry.width, height: geometry.height }
        : {
            fit: [geometry.width, geometry.height] as [number, number],
            align: 'center' as const,
            valign: 'center' as const,
          }
    raw.image(dataUrl, -geometry.width / 2, -geometry.height / 2, options)
    raw.restore()
  } catch {
    return
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

function normalized(start: FloorplanPoint, end: FloorplanPoint): FloorplanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const magnitude = Math.hypot(dx, dy)
  return magnitude <= 1e-6 ? null : [dx / magnitude, dy / magnitude]
}

function addScaled(
  point: FloorplanPoint,
  direction: FloorplanPoint,
  distance: number,
): FloorplanPoint {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance]
}

function pointKey(point: FloorplanPoint): string {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
}

function nextAnnotationLabelShift(context: RenderContext): FloorplanPoint {
  const shift = context.annotationLabelShifts[context.annotationLabelShiftIndex] ?? [0, 0]
  context.annotationLabelShiftIndex += 1
  return shift
}
