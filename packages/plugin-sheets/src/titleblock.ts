/**
 * The sheet border and title block, as core geometry primitives.
 *
 * Everything here is emitted in SHEET INCHES with y running down and the
 * origin at the paper's top-left corner — the same coordinate space the
 * screen SVG and the PDF page both use, so the title block on screen and the
 * title block in the PDF are literally the same primitives (`FloorplanGeometry`,
 * `packages/core/src/registry/types.ts:364+`) rendered by two back ends.
 *
 * LAYOUT. The strip follows the PlanCrafters sheet (app/js/sheets.js
 * `S._titleBlock`, `S.TB_W = 3.4`): a 3.4-inch strip on ARCH D, centred
 * text, and the same row order top to bottom — firm plate, designer,
 * PROJECT (name wrapped to two balanced lines when long, then the address),
 * OWNER / JURISDICTION / APN, DATE / SCALE, a flexible REVISIONS area that
 * also carries the preliminary stamp, then the sheet title and the big sheet
 * number with "SHEET n OF m" under it. Type is IBM Plex Sans / Plex Mono
 * with system fallbacks, the family the PlanCrafters sheets are set in.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { jurisdictionLine, type SiteAddressFallback } from './model'
import type { ProjectRecordNode } from './schema'
import { scaleLabel } from './scale'

export const INK = '#111827'
export const INK_SOFT = '#6b7280'
export const PAPER = '#ffffff'
export const RULE = '#111827'
export const STAMP_RED = '#b91c1c'

export const SANS = '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif'
export const MONO = '"IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace'

export type TitleBlockInput = {
  widthIn: number
  heightIn: number
  number: string
  title: string
  record: ProjectRecordNode | undefined
  /** Address fallback from the site node when the record has none typed in. */
  addressFallback?: SiteAddressFallback
  /** The date this sheet was composed (ISO), printed when the record has no date typed in. */
  plotDate?: string
  /** Printed in the scale field; a sheet with mixed scales says "AS NOTED". */
  scaleText?: string
  /** The whole set, for the cover sheet's index. */
  sheetIndex?: { number: string; title: string }[]
  /** 1-based position of this sheet in the set, and the set size. */
  sheetOrdinal?: number
  sheetCount?: number
}

export type TitleBlockLayout = {
  /** The drawing area left of the title block, in inches. */
  frame: { x: number; y: number; w: number; h: number }
}

const MARGIN_IN = 0.5
/** PlanCrafters `S.TB_W` on ARCH D; scaled for smaller paper, never wider. */
export function titleBlockWidth(widthIn: number): number {
  return Math.min(3.4, Math.max(2.6, widthIn * (3.4 / 36)))
}

/** Where viewports may live: inside the border, left of the title block. */
export function sheetFrame(widthIn: number, heightIn: number): TitleBlockLayout['frame'] {
  const tb = titleBlockWidth(widthIn)
  return {
    x: MARGIN_IN + 0.1,
    y: MARGIN_IN + 0.1,
    w: widthIn - MARGIN_IN * 2 - tb - 0.2,
    h: heightIn - MARGIN_IN * 2 - 0.2,
  }
}

type TextOpts = {
  weight?: number
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
  family?: string
  opacity?: number
}

function text(x: number, y: number, value: string, size: number, opts: TextOpts = {}): FloorplanGeometry {
  return {
    kind: 'text',
    x,
    y,
    text: value,
    fontSize: size,
    fill: opts.fill ?? INK,
    fontWeight: opts.weight ?? 400,
    fontFamily: opts.family ?? SANS,
    textAnchor: opts.anchor ?? 'start',
    dominantBaseline: 'alphabetic',
    opacity: opts.opacity,
  }
}

function line(x1: number, y1: number, x2: number, y2: number, width = 0.008): FloorplanGeometry {
  return { kind: 'line', x1, y1, x2, y2, stroke: RULE, strokeWidth: width }
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; strokeWidth?: number } = {},
): FloorplanGeometry {
  return {
    kind: 'rect',
    x,
    y,
    width: w,
    height: h,
    fill: opts.fill ?? 'none',
    stroke: opts.stroke ?? 'none',
    strokeWidth: opts.strokeWidth ?? 0.008,
  }
}

/** Approximate set width of a Plex Sans string, inches, for wrapping and shrink-to-fit. */
function measure(value: string, size: number, weight = 400): number {
  const k = weight >= 700 ? 0.58 : 0.54
  return value.length * size * k
}

