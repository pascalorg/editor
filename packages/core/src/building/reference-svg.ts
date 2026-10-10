import type { ReferenceContour } from './reference-construction'

/**
 * SVG plan geometry without a DOM, so the editor, the AI chat and the MCP server read the same
 * contours from the same file. Points are in image pixels: the SVG's own width and height, the
 * size an `<img>` decodes it to, which is the space `imagePointToLevel` maps onto a floor.
 */
/** Stroke contours keep their drawn width (image px): it tells walls from fixtures and ticks. */
export type SvgContour = ReferenceContour & { strokeWidth?: number }
/** A text of the plan (a room name, a dimension) where it stands, in image pixels. */
export type SvgLabel = { text: string; at: Point }
export type SvgPlan = { width: number; height: number; contours: SvgContour[]; labels: SvgLabel[] }

type Point = [number, number]
type Matrix = [number, number, number, number, number, number]
type Subpath = { points: Point[]; closed: boolean }

const MAX_SOURCE_CHARS = 6_000_000
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const CURVE_SEGMENTS = 8
const ARC_STEP = Math.PI / 12
const ELLIPSE_SEGMENTS = 24
const BACKGROUND_SHARE = 0.98
/** Content that is referenced or annotated, never drawn as plan geometry. */
const NOT_DRAWN = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'title',
  'desc',
  'style',
  'script',
  'metadata',
  'linearGradient',
  'radialGradient',
  'filter',
  'foreignObject',
])
const SHAPES = new Set(['path', 'rect', 'polygon', 'polyline', 'line', 'circle', 'ellipse'])

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const transformPoint = (m: Matrix, [x, y]: Point): Point => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

const numbers = (value: string) =>
  (value.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)

function parseTransform(value: string | undefined): Matrix {
  let matrix = IDENTITY
  for (const [, name, args] of (value ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const [a = 0, b, c, d, e, f] = numbers(args ?? '')
    let next: Matrix | null = null
    if (name === 'matrix' && f !== undefined) next = [a, b!, c!, d!, e!, f]
    else if (name === 'translate') next = [1, 0, 0, 1, a, b ?? 0]
    else if (name === 'scale') next = [a, 0, 0, b ?? a, 0, 0]
    else if (name === 'rotate') {
      const r = (a * Math.PI) / 180
      const rotation: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
      next =
        b !== undefined && c !== undefined
          ? multiply(multiply([1, 0, 0, 1, b, c], rotation), [1, 0, 0, 1, -b, -c])
          : rotation
    } else if (name === 'skewX') next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0]
    else if (name === 'skewY') next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0]
    if (next) matrix = multiply(matrix, next)
  }
  return matrix
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [, name, double, single, bare] of source.matchAll(
    /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  ))
    attributes[name!] = double ?? single ?? bare ?? ''
  for (const declaration of (attributes.style ?? '').split(';')) {
    const [property, ...rest] = declaration.split(':')
    const key = property?.trim()
    if (key && rest.length) attributes[key] = rest.join(':').trim()
  }
  return attributes
}

const painted = (paint: string | undefined) =>
  !!paint && paint !== 'none' && paint !== 'transparent'

