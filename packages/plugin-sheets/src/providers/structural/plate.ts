/**
 * PLATE geometry for the S-series — paper, not model.
 *
 * Everything here is in ABSOLUTE SHEET INCHES inside the viewport box the
 * host hands the provider (`args.viewport`). Plates carry the parts of a
 * structural sheet that are typeset rather than drawn: schedules, legends and
 * the numbered note blocks that make the sheet enforceable.
 *
 * The note blocks FLOW: a note list is wrapped to the column width, split
 * across as many columns as the box needs, and anything that still does not
 * fit is reported as an overflow line rather than silently clipped — the
 * house rule for this package (see `draw-table.ts`).
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { drawTable, tableHeight } from '../../draw-table'
import type { ScheduleTable } from '../../schedule'
import { INK, INK_SOFT, MONO, SANS } from '../../titleblock'

export type Box = { x: number; y: number; w: number; h: number }

/**
 * Average glyph advance as a fraction of the em. Helvetica / IBM Plex Sans
 * average about 0.50 for mixed-case prose; 0.58 buys a margin so a line
 * measured here still fits when the PDF back end picks a wider fallback.
 */
const CHAR = 0.58
const MONO_CHAR = 0.62

/**
 * Target column width, inches. A structural notes column on a real sheet is
 * about 4-5 in wide — long enough for a sentence, short enough to scan — so
 * a wide plate splits into as many of those as it holds rather than printing
 * one 19-inch line.
 */
const TARGET_COLUMN = 4.6

/** How many note columns a box of this width should use. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.min(4, Math.round(width / TARGET_COLUMN)))
}

/** Greedy word wrap to a pixel width, in the sheet's own font metrics. */
export function wrap(text: string, width: number, size: number, mono = false): string[] {
  const max = Math.max(8, Math.floor(width / (size * (mono ? MONO_CHAR : CHAR))))
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (candidate.length <= max) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      line = word.length <= max ? word : word.slice(0, max)
    }
    out.push(line)
  }
  return out
}

/** A plate heading: bold caps with a heavy rule under it. Returns its height. */
export function heading(
  box: Box,
  title: string,
  subtitle?: string,
): { geometry: FloorplanGeometry[]; height: number } {
  const geometry: FloorplanGeometry[] = [
    {
      kind: 'text',
      x: box.x,
      y: box.y + 0.18,
      text: title.toUpperCase(),
      fontSize: 0.2,
      fill: INK,
      fontWeight: 800,
      fontFamily: SANS,
    },
    {
      kind: 'line',
      x1: box.x,
      y1: box.y + 0.27,
      x2: box.x + box.w,
      y2: box.y + 0.27,
      stroke: INK,
      strokeWidth: 0.02,
    },
  ]
  let height = 0.36
  if (subtitle) {
    for (const [i, part] of wrap(subtitle, box.w, 0.1).entries()) {
      geometry.push({
        kind: 'text',
        x: box.x,
        y: box.y + 0.4 + i * 0.13,
        text: part,
        fontSize: 0.1,
        fill: INK_SOFT,
        fontFamily: SANS,
      })
      height = 0.44 + i * 0.13
    }
    height += 0.08
  }
  return { geometry, height }
}

export type Note = {
  /** The note body. */
  text: string
  /** Code citation printed on its own, e.g. 'IRC R403.1.6'. */
  cite?: string
}

/**
 * A numbered, cited note block flowed into `columns` columns.
 *
 * Every note that carries a citation prints it — that is the whole point of
 * these sheets: a number on the paper that no one can trace is a number no
 * plan checker can accept.
 */
