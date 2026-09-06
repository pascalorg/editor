/**
 * Typical details on the S-series (S5.x) — Bones' parametric construction
 * details (plugin-bones `plans/details.ts`: the typical wall section, the
 * foundation, the eave, an opening, the deck and porch ledgers) drawn as
 * PLATES from the FRAMED model's own variables (`detailVariables`: the stud
 * and rafter sizes and spacings the engines used, the assembly layers, the
 * footing and stem the foundation engine poured, the finish floor above
 * grade from the building's foundation record). Steve, 2026-09-06: "we have
 * a sheet generation tool, the structural details are to be in that".
 *
 * A detail is a drawing in REAL INCHES (x right, z up) plus notes anchored
 * to points in it. Each is fitted into a panel of the plate at the largest
 * scale that fits (the scale is printed under the caption — it is whatever
 * the panel allowed, never a nominal), its notes packed down a column on the
 * right with elbow leaders to their anchors, and captioned with a numbered
 * hexagon the way the reference sets do. Six panels to a sheet; a set with
 * more details gets S5.1.
 *
 * Nothing here invents a number: every dimension on a detail is a variable
 * the framed members or the resolved spec supplied, and a detail whose
 * `applies` gate is closed (no roof, no deck) is not drawn.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { foundationOf } from '../../../../plugin-bones/src/framing/compute'
import {
  DETAILS,
  type DetailDef,
  type DetailVariables,
  detailVariables,
  type Prim,
  variablesLine,
} from '../../../../plugin-bones/src/plans/details'
import type { NodeMap } from '../../model'
import { dot, INK, INK_MID, INK_SOFT, line, PEN, polygon, polyline, text, TYPE } from './draw'
import type { StructuralModel } from './model'
import { type Box, heading, wrap } from './plate'

/** Panels per sheet: three across, two down. */
export const DETAILS_PER_SHEET = 6
const COLS = 3
const ROWS = 2
/** Gap between panels, inches. */
const GAP = 0.3
/** Caption strip under each drawing, inches. */
const CAPTION_H = 0.55
/** Share of the panel the note column takes. */
const NOTE_SHARE = 0.4
/** Bones draws its details in CSS px at 96/in; its line and dot sizes convert at that. */
const PX = 1 / 96
/** Bones' own detail palette (its red for a flagged note). */
const RED = '#c2372b'

const IN = 0.0254

/** The detail variables and the details that apply, read off the framed model. */
export function detailsFor(
  model: StructuralModel,
  nodes: NodeMap,
): { v: DetailVariables; defs: DetailDef[] } {
  const parentId = model.level?.parentId
  const building = typeof parentId === 'string' ? nodes[parentId] : undefined
  const record = foundationOf(building as Record<string, unknown> | undefined)
  const v = detailVariables(model.members, model.spec, {
    type: record.type,
    ffAboveGradeIn: record.ffAboveGradeM / IN,
  })
  return { v, defs: DETAILS.filter((d) => d.applies(v)) }
}

/** How many S5.x sheets the model's details take. */
export function detailsPageCount(model: StructuralModel, nodes: NodeMap): number {
  return Math.ceil(detailsFor(model, nodes).defs.length / DETAILS_PER_SHEET)
}

export type DetailsPlate = {
  plate: FloorplanGeometry[]
  warnings: string[]
  /** Details drawn on this page / in the set. */
  count: number
  total: number
}

/** The plate for page `page` (1-based) of the typical details. */
export function detailsPlate(
  model: StructuralModel,
  nodes: NodeMap,
  box: Box,
  page = 1,
): DetailsPlate {
  const { v, defs } = detailsFor(model, nodes)
  const title = page > 1 ? `Typical details (${page})` : 'Typical details'
  const head = heading(box, title, variablesLine(v))
  const out: FloorplanGeometry[] = [...head.geometry]
  const warnings: string[] = []
  const start = (page - 1) * DETAILS_PER_SHEET
  const chunk = defs.slice(start, start + DETAILS_PER_SHEET)
  if (chunk.length === 0) {
    out.push(
      text([box.x, box.y + head.height + TYPE.body], 'No typical detail applies to this level — nothing was framed to draw one from.', TYPE.body, { fill: INK_MID }),
    )
    warnings.push('No typical detail applies: the framed model has nothing to draw one from.')
    return { plate: out, warnings, count: 0, total: defs.length }
  }
  const field: Box = {
    x: box.x,
    y: box.y + head.height + 0.1,
    w: box.w,
    h: box.h - head.height - 0.1,
  }
  const pw = (field.w - GAP * (COLS - 1)) / COLS
  const ph = (field.h - GAP * (ROWS - 1)) / ROWS
  chunk.forEach((def, i) => {
    const c = i % COLS
    const r = Math.floor(i / COLS)
    const panel: Box = { x: field.x + c * (pw + GAP), y: field.y + r * (ph + GAP), w: pw, h: ph }
    out.push(...renderPanel(def, v, panel, start + i + 1))
  })
  if (defs.length > start + chunk.length) {
    warnings.push(
      `${defs.length - start - chunk.length} more detail(s) continue on the next details sheet.`,
    )
  }
  return { plate: out, warnings, count: chunk.length, total: defs.length }
}