/** Shrink a size until the string fits `maxW`, never below 55 % (sheets.js R162). */
function fit(value: string, size: number, maxW: number, weight = 400): number {
  let s = size
  for (let k = 0; k < 6 && measure(value, s, weight) > maxW; k++) {
    s *= Math.max(0.55, maxW / measure(value, s, weight))
  }
  return s
}

/** Balanced two-line wrap (sheets.js `wrap2`) — a long name reads better on two lines than shrunk. */
function wrap2(value: string): string[] {
  const words = value.trim().split(/\s+/)
  if (words.length < 2) return [value]
  let best: string[] = [value]
  let bestD = Number.POSITIVE_INFINITY
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const d = Math.abs(a.length - b.length)
    if (d < bestD) {
      bestD = d
      best = [a, b]
    }
  }
  return best
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

export function addressLines(input: TitleBlockInput): string[] {
  const a = input.record?.identity?.address
  const fb = input.addressFallback
  const street = a?.street || fb?.street || ''
  const city = a?.city || fb?.city || ''
  const state = a?.state || fb?.state || ''
  const zip = a?.zip || fb?.zip || ''
  const second = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, second].filter(Boolean)
}

export function apnOf(input: TitleBlockInput): string {
  return input.record?.identity?.apn || input.addressFallback?.apn || ''
}

/**
 * The border and the title block. A cover sheet also gets the sheet index in
 * the strip's flexible area.
 */
