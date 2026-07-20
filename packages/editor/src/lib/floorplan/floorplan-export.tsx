'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPalette,
  type FloorplanSchedule,
  type LiveNodeOverrides,
  nodeRegistry,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { jsPDF as JsPdfDocument } from 'jspdf'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { resolveSvgAnnotationCollisions } from '../../components/editor-2d/renderers/floorplan-annotation-layout'
import { FloorplanGeometryRenderer } from '../../components/editor-2d/renderers/floorplan-geometry-renderer'
import {
  buildContext,
  floorplanLayerRank,
  getFloorplanLevelData,
  isFloorplanNodeVisible,
  splitFloorplanOverlay,
} from '../../components/editor-2d/renderers/floorplan-registry-layer'
import { FLOORPLAN_VIEW_ROTATION_DEG } from './geometry'

/**
 * Floorplan PDF export.
 *
 * Re-runs the same registry-driven geometry pipeline the live 2D layer uses
 * (`def.floorplan(node, ctx)` → `FloorplanGeometryRenderer`) headlessly, with
 * a neutral `viewState` so nodes render in their default, unselected form.
 * Every level of the active building becomes its own page, titled with the
 * level's label, with the plan fit to the page (independent of the live
 * pan/zoom). jsPDF + svg2pdf are dynamically imported so they only load when
 * an export actually runs.
 *
 * `scope: 'structure'` keeps only `category === 'structure'` nodes (walls,
 * slabs, ceilings, doors, windows, stairs, columns, roofs…); `'full'` keeps
 * every node that has a floorplan builder and is visible.
 */
export type FloorplanExportScope = 'full' | 'structure'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Meters of margin around the plan bounds. */
const PADDING_M = 1
/** PDF page margin + title band, in pt. */
const PAGE_MARGIN_PT = 36
const TITLE_BAND_PT = 28

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
  purpose: 'document',
  highlighted: false,
  hovered: false,
  moving: false,
  palette: NEUTRAL_PALETTE,
} as const

type ExportLevel = { id: AnyNodeId; label: string }

