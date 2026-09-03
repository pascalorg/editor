/**
 * DOORS AND WINDOWS AS THEY ARE, in elevation.
 *
 * Every glyph is built from the node's own fields — `doorType`, `leafCount`,
 * `segments` (panel / glass / empty rows), `windowType`, `casementStyle`,
 * `hingesSide`, `awningDirection`, `columnRatios` / `rowRatios`,
 * `frameThickness`, `sill` — so a double-hung with a 2×2 grid draws as one,
 * a French door draws as two glazed leaves, a garage door as its sections.
 * Nothing is read off a catalogue picture; change the node and the elevation
 * follows. Drafting conventions used (and only these):
 *   - dashed "V" on an operable sash points at the HINGE side;
 *   - a 3-1/2 in casing band around framed openings;
 *   - a hexagon tag for a door mark, an ellipse for a window mark — the same
 *     shapes the floor plan's tags use (nodes/shared/opening-documentation.ts).
 *
 * Coordinates are DRAWING metres (x along the view, y = −elevation).
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { Opening } from './scene-model'
import { INK, line, polygon, WEIGHT } from './style'
import type { Vec2 } from './types'

export const GLASS = '#dbeafe'
export const GLASS_OPACITY = 0.75
export const LEAF = '#f1f5f9'
export const PANEL = '#e2e8f0'
/** 3-1/2 in casing — the common framed-opening trim (drafting convention). */
export const CASING = 3.5 * 0.0254

type Rect = { x0: number; x1: number; yTop: number; yBottom: number }

function rect(r: Rect, style: Partial<FloorplanGeometry & { kind: 'polygon' }>): FloorplanGeometry {
  return polygon(
    [
      [r.x0, r.yTop],
      [r.x1, r.yTop],
      [r.x1, r.yBottom],
      [r.x0, r.yBottom],
    ],
    style,
  )
}

function inset(r: Rect, by: number): Rect {
  return { x0: r.x0 + by, x1: r.x1 - by, yTop: r.yTop + by, yBottom: r.yBottom - by }
}

function width(r: Rect): number {
  return r.x1 - r.x0
}
function height(r: Rect): number {
  return r.yBottom - r.yTop
}

/** Split a span by ratios → [start, end] pairs. */
function splitByRatios(a: number, b: number, ratios: readonly number[]): Array<[number, number]> {
  const clean = ratios.filter((r) => Number.isFinite(r) && r > 0)
  const list = clean.length > 0 ? clean : [1]
  const total = list.reduce((s, r) => s + r, 0)
  const out: Array<[number, number]> = []
  let cursor = a
  for (const r of list) {
    const next = cursor + ((b - a) * r) / total
    out.push([cursor, next])
    cursor = next
  }
  return out
}

/** Glass with its muntin grid, filling `r`. */
function glazing(r: Rect, columns: readonly number[], rows: readonly number[]): FloorplanGeometry[] {
  if (width(r) <= 1e-4 || height(r) <= 1e-4) return []
  const out: FloorplanGeometry[] = [
    rect(r, { fill: GLASS, fillOpacity: GLASS_OPACITY, stroke: INK, strokeWidth: WEIGHT.detail }),
  ]
  const cols = splitByRatios(r.x0, r.x1, columns)
  for (let i = 1; i < cols.length; i++) {
    const x = cols[i]![0]
    out.push(line([x, r.yTop], [x, r.yBottom], { strokeWidth: WEIGHT.detail }))
  }
  const rws = splitByRatios(r.yTop, r.yBottom, rows)
  for (let i = 1; i < rws.length; i++) {
    const y = rws[i]![0]
    out.push(line([r.x0, y], [r.x1, y], { strokeWidth: WEIGHT.detail }))
  }
  return out
}

