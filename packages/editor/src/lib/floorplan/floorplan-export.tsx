'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ConstructionDrawingType,
  type DrawingSheetNode,
  type DrawingSheetOrientation,
  type DrawingSheetPaperSize,
  type DrawingSheetScale,
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
import {
  type FloorplanAnnotationVisibility,
  filterFloorplanAnnotationGeometry,
} from './annotation-visibility'
import { resolveNodeForDrawingType } from './drawing-coordination'
import {
  type FloorplanMetricNotation,
  type FloorplanSchedule,
  getFloorplanNodeExtension,
  readFloorplanGeometryMetadata,
} from './floorplan-extension'
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
export type FloorplanExportScope = 'full' | 'structure'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Minimum and proportional margin around the structural drawing bounds. */
const MIN_PLAN_PADDING_M = 1
const PLAN_PADDING_RATIO = 0.2
/** PDF page margin + title band, in pt. */
const PAGE_MARGIN_PT = 36
const TITLE_BAND_PT = 28
const SHEET_GAP_PT = 18
const SHEET_SIDE_PANEL_WIDTH_PT = 180
const TITLE_BLOCK_HEIGHT_PT = 42
const POINTS_PER_INCH = 72
const METERS_PER_INCH = 0.0254

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
) {
  return { ...NEUTRAL_VIEW_STATE, unit, metricNotation }
}

type ExportLevel = { id: AnyNodeId; label: string }

type ExportGeometry = {
  id: AnyNodeId
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
}

type SheetComposition = {
  sheetNumber: string
  sheetTitle: string
  paperSize: DrawingSheetPaperSize
  orientation: DrawingSheetOrientation
  customPaperWidth: number | null
  customPaperHeight: number | null
  drawingNumber: string
  viewTitle: string
  drawingLabel: string
  scale: DrawingSheetScale
  generalNotes: { number: number; text: string }[]
  keyedNoteLegend: { key: string; text: string }[]
  keyedNoteInstances: { id: string; key: string; x: number; y: number }[]
  documentMarkers: ResolvedDocumentMarker[]
  preflightIssues: SheetPreflightIssue[]
}

export type SheetExportLayout = {
  planBox: { x: number; y: number; width: number; height: number }
  sidePanel: { x: number; y: number; width: number; height: number }
  titleBlock: { x: number; y: number; width: number; height: number }
}

export type FloorplanPageLayout = {
  planBox: { x: number; y: number; width: number; height: number }
}

type ScheduleDrawResult = {
  drawnSchedules: number
  overflowSchedules: FloorplanSchedule[]
}

export type SheetPageSetup = {
  width: number
  height: number
  orientation: DrawingSheetOrientation
}

export type SheetPreflightIssue = {
  severity: 'warning'
  message: string
}

type ResolvedGeneralNotes = {
  notes: { number: number; text: string }[]
  duplicateWarnings: SheetPreflightIssue[]
}

type ResolvedKeyedNotes = {
  legend: { key: string; text: string }[]
  instances: { id: string; key: string; x: number; y: number }[]
  warnings: SheetPreflightIssue[]
}

type ResolvedDocumentMarker = {
  id: string
  kind: string
  label: string
  title: string
  sheetReference: string
  drawingReference: string
  revisionId: string
  x: number
  y: number
  endX: number | null
  endY: number | null
  points: { x: number; y: number }[]
}