function pathSubpaths(d: string): Subpath[] {
  const subpaths: Subpath[] = []
  const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y
  let i = 0
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++
  }
  const num = () => {
    skip()
    NUMBER.lastIndex = i
    const match = NUMBER.exec(d)
    if (!match) throw Error('Invalid path data.')
    i = NUMBER.lastIndex
    return Number(match[0])
  }
  const flag = () => {
    skip()
    const c = d[i++]
    if (c !== '0' && c !== '1') throw Error('Invalid arc flag.')
    return c === '1'
  }

  let current: Point = [0, 0]
  let start: Point = [0, 0]
  let control: Point | null = null
  let quadratic: Point | null = null
  let points: Point[] | null = null
  let command = ''
  const finish = (closed: boolean) => {
    if (points && points.length > 1) subpaths.push({ points, closed })
    points = null
  }
  const lineTo = (p: Point) => {
    points ??= [current]
    points.push(p)
    current = p
  }

  while (true) {
    skip()
    if (i >= d.length) break
    if (/[a-zA-Z]/.test(d[i]!)) command = d[i++]!
    else if (!command) throw Error('Invalid path data.')
    const relative = command === command.toLowerCase()
    const at = (x: number, y: number): Point =>
      relative ? [current[0] + x, current[1] + y] : [x, y]
    const upper = command.toUpperCase()
    if (upper === 'Z') {
      if (points) lineTo(start)
      finish(true)
      current = start
      control = quadratic = null
      command = ''
      continue
    }
    if (upper === 'M') {
      finish(false)
      current = start = at(num(), num())
      points = [current]
      command = relative ? 'l' : 'L'
    } else if (upper === 'L') lineTo(at(num(), num()))
    else if (upper === 'H') {
      const x = num()
      lineTo([relative ? current[0] + x : x, current[1]])
    } else if (upper === 'V') {
      const y = num()
      lineTo([current[0], relative ? current[1] + y : y])
    } else if (upper === 'C' || upper === 'S') {
      const from = current
      const c1: Point =
        upper === 'C'
          ? at(num(), num())
          : control
            ? [2 * from[0] - control[0], 2 * from[1] - control[1]]
            : from
      const c2 = at(num(), num())
      const to = at(num(), num())
      for (let s = 1; s <= CURVE_SEGMENTS; s++) {
        const t = s / CURVE_SEGMENTS
        const u = 1 - t
        lineTo([
          u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
          u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
        ])
      }
      control = c2
      quadratic = null
      continue
    } else if (upper === 'Q' || upper === 'T') {
      const from = current
      const c: Point =
        upper === 'Q'
          ? at(num(), num())
          : quadratic
            ? [2 * from[0] - quadratic[0], 2 * from[1] - quadratic[1]]
            : from
      const to = at(num(), num())
      for (let s = 1; s <= CURVE_SEGMENTS; s++) {
        const t = s / CURVE_SEGMENTS
        const u = 1 - t
        lineTo([
          u * u * from[0] + 2 * u * t * c[0] + t * t * to[0],
          u * u * from[1] + 2 * u * t * c[1] + t * t * to[1],
        ])
      }
      quadratic = c
      control = null
      continue
    } else if (upper === 'A') {
      const rx = Math.abs(num())
      const ry = Math.abs(num())
      const phi = (num() * Math.PI) / 180
      const large = flag()
      const sweep = flag()
      const to = at(num(), num())
      for (const p of arcPoints(current, to, rx, ry, phi, large, sweep)) lineTo(p)
    } else throw Error(`Unsupported path command ${command}.`)
    control = quadratic = null
  }
  finish(false)
  return subpaths
}

/** SVG arc from endpoint to centre parameterisation (SVG 1.1 §F.6.5), sampled every 15°. */
function arcPoints(
  from: Point,
  to: Point,
  rxIn: number,
  ryIn: number,
  phi: number,
  large: boolean,
  sweep: boolean,
): Point[] {
  if (rxIn === 0 || ryIn === 0 || (from[0] === to[0] && from[1] === to[1])) return [to]
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rxIn * rxIn) + (y1 * y1) / (ryIn * ryIn)
  const rx = lambda > 1 ? rxIn * Math.sqrt(lambda) : rxIn
  const ry = lambda > 1 ? ryIn * Math.sqrt(lambda) : ryIn
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const factor =
    (large === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)))
  const cx1 = (factor * rx * y1) / ry
  const cy1 = (-factor * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / ARC_STEP - 1e-9))
  const points: Point[] = []
  for (let s = 1; s < steps; s++) {
    const t = theta + (delta * s) / steps
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    points.push([cos * x - sin * y + cx, sin * x + cos * y + cy])
  }
  points.push(to)
  return points
}

const attr = (attributes: Record<string, string>, name: string) => Number(attributes[name] ?? 0)

