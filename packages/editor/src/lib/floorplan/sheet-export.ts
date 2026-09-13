'use client'

/**
 * Sheets — geometry collection + multi-sheet vector PDF.
 *
 * Two jobs, both of them thin wrappers over machinery that already exists:
 *
 * 1. `collectSheetGeometry` re-runs the registry-driven floor-plan pipeline
 *    (`def.floorplan(node, ctx)`) headlessly for one level, exactly the way
 *    `floorplan-export.tsx` does for its own PDF, but with a per-viewport
 *    annotation-visibility record and category filter instead of the live
 *    editor's global one. It returns the same `FloorplanGeometry` trees the
 *    2D editor draws, so a sheet viewport and the 2D editor cannot drift.
 *
 * 2. `exportSheetsToPdf` writes a page per sheet at the sheet's own paper
 *    size through the existing pdfkit renderer
 *    (`floorplan-pdfkit-renderer.ts` / `floorplan-pdfkit-document.ts`). The
 *    title block is passed in as ordinary geometry in SHEET INCHES, so the
 *    PDF and the screen draw the same primitives.
 *
 * This module owns no layout opinions — `@pascal-app/plugin-sheets` builds
 * the pages and calls in here.
 */
import type {
  AnyNode,
  AnyNodeId,
  ConstructionDrawingType,
  FloorplanGeometry,
  LiveNodeOverrides,
} from '@pascal-app/core'
import { nodeRegistry, resolveBuildingForLevel } from '@pascal-app/core'
import {
  buildContext,
  collectFloorplanLinkedLevelNodes,
  floorplanLayerRank,
  getFloorplanLevelData,
  isFloorplanNodeVisible,
  splitFloorplanOverlay,
} from '../../components/editor-2d/renderers/floorplan-registry-layer'
import {
  type FloorplanAnnotationVisibility,
  filterFloorplanAnnotationGeometry,
} from './annotation-visibility'
import { resolveNodeForDrawingType } from './drawing-coordination'
import {
  collectFloorplanSchedules,
  filterFloorplanExportOverlay,
  isFloorplanExportAnnotationGeometry,
  resolveFloorplanExportNodeGeometry,
  resolveFloorplanExportRotationDeg,
  resolveFloorplanExportViewState,
} from './floorplan-export'
import type { FloorplanMetricNotation } from './floorplan-extension'
import { createFloorplanPdfDocument } from './floorplan-pdfkit-document'
import { renderFloorplanGeometryToPdfKit } from './floorplan-pdfkit-renderer'

/** PDF user-space units per inch. */
export const POINTS_PER_INCH = 72

/**
 * The schedules the kinds on a level contribute
 * (`def.extensions['pascal:editor/floorplan'].schedule`). Re-exported here so
 * a sheet's schedule viewport prints the SAME marks the plan's mark bubbles
 * do — both come from `resolveOpeningMarks` in `@pascal-app/nodes`.
 */
export { collectFloorplanSchedules }
export type { FloorplanSchedule } from './floorplan-extension'

export type SheetGeometryEntry = {
  id: AnyNodeId
  type: string
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
}

export type SheetGeometryOptions = {
  nodes: Record<string, AnyNode>
  levelId: AnyNodeId
  drawingType: ConstructionDrawingType
  annotationVisibility: FloorplanAnnotationVisibility
  /** Return false to leave a node out of this viewport (the layer switches). */
  accept?: (node: AnyNode, category: string | undefined) => boolean
  unit?: 'metric' | 'imperial'
  metricNotation?: FloorplanMetricNotation
}

/**
 * The geometry one plan viewport shows. Level-local metres, unrotated — the
 * caller applies `resolveSheetRotationDeg` when it places the drawing.
 */
export function collectSheetGeometry(options: SheetGeometryOptions): SheetGeometryEntry[] {
  const {
    nodes,
    levelId,
    drawingType,
    annotationVisibility,
    accept,
    unit = 'imperial',
    metricNotation = 'meters',
  } = options
  const noLiveOverrides = new Map<string, LiveNodeOverrides>()
  const levelNodeIdsByType = new Map<string, AnyNodeId[]>()
  const entries: { id: AnyNodeId; node: AnyNode; parentOverride?: AnyNode }[] = []

  const keep = (node: AnyNode): boolean => {
    const def = nodeRegistry.get(node.type)
    if (!def?.floorplan) return false
    if (!isFloorplanNodeVisible(node)) return false
    return accept ? accept(node, def.category) : true
  }

  const visit = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    const def = nodeRegistry.get(node.type)
    if (def?.computeFloorplanLevelData) {
      const ids = levelNodeIdsByType.get(node.type)
      if (ids) ids.push(id)
      else levelNodeIdsByType.set(node.type, [id])
    }
    if (keep(node)) {
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
      if (!keep(linked.node)) continue
      const drawingNode = resolveNodeForDrawingType(linked.node, nodes, drawingType)
      if (drawingNode) {
        entries.push({ id: linked.id, node: drawingNode, parentOverride: activeLevelNode })
      }
    }
  }

  entries.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))

  const levelDataCache = new Map()
  const out: SheetGeometryEntry[] = []
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
    const viewState = {
      ...resolveFloorplanExportViewState(
        unit,
        metricNotation,
        undefined,
        annotationVisibility.automaticDimensions,
      ),
      // Sheets are documents, not the editing surface: kinds that vary their
      // marks / label chrome by purpose draw their document form.
      purpose: 'document' as const,
    }
    const baseContext = buildContext(node, nodes, viewState, levelData)
    const ctx = parentOverride ? { ...baseContext, parent: parentOverride } : baseContext
    const geometry = builder(node, ctx)
    if (!geometry) continue
    const visible = filterFloorplanAnnotationGeometry(geometry, annotationVisibility)
    if (!visible) continue
    const { base, overlay } = splitFloorplanOverlay(visible)
    const exportOverlay = overlay ? filterFloorplanExportOverlay(overlay) : null
    const annotationOnly = isFloorplanExportAnnotationGeometry(visible)
    const { model, annotations } = resolveFloorplanExportNodeGeometry(
      base,
      exportOverlay,
      annotationOnly,
    )
    if (model || annotations) out.push({ id, type: node.type, model, annotations })
  }
  return out
}