export function notesBlock(
  box: Box,
  notes: readonly Note[],
  options: { columns?: number; size?: number; startAt?: number } = {},
): FloorplanGeometry[] {
  const size = options.size ?? 0.098
  const lead = size * 1.32
  const columns = Math.max(1, options.columns ?? columnsFor(box.w))
  const gutter = 0.3
  const colW = (box.w - gutter * (columns - 1)) / columns
  const numberW = 0.28
  const bodyW = colW - numberW
  const capacity = Math.max(1, Math.floor(box.h / lead))

  type Line = { text: string; number?: string; cite?: boolean }
  // Each note is ONE block: its wrapped body plus its citation. Blocks are
  // never split across a column boundary — an IRC citation stranded at the
  // top of the next column belongs to nothing a reader can see.
  const blocks: Line[][] = notes.map((note, index) => {
    const block: Line[] = []
    const label = `${(options.startAt ?? 1) + index}.`
    wrap(note.text, bodyW, size).forEach((part, i) => {
      block.push({ text: part, number: i === 0 ? label : undefined })
    })
    if (note.cite) {
      for (const part of wrap(note.cite, bodyW, size * 0.94)) block.push({ text: part, cite: true })
    }
    return block
  })
  const lines: Line[] = blocks.flat()

  // Balance: when everything fits, aim for an even split instead of filling
  // the first column to the bottom and leaving the rest of the plate blank.
  const withGaps = lines.length + Math.max(0, blocks.length - 1)
  const target =
    withGaps <= capacity * columns
      ? Math.min(capacity, Math.max(1, Math.ceil(withGaps / columns)))
      : capacity

  const placed: { line: Line; col: number; row: number }[] = []
  let col = 0
  let row = 0
  let dropped = 0
  for (const block of blocks) {
    if (row > 0 && row + block.length > target && col < columns - 1) {
      col += 1
      row = 0
    }
    if (row + block.length > capacity && col < columns - 1) {
      col += 1
      row = 0
    }
    if (row + block.length > capacity) {
      dropped += block.length
      continue
    }
    for (const line of block) {
      placed.push({ line, col, row })
      row += 1
    }
    row += 1
  }

  const out: FloorplanGeometry[] = []
  for (const { line: entry, col: c, row: r } of placed) {
    const x = box.x + c * (colW + gutter)
    const y = box.y + (r + 1) * lead - size * 0.28
    if (entry.text === '') continue
    if (entry.number) {
      out.push({
        kind: 'text',
        x,
        y,
        text: entry.number,
        fontSize: size,
        fill: INK,
        fontWeight: 700,
        fontFamily: MONO,
      })
    }
    out.push({
      kind: 'text',
      x: x + numberW,
      y,
      text: entry.text,
      fontSize: entry.cite ? size * 0.94 : size,
      fill: entry.cite ? INK_SOFT : INK,
      fontWeight: entry.cite ? 600 : 400,
      fontFamily: entry.cite ? MONO : SANS,
    })
  }
  if (dropped > 0) {
    out.push({
      kind: 'text',
      x: box.x,
      y: box.y + box.h - 0.04,
      text: `+${dropped} more note lines — enlarge this viewport`,
      fontSize: 0.09,
      fill: '#b45309',
      fontFamily: SANS,
    })
  }
  return out
}

export type LegendEntry = {
  label: string
  /** How the symbol is drawn in the swatch cell. */
  symbol:
    | { kind: 'line'; dash?: string; width: number; color?: string }
    | { kind: 'double-line'; dash?: string; width: number }
    | { kind: 'dot'; color?: string }
    | { kind: 'square'; color?: string }
    | { kind: 'hatch' }
    | { kind: 'hex'; text?: string }
    | { kind: 'circle'; text?: string }
    | { kind: 'arrow' }
  note?: string
}

/**
 * A legend plate: swatch, label, optional note. A legend entry is only worth
 * printing for a symbol the drawing ACTUALLY uses, so the callers build the
 * list from what they drew (the rule `drawings.ts` applies to the site-plan
 * utilities legend).
 */