export function buildTitleBlock(input: TitleBlockInput): FloorplanGeometry[] {
  const { widthIn: W, heightIn: H, record } = input
  const out: FloorplanGeometry[] = []
  const tbw = titleBlockWidth(W)
  const x0 = W - MARGIN_IN - tbw
  const y0 = MARGIN_IN
  const h = H - MARGIN_IN * 2
  const cx = x0 + tbw / 2
  const left = x0 + 0.18
  const right = x0 + tbw - 0.18
  const innerW = tbw - 0.36
  const k = tbw / 3.4 // row scale for smaller paper

  // Paper + border + strip.
  out.push(rect(0, 0, W, H, { fill: PAPER }))
  out.push(rect(MARGIN_IN, MARGIN_IN, W - MARGIN_IN * 2, H - MARGIN_IN * 2, { strokeWidth: 0.02 }))
  out.push(rect(x0, y0, tbw, h, { strokeWidth: 0.02 }))
  const hr = (yy: number) => out.push(line(x0, yy, x0 + tbw, yy, 0.012))
  const centered = (value: string, yy: number, size: number, weight = 400, family = SANS, fill = INK) => {
    const s = fit(value, size, innerW, weight)
    out.push(text(cx, yy + s * 0.36, value, s, { anchor: 'middle', weight, family, fill }))
  }
  const leftText = (value: string, yy: number, size: number, weight = 400, family = SANS) => {
    const s = fit(value, size, innerW, weight)
    out.push(text(left, yy + s * 0.36, value, s, { weight, family }))
  }

  let y = y0 + 0.55 * k

  // Brand plate: the firm, or the designer when there is no firm yet.
  const firm = record?.firm
  const brand = (firm?.company || record?.designer?.name || 'PASCAL').toUpperCase()
  centered(brand, y, 0.26 * k, 800)
  const sub = (firm?.logoText || (firm?.company ? 'S T U D I O' : 'D E S I G N')).toUpperCase()
  centered(sub, y + 0.34 * k, 0.15 * k, 500)
  const contact = [firm?.phone, firm?.email].filter(Boolean).join('   ')
  if (contact) centered(contact, y + 0.58 * k, 0.09 * k, 400, SANS, INK_SOFT)
  y += (contact ? 0.92 : 0.78) * k
  hr(y)

  // Designer / firm line.
  y += 0.3 * k
  const designer = [record?.designer?.name, record?.designer?.license].filter(Boolean).join('  ·  ')
  centered((designer || 'DESIGNER').toUpperCase(), y, 0.16 * k, 600)
  y += 0.3 * k
  hr(y)

  // PROJECT.
  y += 0.34 * k
  leftText('PROJECT', y, 0.12 * k, 700, MONO)
  const name = record?.identity?.projectName || 'Untitled project'
  const nameLines = measure(name, 0.19 * k, 700) > innerW ? wrap2(name) : [name]
  const addr = addressLines(input)
  if (nameLines.length === 2) {
    centered(nameLines[0] ?? '', y + 0.22 * k, 0.15 * k, 700)
    centered(nameLines[1] ?? '', y + 0.42 * k, 0.15 * k, 700)
    addr.forEach((l, i) => centered(l, y + (0.74 + i * 0.19) * k, 0.14 * k))
    if (addr.length === 0) centered('—', y + 0.74 * k, 0.14 * k)
  } else {
    centered(nameLines[0] ?? '', y + 0.3 * k, 0.19 * k, 700)
    addr.forEach((l, i) => centered(l, y + (0.62 + i * 0.19) * k, 0.14 * k))
    if (addr.length === 0) centered('—', y + 0.62 * k, 0.14 * k)
  }
  y += (1.16 + (addr.length > 1 ? 0.1 : 0)) * k
  hr(y)

  // OWNER / JURISDICTION / APN.
  y += 0.26 * k
  const jurisdiction = jurisdictionLine(record, input.addressFallback)
  leftText(`OWNER: ${record?.owner?.name || '—'}`, y, 0.13 * k)
  leftText(`JURISDICTION: ${jurisdiction || '—'}`, y + 0.26 * k, 0.13 * k)
  leftText(`APN: ${apnOf(input) || '—'}`, y + 0.52 * k, 0.13 * k)
  y += 0.82 * k
  hr(y)

  // DATE / SCALE.
  y += 0.26 * k
  const date = record?.date || (input.plotDate ? `${input.plotDate} (PLOT DATE)` : '')
  leftText(`DATE: ${date || '—'}`, y, 0.13 * k)
  leftText(`SCALE: ${input.scaleText || 'AS NOTED'}`, y + 0.26 * k, 0.13 * k)
  if (record?.drawnBy) leftText(`DRAWN BY: ${record.drawnBy}`, y + 0.52 * k, 0.13 * k)
  y += (record?.drawnBy ? 0.82 : 0.56) * k
  hr(y)

  // REVISIONS (flexible) — with the preliminary stamp box, PlanCrafters style.
  const nbY = y0 + h - 2.4 * k
  y += 0.24 * k
  leftText('REVISIONS', y, 0.12 * k, 700, MONO)
  let ry = y + 0.28 * k
  const revisions = record?.revisions ?? []
  for (const r of revisions.slice(0, 6)) {
    if (ry > nbY - 0.3 * k) break
    out.push(text(left, ry + 0.04, r.id || '·', 0.1 * k, { weight: 700 }))
    out.push(text(left + 0.38 * k, ry + 0.04, truncate(r.description, 22), 0.1 * k))
    out.push(text(right, ry + 0.04, r.date, 0.1 * k, { anchor: 'end', fill: INK_SOFT }))
    ry += 0.2 * k
  }
  const status = record?.documentStatus ?? 'preliminary'
  if (status === 'preliminary' && nbY - ry > 1.7 * k) {
    const sy = ry + 0.16 * k
    const sh = 1.45 * k
    out.push(rect(x0 + 0.14, sy, tbw - 0.28, sh, { stroke: STAMP_RED, strokeWidth: 0.02 }))
    const sx = x0 + 0.26
    out.push(text(sx, sy + 0.34 * k, 'PRELIMINARY', 0.2 * k, { weight: 800, fill: STAMP_RED }))
    out.push(text(sx, sy + 0.6 * k, 'NOT FOR CONSTRUCTION', 0.17 * k, { weight: 800, fill: STAMP_RED }))
    const lines = [
      'Not reviewed or sealed. Verify every',
      'dimension in the field before work.',
      'Issue for permit sets the final status.',
    ]
    lines.forEach((ln, i) =>
      out.push(text(sx, sy + (0.92 + i * 0.17) * k, ln, 0.095 * k, { weight: 600, fill: STAMP_RED })),
    )
    ry = sy + sh
  }

  // Sheet index (cover sheets) in what is left of the flexible area.
  if (input.sheetIndex && input.sheetIndex.length > 0) {
    let iy = ry + 0.3 * k
    if (iy < nbY - 0.6 * k) {
      leftText('SHEET INDEX', iy, 0.12 * k, 700, MONO)
      iy += 0.24 * k
      const pitch = Math.max(
        0.15 * k,
        Math.min(0.2 * k, (nbY - 0.15 * k - iy) / Math.max(1, input.sheetIndex.length)),
      )
      for (const s of input.sheetIndex) {
        if (iy > nbY - 0.12 * k) break
        out.push(text(left, iy, s.number, pitch * 0.62, { weight: 700, family: MONO }))
        out.push(text(left + 0.62 * k, iy, truncate(s.title.toUpperCase(), 30), pitch * 0.58, { fill: INK_SOFT }))
        iy += pitch
      }
    }
  }

  // Sheet title + number (bottom).
  hr(nbY)
  centered(input.title.toUpperCase(), nbY + 0.42 * k, 0.2 * k, 700)
  hr(nbY + 0.9 * k)
  // The number sits high enough that "SHEET n OF m" clears its baseline in
  // print, where the display face falls back to a wider Helvetica Bold.
  out.push(
    text(cx, nbY + 1.72 * k, input.number, 0.85 * k, {
      anchor: 'middle',
      weight: 800,
      family: '"Big Shoulders Display", "IBM Plex Sans", Helvetica, Arial, sans-serif',
    }),
  )
  if (input.sheetOrdinal && input.sheetCount) {
    out.push(
      text(cx, y0 + h - 0.14 * k, `SHEET ${input.sheetOrdinal} OF ${input.sheetCount}`, 0.11 * k, {
        anchor: 'middle',
        family: MONO,
      }),
    )
  }

  return out
}