export async function exportFloorplanPdf(scope: FloorplanExportScope): Promise<void> {
  const nodes = useScene.getState().nodes
  const viewer = useViewer.getState()
  const unit = viewer.unit
  const showMeasurements = viewer.showMeasurements
  const levels = resolveExportLevels(nodes)
  if (levels.length === 0) {
    console.warn('[floorplan-export] no level to export')
    return
  }

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;'
  document.body.appendChild(host)

  let pageCount = 0
  try {
    for (const level of levels) {
      const geometries = collectFloorplanGeometry(nodes, level.id, scope, unit, showMeasurements)
      const schedules = collectFloorplanSchedules(nodes, level.id, unit)
      if (geometries.length === 0 && schedules.length === 0) continue

      if (geometries.length > 0) {
        // Rotate the exported plan to the same north-up orientation the on-screen
        // 2D view uses when aligned to north (user rotation offset = 0), so a PDF
        // points north instead of drawing raw plan-local axes.
        const buildingId = resolveBuildingForLevel(level.id, nodes as Record<AnyNodeId, AnyNode>)
        const building = buildingId ? nodes[buildingId] : undefined
        const buildingRotationY = building?.type === 'building' ? (building.rotation[1] ?? 0) : 0
        const rotationDeg = FLOORPLAN_VIEW_ROTATION_DEG - (buildingRotationY * 180) / Math.PI

        const mounted = await mountFloorplanSvg(host, geometries, rotationDeg)
        if (mounted) {
          try {
            if (pageCount > 0) doc.addPage()
            pageCount++

            doc.setFontSize(14)
            doc.text(level.label, PAGE_MARGIN_PT, PAGE_MARGIN_PT + 12)

            // Fit the plan into the page below the title band, preserving aspect.
            const boxX = PAGE_MARGIN_PT
            const boxY = PAGE_MARGIN_PT + TITLE_BAND_PT
            const boxW = pageW - PAGE_MARGIN_PT * 2
            const boxH = pageH - PAGE_MARGIN_PT * 2 - TITLE_BAND_PT
            let fitted = fitPlanToBox(mounted.width, mounted.height, boxX, boxY, boxW, boxH)
            for (let pass = 0; pass < 2; pass++) {
              await mounted.setAnnotationUnitsPerPoint(mounted.width / fitted.width)
              fitted = fitPlanToBox(mounted.width, mounted.height, boxX, boxY, boxW, boxH)
            }

            // svg2pdf doesn't honour `vector-effect: non-scaling-stroke` (which
            // many builders use to keep door/window/stair line weights constant
            // on screen). Left as-is, those pixel-sized widths render as
            // metre-wide strokes — huge grey blobs. Convert them to the real-unit
            // width that lands at the intended point weight once svg2pdf scales
            // the plan onto the page.
            inlineNonScalingStrokes(mounted.svg, fitted.width / mounted.width)

            await svg2pdf(mounted.svg, doc, {
              x: fitted.x,
              y: fitted.y,
              width: fitted.width,
              height: fitted.height,
            })
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
    doc.save(`floorplan_${scope}_${date}.pdf`)
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
    if (!definition.floorplanSchedule) continue
    const siblings = siblingsByType.get(kind) ?? []
    const schedule = definition.floorplanSchedule({ siblings, nodes, levelId, unit })
    if (schedule && schedule.rows.length > 0) schedules.push(schedule)
  }
  return schedules
}

function drawFloorplanSchedulePages(
  doc: JsPdfDocument,
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
    if (pageCount > 0) doc.addPage()
    pageCount++
    doc.setTextColor('#111827')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setLineWidth(0.5)
    doc.text(`${levelLabel} - Opening Schedules`, PAGE_MARGIN_PT, PAGE_MARGIN_PT + 12)
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
  doc: JsPdfDocument,
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

function truncatePdfText(doc: JsPdfDocument, value: string, maxWidth: number): string {
  if (doc.getTextWidth(value) <= maxWidth) return value
  let truncated = value
  while (truncated.length > 0 && doc.getTextWidth(`${truncated}...`) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}...`
}

type MountedFloorplan = {
  svg: SVGSVGElement
  /** Padded viewBox dimensions, in meters — used for aspect-preserving fit. */
  width: number
  height: number
  setAnnotationUnitsPerPoint: (value: number) => Promise<void>
  cleanup: () => void
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

async function mountFloorplanSvg(
  parent: HTMLElement,
  geometries: { id: AnyNodeId; base: FloorplanGeometry }[],
  rotationDeg: number,
): Promise<MountedFloorplan | null> {
  const container = document.createElement('div')
  parent.appendChild(container)
  const root = createRoot(container)
  const cleanup = () => {
    root.unmount()
    container.remove()
  }

  const render = (annotationUnitsPerPoint?: number) => {
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
              geometries.map(({ id, base }) =>
                createElement(FloorplanGeometryRenderer, {
                  key: id,
                  geometry: base,
                  sceneRotationDeg: rotationDeg,
                  annotationUnitsPerPoint,
                }),
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

  const mounted: MountedFloorplan = {
    svg,
    width: 0,
    height: 0,
    cleanup,
    setAnnotationUnitsPerPoint: async (value) => {
      render(value)
      await nextFrames(1)
      resolveSvgAnnotationCollisions(svg)
      if (!measureMountedFloorplan(mounted)) throw new Error('Unable to measure floor plan export')
    },
  }
  if (!measureMountedFloorplan(mounted)) {
    cleanup()
    return null
  }
  return mounted
}

function measureMountedFloorplan(mounted: MountedFloorplan): boolean {
  const content = mounted.svg.querySelector('[data-floorplan-content]') as SVGGraphicsElement | null
  const bbox = content?.getBBox()
  if (!bbox || bbox.width === 0 || bbox.height === 0) return false

  const minX = bbox.x - PADDING_M
  const minY = bbox.y - PADDING_M
  mounted.width = bbox.width + PADDING_M * 2
  mounted.height = bbox.height + PADDING_M * 2
  mounted.svg.setAttribute('viewBox', `${minX} ${minY} ${mounted.width} ${mounted.height}`)
  mounted.svg.setAttribute('width', `${mounted.width}`)
  mounted.svg.setAttribute('height', `${mounted.height}`)

  mounted.svg.querySelector('[data-floorplan-background]')?.remove()
  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('data-floorplan-background', '')
  background.setAttribute('x', `${minX}`)
  background.setAttribute('y', `${minY}`)
  background.setAttribute('width', `${mounted.width}`)
  background.setAttribute('height', `${mounted.height}`)
  background.setAttribute('fill', '#ffffff')
  mounted.svg.insertBefore(background, mounted.svg.firstChild)
  return true
}

/**
 * Bake `vector-effect: non-scaling-stroke` widths into real user units.
 *
 * svg2pdf ignores the non-scaling hint, so a `stroke-width="1.25"` meant as
 * "1.25 screen px" would otherwise render as 1.25 metres on the page. We
 * rewrite each such width (and any dash pattern) to `px / ptPerUnit` so it
 * lands at ~`px` points once svg2pdf scales the plan by `ptPerUnit`, then drop
 * the now-misleading attribute.
 */
function inlineNonScalingStrokes(svg: SVGSVGElement, ptPerUnit: number) {
  if (!Number.isFinite(ptPerUnit) || ptPerUnit <= 0) return
  for (const el of svg.querySelectorAll('[vector-effect="non-scaling-stroke"]')) {
    const sw = el.getAttribute('stroke-width')
    if (sw) {
      const px = Number.parseFloat(sw)
      if (Number.isFinite(px)) el.setAttribute('stroke-width', `${px / ptPerUnit}`)
    }
    const dash = el.getAttribute('stroke-dasharray')
    if (dash) {
      const scaled = dash
        .split(/[\s,]+/)
        .map((v) => {
          const n = Number.parseFloat(v)
          return Number.isFinite(n) ? `${n / ptPerUnit}` : v
        })
        .join(' ')
      el.setAttribute('stroke-dasharray', scaled)
    }
    el.removeAttribute('vector-effect')
  }
}

function collectFloorplanGeometry(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  scope: FloorplanExportScope,
  unit: 'metric' | 'imperial',
  showMeasurements: boolean,
): { id: AnyNodeId; base: FloorplanGeometry }[] {
  const noLiveOverrides = new Map<string, LiveNodeOverrides>()
  const levelNodeIdsByType = new Map<string, AnyNodeId[]>()
  const entries: { id: AnyNodeId; node: AnyNode }[] = []

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
      (node.type !== 'measurement' || showMeasurements) &&
      (scope === 'full' || def.category === 'structure')
    ) {
      entries.push({ id, node })
    }
    const childIds = (node as { children?: AnyNodeId[] }).children
    if (Array.isArray(childIds)) for (const cid of childIds) visit(cid)
  }
  visit(levelId)

  // Document order is paint order — sort the same way the live layer does so
  // zones sit under walls/slabs/furniture rather than on top of them.
  entries.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))

  // One-shot per-type cache for `computeFloorplanLevelData`; value type is
  // module-private to the registry layer, so let it infer.
  const levelDataCache = new Map()
  const out: { id: AnyNodeId; base: FloorplanGeometry }[] = []
  for (const { id, node } of entries) {
    const builder = nodeRegistry.get(node.type)?.floorplan
    if (!builder) continue
    const levelData = getFloorplanLevelData(
      node.type,
      nodes,
      noLiveOverrides,
      levelNodeIdsByType,
      levelDataCache,
    )
    const ctx = buildContext(node, nodes, { ...NEUTRAL_VIEW_STATE, unit }, levelData)
    const geometry = builder(node, ctx)
    if (!geometry) continue
    const { base, overlay } = splitFloorplanOverlay(geometry)
    const exportOverlay = overlay ? filterFloorplanExportOverlay(overlay) : null
    const exportGeometry = combineGeometry(base, exportOverlay)
    if (exportGeometry) out.push({ id, base: exportGeometry })
  }
  return out
}

export function filterFloorplanExportOverlay(
  geometry: FloorplanGeometry,
): FloorplanGeometry | null {
  if (
    geometry.kind === 'dimension' ||
    geometry.kind === 'dimension-label' ||
    geometry.kind === 'text'
  ) {
    return geometry
  }
  if (geometry.kind !== 'group') return null

  const children = geometry.children
    .map(filterFloorplanExportOverlay)
    .filter((child): child is FloorplanGeometry => child !== null)
  if (children.length === 0) return null
  return { ...geometry, children }
}

function combineGeometry(
  base: FloorplanGeometry | null,
  overlay: FloorplanGeometry | null,
): FloorplanGeometry | null {
  if (!base) return overlay
  if (!overlay) return base
  return { kind: 'group', children: [base, overlay] }
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
