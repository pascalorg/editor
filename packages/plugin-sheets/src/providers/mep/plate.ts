/**
 * Paper furniture for the MEP sheets — legends, key blocks and note columns,
 * in ABSOLUTE SHEET INCHES inside the viewport box.
 *
 * These are the boxes that make a trade drawing readable at the counter: a
 * symbols legend that lists ONLY what is actually on the drawing, a key, and
 * a numbered notes column whose every line carries its code citation. The
 * look matches `draw-table.ts` (bold caps heading, heavy rule, 0.115-in body
 * type) so a legend and a schedule on the same sheet read as one document.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { INK, INK_SOFT, MONO, SANS } from '../../titleblock'

export const PLATE_PAPER = '#ffffff'
export const HEADING_H = 0.34
export const ROW_H = 0.22
export const NOTE_LINE_H = 0.155
export const PAD = 0.12

export type Box = { x: number; y: number; w: number; h: number }

/** A bold caps heading with the heavy rule under it. Returns its height. */
export function heading(out: FloorplanGeometry[], box: Box, text: string): number {
  out.push({
    kind: 'text',
    x: box.x,
    y: box.y + 0.155,
    text: text.toUpperCase(),
    fontSize: 0.15,
    fill: INK,
    fontWeight: 800,
    fontFamily: SANS,
  })
  out.push({
    kind: 'line',
    x1: box.x,
    y1: box.y + 0.225,
    x2: box.x + box.w,
    y2: box.y + 0.225,
    stroke: INK,
    strokeWidth: 0.018,
  })
  return HEADING_H
}

/** The thin outline every plate block sits in. */
export function frame(out: FloorplanGeometry[], box: Box): void {
  out.push({
    kind: 'rect',
    x: box.x - PAD,
    y: box.y - PAD,
    width: box.w + PAD * 2,
    height: box.h + PAD * 2,
    fill: PLATE_PAPER,
    stroke: INK,
    strokeWidth: 0.012,
  })
}

/**
 * Wrap `text` to lines of at most `max` characters, hanging-indented under a
 * numbered marker. Character counting rather than metrics: the sheet type is
 * a single size, and an approximate wrap that never overflows beats an exact
 * one that needs a font metrics table on the paper path.
 */
export function wrap(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) out.push(line)
  return out.length > 0 ? out : ['']
}

/** Characters that fit `w` inches at `fontSize` (0.5 em average advance). */
export function charsPerLine(w: number, fontSize: number): number {
  return Math.max(12, Math.floor(w / (fontSize * 0.5)))
}

export type NumberedNote = { text: string }

/**
 * A numbered notes column. Returns the height actually consumed. Notes that
 * do not fit are NOT silently dropped — the caller is told how many were cut
 * through the return value's `overflow`, and prints it.
 */
export function notesColumn(
  out: FloorplanGeometry[],
  box: Box,
  notes: readonly string[],
  fontSize = 0.105,
): { height: number; overflow: number } {
  const cols = charsPerLine(box.w - 0.22, fontSize)
  let y = box.y
  let printed = 0
  for (const [index, note] of notes.entries()) {
    const lines = wrap(note, cols)
    const need = lines.length * NOTE_LINE_H
    if (y + need > box.y + box.h) break
    out.push({
      kind: 'text',
      x: box.x,
      y: y + NOTE_LINE_H - 0.045,
      text: `${index + 1}.`,
      fontSize,
      fill: INK,
      fontWeight: 700,
      fontFamily: MONO,
    })
    lines.forEach((line, i) => {
      out.push({
        kind: 'text',
        x: box.x + 0.22,
        y: y + (i + 1) * NOTE_LINE_H - 0.045,
        text: line,
        fontSize,
        fill: INK,
        fontFamily: SANS,
      })
    })
    y += need
    printed += 1
  }
  return { height: y - box.y, overflow: notes.length - printed }
}

export type LegendRow = {
  /** Symbol geometry in a LOCAL frame, centred on (0,0), in sheet inches. */
  swatch: FloorplanGeometry[]
  label: string
}

/**
 * A symbols legend: one row per symbol, its glyph drawn at the same shape it
 * takes on the plan. Returns the height consumed.
 */
export function legendBlock(
  out: FloorplanGeometry[],
  box: Box,
  rows: readonly LegendRow[],
): { height: number; overflow: number } {
  let y = box.y
  let printed = 0
  for (const row of rows) {
    if (y + ROW_H > box.y + box.h) break
    out.push({
      kind: 'group',
      transform: { translate: [box.x + 0.16, y + ROW_H / 2] },
      children: row.swatch,
    })
    out.push({
      kind: 'text',
      x: box.x + 0.42,
      y: y + ROW_H - 0.07,
      text: row.label,
      fontSize: 0.105,
      fill: INK,
      fontFamily: SANS,
    })
    y += ROW_H
    printed += 1
  }
  return { height: y - box.y, overflow: rows.length - printed }
}

/** A two-column key: a bold letter and what it means. */
export function keyBlock(
  out: FloorplanGeometry[],
  box: Box,
  rows: readonly { letter: string; label: string }[],
): { height: number; overflow: number } {
  const cols = charsPerLine(box.w - 0.5, 0.105)
  let y = box.y
  let printed = 0
  for (const row of rows) {
    const lines = wrap(row.label, cols)
    const need = Math.max(ROW_H, lines.length * NOTE_LINE_H + 0.03)
    if (y + need > box.y + box.h) break
    out.push({
      kind: 'text',
      x: box.x + 0.06,
      y: y + NOTE_LINE_H,
      text: row.letter,
      fontSize: 0.13,
      fill: INK,
      fontWeight: 800,
      fontFamily: MONO,
    })
    lines.forEach((line, i) => {
      out.push({
        kind: 'text',
        x: box.x + 0.42,
        y: y + NOTE_LINE_H + i * NOTE_LINE_H,
        text: line,
        fontSize: 0.105,
        fill: INK,
        fontFamily: SANS,
      })
    })
    y += need
    printed += 1
  }
  return { height: y - box.y, overflow: rows.length - printed }
}

/** A one-line caption under a block — assumptions, sources, "verify" lines. */
export function caption(out: FloorplanGeometry[], box: Box, text: string): number {
  const lines = wrap(text, charsPerLine(box.w, 0.095))
  lines.forEach((line, i) => {
    out.push({
      kind: 'text',
      x: box.x,
      y: box.y + 0.1 + i * 0.13,
      text: line,
      fontSize: 0.095,
      fill: INK_SOFT,
      fontFamily: SANS,
    })
  })
  return lines.length * 0.13
}

/** A colour/line-style key row for the pipe and wiring runs. */
export function runSwatch(
  color: string,
  dash: string | undefined,
  width = 0.28,
): FloorplanGeometry[] {
  return [
    {
      kind: 'line',
      x1: -width / 2,
      y1: 0,
      x2: width / 2,
      y2: 0,
      stroke: color,
      strokeWidth: 0.028,
      ...(dash ? { strokeDasharray: dash } : {}),
    },
  ]
}