/**
 * Plan rotation for a level: the floor-plan view rotation minus the
 * building's own yaw — the same expression `floorplan-export.tsx` uses, with
 * the live navigation azimuth deliberately left out. A sheet must not change
 * because someone orbited the 3D view.
 */
export function resolveSheetRotationDeg(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
): number {
  const buildingId = resolveBuildingForLevel(levelId, nodes as Record<AnyNodeId, AnyNode>)
  const building = buildingId ? nodes[buildingId] : undefined
  const buildingRotationY = building?.type === 'building' ? (building.rotation[1] ?? 0) : 0
  return resolveFloorplanExportRotationDeg(buildingRotationY, undefined)
}

/* ----------------------------------------------------------------- PDF */

export type SheetPdfWindow = {
  /** Placement on the paper, in sheet inches from the top-left. */
  rect: { x: number; y: number; w: number; h: number }
  /** World window shown inside `rect`, in ROTATED plan metres. */
  viewport: { x: number; y: number; width: number; height: number }
  rotationDeg: number
  model: FloorplanGeometry | null
  annotations: FloorplanGeometry | null
}

export type SheetPdfPage = {
  widthIn: number
  heightIn: number
  /** Paper, border and title block — drawn UNDER the live windows. */
  plate: FloorplanGeometry[]
  windows: SheetPdfWindow[]
  /** Viewport labels, tables, notes, images — drawn OVER the live windows. */
  overlay: FloorplanGeometry[]
}

/** Every sheet, one PDF, each page at its own paper size. */
export async function exportSheetsToPdf(
  pages: readonly SheetPdfPage[],
  filename: string,
): Promise<void> {
  if (pages.length === 0) return
  const first = pages[0]
  if (!first) return
  const { doc, save } = await createFloorplanPdfDocument([
    first.widthIn * POINTS_PER_INCH,
    first.heightIn * POINTS_PER_INCH,
  ])

  for (const page of pages) {
    const pw = page.widthIn * POINTS_PER_INCH
    const ph = page.heightIn * POINTS_PER_INCH
    doc.addPage([pw, ph])

    // Paper and title block, then the live windows, then everything that is
    // meant to read on top of a drawing.
    await drawPlate(doc, page.plate, page, pw, ph)

    for (const win of page.windows) {
      if (!win.model && !win.annotations) continue
      if (win.viewport.width <= 0 || win.viewport.height <= 0) continue
      const placement = {
        x: win.rect.x * POINTS_PER_INCH,
        y: win.rect.y * POINTS_PER_INCH,
        width: win.rect.w * POINTS_PER_INCH,
        height: win.rect.h * POINTS_PER_INCH,
      }
      doc.raw.save()
      doc.raw.rect(placement.x, placement.y, placement.width, placement.height).clip()
      if (win.model) {
        await renderFloorplanGeometryToPdfKit(doc, win.model, {
          annotationLayer: false,
          placement,
          rotationDeg: win.rotationDeg,
          viewport: win.viewport,
        })
      }
      if (win.annotations) {
        await renderFloorplanGeometryToPdfKit(doc, win.annotations, {
          annotationLayer: true,
          placement,
          rotationDeg: win.rotationDeg,
          viewport: win.viewport,
        })
      }
      doc.raw.restore()
    }

    await drawPlate(doc, page.overlay, page, pw, ph)
  }

  await save(filename)
}

/** Geometry authored in sheet inches, painted 1:1 onto the page. */
async function drawPlate(
  doc: Awaited<ReturnType<typeof createFloorplanPdfDocument>>['doc'],
  geometry: readonly FloorplanGeometry[],
  page: SheetPdfPage,
  pw: number,
  ph: number,
): Promise<void> {
  if (geometry.length === 0) return
  await renderFloorplanGeometryToPdfKit(
    doc,
    { kind: 'group', children: [...geometry] },
    {
      annotationLayer: false,
      placement: { x: 0, y: 0, width: pw, height: ph },
      rotationDeg: 0,
      viewport: { x: 0, y: 0, width: page.widthIn, height: page.heightIn },
    },
  )
}