export async function exportFloorplanPdf(scope: FloorplanExportScope): Promise<void> {
  const nodes = useScene.getState().nodes
  const viewer = useViewer.getState()
  const unit = viewer.unit
  const metricNotation = viewer.metricNotation
  const annotationVisibility = resolveFloorplanExportAnnotationVisibility(
    useFloorplanAnnotationVisibility.getState().visibility,
  )
  const navigationAzimuth = useEditor.getState().navigationSyncPose?.azimuth
  const drawingType = useDrawingView.getState().drawingType
  const annotationLayoutOverrides = useDrawingView.getState().annotationLayoutOverrides
  const drawingLabel =
    DRAWING_TYPE_OPTIONS.find((option) => option.id === drawingType)?.label ?? 'Floor plan'
  const levels = resolveExportLevels(nodes)
  if (levels.length === 0) {
    console.warn('[floorplan-export] no level to export')
    return
  }

  const defaultPageSetup = resolveSheetPageSetup({
    paperSize: 'a4',
    orientation: 'landscape',
    customPaperWidth: null,
    customPaperHeight: null,
  })
  const { doc, save } = await createFloorplanPdfDocument([
    defaultPageSetup.width,
    defaultPageSetup.height,
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
      )
      const schedules = collectFloorplanSchedules(nodes, level.id, unit)
      if (geometries.length === 0 && schedules.length === 0) continue
      const pageSetup = resolveSheetPageSetup({
        paperSize: 'a4',
        orientation: 'landscape',
        customPaperWidth: null,
        customPaperHeight: null,
      })
      const layout = resolveFloorplanPageLayout(pageSetup.width, pageSetup.height)
      let scheduleOverflow: FloorplanSchedule[] = [...schedules]

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
            doc.addPage([pageSetup.width, pageSetup.height], pageSetup.orientation)
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

      if (scheduleOverflow.length > 0) {
        pageCount = drawFloorplanSchedulePages(doc, level.label, scheduleOverflow, pageCount)
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
): FloorplanSchedule[] {
  const siblingsByType = new Map<string, AnyNode[]>()
  const visit = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    if (node.visible !== false) {
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

export function resolveSheetComposition(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  levelLabel: string,
  drawingType: ConstructionDrawingType,
  drawingLabel: string,
  fallbackScale: DrawingSheetScale,
): SheetComposition {
  const sheet = findDrawingSheetForLevel(nodes, levelId, drawingType)
  const placedView = sheet?.placedViews.find(
    (view) =>
      (view.levelId === null || view.levelId === levelId) && view.drawingType === drawingType,
  )
  const generalNotes = sheet
    ? resolveDrawingSheetGeneralNotes(sheet)
    : { notes: [], duplicateWarnings: [] }
  const keyedNotes = sheet
    ? resolveDrawingSheetKeyedNotes(sheet, placedView?.id ?? null)
    : { legend: [], instances: [], warnings: [] }
  const documentMarkers = sheet
    ? resolveDrawingSheetDocumentMarkers(sheet, placedView?.id ?? null)
    : []
  return {
    sheetNumber: sheet?.sheetNumber ?? 'A1.0',
    sheetTitle: sheet?.sheetTitle ?? drawingLabel,
    paperSize: sheet?.paperSize ?? 'a4',
    orientation: sheet?.orientation ?? 'landscape',
    customPaperWidth: sheet?.customPaperWidth ?? null,
    customPaperHeight: sheet?.customPaperHeight ?? null,
    drawingNumber: placedView?.drawingNumber ?? '1',
    viewTitle: placedView?.title ?? `${levelLabel} ${drawingLabel}`,
    drawingLabel,
    scale: placedView?.scale ?? fallbackScale,
    generalNotes: generalNotes.notes,
    keyedNoteLegend: keyedNotes.legend,
    keyedNoteInstances: keyedNotes.instances,
    documentMarkers,
    preflightIssues: [...generalNotes.duplicateWarnings, ...keyedNotes.warnings],
  }
}

export function resolveDrawingSheetGeneralNotes(sheet: DrawingSheetNode): ResolvedGeneralNotes {
  const generalNoteSets = sheet.generalNoteSets ?? []
  const generalNoteSetIds = sheet.generalNoteSetIds ?? []
  const sheetNotes = sheet.generalNotes ?? []
  const selectedSetIds =
    generalNoteSetIds.length > 0
      ? new Set(generalNoteSetIds)
      : new Set(generalNoteSets.map((set) => set.id))
  const noteSources = [
    ...generalNoteSets
      .filter((set) => selectedSetIds.has(set.id))
      .flatMap((set) => set.notes.map((note) => ({ text: note.text, source: set.name }))),
    ...sheetNotes.map((note) => ({ text: note.text, source: 'sheet' })),
  ]
  const notes = noteSources.map((note, index) => ({ number: index + 1, text: note.text }))
  const duplicateWarnings: SheetPreflightIssue[] = []
  const seen = new Map<string, { text: string; count: number; sources: Set<string> }>()
  for (const note of noteSources) {
    const key = normalizeGeneralNoteText(note.text)
    const existing = seen.get(key)
    if (existing) {
      existing.count += 1
      existing.sources.add(note.source)
      continue
    }
    seen.set(key, { text: note.text, count: 1, sources: new Set([note.source]) })
  }
  for (const duplicate of seen.values()) {
    if (duplicate.count < 2) continue
    duplicateWarnings.push({
      severity: 'warning',
      message: `Duplicate general note: "${duplicate.text}" appears in ${[
        ...duplicate.sources,
      ].join(' and ')}.`,
    })
  }
  return { notes, duplicateWarnings }
}

function normalizeGeneralNoteText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function resolveDrawingSheetKeyedNotes(
  sheet: DrawingSheetNode,
  placedViewId: string | null = null,
): ResolvedKeyedNotes {
  const definitions = sheet.keyedNoteDefinitions ?? []
  const instances = sheet.keyedNoteInstances ?? []
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]))
  const scopedInstances = instances.filter(
    (instance) => instance.placedViewId === null || instance.placedViewId === placedViewId,
  )
  const warnings: SheetPreflightIssue[] = []
  const usedDefinitions = new Map<string, { key: string; text: string }>()
  const resolvedInstances: ResolvedKeyedNotes['instances'] = []

  for (const instance of scopedInstances) {
    const definition = definitionById.get(instance.definitionId)
    if (!definition) {
      warnings.push({
        severity: 'warning',
        message: `Keyed-note symbol ${instance.id} references missing definition ${instance.definitionId}.`,
      })
      continue
    }
    usedDefinitions.set(definition.id, { key: definition.key, text: definition.text })
    resolvedInstances.push({
      id: instance.id,
      key: definition.key,
      x: instance.position[0],
      y: instance.position[1],
    })
  }

  const derivedLegend = [...usedDefinitions.values()].sort((left, right) =>
    left.key.localeCompare(right.key, undefined, { numeric: true }),
  )
  return {
    legend: derivedLegend.length > 0 ? derivedLegend : (sheet.keyedNoteLegend ?? []),
    instances: resolvedInstances,
    warnings,
  }
}

export function resolveDrawingSheetDocumentMarkers(
  sheet: DrawingSheetNode,
  placedViewId: string | null = null,
): ResolvedDocumentMarker[] {
  return (sheet.documentMarkers ?? [])
    .filter((marker) => marker.placedViewId === null || marker.placedViewId === placedViewId)
    .map((marker) => ({
      id: marker.id,
      kind: marker.kind,
      label: marker.label,
      title: marker.title,
      sheetReference: marker.sheetReference,
      drawingReference: marker.drawingReference,
      revisionId: marker.revisionId,
      x: marker.position[0],
      y: marker.position[1],
      endX: marker.endPosition?.[0] ?? null,
      endY: marker.endPosition?.[1] ?? null,
      points: marker.points.map(([x, y]) => ({ x, y })),
    }))
}

export function resolveSheetPageSetup(
  sheet: Pick<
    SheetComposition,
    'paperSize' | 'orientation' | 'customPaperWidth' | 'customPaperHeight'
  >,
): SheetPageSetup {
  const base = paperSizePoints(sheet.paperSize, sheet.customPaperWidth, sheet.customPaperHeight)
  const [width, height] =
    sheet.orientation === 'landscape'
      ? [Math.max(base.width, base.height), Math.min(base.width, base.height)]
      : [Math.min(base.width, base.height), Math.max(base.width, base.height)]
  return { width, height, orientation: sheet.orientation }
}

function paperSizePoints(
  paperSize: DrawingSheetPaperSize,
  customPaperWidth: number | null,
  customPaperHeight: number | null,
): { width: number; height: number } {
  switch (paperSize) {
    case 'letter':
      return inchesToPoints(8.5, 11)
    case 'tabloid':
      return inchesToPoints(11, 17)
    case 'arch-a':
      return inchesToPoints(9, 12)
    case 'arch-b':
      return inchesToPoints(12, 18)
    case 'arch-c':
      return inchesToPoints(18, 24)
    case 'a3':
      return millimetersToPoints(297, 420)
    case 'custom':
      return inchesToPoints(customPaperWidth ?? 18, customPaperHeight ?? 12)
    case 'a4':
      return millimetersToPoints(210, 297)
  }
}

function inchesToPoints(width: number, height: number): { width: number; height: number } {
  return { width: width * POINTS_PER_INCH, height: height * POINTS_PER_INCH }
}

function millimetersToPoints(width: number, height: number): { width: number; height: number } {
  return inchesToPoints(width / 25.4, height / 25.4)
}

function findDrawingSheetForLevel(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  drawingType: ConstructionDrawingType,
): DrawingSheetNode | null {
  for (const node of Object.values(nodes)) {
    const resolveDrawingSheet = getFloorplanNodeExtension(
      nodeRegistry.get(node.type),
    )?.resolveDrawingSheet
    const sheet = resolveDrawingSheet?.({ node: node as never, levelId, drawingType })
    if (sheet) return sheet
  }
  return null
}

export function resolveSheetExportLayout(pageWidth: number, pageHeight: number): SheetExportLayout {
  const contentX = PAGE_MARGIN_PT
  const contentY = PAGE_MARGIN_PT
  const contentWidth = pageWidth - PAGE_MARGIN_PT * 2
  const contentHeight = pageHeight - PAGE_MARGIN_PT * 2
  const titleBlock = {
    x: contentX,
    y: contentY + contentHeight - TITLE_BLOCK_HEIGHT_PT,
    width: contentWidth,
    height: TITLE_BLOCK_HEIGHT_PT,
  }
  const upperHeight = contentHeight - TITLE_BLOCK_HEIGHT_PT - SHEET_GAP_PT
  const sidePanel = {
    x: contentX + contentWidth - SHEET_SIDE_PANEL_WIDTH_PT,
    y: contentY,
    width: SHEET_SIDE_PANEL_WIDTH_PT,
    height: upperHeight,
  }
  return {
    planBox: {
      x: contentX,
      y: contentY,
      width: contentWidth - SHEET_SIDE_PANEL_WIDTH_PT - SHEET_GAP_PT,
      height: upperHeight,
    },
    sidePanel,
    titleBlock,
  }
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

function drawSheetChrome(
  doc: FloorplanPdfDocument,
  layout: SheetExportLayout,
  composition: SheetComposition,
  schedules: readonly FloorplanSchedule[],
): ScheduleDrawResult {
  doc.setDrawColor('#0f172a')
  doc.setLineWidth(0.6)
  doc.rect(
    PAGE_MARGIN_PT,
    PAGE_MARGIN_PT,
    doc.internal.pageSize.getWidth() - PAGE_MARGIN_PT * 2,
    doc.internal.pageSize.getHeight() - PAGE_MARGIN_PT * 2,
  )
  doc.setDrawColor('#cbd5e1')
  doc.setLineWidth(0.4)
  doc.rect(layout.planBox.x, layout.planBox.y, layout.planBox.width, layout.planBox.height)
  doc.rect(layout.sidePanel.x, layout.sidePanel.y, layout.sidePanel.width, layout.sidePanel.height)
  doc.rect(
    layout.titleBlock.x,
    layout.titleBlock.y,
    layout.titleBlock.width,
    layout.titleBlock.height,
  )

  drawSheetTitleBlock(doc, layout, composition)
  drawNorthArrow(doc, layout.planBox.x + layout.planBox.width - 26, layout.planBox.y + 38)
  drawGraphicScale(doc, layout.planBox.x + 18, layout.planBox.y + layout.planBox.height - 22, {
    scale: composition.scale,
    maxWidth: Math.min(150, layout.planBox.width * 0.3),
  })
  drawSheetDocumentMarkers(doc, composition)
  drawKeyedNoteSymbols(doc, composition)
  return drawSheetSidePanel(doc, layout.sidePanel, composition, schedules)
}

function drawSheetDocumentMarkers(doc: FloorplanPdfDocument, composition: SheetComposition): void {
  if (composition.documentMarkers.length === 0) return
  doc.setDrawColor('#111827')
  doc.setTextColor('#111827')
  doc.setLineWidth(0.7)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  for (const marker of composition.documentMarkers) {
    const x = marker.x * 72
    const y = marker.y * 72
    const end =
      marker.endX !== null && marker.endY !== null
        ? { x: marker.endX * 72, y: marker.endY * 72 }
        : null
    switch (marker.kind) {
      case 'wall-tag':
      case 'glazing-tag':
      case 'assembly-tag':
        drawTagMarker(doc, marker, x, y)
        break
      case 'section-callout':
      case 'elevation-callout':
      case 'detail-reference':
        drawCalloutMarker(doc, marker, x, y, end)
        break
      case 'delta-marker':
        drawDeltaMarker(doc, marker, x, y)
        break
      case 'revision-cloud':
        drawRevisionCloudMarker(doc, marker, x, y)
        break
    }
  }
}

function drawTagMarker(
  doc: FloorplanPdfDocument,
  marker: ResolvedDocumentMarker,
  x: number,
  y: number,
) {
  const width = Math.max(20, marker.label.length * 5 + 10)
  const height = 14
  if (marker.kind === 'glazing-tag') {
    doc.roundedRect(x - width / 2, y - height / 2, width, height, 2, 2)
  } else if (marker.kind === 'assembly-tag') {
    doc.rect(x - width / 2, y - height / 2, width, height)
  } else {
    doc.circle(x, y, Math.max(7, width / 2))
  }
  doc.text(marker.label, x, y + 2.4, { align: 'center' })
}

function drawCalloutMarker(
  doc: FloorplanPdfDocument,
  marker: ResolvedDocumentMarker,
  x: number,
  y: number,
  end: { x: number; y: number } | null,
) {
  if (end) doc.line(x, y, end.x, end.y)
  doc.circle(x, y, 8)
  doc.line(x - 8, y, x + 8, y)
  doc.text(marker.label, x, y - 1.8, { align: 'center' })
  const reference = [marker.drawingReference, marker.sheetReference].filter(Boolean).join('/')
  if (reference) {
    doc.setFont('helvetica', 'normal')
    doc.text(reference, x, y + 6, { align: 'center' })
    doc.setFont('helvetica', 'bold')
  }
}

function drawDeltaMarker(
  doc: FloorplanPdfDocument,
  marker: ResolvedDocumentMarker,
  x: number,
  y: number,
) {
  const radius = 8
  const points = [
    [x, y - radius],
    [x + radius * 0.87, y + radius / 2],
    [x - radius * 0.87, y + radius / 2],
  ] as const
  doc.triangle(points[0][0], points[0][1], points[1][0], points[1][1], points[2][0], points[2][1])
  doc.text(marker.revisionId || marker.label, x, y + 3, { align: 'center' })
}

function drawRevisionCloudMarker(
  doc: FloorplanPdfDocument,
  marker: ResolvedDocumentMarker,
  x: number,
  y: number,
) {
  const points: [number, number][] | null =
    marker.points.length >= 3 ? marker.points.map((point) => [point.x * 72, point.y * 72]) : null
  if (points) {
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]!
      const next = points[(index + 1) % points.length]!
      const [x1, y1] = current
      const [x2, y2] = next
      doc.line(x1, y1, x2, y2)
    }
  } else {
    doc.roundedRect(x - 28, y - 16, 56, 32, 8, 8)
  }
  if (marker.revisionId) drawDeltaMarker(doc, marker, x, y)
}

