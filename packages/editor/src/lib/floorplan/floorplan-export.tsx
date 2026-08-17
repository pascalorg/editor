'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ConstructionDrawingType,
  type FloorplanGeometry,
  type FloorplanPalette,
  type FloorplanPoint,
  type LiveNodeOverrides,
  nodeRegistry,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { resolveSvgAnnotationCollisions } from '../../components/editor-2d/renderers/floorplan-annotation-layout'
import { FloorplanGeometryRenderer } from '../../components/editor-2d/renderers/floorplan-geometry-renderer'
import {
  buildContext,
  collectFloorplanLinkedLevelNodes,
  floorplanLayerRank,
  getFloorplanLevelData,
  isFloorplanNodeVisible,
  splitFloorplanOverlay,
} from '../../components/editor-2d/renderers/floorplan-registry-layer'
import useDrawingView, { DRAWING_TYPE_OPTIONS } from '../../store/use-drawing-view'
import useEditor from '../../store/use-editor'
import useFloorplanAnnotationVisibility from '../../store/use-floorplan-annotation-visibility'
import useFloorplanMode from '../../store/use-floorplan-mode'
import {
  type FloorplanAnnotationVisibility,
  filterFloorplanAnnotationGeometry,
} from './annotation-visibility'
import { resolveNodeForDrawingType } from './drawing-coordination'
import {
  type FloorplanMetricNotation,
  type FloorplanSchedule,
  type FloorplanWallDimensionReference,
  getFloorplanNodeExtension,
  readFloorplanGeometryMetadata,
} from './floorplan-extension'
import {
  type FloorplanMode,
  resolveFloorplanAnnotationVisibility,
  resolveFloorplanWallDimensionReference,
} from './floorplan-mode'
import { createFloorplanPdfDocument, type FloorplanPdfDocument } from './floorplan-pdfkit-document'
import { renderFloorplanGeometryToPdfKit } from './floorplan-pdfkit-renderer'
import { FLOORPLAN_VIEW_ROTATION_DEG } from './geometry'

/**
 * Floorplan PDF export.
 *
 * Re-runs the same registry-driven geometry pipeline the live 2D layer uses
 * (`def.floorplan(node, ctx)` → `FloorplanGeometryRenderer`) headlessly, with
 * a neutral `viewState` so nodes render in their default, unselected form.
 * Every level of the active building becomes its own page, titled with the
 * level's label, with the plan fit to the page (independent of the live
 * pan/zoom). PDFKit is dynamically imported so it only loads when an export
 * actually runs. Geometry and labels are emitted as native PDF vectors and
 * text instead of being reinterpreted from browser SVG.
 *
 * `scope: 'structure'` keeps only `category === 'structure'` nodes (walls,
 * slabs, ceilings, doors, windows, stairs, columns, roofs…); `'full'` keeps
 * every node that has a floorplan builder and is visible.
 */
export type FloorplanExportScope = 'full' | 'structure' | 'routing'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Minimum and proportional margin around the structural drawing bounds. */
const MIN_PLAN_PADDING_M = 1
const PLAN_PADDING_RATIO = 0.2
/** PDF page margin + title band, in pt. */
const PAGE_MARGIN_PT = 36
const TITLE_BAND_PT = 28
const A4_LANDSCAPE_WIDTH_PT = (297 / 25.4) * 72
const A4_LANDSCAPE_HEIGHT_PT = (210 / 25.4) * 72

const NEUTRAL_PALETTE: FloorplanPalette = {
  selectedStroke: '#334155',
  selectedFill: '#ffffff',
  selectedHatch: '#334155',
  wallHoverStroke: '#334155',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#334155',
  endpointHandleHoverStroke: '#334155',
  endpointHandleActiveFill: '#334155',
  endpointHandleActiveStroke: '#334155',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#334155',
  curveHandleHoverStroke: '#334155',
  measurementStroke: '#334155',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#111827',
}

// Neutral view state — no selection / hover. A neutral palette keeps the
// full view state (including unit preference) available to node builders.
const NEUTRAL_VIEW_STATE = {
  selected: false,
  purpose: 'edit',
  highlighted: false,
  hovered: false,
  moving: false,
  palette: NEUTRAL_PALETTE,
} as const