function shapeSubpaths(name: string, a: Record<string, string>): Subpath[] {
  if (name === 'path') return pathSubpaths(a.d ?? '')
  if (name === 'rect') {
    const [x, y, w, h] = [attr(a, 'x'), attr(a, 'y'), attr(a, 'width'), attr(a, 'height')]
    if (!(w > 0 && h > 0)) return []
    return [
      {
        points: [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        closed: true,
      },
    ]
  }
  if (name === 'polygon' || name === 'polyline') {
    const values = numbers(a.points ?? '')
    const points: Point[] = []
    for (let k = 0; k + 1 < values.length; k += 2) points.push([values[k]!, values[k + 1]!])
    return [{ points, closed: name === 'polygon' }]
  }
  if (name === 'line')
    return [
      {
        points: [
          [attr(a, 'x1'), attr(a, 'y1')],
          [attr(a, 'x2'), attr(a, 'y2')],
        ],
        closed: false,
      },
    ]
  const rx = name === 'circle' ? attr(a, 'r') : attr(a, 'rx')
  const ry = name === 'circle' ? attr(a, 'r') : attr(a, 'ry')
  if (!(rx > 0 && ry > 0)) return []
  const points = Array.from({ length: ELLIPSE_SEGMENTS }, (_, k): Point => {
    const t = (2 * Math.PI * k) / ELLIPSE_SEGMENTS
    return [attr(a, 'cx') + rx * Math.cos(t), attr(a, 'cy') + ry * Math.sin(t)]
  })
  return [{ points, closed: true }]
}

function withoutRepeats(points: Point[]): Point[] {
  return points.filter(
    (p, k) => k === 0 || Math.hypot(p[0] - points[k - 1]![0], p[1] - points[k - 1]![1]) > 1e-9,
  )
}

function area(points: Point[]) {
  let sum = 0
  for (let k = 0; k < points.length; k++) {
    const a = points[k]!
    const b = points[(k + 1) % points.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

function inside([x, y]: Point, polygon: Point[]) {
  let hit = false
  for (let k = 0, j = polygon.length - 1; k < polygon.length; j = k++) {
    const [xi, yi] = polygon[k]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function boundsArea(points: Point[]) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

/** A filled element: outer loops, each with the loops it contains as holes. */
function filledContours(loops: Point[][]): { points: Point[]; holes: Point[][] }[] {
  const closed = loops.filter((loop) => loop.length >= 3 && area(loop) > 0)
  const bySize = [...closed].sort((a, b) => area(b) - area(a))
  const outers: { points: Point[]; holes: Point[][] }[] = []
  for (const loop of bySize) {
    const host = [...outers].reverse().find((outer) => inside(loop[0]!, outer.points))
    if (host) host.holes.push(loop)
    else outers.push({ points: loop, holes: [] })
  }
  return outers
}

type Frame = {
  matrix: Matrix
  fill?: string
  stroke?: string
  strokeWidth?: string
  dash?: string
  hidden: boolean
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
/** A text element's content: its tspans joined, entities decoded, spaces collapsed. */
const textContent = (inner: string) =>
  inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) =>
      code[0] === '#'
        ? String.fromCodePoint(
            Number.parseInt(code.slice(code[1] === 'x' ? 2 : 1), code[1] === 'x' ? 16 : 10),
          )
        : (ENTITIES[code] ?? entity),
    )
    .replace(/\s+/g, ' ')
    .trim()

export function readSvgPlan(source: string, { maxContours = 512 } = {}): SvgPlan {
  if (source.length > MAX_SOURCE_CHARS) throw Error('Choose an SVG under 6 MB.')
  const text = source.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  const tags = text.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)
  const stack: Frame[] = []
  const found: { contour: Omit<SvgContour, 'id'>; size: number }[] = []
  let size: { width: number; height: number } | null = null
  let skipped = 0
  const labels: SvgLabel[] = []
  // The text element being read: its frame, its anchor (its own x, y, else its first tspan's),
  // and where its content starts.
  let reading: { matrix: Matrix; at: Point | null; from: number; hidden: boolean } | null = null

  for (const match of tags) {
    const [tag, closing, rawName, rawAttributes, selfClosing] = match
    const name = rawName!.replace(/^svg:/, '')
    if (reading) {
      if (closing && name === 'text') {
        const content = textContent(text.slice(reading.from, match.index))
        if (content && !reading.hidden)
          labels.push({ text: content, at: transformPoint(reading.matrix, reading.at ?? [0, 0]) })
        reading = null
      } else if (!closing && name === 'tspan' && !reading.at) {
        const a = parseAttributes(rawAttributes ?? '')
        if (a.x !== undefined || a.y !== undefined)
          reading.at = [numbers(a.x ?? '0')[0] ?? 0, numbers(a.y ?? '0')[0] ?? 0]
      }
      continue
    }
    if (closing) {
      if (skipped > 0) {
        if (NOT_DRAWN.has(name)) skipped--
      } else if (!SHAPES.has(name)) stack.pop()
      continue
    }
    if (!size && name !== 'svg') throw Error('This file is not an SVG.')
    const attributes = parseAttributes(rawAttributes ?? '')
    if (NOT_DRAWN.has(name)) {
      if (!selfClosing) skipped++
      continue
    }
    if (skipped > 0) continue
    const parent = stack.at(-1) ?? { matrix: IDENTITY, hidden: false }
    let matrix = multiply(parent.matrix, parseTransform(attributes.transform))
    if (!size) {
      const box = numbers(attributes.viewBox ?? '')
      const width = Number.parseFloat(attributes.width ?? '') || box[2] || 0
      const height = Number.parseFloat(attributes.height ?? '') || box[3] || 0
      if (!(width > 0 && height > 0))
        throw Error('This SVG has no size (width, height or viewBox).')
      size = { width, height }
      if (box.length === 4 && box[2]! > 0 && box[3]! > 0)
        matrix = multiply(matrix, [
          width / box[2]!,
          0,
          0,
          height / box[3]!,
          -box[0]! * (width / box[2]!),
          -box[1]! * (height / box[3]!),
        ])
    }
    if (name === 'text') {
      if (!selfClosing)
        reading = {
          matrix,
          at:
            attributes.x !== undefined || attributes.y !== undefined
              ? [numbers(attributes.x ?? '0')[0] ?? 0, numbers(attributes.y ?? '0')[0] ?? 0]
              : null,
          from: match.index + tag.length,
          hidden:
            parent.hidden || attributes.display === 'none' || attributes.visibility === 'hidden',
        }
      continue
    }
    const frame: Frame = {
      matrix,
      fill: attributes.fill ?? parent.fill,
      stroke: attributes.stroke ?? parent.stroke,
      strokeWidth: attributes['stroke-width'] ?? parent.strokeWidth,
      dash: attributes['stroke-dasharray'] ?? parent.dash,
      hidden:
        parent.hidden ||
        attributes.display === 'none' ||
        attributes.visibility === 'hidden' ||
        attributes.visibility === 'collapse',
    }
    if (!SHAPES.has(name)) {
      if (!selfClosing) stack.push(frame)
      continue
    }
    if (frame.hidden) continue
    const fill = frame.fill ?? 'black'
    const filled = painted(fill)
    if (!(filled || painted(frame.stroke))) continue
    let subpaths: Subpath[]
    try {
      subpaths = shapeSubpaths(name, attributes)
    } catch {
      continue
    }
    const placed = subpaths.map((subpath) => ({
      closed: subpath.closed,
      points: withoutRepeats(subpath.points.map((p) => transformPoint(frame.matrix, p))),
    }))
    const label = attributes.id ? { name: attributes.id } : {}
    if (filled) {
      for (const { points, holes } of filledContours(placed.map((s) => s.points))) {
        // A rect spanning the page is its background, not plan geometry.
        if (name === 'rect' && boundsArea(points) >= BACKGROUND_SHARE * size!.width * size!.height)
          continue
        found.push({
          contour: { ...label, points, ...(holes.length ? { holes } : {}) },
          size: boundsArea(points),
        })
      }
    } else {
      const [a, b, c, d] = frame.matrix
      const strokeWidth =
        Math.round(
          Number.parseFloat(frame.strokeWidth ?? '1') * Math.sqrt(Math.abs(a * d - b * c)) * 1e6,
        ) / 1e6
      const dashed = !!frame.dash && numbers(frame.dash).some((length) => length > 0)
      for (const { points, closed } of placed) {
        if (points.length < 2) continue
        const line = closed && points.length > 2 ? [...points, points[0]!] : points
        found.push({
          contour: {
            ...label,
            points: line,
            stroke: true,
            strokeWidth,
            ...(dashed ? { dashed } : {}),
          },
          size: boundsArea(line),
        })
      }
    }
  }
  if (!size) throw Error('This file is not an SVG.')

  const keep =
    found.length > maxContours
      ? new Set([...found].sort((a, b) => b.size - a.size).slice(0, maxContours))
      : null
  const contours = found
    .filter((entry) => !keep || keep.has(entry))
    .map((entry, index) => ({ id: `s${index}`, ...entry.contour }))
  return { ...size, contours, labels }
}