/** Dashed operation "V" whose apex points at the hinge side. */
function swingV(r: Rect, hinge: 'left' | 'right' | 'top' | 'bottom'): FloorplanGeometry[] {
  const dash = { strokeWidth: WEIGHT.detail, strokeDasharray: '0.08 0.05' }
  const midY = (r.yTop + r.yBottom) / 2
  const midX = (r.x0 + r.x1) / 2
  switch (hinge) {
    case 'left':
      return [
        line([r.x1, r.yTop], [r.x0, midY], dash),
        line([r.x1, r.yBottom], [r.x0, midY], dash),
      ]
    case 'right':
      return [
        line([r.x0, r.yTop], [r.x1, midY], dash),
        line([r.x0, r.yBottom], [r.x1, midY], dash),
      ]
    case 'top':
      return [
        line([r.x0, r.yBottom], [midX, r.yTop], dash),
        line([r.x1, r.yBottom], [midX, r.yTop], dash),
      ]
    default:
      return [
        line([r.x0, r.yTop], [midX, r.yBottom], dash),
        line([r.x1, r.yTop], [midX, r.yBottom], dash),
      ]
  }
}

/** A sash: its frame stiles/rails, then glazing inside. */
function sash(r: Rect, frame: number, columns: readonly number[], rows: readonly number[]) {
  const out: FloorplanGeometry[] = [
    rect(r, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.detail }),
  ]
  out.push(...glazing(inset(r, frame), columns, rows))
  return out
}

export function windowGlyph(opening: Opening, outer: Rect): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const frame = Math.min(opening.frameThickness, width(outer) / 6, height(outer) / 6)
  const cols = opening.columnRatios
  const rows = opening.rowRatios
  // Casing around the opening (framed construction).
  if (opening.construction !== 'masonry') {
    out.push(
      rect(
        { x0: outer.x0 - CASING, x1: outer.x1 + CASING, yTop: outer.yTop - CASING, yBottom: outer.yBottom },
        { fill: 'none', stroke: INK, strokeWidth: WEIGHT.detail },
      ),
    )
  }
  // Frame.
  out.push(rect(outer, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.projected }))
  const light = inset(outer, frame)
  const type = opening.windowType ?? 'fixed'
  switch (type) {
    case 'double-hung':
    case 'single-hung': {
      const midY = (light.yTop + light.yBottom) / 2
      const upper: Rect = { ...light, yBottom: midY }
      const lower: Rect = { ...light, yTop: midY }
      out.push(...sash(upper, frame * 0.6, cols, rows), ...sash(lower, frame * 0.6, cols, rows))
      // Meeting rail reads heavier than a muntin.
      out.push(line([light.x0, midY], [light.x1, midY], { strokeWidth: WEIGHT.projected }))
      break
    }
    case 'sliding': {
      const midX = (light.x0 + light.x1) / 2
      out.push(
        ...sash({ ...light, x1: midX }, frame * 0.6, cols, rows),
        ...sash({ ...light, x0: midX }, frame * 0.6, cols, rows),
      )
      out.push(line([midX, light.yTop], [midX, light.yBottom], { strokeWidth: WEIGHT.projected }))
      break
    }
    case 'casement': {
      if (opening.casementStyle === 'french') {
        const midX = (light.x0 + light.x1) / 2
        const left: Rect = { ...light, x1: midX }
        const right: Rect = { ...light, x0: midX }
        out.push(...sash(left, frame * 0.6, cols, rows), ...swingV(left, 'left'))
        out.push(...sash(right, frame * 0.6, cols, rows), ...swingV(right, 'right'))
      } else {
        out.push(...sash(light, frame * 0.6, cols, rows), ...swingV(light, opening.hingesSide ?? 'left'))
      }
      break
    }
    case 'awning':
      out.push(...sash(light, frame * 0.6, cols, rows), ...swingV(light, 'top'))
      break
    case 'hopper':
      out.push(...sash(light, frame * 0.6, cols, rows), ...swingV(light, 'bottom'))
      break
    case 'louvered': {
      out.push(rect(light, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.detail }))
      const slat = 0.1
      for (let y = light.yTop + slat; y < light.yBottom; y += slat) {
        out.push(line([light.x0, y], [light.x1, y], { strokeWidth: WEIGHT.detail }))
      }
      break
    }
    default:
      // fixed / picture / bay / bow — one glazed light with its grid.
      out.push(...glazing(light, cols, rows))
      break
  }
  if (opening.hasSill) {
    // Sill projects past the casing on each side.
    const y = outer.yBottom
    out.push(
      rect(
        { x0: outer.x0 - CASING - 0.02, x1: outer.x1 + CASING + 0.02, yTop: y, yBottom: y + 0.04 },
        { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.projected },
      ),
    )
  }
  return out
}