export function resolveFloorplanExportViewState(
  unit: 'metric' | 'imperial',
  metricNotation: FloorplanMetricNotation,
  wallDimensionReference?: FloorplanWallDimensionReference,
  automaticDimensions = true,
) {
  return {
    ...NEUTRAL_VIEW_STATE,
    automaticDimensions,
    unit,
    metricNotation,
    wallDimensionReference,
  }
}

type ExportLevel = { id: AnyNodeId; label: string }

type ExportGeometry = {
  id: AnyNodeId
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
}

export type FloorplanPageLayout = {
  planBox: { x: number; y: number; width: number; height: number }
}

export async function exportFloorplanPdf(
  scope: FloorplanExportScope,
  options?: { drawingType?: ConstructionDrawingType }
): Promise<void> {
  const nodes = useScene.getState().nodes
  const viewer = useViewer.getState()
  const unit = viewer.unit
  const metricNotation = viewer.metricNotation
  const floorplanMode = useFloorplanMode.getState().mode
  const expertAnnotationState = useFloorplanAnnotationVisibility.getState()
  const annotationVisibility = resolveFloorplanExportAnnotationVisibility(
    floorplanMode,
    expertAnnotationState.visibility,
  )
  const wallDimensionReference = resolveFloorplanWallDimensionReference(
    floorplanMode,
    expertAnnotationState.wallDimensionReference,
  )
  const navigationAzimuth = useEditor.getState().navigationSyncPose?.azimuth
  const drawingType = options?.drawingType ?? useDrawingView.getState().drawingType
  const annotationLayoutOverrides = useDrawingView.getState().annotationLayoutOverrides
  const drawingLabel =
    DRAWING_TYPE_OPTIONS.find((option) => option.id === drawingType)?.label ?? 'Floor plan'
  const levels = resolveExportLevels(nodes)
  if (levels.length === 0) {
    console.warn('[floorplan-export] no level to export')
    return
  }

  const { doc, save } = await createFloorplanPdfDocument([
    A4_LANDSCAPE_WIDTH_PT,
    A4_LANDSCAPE_HEIGHT_PT,
  ])

  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;'
  document.body.appendChild(host)

  let pageCount = 0
  try {
    for (const level of levels) {
      const geometries = collectFloorplanGeometry(
        nodes,
        level.id,
        scope,
        unit,
        metricNotation,
        annotationVisibility,
        drawingType,
        wallDimensionReference,
      )
      const schedules = collectFloorplanSchedules(nodes, level.id, unit, scope)
      if (geometries.length === 0 && schedules.length === 0) continue
      const layout = resolveFloorplanPageLayout(A4_LANDSCAPE_WIDTH_PT, A4_LANDSCAPE_HEIGHT_PT)

      if (geometries.length > 0) {
        // Preserve the live floor-plan orientation rather than forcing north-up.
        const buildingId = resolveBuildingForLevel(level.id, nodes as Record<AnyNodeId, AnyNode>)
        const building = buildingId ? nodes[buildingId] : undefined
        const buildingRotationY = building?.type === 'building' ? (building.rotation[1] ?? 0) : 0
        const rotationDeg = resolveFloorplanExportRotationDeg(buildingRotationY, navigationAzimuth)

        const mounted = await mountFloorplanSvg(
          host,
          geometries,
          rotationDeg,
          annotationLayoutOverrides,
        )
        if (mounted) {
          try {
            doc.addPage([A4_LANDSCAPE_WIDTH_PT, A4_LANDSCAPE_HEIGHT_PT], 'landscape')
            pageCount++

            const screenUnitsPerPixel = resolveFloorplanScreenUnitsPerPixel(
              mounted.width,
              mounted.height,
              layout.planBox.width,
              layout.planBox.height,
            )
            await mounted.setScreenUnitsPerPixel(screenUnitsPerPixel)
            const fitted = resolveFloorplanExportPlacement(
              mounted.width,
              mounted.height,
              layout.planBox.x,
              layout.planBox.y,
              layout.planBox.width,
              layout.planBox.height,
            )
            drawFloorplanPageHeader(doc, level.label, drawingLabel)
            const model = combineGeometryList(geometries.map((geometry) => geometry.model))
            if (model) {
              await renderFloorplanGeometryToPdfKit(doc, model, {
                annotationLayer: false,
                placement: fitted,
                rotationDeg,
                viewport: mounted.viewport,
              })
            }
            const annotations = combineGeometryList(
              geometries.map((geometry) => geometry.annotations),
            )
            if (annotations) {
              await renderFloorplanGeometryToPdfKit(doc, annotations, {
                annotationLabelShifts: mounted.annotationLabelShifts,
                annotationLayer: true,
                placement: fitted,
                rotationDeg,
                viewport: mounted.viewport,
              })
            }
          } finally {
            mounted.cleanup()
          }
        }
      }

      if (schedules.length > 0) {
        pageCount = drawFloorplanSchedulePages(doc, level.label, schedules, pageCount)
      }
    }

    if (pageCount === 0) {
      console.warn(`[floorplan-export] nothing to export for scope "${scope}"`)
      return
    }

    const date = new Date().toISOString().split('T')[0]
    await save(`${drawingType}_${scope}_${date}.pdf`)
  } finally {
    host.remove()
  }
}

