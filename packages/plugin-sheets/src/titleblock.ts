/**
 * The sheet border and title block, as core geometry primitives.
 *
 * Everything here is emitted in SHEET INCHES with y running down and the
 * origin at the paper's top-left corner — the same coordinate space the
 * screen SVG and the PDF page both use, so the title block on screen and the
 * title block in the PDF are literally the same primitives (`FloorplanGeometry`,
 * `packages/core/src/registry/types.ts:364+`) rendered by two back ends.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { ProjectRecordNode } from './schema'
import { scaleLabel } from './scale'

export const INK = '#111827'
export const INK_SOFT = '#6b7280'
export const PAPER = '#ffffff'
export const RULE = '#111827'

export type TitleBlockInput = {
  widthIn: number
  heightIn: number
  number: string
  title: string
  record: ProjectRecordNode | undefined
  /** Address fallback from the site node when the record has none typed in. */
  addressFallback?: { street: string; city: string; state: string; zip: string; apn: string }
  /** Printed in the scale field; a sheet with mixed scales says "AS NOTED". */
  scaleText?: string
  /** The whole set, for the cover sheet's index. */
  sheetIndex?: { number: string; title: string }[]
}

export type TitleBlockLayout = {
  /** The drawing area left of the title block, in inches. */
  frame: { x: number; y: number; w: number; h: number }
}

const MARGIN_IN = 0.5

export function titleBlockWidth(widthIn: number): number {
  return Math.max(3.2, Math.min(5.5, widthIn * 0.155))
}