function drawKeyedNoteSymbols(doc: FloorplanPdfDocument, composition: SheetComposition): void {
  if (composition.keyedNoteInstances.length === 0) return
  doc.setDrawColor('#111827')
  doc.setTextColor('#111827')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  for (const instance of composition.keyedNoteInstances) {
    const x = instance.x * 72
    const y = instance.y * 72
    doc.circle(x, y, 6)
    doc.text(instance.key, x, y + 2.4, { align: 'center' })
  }
}

function drawSheetTitleBlock(
  doc: FloorplanPdfDocument,
  layout: SheetExportLayout,
  composition: SheetComposition,
) {
  const title = layout.titleBlock
  const sheetNumberWidth = 86
  const drawingRefWidth = 72
  doc.setDrawColor('#cbd5e1')
  doc.line(
    title.x + title.width - sheetNumberWidth,
    title.y,
    title.x + title.width - sheetNumberWidth,
    title.y + title.height,
  )
  doc.line(
    title.x + title.width - sheetNumberWidth - drawingRefWidth,
    title.y,
    title.x + title.width - sheetNumberWidth - drawingRefWidth,
    title.y + title.height,
  )

  doc.setTextColor('#111827')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(composition.viewTitle.toLocaleUpperCase(), title.x + 10, title.y + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Scale: ${formatDrawingScaleLabel(composition.scale)}`, title.x + 10, title.y + 30)
  doc.text(
    `Drawing: ${composition.drawingNumber}`,
    title.x + title.width - sheetNumberWidth - drawingRefWidth + 10,
    title.y + 16,
  )
  doc.text(
    composition.drawingLabel,
    title.x + title.width - sheetNumberWidth - drawingRefWidth + 10,
    title.y + 30,
  )
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(composition.sheetNumber, title.x + title.width - sheetNumberWidth + 10, title.y + 25)
  doc.setFontSize(7)
  doc.text(
    composition.sheetTitle.toLocaleUpperCase(),
    title.x + title.width - sheetNumberWidth + 10,
    title.y + 36,
    {
      maxWidth: sheetNumberWidth - 20,
    },
  )
}

function drawNorthArrow(doc: FloorplanPdfDocument, x: number, y: number) {
  doc.setDrawColor('#111827')
  doc.setFillColor('#111827')
  doc.setLineWidth(0.6)
  doc.triangle(x, y - 24, x - 6, y - 5, x + 6, y - 5, 'F')
  doc.line(x, y - 5, x, y + 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('N', x, y - 28, { align: 'center' })
}

export function resolveGraphicScaleLength(
  scale: DrawingSheetScale,
  maxWidthPt: number,
): { modelMeters: number; widthPt: number; label: string } {
  const pointsPerMeter = pointsPerMeterForDrawingScale(scale)
  const maxMeters = Math.max(0.1, maxWidthPt / pointsPerMeter)
  const candidates = [50, 20, 10, 5, 2, 1, 0.5, 0.25]
  const modelMeters = candidates.find((candidate) => candidate <= maxMeters) ?? 0.1
  return {
    modelMeters,
    widthPt: modelMeters * pointsPerMeter,
    label: `${modelMeters >= 1 ? modelMeters : modelMeters * 1000}${modelMeters >= 1 ? ' m' : ' mm'}`,
  }
}

function drawGraphicScale(
  doc: FloorplanPdfDocument,
  x: number,
  y: number,
  options: { scale: DrawingSheetScale; maxWidth: number },
) {
  const resolved = resolveGraphicScaleLength(options.scale, options.maxWidth)
  const half = resolved.widthPt / 2
  doc.setDrawColor('#111827')
  doc.setFillColor('#111827')
  doc.setLineWidth(0.6)
  doc.rect(x, y, half, 5, 'F')
  doc.rect(x + half, y, half, 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('0', x, y + 15, { align: 'center' })
  doc.text(resolved.label, x + resolved.widthPt, y + 15, { align: 'center' })
  doc.text(formatDrawingScaleLabel(options.scale), x + resolved.widthPt / 2, y - 4, {
    align: 'center',
  })
}

function drawSheetSidePanel(
  doc: FloorplanPdfDocument,
  panel: SheetExportLayout['sidePanel'],
  composition: SheetComposition,
  schedules: readonly FloorplanSchedule[],
): ScheduleDrawResult {
  let y = panel.y + 12
  const left = panel.x + 8
  const width = panel.width - 16
  const bottom = panel.y + panel.height - 8

  y = drawSheetNotes(doc, 'GENERAL NOTES', composition.generalNotes, left, y, width, bottom)
  y = drawKeyedNoteLegend(doc, composition, left, y + 8, width, bottom)
  return drawInlineSchedules(doc, schedules, left, y + 8, width, bottom)
}

function drawSheetNotes(
  doc: FloorplanPdfDocument,
  title: string,
  notes: readonly { number: number; text: string }[],
  x: number,
  y: number,
  width: number,
  bottom: number,
) {
  if (notes.length === 0) return y
  doc.setTextColor('#111827')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(title, x, y)
  y += 9
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  for (const note of notes) {
    const lines = doc.splitTextToSize(`${note.number}. ${note.text}`, width)
    if (y + lines.length * 8 > bottom) break
    doc.text(lines, x, y)
    y += lines.length * 8 + 3
  }
  return y
}

function drawKeyedNoteLegend(
  doc: FloorplanPdfDocument,
  composition: SheetComposition,
  x: number,
  y: number,
  width: number,
  bottom: number,
) {
  if (composition.keyedNoteLegend.length === 0) return y
  doc.setTextColor('#111827')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('KEYED NOTES', x, y)
  y += 9
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  for (const note of composition.keyedNoteLegend) {
    const lines = doc.splitTextToSize(`${note.key}. ${note.text}`, width)
    if (y + lines.length * 8 > bottom) break
    doc.text(lines, x, y)
    y += lines.length * 8 + 3
  }
  return y
}

function drawInlineSchedules(
  doc: FloorplanPdfDocument,
  schedules: readonly FloorplanSchedule[],
  x: number,
  y: number,
  width: number,
  bottom: number,
): ScheduleDrawResult {
  const overflowSchedules: FloorplanSchedule[] = []
  let drawnSchedules = 0
  for (const schedule of schedules) {
    const rowHeight = 12
    const tableHeight = 18 + rowHeight * Math.min(schedule.rows.length, 6)
    if (y + tableHeight > bottom) {
      overflowSchedules.push(schedule)
      continue
    }
    drawnSchedules++
    doc.setTextColor('#111827')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(schedule.title.toLocaleUpperCase(), x, y)
    y += 10
    const widths = scheduleColumnWidths(schedule, width)
    doc.setFillColor('#334155')
    doc.rect(x, y, width, rowHeight, 'F')
    doc.setTextColor('#ffffff')
    doc.setFontSize(6)
    let colX = x
    schedule.columns.forEach((column, index) => {
      doc.text(column.label, colX + 2, y + 8, { maxWidth: Math.max(0, (widths[index] ?? 0) - 4) })
      colX += widths[index] ?? 0
    })
    y += rowHeight
    doc.setFont('helvetica', 'normal')
    doc.setTextColor('#111827')
    const inlineRows = schedule.rows.slice(0, 6)
    for (const row of inlineRows) {
      colX = x
      schedule.columns.forEach((column, index) => {
        const colWidth = widths[index] ?? 0
        doc.text(
          truncatePdfText(doc, row.cells[column.key] ?? '', Math.max(0, colWidth - 4)),
          colX + 2,
          y + 8,
        )
        colX += colWidth
      })
      doc.setDrawColor('#cbd5e1')
      doc.rect(x, y, width, rowHeight)
      y += rowHeight
    }
    if (schedule.rows.length > inlineRows.length) {
      overflowSchedules.push({
        ...schedule,
        title: `${schedule.title} Continued`,
        rows: schedule.rows.slice(inlineRows.length),
      })
    }
    y += 12
  }
  return { drawnSchedules, overflowSchedules }
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
  const padding = Math.max(
    MIN_PLAN_PADDING_M,
    Math.max(modelBounds.width, modelBounds.height) * PLAN_PADDING_RATIO,
  )
  return {
    x: modelBounds.x - padding,
    y: modelBounds.y - padding,
    width: modelBounds.width + padding * 2,
    height: modelBounds.height + padding * 2,
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
  liveVisibility: FloorplanAnnotationVisibility,
): FloorplanAnnotationVisibility {
  return { ...liveVisibility }
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

export function pointsPerMeterForDrawingScale(scale: DrawingSheetScale): number {
  if (scale.startsWith('1:')) {
    const denominator = Number.parseFloat(scale.slice(2))
    if (Number.isFinite(denominator) && denominator > 0) {
      return POINTS_PER_INCH / METERS_PER_INCH / denominator
    }
  }

  const imperial = scale.match(/^(.+)"=1'-0"$/)
  if (imperial) {
    const paperInchesPerFoot = parseImperialPaperInches(imperial[1] ?? '')
    if (paperInchesPerFoot > 0) {
      return (paperInchesPerFoot / 12) * (POINTS_PER_INCH / METERS_PER_INCH)
    }
  }

  return pointsPerMeterForDrawingScale('1/4"=1\'-0"')
}

function parseImperialPaperInches(value: string): number {
  const trimmed = value.trim()
  if (trimmed.includes('/')) {
    const [numerator, denominator] = trimmed.split('/').map((part) => Number.parseFloat(part))
    return numerator && denominator ? numerator / denominator : 0
  }
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDrawingScaleLabel(scale: DrawingSheetScale): string {
  return scale.replace('=', ' = ')
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

function collectFloorplanGeometry(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  scope: FloorplanExportScope,
  unit: 'metric' | 'imperial',
  metricNotation: FloorplanMetricNotation,
  annotationVisibility: FloorplanAnnotationVisibility,
  drawingType: ConstructionDrawingType,
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
      (scope === 'full' || def.category === 'structure')
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
        (scope === 'full' || definition?.category === 'structure')
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
      resolveFloorplanExportViewState(unit, metricNotation),
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
    levelNodes = childIds.map((id) => nodes[id]).filter((n): n is AnyNode => n?.type === 'level')
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