export function collectFloorplanSchedules(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  unit: 'metric' | 'imperial',
  scope: FloorplanExportScope,
): FloorplanSchedule[] {
  const siblingsByType = new Map<string, AnyNode[]>()
  const visit = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    const def = nodeRegistry.get(node.type)
    if (
      node.visible !== false &&
      (scope === 'full' ||
        def?.category === 'structure' ||
        (scope === 'routing' && def?.category === 'utility'))
    ) {
      const siblings = siblingsByType.get(node.type)
      if (siblings) siblings.push(node)
      else siblingsByType.set(node.type, [node])
    }
    const children = (node as { children?: AnyNodeId[] }).children
    if (Array.isArray(children)) for (const childId of children) visit(childId)
  }
  visit(levelId)

  const schedules: FloorplanSchedule[] = []
  for (const [kind, definition] of nodeRegistry.entries()) {
    const scheduleContribution = getFloorplanNodeExtension(definition)?.schedule
    if (!scheduleContribution) continue
    const siblings = siblingsByType.get(kind) ?? []
    const schedule = scheduleContribution({ siblings, nodes, levelId, unit })
    if (schedule && schedule.rows.length > 0) schedules.push(schedule)
  }
  return schedules
}

export function resolveFloorplanPageLayout(
  pageWidth: number,
  pageHeight: number,
): FloorplanPageLayout {
  const planY = PAGE_MARGIN_PT + TITLE_BAND_PT
  return {
    planBox: {
      x: PAGE_MARGIN_PT,
      y: planY,
      width: pageWidth - PAGE_MARGIN_PT * 2,
      height: pageHeight - planY - PAGE_MARGIN_PT,
    },
  }
}

function drawFloorplanPageHeader(
  doc: FloorplanPdfDocument,
  levelLabel: string,
  drawingLabel: string,
): void {
  doc.setTextColor('#111827')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`${levelLabel} - ${drawingLabel}`, PAGE_MARGIN_PT, PAGE_MARGIN_PT + 12)
}