/**
 * "PRELIMINARY — NOT FOR CONSTRUCTION" laid diagonally across the drawing
 * area. Drawn OVER the viewports, not under them — a stamp under a floor plan
 * is not a stamp. Light, so the drawing stays legible (the strip carries the
 * full-strength stamp).
 */
export function buildStatusStamp(input: TitleBlockInput): FloorplanGeometry[] {
  if ((input.record?.documentStatus ?? 'preliminary') !== 'preliminary') return []
  const frame = sheetFrame(input.widthIn, input.heightIn)
  return [
    {
      kind: 'group',
      transform: {
        translate: [frame.x + frame.w / 2, frame.y + frame.h / 2],
        rotate: -Math.atan2(frame.h, frame.w),
      },
      children: [
        text(0, 0, 'PRELIMINARY — NOT FOR CONSTRUCTION', Math.min(frame.w / 17, 1.4), {
          anchor: 'middle',
          weight: 700,
          fill: '#dc2626',
          opacity: 0.12,
        }),
      ],
    },
  ]
}

/** The label strip under a viewport: "1  FLOOR PLAN — LEVEL 1   1/4" = 1'-0"". */
export function buildViewportLabel(
  index: number,
  title: string,
  scale: number | undefined,
  x: number,
  y: number,
  w: number,
  northDeg?: number,
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  out.push({ kind: 'circle', cx: x + 0.17, cy: y - 0.11, r: 0.17, fill: 'none', stroke: INK, strokeWidth: 0.014 })
  out.push(text(x + 0.17, y - 0.05, String(index), 0.15, { anchor: 'middle', weight: 700 }))
  out.push(text(x + 0.46, y, title.toUpperCase(), 0.16, { weight: 700 }))
  if (scale) {
    out.push(text(x + w, y, scaleLabel(scale), 0.12, { anchor: 'end', fill: INK_SOFT, weight: 600, family: MONO }))
  }
  if (typeof northDeg === 'number' && Number.isFinite(northDeg)) {
    // North arrow after the title: the drafting convention puts one beside
    // every plan title (the reference set's "Proposed 1st Floor Plan" ⊕).
    const titleWidth = Math.min(w - 1.2, 0.46 + title.length * 0.105)
    out.push(...northArrowGlyph(x + titleWidth + 0.55, y - 0.1, 0.24, northDeg))
  }
  out.push(line(x, y + 0.09, x + w, y + 0.09, 0.018))
  out.push(line(x, y + 0.13, x + w, y + 0.13, 0.006))
  return out
}

/**
 * The standard north arrow: a circle, a filled half-arrow pointing at true
 * north, and an "N". `deg` is clockwise from paper-up. Sheet inches.
 */
export function northArrowGlyph(cx: number, cy: number, r: number, deg: number): FloorplanGeometry[] {
  const a = (deg * Math.PI) / 180
  const rot = (dx: number, dy: number): readonly [number, number] => [
    cx + dx * Math.cos(a) - dy * Math.sin(a),
    cy + dx * Math.sin(a) + dy * Math.cos(a),
  ]
  const tip = rot(0, -r * 0.92)
  const tail = rot(0, r * 0.55)
  const left = rot(-r * 0.3, r * 0.25)
  const right = rot(r * 0.3, r * 0.25)
  const nAt = rot(0, -r * 1.35)
  return [
    { kind: 'circle', cx, cy, r, fill: 'none', stroke: INK, strokeWidth: 0.012 },
    { kind: 'polygon', points: [tip, left, tail], fill: INK, stroke: INK, strokeWidth: 0.006 },
    { kind: 'polygon', points: [tip, right, tail], fill: 'none', stroke: INK, strokeWidth: 0.008 },
    text(nAt[0], nAt[1] + 0.04, 'N', 0.11, { anchor: 'middle', weight: 700 }),
  ]
}