export function legendBlock(box: Box, entries: readonly LegendEntry[]): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const rowH = 0.3
  const swatchW = 0.92
  const capacity = Math.max(0, Math.floor(box.h / rowH))
  const shown = entries.slice(0, capacity)
  shown.forEach((entry, i) => {
    const cy = box.y + i * rowH + rowH / 2
    const x0 = box.x + 0.05
    const x1 = box.x + swatchW
    switch (entry.symbol.kind) {
      case 'line':
        out.push({
          kind: 'line',
          x1: x0,
          y1: cy,
          x2: x1,
          y2: cy,
          stroke: entry.symbol.color ?? INK,
          strokeWidth: entry.symbol.width,
          ...(entry.symbol.dash ? { strokeDasharray: entry.symbol.dash } : {}),
        })
        break
      case 'double-line':
        for (const dy of [-0.045, 0.045]) {
          out.push({
            kind: 'line',
            x1: x0,
            y1: cy + dy,
            x2: x1,
            y2: cy + dy,
            stroke: INK,
            strokeWidth: entry.symbol.width,
            ...(entry.symbol.dash ? { strokeDasharray: entry.symbol.dash } : {}),
          })
        }
        break
      case 'dot': {
        const fill = entry.symbol.color ?? INK
        out.push({
          kind: 'circle',
          cx: (x0 + x1) / 2,
          cy,
          r: 0.055,
          fill,
          stroke: fill === '#ffffff' ? INK : 'none',
          strokeWidth: fill === '#ffffff' ? 0.01 : 0,
        })
        break
      }
      case 'square': {
        // A white swatch on white paper is not a swatch: outline it.
        const fill = entry.symbol.color ?? INK
        out.push({
          kind: 'rect',
          x: (x0 + x1) / 2 - 0.058,
          y: cy - 0.058,
          width: 0.116,
          height: 0.116,
          fill,
          stroke: fill === '#ffffff' ? INK : 'none',
          strokeWidth: fill === '#ffffff' ? 0.01 : 0,
        })
        break
      }
      case 'hatch':
        out.push({
          kind: 'rect',
          x: x0,
          y: cy - 0.09,
          width: x1 - x0,
          height: 0.18,
          fill: 'none',
          stroke: INK,
          strokeWidth: 0.008,
        })
        for (let t = 0; t < x1 - x0 + 0.18; t += 0.07) {
          const ax = x0 + t
          const ay = cy - 0.09
          const bx = x0 + t - 0.18
          const by = cy + 0.09
          if (bx > x1 || ax < x0) continue
          out.push({
            kind: 'line',
            x1: ax,
            y1: ay,
            x2: bx,
            y2: by,
            stroke: INK,
            strokeWidth: 0.005,
          })
        }
        break
      case 'hex':
      case 'circle': {
        const cx = (x0 + x1) / 2
        const r = 0.1
        if (entry.symbol.kind === 'circle') {
          out.push({ kind: 'circle', cx, cy, r, fill: '#ffffff', stroke: INK, strokeWidth: 0.01 })
        } else {
          const pts: [number, number][] = []
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k - Math.PI / 2
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
          }
          out.push({
            kind: 'polygon',
            points: pts,
            fill: '#ffffff',
            stroke: INK,
            strokeWidth: 0.01,
          })
        }
        out.push({
          kind: 'text',
          x: cx,
          y: cy + 0.037,
          text: entry.symbol.text ?? '#',
          fontSize: 0.1,
          fill: INK,
          fontWeight: 700,
          fontFamily: MONO,
          textAnchor: 'middle',
        })
        break
      }
      case 'arrow':
        out.push({
          kind: 'line',
          x1: x0 + 0.08,
          y1: cy,
          x2: x1 - 0.08,
          y2: cy,
          stroke: INK,
          strokeWidth: 0.014,
        })
        for (const [tip, back] of [
          [x0 + 0.02, x0 + 0.12],
          [x1 - 0.02, x1 - 0.12],
        ]) {
          out.push({
            kind: 'polygon',
            points: [
              [tip as number, cy],
              [back as number, cy - 0.038],
              [back as number, cy + 0.038],
            ],
            fill: INK,
            stroke: 'none',
          })
        }
        break
    }
    out.push({
      kind: 'text',
      x: box.x + swatchW + 0.16,
      y: cy + 0.037,
      text: entry.label,
      fontSize: 0.1,
      fill: INK,
      fontWeight: 600,
      fontFamily: SANS,
    })
    if (entry.note) {
      const noteLines = wrap(entry.note, box.w - swatchW - 0.2, 0.085)
      out.push({
        kind: 'text',
        x: box.x + swatchW + 0.16,
        y: cy + 0.16,
        text: noteLines[0] ?? '',
        fontSize: 0.085,
        fill: INK_SOFT,
        fontFamily: SANS,
      })
    }
  })
  if (entries.length > shown.length) {
    out.push({
      kind: 'text',
      x: box.x,
      y: box.y + box.h - 0.03,
      text: `+${entries.length - shown.length} more legend entries — enlarge this viewport`,
      fontSize: 0.09,
      fill: '#b45309',
      fontFamily: SANS,
    })
  }
  return out
}