/* ------------------------------------------------------------- panel */

type Ext = { x0: number; x1: number; z0: number; z1: number }

function extentOf(prims: readonly Prim[]): Ext {
  const e: Ext = {
    x0: Number.POSITIVE_INFINITY,
    x1: Number.NEGATIVE_INFINITY,
    z0: Number.POSITIVE_INFINITY,
    z1: Number.NEGATIVE_INFINITY,
  }
  const add = (x: number, z: number) => {
    e.x0 = Math.min(e.x0, x)
    e.x1 = Math.max(e.x1, x)
    e.z0 = Math.min(e.z0, z)
    e.z1 = Math.max(e.z1, z)
  }
  for (const p of prims) {
    switch (p.k) {
      case 'rect':
        add(p.x, p.zTop)
        add(p.x + p.w, p.zTop - p.h)
        break
      case 'line':
        add(p.x1, p.z1)
        add(p.x2, p.z2)
        break
      case 'poly':
        for (const q of p.pts) add(q[0], q[1])
        break
      case 'batt':
        add(p.x, p.zTop)
        add(p.x + p.w, p.zBot)
        break
      case 'dot':
      case 'text':
        add(p.x, p.z)
        break
    }
  }
  if (!Number.isFinite(e.x0)) return { x0: 0, x1: 1, z0: 0, z1: 1 }
  return e
}

/** "1-1/2\" = 1'-0\"" for `s` paper inches per real inch, to the nearest eighth. */
export function detailScaleLabel(s: number): string {
  const eighths = Math.max(1, Math.round(12 * s * 8))
  const whole = Math.floor(eighths / 8)
  const rem = eighths % 8
  const fr =
    rem === 0 ? '' : rem % 4 === 0 ? `${rem / 4}/2` : rem % 2 === 0 ? `${rem / 2}/4` : `${rem}/8`
  const lead = whole > 0 ? `${whole}${fr ? `-${fr}` : ''}` : fr
  return `${lead || '1/8'}" = 1'-0"`
}