/** One door leaf with its panel / glass rows. */
function leaf(r: Rect, opening: Opening, glazedDefault: boolean): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = [
    rect(r, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.projected }),
  ]
  const stile = Math.min(0.11, width(r) / 5)
  const inner = inset(r, stile)
  const segments = opening.segments ?? []
  if (segments.length > 0) {
    const rows = splitByRatios(
      inner.yTop,
      inner.yBottom,
      segments.map((s) => s.heightRatio),
    )
    segments.forEach((segment, i) => {
      const [yTop, yBottom] = rows[i]!
      const row: Rect = { x0: inner.x0, x1: inner.x1, yTop, yBottom }
      const cols = splitByRatios(row.x0, row.x1, segment.columnRatios)
      for (const [x0, x1] of cols) {
        const cell = inset({ x0, x1, yTop: row.yTop, yBottom: row.yBottom }, 0.02)
        if (width(cell) <= 1e-4 || height(cell) <= 1e-4) continue
        if (segment.type === 'glass') out.push(...glazing(cell, [1], [1]))
        else if (segment.type === 'panel') {
          out.push(rect(cell, { fill: PANEL, stroke: INK, strokeWidth: WEIGHT.detail }))
        }
      }
    })
  } else if (glazedDefault) {
    out.push(...glazing(inner, [1, 1], [1, 1, 1, 1, 1]))
  } else {
    // Six-panel leaf — the default hinged door reads as a door, not a slab.
    const cols = splitByRatios(inner.x0, inner.x1, [1, 1])
    const rows = splitByRatios(inner.yTop, inner.yBottom, [1, 1.4, 1.4])
    for (const [x0, x1] of cols) {
      for (const [yTop, yBottom] of rows) {
        const cell = inset({ x0, x1, yTop, yBottom }, 0.035)
        if (width(cell) > 1e-4 && height(cell) > 1e-4) {
          out.push(rect(cell, { fill: PANEL, stroke: INK, strokeWidth: WEIGHT.detail }))
        }
      }
    }
  }
  return out
}