function drawFloorplanSchedulePages(
  doc: FloorplanPdfDocument,
  levelLabel: string,
  schedules: readonly FloorplanSchedule[],
  initialPageCount: number,
): number {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const tableWidth = pageW - PAGE_MARGIN_PT * 2
  const bottom = pageH - PAGE_MARGIN_PT
  const headerHeight = 22
  const rowHeight = 20
  let pageCount = initialPageCount
  let y = 0

  const startPage = () => {
    doc.addPage([pageW, pageH])
    pageCount++
    doc.setTextColor('#111827')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setLineWidth(0.5)
    doc.text(`${levelLabel} - Construction Schedules`, PAGE_MARGIN_PT, PAGE_MARGIN_PT + 12)
    y = PAGE_MARGIN_PT + TITLE_BAND_PT + 8
  }

  const drawHeader = (schedule: FloorplanSchedule, continued: boolean) => {
    doc.setTextColor('#111827')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`${schedule.title}${continued ? ' (CONTINUED)' : ''}`, PAGE_MARGIN_PT, y + 11)
    y += 18
    doc.setFillColor('#334155')
    doc.rect(PAGE_MARGIN_PT, y, tableWidth, headerHeight, 'F')
    doc.setTextColor('#ffffff')
    doc.setFontSize(8)
    const widths = scheduleColumnWidths(schedule, tableWidth)
    doc.setDrawColor('#64748b')
    drawScheduleColumnDividers(doc, widths, y, headerHeight)
    let x = PAGE_MARGIN_PT
    schedule.columns.forEach((column, index) => {
      const width = widths[index] ?? 0
      doc.text(column.label, x + 4, y + 14, { maxWidth: Math.max(0, width - 8) })
      x += width
    })
    y += headerHeight
  }

  startPage()
  for (const schedule of schedules) {
    const issueHeight = (schedule.issues?.length ?? 0) * 13
    const minimumTableHeight = 18 + issueHeight + headerHeight + rowHeight
    if (y + minimumTableHeight > bottom) startPage()

    if (schedule.issues?.length) {
      doc.setTextColor('#b45309')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      for (const issue of schedule.issues) {
        doc.text(`WARNING: ${issue}`, PAGE_MARGIN_PT, y + 9)
        y += 13
      }
    }

    drawHeader(schedule, false)
    const widths = scheduleColumnWidths(schedule, tableWidth)
    schedule.rows.forEach((row, rowIndex) => {
      if (y + rowHeight > bottom) {
        startPage()
        drawHeader(schedule, true)
      }
      if (rowIndex % 2 === 1) {
        doc.setFillColor('#f1f5f9')
        doc.rect(PAGE_MARGIN_PT, y, tableWidth, rowHeight, 'F')
      }
      doc.setDrawColor('#cbd5e1')
      doc.rect(PAGE_MARGIN_PT, y, tableWidth, rowHeight)
      drawScheduleColumnDividers(doc, widths, y, rowHeight)
      doc.setTextColor('#111827')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      let x = PAGE_MARGIN_PT
      schedule.columns.forEach((column, columnIndex) => {
        const width = widths[columnIndex] ?? 0
        const text = truncatePdfText(doc, row.cells[column.key] ?? '', Math.max(0, width - 8))
        doc.text(text, x + 4, y + 13)
        x += width
      })
      y += rowHeight
    })
    y += 20
  }

  return pageCount
}

function scheduleColumnWidths(schedule: FloorplanSchedule, tableWidth: number): number[] {
  const totalWeight = schedule.columns.reduce((sum, column) => sum + (column.weight ?? 1), 0)
  return schedule.columns.map((column) => (tableWidth * (column.weight ?? 1)) / totalWeight)
}

function drawScheduleColumnDividers(
  doc: FloorplanPdfDocument,
  widths: readonly number[],
  y: number,
  height: number,
) {
  let x = PAGE_MARGIN_PT
  for (const width of widths.slice(0, -1)) {
    x += width
    doc.line(x, y, x, y + height)
  }
}