function renderPanel(
  def: DetailDef,
  v: DetailVariables,
  panel: Box,
  num: number,
): FloorplanGeometry[] {
  const drawing = def.draw(v)
  const ext = extentOf(drawing.prims)
  const noteW = panel.w * NOTE_SHARE
  const gap = 0.15
  const pad = 0.1
  const drawW = panel.w - noteW - gap - 2 * pad
  const drawH = panel.h - CAPTION_H - 2 * pad
  const s = Math.min(drawW / Math.max(1, ext.x1 - ext.x0), drawH / Math.max(1, ext.z1 - ext.z0))
  const ox = panel.x + pad + (drawW - (ext.x1 - ext.x0) * s) / 2
  const oy = panel.y + pad + (drawH - (ext.z1 - ext.z0) * s) / 2
  const X = (wx: number) => ox + (wx - ext.x0) * s
  const Y = (wz: number) => oy + (ext.z1 - wz) * s
  const out: FloorplanGeometry[] = []

  for (const p of drawing.prims) {
    switch (p.k) {
      case 'rect': {
        const x0 = X(p.x)
        const y0 = Y(p.zTop)
        const x1 = x0 + p.w * s
        const y1 = y0 + p.h * s
        out.push(
          polygon(
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ],
            { fill: p.fill ?? 'none', stroke: p.stroke ?? INK, strokeWidth: PEN.thin },
          ),
        )
        if (p.xMark) {
          out.push(line([x0, y0], [x1, y1], { stroke: INK, strokeWidth: PEN.thin }))
          out.push(line([x1, y0], [x0, y1], { stroke: INK, strokeWidth: PEN.thin }))
        }
        break
      }
      case 'line':
        out.push(
          line([X(p.x1), Y(p.z1)], [X(p.x2), Y(p.z2)], {
            stroke: p.stroke ?? INK,
            strokeWidth: p.width !== undefined ? p.width * PX : PEN.thin,
            ...(p.dash
              ? {
                  strokeDasharray: p.dash
                    .split(/[\s,]+/)
                    .map((d) => (Number(d) * PX).toFixed(4))
                    .join(' '),
                }
              : {}),
          }),
        )
        break
      case 'poly':
        out.push(
          polygon(
            p.pts.map((q) => [X(q[0]), Y(q[1])] as [number, number]),
            { fill: p.fill ?? 'none', stroke: p.stroke ?? INK, strokeWidth: PEN.thin },
          ),
        )
        break
      case 'batt': {
        // the insulation squiggle down the cavity — a zigzag at the cavity width
        const r = Math.max(0.02, (p.w * s) / 2)
        const cx = X(p.x + p.w / 2)
        const yTop = Y(p.zTop) + r
        const yEnd = Y(p.zBot) - r
        const pts: [number, number][] = []
        let y = yTop
        let flip = false
        while (y <= yEnd) {
          pts.push([cx + (flip ? -r : r) * 0.9, y])
          y += r * 0.8
          flip = !flip
        }
        if (pts.length > 1)
          out.push(polyline(pts, { fill: 'none', stroke: '#b48ead', strokeWidth: PEN.thin }))
        break
      }
      case 'dot':
        out.push(dot([X(p.x), Y(p.z)], Math.max(0.014, (p.r ?? 0.3) * s), p.fill ?? INK))
        break
      case 'text':
        out.push(
          text([X(p.x), Y(p.z)], p.t, ((p.size ?? 8) / 8) * TYPE.small, {
            anchor: p.anchor ?? 'start',
          }),
        )
        break
    }
  }

  // notes: a right column, rows packed top-down in anchor order, elbow leaders
  const colX = panel.x + panel.w - noteW
  const fs = TYPE.small
  const lineH = fs * 1.3
  const sorted = [...drawing.notes].sort((a, b) => b.z - a.z)
  const blocks = sorted.map((n) => ({ n, lines: wrap(n.t, noteW - 0.05, fs) }))
  const totalH = blocks.reduce((sum, b) => sum + b.lines.length * lineH, 0)
  const avail = panel.h - CAPTION_H - 2 * pad
  const gapY =
    blocks.length > 1 ? Math.max(0.03, Math.min(0.1, (avail - totalH) / (blocks.length - 1))) : 0
  let cursor = panel.y + pad
  const tops: number[] = []
  for (const b of blocks) {
    const h = b.lines.length * lineH
    const ideal = Math.max(panel.y + pad, Math.min(Y(b.n.z) - h / 2, panel.y + pad + avail - h))
    const top = Math.max(ideal, cursor)
    tops.push(top)
    cursor = top + h + gapY
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const h = (blocks[i] as { lines: string[] }).lines.length * lineH
    const maxTop =
      i === blocks.length - 1 ? panel.y + pad + avail - h : (tops[i + 1] as number) - gapY - h
    tops[i] = Math.min(tops[i] as number, maxTop)
  }
  blocks.forEach((b, i) => {
    const top = tops[i] as number
    const h = b.lines.length * lineH
    const ly = top + h / 2
    const anchor: [number, number] = [X(b.n.x), Y(b.n.z)]
    const color = b.n.red ? RED : INK_MID
    const elbow = colX - 0.08
    out.push(
      polyline([[colX - 0.03, ly], [elbow, ly], anchor], {
        fill: 'none',
        stroke: color,
        strokeWidth: PEN.hair,
      }),
    )
    out.push(dot(anchor, 0.014, color))
    b.lines.forEach((l, j) => {
      out.push(text([colX, top + lineH * (j + 0.8)], l, fs, { fill: b.n.red ? RED : INK }))
    })
  })

  // caption: hex bubble + title + the scale the panel allowed
  const cy = panel.y + panel.h - CAPTION_H / 2
  const r = 0.11
  const hx = panel.x + r + 0.05
  out.push(
    polygon(
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6
        return [hx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]
      }),
      { fill: 'none', stroke: INK, strokeWidth: PEN.medium },
    ),
  )
  out.push(text([hx, cy + TYPE.small * 0.35], String(num), TYPE.small, { anchor: 'middle', weight: 700 }))
  out.push(text([hx + r + 0.1, cy - 0.02], def.title, TYPE.body, { weight: 700 }))
  out.push(
    text([hx + r + 0.1, cy + TYPE.micro * 1.6], `SCALE: ${detailScaleLabel(s)}`, TYPE.micro, {
      fill: INK_MID,
    }),
  )
  // panel frame
  out.push(
    polygon(
      [
        [panel.x, panel.y],
        [panel.x + panel.w, panel.y],
        [panel.x + panel.w, panel.y + panel.h],
        [panel.x, panel.y + panel.h],
      ],
      { fill: 'none', stroke: INK_SOFT, strokeWidth: PEN.hair },
    ),
  )
  return out
}