/** Where viewports may live: inside the border, left of the title block. */
export function sheetFrame(widthIn: number, heightIn: number): TitleBlockLayout['frame'] {
  const tb = titleBlockWidth(widthIn)
  return {
    x: MARGIN_IN,
    y: MARGIN_IN,
    w: widthIn - MARGIN_IN * 2 - tb,
    h: heightIn - MARGIN_IN * 2,
  }
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  opts: {
    weight?: number
    fill?: string
    anchor?: 'start' | 'middle' | 'end'
    family?: string
    opacity?: number
  } = {},
): FloorplanGeometry {
  return {
    kind: 'text',
    x,
    y,
    text: value,
    fontSize: size,
    fill: opts.fill ?? INK,
    fontWeight: opts.weight ?? 400,
    fontFamily: opts.family ?? 'Helvetica, Arial, sans-serif',
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
 * The border, the title block, and — when the record is still marked
 * preliminary — the diagonal NOT FOR CONSTRUCTION stamp across the drawing
 * area. A cover sheet also gets the sheet index.
 */
export function buildTitleBlock(input: TitleBlockInput): FloorplanGeometry[] {
  const { widthIn: W, heightIn: H, record } = input
  const out: FloorplanGeometry[] = []
  const tbw = titleBlockWidth(W)
  const tbx = W - MARGIN_IN - tbw

  // Paper + border.
  out.push(rect(0, 0, W, H, { fill: PAPER }))
  out.push(rect(MARGIN_IN, MARGIN_IN, W - MARGIN_IN * 2, H - MARGIN_IN * 2, { strokeWidth: 0.02 }))
  out.push(line(tbx, MARGIN_IN, tbx, H - MARGIN_IN, 0.014))

  const left = tbx + 0.16
  const right = W - MARGIN_IN - 0.16
  const inner = right - left
  let y = MARGIN_IN + 0.42

  const rule = () => {
    y += 0.1
    out.push(line(tbx, y, W - MARGIN_IN, y, 0.006))
    y += 0.26
  }
  const field = (caption: string, value: string, size = 0.13) => {
    out.push(text(left, y, caption.toUpperCase(), 0.075, { fill: INK_SOFT, weight: 600 }))
    y += 0.16
    out.push(text(left, y, truncate(value || '—', Math.floor(inner / (size * 0.52))), size))
    y += 0.1
  }

  // Firm plate.
  const firm = record?.firm
  out.push(text(left, y, (firm?.logoText || firm?.company || 'PASCAL').toUpperCase(), 0.21, { weight: 700 }))
  y += 0.2
  const contact = [firm?.phone, firm?.email].filter(Boolean).join('   ')
  if (contact) {
    out.push(text(left, y, contact, 0.085, { fill: INK_SOFT }))
    y += 0.06
  }
  rule()

  field('Project', record?.identity?.projectName || 'Untitled project', 0.15)
  for (const l of addressLines(input)) {
    out.push(text(left, y, truncate(l, 40), 0.105, { fill: INK_SOFT }))
    y += 0.15
  }
  const apn = apnOf(input)
  if (apn) {
    out.push(text(left, y, `APN ${apn}`, 0.095, { fill: INK_SOFT }))
    y += 0.14
  }
  rule()

  field('Owner', record?.owner?.name || '')
  field(
    'Designer',
    [record?.designer?.name, record?.designer?.license].filter(Boolean).join('  ·  '),
  )
  if (record?.engineer?.company) {
    field(
      'Engineer of record',
      [record.engineer.company, record.engineer.license].filter(Boolean).join('  ·  '),
    )
  }
  const j = record?.jurisdiction
  const jurisdiction = [j?.city, j?.county, j?.state].filter(Boolean).join(', ')
  if (jurisdiction) field('Jurisdiction', jurisdiction)
  rule()

  // Revisions.
  out.push(text(left, y, 'REVISIONS', 0.075, { fill: INK_SOFT, weight: 600 }))
  y += 0.18
  const revisions = record?.revisions ?? []
  if (revisions.length === 0) {
    out.push(text(left, y, '—', 0.1, { fill: INK_SOFT }))
    y += 0.16
  } else {
    for (const r of revisions.slice(0, 8)) {
      out.push(text(left, y, r.id || '·', 0.095, { weight: 600 }))
      out.push(text(left + 0.4, y, truncate(r.description, 26), 0.095))
      out.push(text(right, y, r.date, 0.095, { anchor: 'end', fill: INK_SOFT }))
      y += 0.17
    }
  }
  rule()

  // Sheet index, cover sheets only.
  if (input.sheetIndex && input.sheetIndex.length > 0) {
    out.push(text(left, y, 'SHEET INDEX', 0.075, { fill: INK_SOFT, weight: 600 }))
    y += 0.18
    for (const s of input.sheetIndex.slice(0, 24)) {
      out.push(text(left, y, s.number, 0.095, { weight: 600 }))
      out.push(text(left + 0.75, y, truncate(s.title, 28), 0.095, { fill: INK_SOFT }))
      y += 0.16
    }
    rule()
  }

  // Bottom plate: status, date / drawn by / scale, then the sheet identity.
  const bottom = H - MARGIN_IN
  const plate = bottom - 1.85
  out.push(line(tbx, plate, W - MARGIN_IN, plate, 0.006))
  const status = (record?.documentStatus ?? 'preliminary').replace('-', ' ').toUpperCase()
  out.push(text(left, plate + 0.24, status, 0.11, { weight: 700 }))

  const cols = [
    { caption: 'DATE', value: record?.date || '' },
    { caption: 'DRAWN BY', value: record?.drawnBy || '' },
    { caption: 'SCALE', value: input.scaleText || 'AS NOTED' },
  ]
  const colW = inner / cols.length
  cols.forEach((c, i) => {
    const cx = left + colW * i
    out.push(text(cx, plate + 0.55, c.caption, 0.07, { fill: INK_SOFT, weight: 600 }))
    out.push(text(cx, plate + 0.72, truncate(c.value || '—', 14), 0.1))
  })

  out.push(line(tbx, plate + 0.88, W - MARGIN_IN, plate + 0.88, 0.006))
  out.push(text(left, plate + 1.24, truncate(input.title, 30), 0.14, { weight: 600 }))
  out.push(text(right, plate + 1.7, input.number, 0.34, { anchor: 'end', weight: 700 }))

  return out
}

/**
 * "PRELIMINARY — NOT FOR CONSTRUCTION" laid diagonally across the drawing
 * area. Drawn OVER the viewports, not under them — a stamp under a floor plan
 * is not a stamp.
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
          opacity: 0.16,
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
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  out.push({
    kind: 'circle',
    cx: x + 0.16,
    cy: y - 0.11,
    r: 0.16,
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.012,
  })
  out.push(
    text(x + 0.16, y - 0.05, String(index), 0.14, { anchor: 'middle', weight: 700 }),
  )
  out.push(text(x + 0.42, y, title.toUpperCase(), 0.15, { weight: 700 }))
  if (scale) {
    out.push(
      text(x + w, y, scaleLabel(scale), 0.115, { anchor: 'end', fill: INK_SOFT, weight: 600 }),
    )
  }
  out.push(line(x, y + 0.09, x + w, y + 0.09, 0.014))
  return out
}
