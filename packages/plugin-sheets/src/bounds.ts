/**
 * Analytic bounds over a `FloorplanGeometry` tree.
 *
 * The editor's own PDF export measures bounds by mounting the SVG and
 * calling `getBBox()`. Sheets cannot: it needs the extents of a dozen
 * viewports on every render, in tests, and before anything is on screen. So
 * the tree is walked directly.
 *
 * `path` is the one primitive that cannot be measured exactly without a path
 * parser; its `d` string's numeric pairs are used as a control-point hull,
 * which is an over-estimate for arcs and an exact answer for the line/move
 * segments most kinds emit. Text is treated as a point (labels should not
 * drive a drawing's extents).
 */
import type { FloorplanGeometry } from '@pascal-app/core'

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export const EMPTY_BOUNDS: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
}

export function isEmpty(b: Bounds): boolean {
  return !(b.maxX > b.minX || b.maxY > b.minY)
}

export function boundsSize(b: Bounds): { width: number; height: number } {
  return { width: Math.max(0, b.maxX - b.minX), height: Math.max(0, b.maxY - b.minY) }
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

/** Bounds of a geometry tree, in the tree's own coordinate space. */
export function geometryBounds(geometry: FloorplanGeometry | null | undefined): Bounds {
  if (!geometry) return EMPTY_BOUNDS
  const acc: number[] = []
  collect(geometry, 0, 0, 0, acc)
  if (acc.length === 0) return EMPTY_BOUNDS
  let b = EMPTY_BOUNDS
  for (let i = 0; i < acc.length; i += 2) {
    const x = acc[i] as number
    const y = acc[i + 1] as number
    b = {
      minX: Math.min(b.minX, x),
      minY: Math.min(b.minY, y),
      maxX: Math.max(b.maxX, x),
      maxY: Math.max(b.maxY, y),
    }
  }
  return b
}

export function geometryListBounds(list: readonly (FloorplanGeometry | null)[]): Bounds {
  let b = EMPTY_BOUNDS
  for (const g of list) if (g) b = unionBounds(b, geometryBounds(g))
  return b
}

function push(acc: number[], x: number, y: number, tx: number, ty: number, rot: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (rot === 0) {
    acc.push(x + tx, y + ty)
    return
  }
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  acc.push(x * c - y * s + tx, x * s + y * c + ty)
}

function collect(g: FloorplanGeometry, tx: number, ty: number, rot: number, acc: number[]): void {
  switch (g.kind) {
    case 'group': {
      const t = g.transform?.translate
      const r = g.transform?.rotate ?? 0
      // Compose: the child frame is rotated by `rot`, then offset by `t`
      // expressed in that frame.
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      const dx = t ? t[0] * c - t[1] * s : 0
      const dy = t ? t[0] * s + t[1] * c : 0
      for (const child of g.children) collect(child, tx + dx, ty + dy, rot + r, acc)
      return
    }
    case 'polygon':
    case 'polyline':
    case 'hatch':
      for (const [x, y] of g.points) push(acc, x, y, tx, ty, rot)
      return
    case 'rect':
      push(acc, g.x, g.y, tx, ty, rot)
      push(acc, g.x + g.width, g.y + g.height, tx, ty, rot)
      push(acc, g.x + g.width, g.y, tx, ty, rot)
      push(acc, g.x, g.y + g.height, tx, ty, rot)
      return
    case 'circle':
      push(acc, g.cx - g.r, g.cy - g.r, tx, ty, rot)
      push(acc, g.cx + g.r, g.cy + g.r, tx, ty, rot)
      return
    case 'line':
      push(acc, g.x1, g.y1, tx, ty, rot)
      push(acc, g.x2, g.y2, tx, ty, rot)
      return
    case 'text':
      push(acc, g.x, g.y, tx, ty, rot)
      return
    case 'image':
      push(acc, g.center[0] - g.width / 2, g.center[1] - g.height / 2, tx, ty, rot)
      push(acc, g.center[0] + g.width / 2, g.center[1] + g.height / 2, tx, ty, rot)
      return
    case 'path': {
      for (const [x, y] of pathPoints(g.d)) push(acc, x, y, tx, ty, rot)
      return
    }
    default: {
      // Dimensions and handles carry their own point fields; take any
      // top-level numeric x/y pairs we recognise rather than special-casing
      // every annotation kind.
      const any = g as unknown as Record<string, unknown>
      for (const [ax, ay] of [
        ['x1', 'y1'],
        ['x2', 'y2'],
        ['x', 'y'],
        ['cx', 'cy'],
      ] as const) {
        if (typeof any[ax] === 'number' && typeof any[ay] === 'number') {
          push(acc, any[ax] as number, any[ay] as number, tx, ty, rot)
        }
      }
      for (const key of ['start', 'end', 'from', 'to']) {
        const v = any[key]
        if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
          push(acc, v[0], v[1], tx, ty, rot)
        }
      }
      const points = any.points
      if (Array.isArray(points)) {
        for (const p of points) {
          if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
            push(acc, p[0], p[1], tx, ty, rot)
          }
        }
      }
      return
    }
  }
}

const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

export function pathPoints(d: string): [number, number][] {
  const numbers = d.match(NUMBER_RE)?.map(Number) ?? []
  const out: [number, number][] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    out.push([numbers[i] as number, numbers[i + 1] as number])
  }
  return out
}

/** Bounds rotated by `deg` about the origin, matching the pdfkit renderer. */
export function rotateBounds(b: Bounds, deg: number): Bounds {
  if (isEmpty(b)) return b
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const corners: [number, number][] = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ]
  let out = EMPTY_BOUNDS
  for (const [x, y] of corners) {
    const rx = x * c - y * s
    const ry = x * s + y * c
    out = {
      minX: Math.min(out.minX, rx),
      minY: Math.min(out.minY, ry),
      maxX: Math.max(out.maxX, rx),
      maxY: Math.max(out.maxY, ry),
    }
  }
  return out
}