function truncatePdfText(doc: FloorplanPdfDocument, value: string, maxWidth: number): string {
  if (doc.getTextWidth(value) <= maxWidth) return value
  let truncated = value
  while (truncated.length > 0 && doc.getTextWidth(`${truncated}...`) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}...`
}

type MountedFloorplan = {
  svg: SVGSVGElement
  annotationLabelShifts: readonly FloorplanPoint[]
  /** Padded viewBox dimensions, in meters — used for aspect-preserving fit. */
  width: number
  height: number
  viewport: FloorplanExportBounds
  setScreenUnitsPerPixel: (value: number) => Promise<void>
  cleanup: () => void
}

export type FloorplanExportBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function fitPlanToBox(
  planWidth: number,
  planHeight: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
) {
  const aspect = planWidth / planHeight
  let width = boxWidth
  let height = width / aspect
  if (height > boxHeight) {
    height = boxHeight
    width = height * aspect
  }
  return {
    x: boxX + (boxWidth - width) / 2,
    y: boxY + (boxHeight - height) / 2,
    width,
    height,
  }
}

export function resolveFloorplanExportPlacement(
  planWidth: number,
  planHeight: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
) {
  return fitPlanToBox(planWidth, planHeight, boxX, boxY, boxWidth, boxHeight)
}

export function resolveFloorplanExportViewport(
  modelBounds: FloorplanExportBounds,
): FloorplanExportBounds {
  const paddingX = Math.max(MIN_PLAN_PADDING_M, modelBounds.width * PLAN_PADDING_RATIO)
  const paddingY = Math.max(MIN_PLAN_PADDING_M, modelBounds.height * PLAN_PADDING_RATIO)
  
  return {
    x: modelBounds.x - paddingX,
    y: modelBounds.y - paddingY,
    width: modelBounds.width + paddingX * 2,
    height: modelBounds.height + paddingY * 2,
  }
}

export function rotateFloorplanExportBounds(
  bounds: FloorplanExportBounds,
  rotationDeg: number,
): FloorplanExportBounds {
  const radians = (rotationDeg * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ] as const
  const rotated = corners.map(([x, y]) => ({
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  }))
  const minX = Math.min(...rotated.map((point) => point.x))
  const minY = Math.min(...rotated.map((point) => point.y))
  const maxX = Math.max(...rotated.map((point) => point.x))
  const maxY = Math.max(...rotated.map((point) => point.y))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function resolveFloorplanScreenUnitsPerPixel(
  modelWidth: number,
  modelHeight: number,
  boxWidth: number,
  boxHeight: number,
): number {
  return Math.max(modelWidth / boxWidth, modelHeight / boxHeight)
}

export function resolveFloorplanExportAnnotationVisibility(
  mode: FloorplanMode,
  liveVisibility: FloorplanAnnotationVisibility,
): FloorplanAnnotationVisibility {
  return resolveFloorplanAnnotationVisibility(mode, liveVisibility, { target: 'export' })
}

export function resolveFloorplanExportRotationDeg(
  buildingRotationY: number,
  navigationAzimuth?: number,
): number {
  const userRotationDeg =
    navigationAzimuth === undefined
      ? 0
      : (navigationAzimuth * 180) / Math.PI - FLOORPLAN_VIEW_ROTATION_DEG
  return FLOORPLAN_VIEW_ROTATION_DEG + userRotationDeg - (buildingRotationY * 180) / Math.PI
}

async function mountFloorplanSvg(
  parent: HTMLElement,
  geometries: ExportGeometry[],
  rotationDeg: number,
  annotationLayoutOverrides = useDrawingView.getState().annotationLayoutOverrides,
): Promise<MountedFloorplan | null> {
  const container = document.createElement('div')
  parent.appendChild(container)
  const root = createRoot(container)
  const cleanup = () => {
    root.unmount()
    container.remove()
  }

  const render = (screenUnitsPerPixel?: number) => {
    flushSync(() => {
      root.render(
        createElement(
          'svg',
          { xmlns: SVG_NS },
          createElement(
            'g',
            { 'data-floorplan-content': '' },
            createElement(
              'g',
              { transform: `rotate(${rotationDeg})` },
              createElement(
                'g',
                { 'data-floorplan-model': '' },
                geometries.map(({ id, model }) =>
                  model
                    ? createElement(FloorplanGeometryRenderer, {
                        key: id,
                        geometry: model,
                        sceneRotationDeg: rotationDeg,
                      })
                    : null,
                ),
              ),
              createElement(
                'g',
                { 'data-floorplan-annotations': '' },
                geometries.map(({ id, annotations }) =>
                  annotations
                    ? createElement(FloorplanGeometryRenderer, {
                        key: id,
                        geometry: annotations,
                        renderMode: 'pdf',
                        sceneRotationDeg: rotationDeg,
                        screenUnitsPerPixel,
                      })
                    : null,
                ),
              ),
            ),
          ),
        ),
      )
    })
  }

  render()

  // Give async asset images (item icons) a couple of frames to resolve so
  // they're included in the measured bounds and the rendered output.
  await nextFrames(2)

  const svg = container.querySelector('svg')
  if (!svg) {
    cleanup()
    return null
  }

  const modelBounds = measureFloorplanBounds(svg, '[data-floorplan-model]')
  if (!modelBounds) {
    cleanup()
    return null
  }
  const viewport = resolveFloorplanExportViewport(
    rotateFloorplanExportBounds(modelBounds, rotationDeg),
  )
  const mounted: MountedFloorplan = {
    svg,
    annotationLabelShifts: [],
    width: viewport.width,
    height: viewport.height,
    viewport,
    cleanup,
    setScreenUnitsPerPixel: async (value) => {
      render(value)
      applyFloorplanViewport(mounted, viewport, value)
      await nextFrames(1)
      resolveSvgAnnotationCollisions(svg, { layoutOverrides: annotationLayoutOverrides })
      mounted.annotationLabelShifts = readSvgAnnotationLabelShifts(svg)
    },
  }
  applyFloorplanViewport(mounted, viewport)
  return mounted
}

function readSvgAnnotationLabelShifts(svg: SVGSVGElement): FloorplanPoint[] {
  return Array.from(svg.querySelectorAll<SVGGElement>('[data-floorplan-annotation-label]')).map(
    (label) => {
      const x = Number(label.dataset.floorplanAnnotationLayoutDx ?? 0)
      const y = Number(label.dataset.floorplanAnnotationLayoutDy ?? 0)
      return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0]
    },
  )
}

function measureFloorplanBounds(
  svg: SVGSVGElement,
  selector: string,
): FloorplanExportBounds | null {
  const content = svg.querySelector(selector) as SVGGraphicsElement | null
  const bbox = content?.getBBox()
  if (!bbox || bbox.width === 0 || bbox.height === 0) return null
  return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }
}

export function resolveFloorplanMeasurementSize(
  viewport: FloorplanExportBounds,
  screenUnitsPerPixel: number,
): { width: number; height: number } {
  return {
    width: viewport.width / screenUnitsPerPixel,
    height: viewport.height / screenUnitsPerPixel,
  }
}

function applyFloorplanViewport(
  mounted: MountedFloorplan,
  viewport: FloorplanExportBounds,
  screenUnitsPerPixel?: number,
): void {
  mounted.width = viewport.width
  mounted.height = viewport.height
  mounted.svg.setAttribute(
    'viewBox',
    `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`,
  )
  const measurementSize = screenUnitsPerPixel
    ? resolveFloorplanMeasurementSize(viewport, screenUnitsPerPixel)
    : { width: mounted.width, height: mounted.height }
  mounted.svg.setAttribute('width', `${measurementSize.width}`)
  mounted.svg.setAttribute('height', `${measurementSize.height}`)

  mounted.svg.querySelector('[data-floorplan-background]')?.remove()
  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('data-floorplan-background', '')
  background.setAttribute('x', `${viewport.x}`)
  background.setAttribute('y', `${viewport.y}`)
  background.setAttribute('width', `${mounted.width}`)
  background.setAttribute('height', `${mounted.height}`)
  background.setAttribute('fill', '#ffffff')
  mounted.svg.insertBefore(background, mounted.svg.firstChild)
}

export function collectFloorplanGeometry(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  scope: FloorplanExportScope,
  unit: 'metric' | 'imperial',
  metricNotation: FloorplanMetricNotation,
  annotationVisibility: FloorplanAnnotationVisibility,
  drawingType: ConstructionDrawingType,
  wallDimensionReference: FloorplanWallDimensionReference,
): ExportGeometry[] {
  const noLiveOverrides = new Map<string, LiveNodeOverrides>()
  const levelNodeIdsByType = new Map<string, AnyNodeId[]>()
  const entries: { id: AnyNodeId; node: AnyNode; parentOverride?: AnyNode }[] = []

  const visit = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    const def = nodeRegistry.get(node.type)
    if (def?.computeFloorplanLevelData) {
      const ids = levelNodeIdsByType.get(node.type)
      if (ids) ids.push(id)
      else levelNodeIdsByType.set(node.type, [id])
    }
    if (
      def?.floorplan &&
      isFloorplanNodeVisible(node) &&
      (scope === 'full' ||
        def.category === 'structure' ||
        (scope === 'routing' && def.category === 'utility'))
    ) {
      const drawingNode = resolveNodeForDrawingType(node, nodes, drawingType)
      if (drawingNode) entries.push({ id, node: drawingNode })
    }
    const childIds = (node as { children?: AnyNodeId[] }).children
    if (Array.isArray(childIds)) for (const cid of childIds) visit(cid)
  }
  visit(levelId)

  const activeLevelNode = nodes[levelId]
  if (activeLevelNode) {
    const collectedIds = new Set(entries.map((entry) => entry.id))
    for (const linked of collectFloorplanLinkedLevelNodes(nodes, levelId, collectedIds)) {
      const definition = nodeRegistry.get(linked.node.type)
      if (
        isFloorplanNodeVisible(linked.node) &&
        (scope === 'full' ||
          definition?.category === 'structure' ||
          (scope === 'routing' && definition?.category === 'utility'))
      ) {
        const drawingNode = resolveNodeForDrawingType(linked.node, nodes, drawingType)
        if (drawingNode) {
          entries.push({ id: linked.id, node: drawingNode, parentOverride: activeLevelNode })
        }
      }
    }
  }

  // Document order is paint order — sort the same way the live layer does so
  // zones sit under walls/slabs/furniture rather than on top of them.
  entries.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))

  // One-shot per-type cache for `computeFloorplanLevelData`; value type is
  // module-private to the registry layer, so let it infer.
  const levelDataCache = new Map()
  const out: ExportGeometry[] = []
  for (const { id, node, parentOverride } of entries) {
    const builder = nodeRegistry.get(node.type)?.floorplan
    if (!builder) continue
    const levelData = getFloorplanLevelData(
      node.type,
      nodes,
      noLiveOverrides,
      levelNodeIdsByType,
      levelDataCache,
    )
    const baseContext = buildContext(
      node,
      nodes,
      resolveFloorplanExportViewState(
        unit,
        metricNotation,
        wallDimensionReference,
        annotationVisibility.automaticDimensions,
      ),
      levelData,
    )
    const ctx = parentOverride ? { ...baseContext, parent: parentOverride } : baseContext
    const geometry = builder(node, ctx)
    if (!geometry) continue
    const visibleGeometry = filterFloorplanAnnotationGeometry(geometry, annotationVisibility)
    if (!visibleGeometry) continue
    const { base, overlay } = splitFloorplanOverlay(visibleGeometry)
    const exportOverlay = overlay ? filterFloorplanExportOverlay(overlay) : null
    const annotationOnly = isFloorplanExportAnnotationGeometry(visibleGeometry)
    const { model, annotations } = resolveFloorplanExportNodeGeometry(
      base,
      exportOverlay,
      annotationOnly,
    )
    if (model || annotations) out.push({ id, model, annotations })
  }
  return out
}

export function filterFloorplanExportOverlay(
  geometry: FloorplanGeometry,
): FloorplanGeometry | null {
  if (FLOORPLAN_EXPORT_EDITING_KINDS.has(geometry.kind)) return null
  if (geometry.kind !== 'group') return geometry

  const children = geometry.children
    .map(filterFloorplanExportOverlay)
    .filter((child): child is FloorplanGeometry => child !== null)
  if (children.length === 0) return null
  return { ...geometry, children }
}

const FLOORPLAN_EXPORT_EDITING_KINDS = new Set<FloorplanGeometry['kind']>([
  'endpoint-handle',
  'midpoint-handle',
  'edge-handle',
  'move-handle',
  'move-arrow',
  'rotate-arrow',
])

type FloorplanExportOverlayPartition = {
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
}

export function resolveFloorplanExportNodeGeometry(
  base: FloorplanGeometry | null,
  overlay: FloorplanGeometry | null,
  annotationOnly: boolean,
): FloorplanExportOverlayPartition {
  const combined = combineGeometry(base, overlay)
  if (annotationOnly) return { model: null, annotations: combined }
  return combined ? partitionFloorplanExportOverlay(combined) : { model: null, annotations: null }
}

export function partitionFloorplanExportOverlay(
  geometry: FloorplanGeometry,
): FloorplanExportOverlayPartition {
  if (FLOORPLAN_EXPORT_EDITING_KINDS.has(geometry.kind)) {
    return { model: null, annotations: null }
  }
  if (isFloorplanExportAnnotationGeometry(geometry)) {
    return { model: null, annotations: filterFloorplanExportOverlay(geometry) }
  }
  if (geometry.kind !== 'group') {
    return { model: geometry, annotations: null }
  }

  const modelChildren: FloorplanGeometry[] = []
  const annotationChildren: FloorplanGeometry[] = []
  for (const child of geometry.children) {
    const partition = partitionFloorplanExportOverlay(child)
    if (partition.model) modelChildren.push(partition.model)
    if (partition.annotations) annotationChildren.push(partition.annotations)
  }
  return {
    model:
      modelChildren.length > 0
        ? { kind: 'group', children: modelChildren, transform: geometry.transform }
        : null,
    annotations:
      annotationChildren.length > 0
        ? { kind: 'group', children: annotationChildren, transform: geometry.transform }
        : null,
  }
}

export function isFloorplanExportAnnotationGeometry(geometry: FloorplanGeometry): boolean {
  if (
    geometry.kind === 'text' ||
    geometry.kind === 'dimension' ||
    geometry.kind === 'dimension-string' ||
    geometry.kind === 'dimension-label' ||
    geometry.kind === 'equal-spacing-badge'
  ) {
    return true
  }
  if (readFloorplanGeometryMetadata(geometry).annotationRole) return true
  return false
}

function combineGeometry(
  base: FloorplanGeometry | null,
  overlay: FloorplanGeometry | null,
): FloorplanGeometry | null {
  if (!base) return overlay
  if (!overlay) return base
  return { kind: 'group', children: [base, overlay] }
}

function combineGeometryList(
  geometries: readonly (FloorplanGeometry | null)[],
): FloorplanGeometry | null {
  const children = geometries.filter((geometry): geometry is FloorplanGeometry => geometry !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0] ?? null
  return { kind: 'group', children }
}

/**
 * Levels to export, ordered bottom-to-top. The active building (the building
 * owning the selected level, or the first one found) contributes all of its
 * level children; if there is no building wrapper we fall back to the single
 * resolved level.
 */
function resolveExportLevels(nodes: Record<string, AnyNode>): ExportLevel[] {
  const selected = useViewer.getState().selection.levelId as AnyNodeId | null | undefined
  const activeLevelId = selected && nodes[selected] ? selected : firstLevelId(nodes)
  if (!activeLevelId) return []

  const buildingId = resolveBuildingForLevel(activeLevelId, nodes as Record<AnyNodeId, AnyNode>)
  let levelNodes: AnyNode[]
  if (buildingId) {
    const childIds = (nodes[buildingId] as { children?: AnyNodeId[] }).children ?? []
    levelNodes = childIds
      .map((id) => nodes[id])
      .filter((n): n is AnyNode => n?.type === 'level')
      .filter((n) => (n.metadata as { role?: unknown } | undefined)?.role !== 'roof')
  } else {
    const node = nodes[activeLevelId]
    levelNodes = node ? [node] : []
  }

  levelNodes.sort((a, b) => levelIndexOf(a) - levelIndexOf(b))
  return levelNodes.map((n) => ({ id: n.id as AnyNodeId, label: levelLabelOf(n) }))
}

function firstLevelId(nodes: Record<string, AnyNode>): AnyNodeId | null {
  for (const node of Object.values(nodes)) {
    if (node.type === 'level') return node.id as AnyNodeId
  }
  return null
}

function levelIndexOf(node: AnyNode): number {
  return (node as { level?: number }).level ?? 0
}

function levelLabelOf(node: AnyNode): string {
  const name = node.name?.trim()
  if (name) return name
  return `Level ${levelIndexOf(node)}`
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => tick(remaining - 1))
    }
    tick(count)
  })
}