export function doorGlyph(opening: Opening, outer: Rect): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  if (opening.construction !== 'masonry') {
    out.push(
      rect(
        { x0: outer.x0 - CASING, x1: outer.x1 + CASING, yTop: outer.yTop - CASING, yBottom: outer.yBottom },
        { fill: 'none', stroke: INK, strokeWidth: WEIGHT.detail },
      ),
    )
  }
  // Frame / jambs.
  out.push(rect(outer, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.projected }))
  if (opening.openingKind === 'opening') {
    // A cased opening: no leaf, the wall beyond shows through.
    out.push(rect(inset(outer, opening.frameThickness), { fill: '#ffffff', stroke: INK, strokeWidth: WEIGHT.detail }))
    return out
  }
  const jamb = Math.min(opening.frameThickness, width(outer) / 8)
  const leafBox: Rect = { x0: outer.x0 + jamb, x1: outer.x1 - jamb, yTop: outer.yTop + jamb, yBottom: outer.yBottom }
  const type = opening.doorType ?? 'hinged'
  const leaves = Math.max(1, opening.leafCount ?? (type === 'double' || type === 'french' || type === 'sliding' ? 2 : 1))
  if (type.startsWith('garage')) {
    // Sectional: four horizontal sections of raised panels; roll-up: slats.
    out.push(rect(leafBox, { fill: LEAF, stroke: INK, strokeWidth: WEIGHT.projected }))
    if (type === 'garage-rollup') {
      const slat = 0.18
      for (let y = leafBox.yTop + slat; y < leafBox.yBottom; y += slat) {
        out.push(line([leafBox.x0, y], [leafBox.x1, y], { strokeWidth: WEIGHT.detail }))
      }
    } else {
      const sections = splitByRatios(leafBox.yTop, leafBox.yBottom, [1, 1, 1, 1])
      const panelsAcross = Math.max(2, Math.round(width(leafBox) / 0.6))
      sections.forEach(([yTop, yBottom], row) => {
        out.push(line([leafBox.x0, yTop], [leafBox.x1, yTop], { strokeWidth: WEIGHT.detail }))
        const cols = splitByRatios(leafBox.x0, leafBox.x1, new Array(panelsAcross).fill(1))
        for (const [x0, x1] of cols) {
          const cell = inset({ x0, x1, yTop, yBottom }, 0.06)
          if (width(cell) <= 1e-4 || height(cell) <= 1e-4) continue
          // Top section glazed on a sectional door is a common option, but not
          // modelled — every section draws as a raised panel.
          out.push(rect(cell, { fill: row === 0 ? PANEL : PANEL, stroke: INK, strokeWidth: WEIGHT.detail }))
        }
      })
    }
  } else {
    const glazed = type === 'french' || type === 'sliding'
    const parts = splitByRatios(leafBox.x0, leafBox.x1, new Array(leaves).fill(1))
    parts.forEach(([x0, x1], i) => {
      const r: Rect = { x0, x1, yTop: leafBox.yTop, yBottom: leafBox.yBottom }
      out.push(...leaf(r, opening, glazed))
      if (type === 'sliding' && i > 0) {
        out.push(line([x0, r.yTop], [x0, r.yBottom], { strokeWidth: WEIGHT.projected }))
      }
    })
    // Knob / lever on the latch side at the handle height.
    if (opening.handle !== false && type !== 'sliding' && type !== 'pocket') {
      const y = outer.yBottom - (opening.handleHeight ?? 1.05)
      const first = parts[0]!
      const last = parts[parts.length - 1]!
      const xs: number[] = []
      if (leaves >= 2) xs.push(first[1] - 0.06, last[0] + 0.06)
      else xs.push(opening.handleSide === 'left' ? first[0] + 0.07 : first[1] - 0.07)
      for (const x of xs) {
        out.push({ kind: 'circle', cx: x, cy: y, r: 0.022, fill: INK, stroke: 'none' } as FloorplanGeometry)
      }
    }
  }
  // Threshold.
  if (opening.threshold !== false) {
    out.push(
      line([outer.x0 - CASING, outer.yBottom], [outer.x1 + CASING, outer.yBottom], {
        strokeWidth: WEIGHT.projected,
      }),
    )
  }
  return out
}

/**
 * Mark tag above an opening: hexagon for doors, ellipse for windows — the
 * floor plan's own tag shapes — with the mark the schedule prints.
 */
export function openingTag(
  opening: Pick<Opening, 'nodeType' | 'mark'>,
  cx: number,
  yAbove: number,
): FloorplanGeometry[] {
  const mark = opening.mark
  if (!mark) return []
  const h = 0.3
  const w = Math.max(0.42, mark.length * 0.14 + 0.16)
  const cy = yAbove - h / 2 - 0.08
  const out: FloorplanGeometry[] = []
  if (opening.nodeType === 'door') {
    const hex: Vec2[] = [
      [cx - w / 2, cy],
      [cx - w / 4, cy - h / 2],
      [cx + w / 4, cy - h / 2],
      [cx + w / 2, cy],
      [cx + w / 4, cy + h / 2],
      [cx - w / 4, cy + h / 2],
    ]
    out.push(polygon(hex, { fill: '#ffffff', stroke: INK, strokeWidth: WEIGHT.projected }))
  } else {
    const pts: Vec2[] = []
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      pts.push([cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)])
    }
    out.push(polygon(pts, { fill: '#ffffff', stroke: INK, strokeWidth: WEIGHT.projected }))
  }
  out.push({
    kind: 'text',
    x: cx,
    y: cy,
    text: mark,
    fontSize: 0.15,
    fill: INK,
    fontWeight: 700,
    textAnchor: 'middle',
    dominantBaseline: 'central',
  } as FloorplanGeometry)
  return out
}