/**
 * Stack a list of blocks down a plate box, each measured by its own height,
 * and stop honestly when the box runs out.
 */
export function stack(
  box: Box,
  blocks: readonly { height: number; render: (at: Box) => FloorplanGeometry[]; label: string }[],
  gap = 0.34,
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  let y = box.y
  const dropped: string[] = []
  for (const block of blocks) {
    if (y + block.height > box.y + box.h + 0.001) {
      dropped.push(block.label)
      continue
    }
    out.push(...block.render({ x: box.x, y, w: box.w, h: block.height }))
    y += block.height + gap
  }
  if (dropped.length > 0) {
    out.push({
      kind: 'text',
      x: box.x,
      y: box.y + box.h - 0.03,
      text: `Not shown here (no room): ${dropped.join(', ')}`,
      fontSize: 0.09,
      fill: '#b45309',
      fontFamily: SANS,
    })
  }
  return out
}

/**
 * A schedule block sized to its rows — for `stack`.
 *
 * `drawTable` prints a table's ISSUES above its own origin, so the block
 * reserves that strip at the top; without it the issues of one table land on
 * top of the block above (caught in the first SN1 render). Issue text is not
 * wrapped by `drawTable` either, so it is clipped to the block width here —
 * the full sentence belongs in a notes block, which does wrap.
 */
export function scheduleBlock(
  table: ScheduleTable,
  title: string,
  legend?: string,
): { height: number; render: (at: Box) => FloorplanGeometry[]; label: string } {
  const issueH = table.issues.length > 0 ? 0.14 + table.issues.length * 0.16 : 0
  const height = issueH + tableHeight(Math.max(1, table.rows.length), true) + 0.06
  return {
    label: title,
    height,
    render: (at) => {
      const clipped: ScheduleTable = {
        ...table,
        issues: table.issues.map((issue) => clip(issue, at.w - 0.3, 0.1)),
      }
      return drawTable(clipped, at.x, at.y + issueH, at.w, at.h - issueH, {
        title,
        legend: legend ? clip(legend, at.w, 0.12) : undefined,
      })
    },
  }
}

/** Trim a single unwrapped line to a width, with an ellipsis. */
export function clip(text: string, width: number, size: number): string {
  const max = Math.max(8, Math.floor(width / (size * CHAR)))
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** A block of cited notes sized to its content — for `stack`. */
export function notesBlockSized(
  title: string,
  notes: readonly Note[],
  columns = 0,
  width = 0,
): { height: number; render: (at: Box) => FloorplanGeometry[]; label: string } {
  const size = 0.098
  const lead = size * 1.32
  const numberW = 0.28
  const w = width || 6
  const cols = columns > 0 ? columns : columnsFor(w)
  const bodyW = Math.max(0.6, (w - 0.3 * (cols - 1)) / cols - numberW)
  // `notesBlock` never splits a note across a column boundary, so a column
  // can overshoot the even split by up to one whole note. Budget for that,
  // or the block silently prints "+N more" and drops the engine flags that
  // are the whole point of these sheets (caught on the roof-notes plate).
  let count = 0
  let longest = 0
  for (const note of notes) {
    const block =
      wrap(note.text, bodyW, size).length +
      (note.cite ? wrap(note.cite, bodyW, size * 0.94).length : 0)
    longest = Math.max(longest, block)
    count += block + 1
  }
  const height = (title ? 0.42 : 0.06) + (Math.ceil(count / cols) + longest) * lead
  return {
    label: title,
    height,
    render: (at) => {
      const head = title ? heading(at, title) : { geometry: [], height: 0.06 }
      return [
        ...head.geometry,
        ...notesBlock({ x: at.x, y: at.y + head.height, w: at.w, h: at.h - head.height }, notes, {
          columns: cols,
        }),
      ]
    },
  }
}

/** A legend sized to its entries — for `stack`. */
export function legendBlockSized(
  title: string,
  entries: readonly LegendEntry[],
): { height: number; render: (at: Box) => FloorplanGeometry[]; label: string } {
  return {
    label: title,
    height: 0.42 + entries.length * 0.3,
    render: (at) => {
      const head = heading(at, title)
      return [
        ...head.geometry,
        ...legendBlock({ x: at.x, y: at.y + head.height, w: at.w, h: at.h - head.height }, entries),
      ]
    },
  }
}
