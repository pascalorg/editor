/**
 * Where the plates go, and how far the live drawing slides to make room.
 *
 * `resolveProvided` (drawings.ts) centres a provided drawing on the WHOLE
 * viewport box, so a plate column on the right would sit on top of the plan.
 * The fix is arithmetic rather than a new contract: the provider returns
 * BOUNDS whose centre is offset, and the window that gets built around that
 * centre lands the drawing in the part of the box the plates left free.
 */
import { sheetInchesToWorld } from '../../scale'
import type { Box } from './plate'

export type PlateLayout = {
  mode: 'column' | 'stack'
  /** Where the drawing should read, sheet inches. */
  plan: Box
  /** The band the plate blocks are laid out in, sheet inches. */
  plates: Box
  /** Column width for stacked plates. */
  stackColumns: number
  /** World-metre offset to add to the drawing bounds' CENTRE. */
  shift: { x: number; y: number }
}

const GAP = 0.34

export function plateLayout(
  viewport: { x: number; y: number; w: number; h: number; scale: number },
): PlateLayout {
  const { x, y, w, h, scale } = viewport
  if (w >= 8) {
    const colW = Math.max(2.6, Math.min(4.2, w * 0.32))
    const planW = w - colW - GAP
    return {
      mode: 'column',
      plan: { x, y, w: planW, h },
      plates: { x: x + planW + GAP, y, w: colW, h },
      stackColumns: 1,
      // Drawing centres in [x, x+planW] instead of [x, x+w] → it moves LEFT
      // on paper by (w - planW)/2, which means the window's world origin
      // moves EAST by the same distance.
      shift: { x: sheetInchesToWorld((w - planW) / 2, scale), y: 0 },
    }
  }
  const bandH = Math.max(1.6, Math.min(h * 0.5, 4.2))
  const planH = h - bandH - GAP
  return {
    mode: 'stack',
    plan: { x, y, w, h: planH },
    plates: { x, y: y + planH + GAP, w, h: bandH },
    stackColumns: Math.max(1, Math.floor(w / 2.7)),
    shift: { x: 0, y: sheetInchesToWorld((h - planH) / 2, scale) },
  }
}

/** Slice a plate band into `n` equal columns with gutters. */
export function columnsOf(box: Box, n: number): Box[] {
  const count = Math.max(1, n)
  const colW = (box.w - GAP * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({
    x: box.x + i * (colW + GAP),
    y: box.y,
    w: colW,
    h: box.h,
  }))
}
