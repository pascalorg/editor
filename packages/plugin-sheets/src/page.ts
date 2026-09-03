/**
 * One sheet, fully composed — the single description the screen renderer and
 * the PDF writer both consume. Whatever you see on the paper is what prints.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { SheetPdfWindow } from '@pascal-app/editor'
import { resolveViewport } from './drawings'
import { type NodeMap, projectRecord, sheets, siteAddress, viewports } from './model'
import { paperSize, scaleLabel } from './scale'
import type { SheetNode, ViewportNode } from './schema'
import { buildStatusStamp, buildTitleBlock, buildViewportLabel } from './titleblock'

export type ComposedSheet = {
  sheet: SheetNode
  widthIn: number
  heightIn: number
  /** Paper, border and title block — under the live windows. */
  plate: FloorplanGeometry[]
  /** Labels, tables, notes, images — over the live windows. */
  overlay: FloorplanGeometry[]
  /** Live drawing windows, in sheet inches + world metres. */
  windows: SheetPdfWindow[]
  /** Per-viewport bookkeeping the on-screen editor needs. */
  placements: { viewport: ViewportNode; title: string; scale: number | undefined }[]
}

export type ComposeOptions = {
  nodes: NodeMap
  /** Data URLs captured for view3d viewports this session. */
  captures?: Record<string, string>
  /** Why a view3d viewport has no image, keyed by viewport id. */
  captureNotes?: Record<string, string>
  /** Draw the sheet index in the title block (cover sheets). */
  withIndex?: boolean
}

export function composeSheet(sheet: SheetNode, options: ComposeOptions): ComposedSheet {
  const { nodes, captures, captureNotes } = options
  const paper = paperSize(sheet.size)
  const list = viewports(nodes, sheet.id)
  const overlay: FloorplanGeometry[] = []
  const windows: SheetPdfWindow[] = []
  const placements: ComposedSheet['placements'] = []

  const scalesUsed = new Set<number>()
  list.forEach((vp, index) => {
    const drawn = resolveViewport(vp, { nodes, captures, captureNotes })
    overlay.push(...drawn.plate)
    if (drawn.live) {
      windows.push({
        rect: { x: vp.x, y: vp.y, w: vp.w, h: vp.h },
        viewport: drawn.live.view,
        rotationDeg: drawn.live.rotationDeg,
        model: drawn.live.model,
        annotations: drawn.live.annotations,
      })
    }
    if (drawn.scale) scalesUsed.add(drawn.scale)
    // Cover blocks carry their own headings — a numbered label strip under
    // "SHEET INDEX" would only say it twice.
    if (!drawn.noLabel) {
      overlay.push(
        ...buildViewportLabel(index + 1, drawn.title, drawn.scale, vp.x, vp.y + vp.h + 0.28, vp.w),
      )
    }
    placements.push({ viewport: vp, title: drawn.title, scale: drawn.scale })
  })

  const withIndex = options.withIndex ?? /^A0/.test(sheet.number)
  const titleBlockInput = {
    widthIn: paper.widthIn,
    heightIn: paper.heightIn,
    number: sheet.number,
    title: sheet.title,
    record: projectRecord(nodes),
    addressFallback: siteAddress(nodes),
    scaleText: scalesUsed.size === 1 ? scaleLabel([...scalesUsed][0] as number) : 'AS NOTED',
    sheetIndex: withIndex
      ? sheets(nodes).map((s) => ({ number: s.number, title: s.title }))
      : undefined,
    sheetOrdinal: Math.max(1, sheets(nodes).findIndex((s) => s.id === sheet.id) + 1),
    sheetCount: sheets(nodes).length,
  }
  const titleBlock = buildTitleBlock(titleBlockInput)
  overlay.push(...buildStatusStamp(titleBlockInput))

  return {
    sheet,
    widthIn: paper.widthIn,
    heightIn: paper.heightIn,
    // The title block paints the paper, so it goes first; viewport plates and
    // labels sit on top of it.
    plate: titleBlock,
    overlay,
    windows,
    placements,
  }
}

export function composeAll(options: ComposeOptions): ComposedSheet[] {
  return sheets(options.nodes).map((sheet) => composeSheet(sheet, options))
}
