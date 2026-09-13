/**
 * A plate, as an SVG file you can actually look at.
 *
 * Plates are `FloorplanGeometry` in SHEET INCHES, which is easy to assert on
 * and impossible to eyeball. This turns a plate into a standalone SVG at a
 * fixed pixels-per-inch so a test can drop one on disk and a human (or a
 * model with an image reader) can see whether the columns balance, whether
 * the tables collide and whether the diagram lands where it should.
 *
 * TEST-ONLY. Nothing in the shipped sheet path imports this; the tests that
 * do only write a file when `PASCAL_SHEET_SVG` is set in the environment, so
 * an ordinary `bun test` never touches the filesystem.
 */
import type { FloorplanGeometry } from '@pascal-app/core'

const PX_PER_IN = 60

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attr(name: string, value: unknown): string {
  return value === undefined || value === null ? '' : ` ${name}="${value}"`
}

function points(list: readonly (readonly [number, number])[]): string {
  return list.map(([x, y]) => `${x * PX_PER_IN},${y * PX_PER_IN}`).join(' ')
}

function render(geometry: FloorplanGeometry): string {
  const style = geometry as unknown as Record<string, unknown>
  const stroke = attr('stroke', style.stroke ?? 'none')
  const strokeWidth = attr(
    'stroke-width',
    typeof style.strokeWidth === 'number' ? style.strokeWidth * PX_PER_IN : undefined,
  )
  const dash = attr(
    'stroke-dasharray',
    typeof style.strokeDasharray === 'string'
      ? style.strokeDasharray
          .split(/\s+/)
          .map((n) => Number(n) * PX_PER_IN)
          .join(' ')
      : undefined,
  )
  const fill = attr('fill', style.fill ?? 'none')
  switch (geometry.kind) {
    case 'text':
      return `<text x="${geometry.x * PX_PER_IN}" y="${geometry.y * PX_PER_IN}" font-size="${geometry.fontSize * PX_PER_IN}"${attr('fill', geometry.fill ?? '#111827')}${attr('font-weight', geometry.fontWeight)}${attr('text-anchor', geometry.textAnchor)} font-family="Helvetica, Arial, sans-serif">${escapeText(geometry.text)}</text>`
    case 'line':
      return `<line x1="${geometry.x1 * PX_PER_IN}" y1="${geometry.y1 * PX_PER_IN}" x2="${geometry.x2 * PX_PER_IN}" y2="${geometry.y2 * PX_PER_IN}"${stroke}${strokeWidth}${dash}/>`
    case 'rect':
      return `<rect x="${geometry.x * PX_PER_IN}" y="${geometry.y * PX_PER_IN}" width="${geometry.width * PX_PER_IN}" height="${geometry.height * PX_PER_IN}"${fill}${stroke}${strokeWidth}/>`
    case 'polygon':
      return `<polygon points="${points(geometry.points)}"${fill}${stroke}${strokeWidth}${dash}/>`
    case 'polyline':
      return `<polyline points="${points(geometry.points)}"${fill}${stroke}${strokeWidth}${dash}/>`
    case 'circle':
      return `<circle cx="${geometry.cx * PX_PER_IN}" cy="${geometry.cy * PX_PER_IN}" r="${geometry.r * PX_PER_IN}"${fill}${stroke}${strokeWidth}/>`
    case 'group':
      return `<g>${geometry.children.map(render).join('')}</g>`
    default:
      return ''
  }
}

/** A whole sheet-inch plate as one SVG document. */
export function plateToSvg(
  plate: readonly FloorplanGeometry[],
  frame: { x: number; y: number; w: number; h: number },
): string {
  const w = (frame.x * 2 + frame.w) * PX_PER_IN
  const h = (frame.y * 2 + frame.h) * PX_PER_IN
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
    `<rect x="${frame.x * PX_PER_IN}" y="${frame.y * PX_PER_IN}" width="${frame.w * PX_PER_IN}" height="${frame.h * PX_PER_IN}" fill="none" stroke="#d1d5db" stroke-width="1"/>`,
    ...plate.map(render),
    '</svg>',
  ].join('\n')
}
