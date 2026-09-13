/**
 * A test-only serializer: one `DrawingResult` → one SVG file you can open.
 *
 * The sheets pipeline has two renderers (the screen's nested `<svg>` and the
 * pdfkit page) and neither runs under `bun test`, so a provider that composes
 * the wrong geometry looks exactly like one that composes the right geometry:
 * both are just arrays. This walks the same primitives both renderers walk and
 * writes them out, so the drawing can actually be LOOKED at while it is being
 * built. It is not part of any sheet — only the provider tests call it.
 *
 * It mirrors `resolveProvided` + `windowFor` (drawings.ts) exactly: the live
 * window is `sheetInchesToWorld(vp.w/h, scale)` centred on the padded result
 * bounds, and the plate is already in absolute sheet inches.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { padBounds } from '../../bounds'
import type { DrawingResult } from '../../drawings'
import { INCHES_PER_METRE } from '../../scale'

type Box = { x: number; y: number; w: number; h: number; scale: number }

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const n = (v: number): string => (Number.isFinite(v) ? v.toFixed(4) : '0')

function styleAttrs(g: Record<string, unknown>, unitsPerPixel?: number): string {
  const parts: string[] = []
  const push = (name: string, value: unknown) => {
    if (value === undefined || value === null) return
    parts.push(`${name}="${esc(String(value))}"`)
  }
  push('fill', g.fill ?? 'none')
  push('stroke', g.stroke)
  // `non-scaling-stroke` means `strokeWidth` is SCREEN PIXELS, not world
  // metres. Dropping it once turned the host's 1-px door-hinge marks into
  // 1-METRE blobs that read as furniture and sent this workstream hunting a
  // provider bug that did not exist. The attribute goes out, and the width is
  // also converted to world units so a renderer that ignores the attribute
  // still draws something the right size.
  const nonScaling = g.vectorEffect === 'non-scaling-stroke'
  if (nonScaling) parts.push('vector-effect="non-scaling-stroke"')
  push(
    'stroke-width',
    nonScaling && typeof g.strokeWidth === 'number'
      ? g.strokeWidth * (unitsPerPixel ?? 1)
      : g.strokeWidth,
  )
  push('stroke-dasharray', g.strokeDasharray)
  push('opacity', g.opacity)
  push('fill-opacity', g.fillOpacity)
  push('stroke-opacity', g.strokeOpacity)
  push('stroke-linecap', g.strokeLinecap)
  return parts.join(' ')
}

function emit(g: FloorplanGeometry, out: string[], unitsPerPixel?: number): void {
  const any = g as unknown as Record<string, unknown>
  switch (g.kind) {
    case 'group': {
      const t = g.transform
      const parts: string[] = []
      if (t?.translate) parts.push(`translate(${n(t.translate[0])} ${n(t.translate[1])})`)
      if (t?.rotate !== undefined) parts.push(`rotate(${n((t.rotate * 180) / Math.PI)})`)
      out.push(`<g${parts.length > 0 ? ` transform="${parts.join(' ')}"` : ''}>`)
      for (const child of g.children) emit(child, out, unitsPerPixel)
      out.push('</g>')
      return
    }
    case 'path':
      out.push(`<path d="${esc(g.d)}" ${styleAttrs(any, unitsPerPixel)}/>`)
      return
    case 'polygon':
      out.push(
        `<polygon points="${g.points.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${styleAttrs(any, unitsPerPixel)}/>`,
      )
      return
    case 'polyline':
    case 'hatch':
      out.push(
        `<polyline points="${(g.points as readonly [number, number][]).map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" fill="none" stroke="${esc(String((any.color ?? any.stroke) ?? '#888'))}" stroke-width="0.01"/>`,
      )
      return
    case 'rect':
      out.push(
        `<rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" ${styleAttrs(any, unitsPerPixel)}/>`,
      )
      return
    case 'circle':
      out.push(`<circle cx="${n(g.cx)}" cy="${n(g.cy)}" r="${n(g.r)}" ${styleAttrs(any, unitsPerPixel)}/>`)
      return
    case 'line':
      out.push(
        `<line x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}" ${styleAttrs(any, unitsPerPixel)}/>`,
      )
      return
    case 'text':
      out.push(
        `<text x="${n(g.x)}" y="${n(g.y)}" font-size="${n(g.fontSize)}" fill="${esc(g.fill ?? '#000')}"` +
          ` font-family="Helvetica, Arial, sans-serif"${g.fontWeight ? ` font-weight="${esc(String(g.fontWeight))}"` : ''}` +
          `${g.textAnchor ? ` text-anchor="${esc(g.textAnchor)}"` : ''}${g.opacity !== undefined ? ` opacity="${n(g.opacity)}"` : ''}>${esc(g.text)}</text>`,
      )
      return
    default:
      return
  }
}

/**
 * Render a provider result the way a sheet would: the plate in sheet inches
 * over a live window fitted to the viewport at its scale.
 */
export function drawingToSvg(result: DrawingResult, viewport: Box): string {
  const pxPerInch = 100
  const pad = 0.5
  const width = (viewport.w + pad * 2) * pxPerInch
  const height = (viewport.h + pad * 2) * pxPerInch
  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(viewport.x - pad)} ${n(viewport.y - pad)} ${n(viewport.w + pad * 2)} ${n(viewport.h + pad * 2)}">`,
  )
  out.push(
    `<rect x="${n(viewport.x - pad)}" y="${n(viewport.y - pad)}" width="${n(viewport.w + pad * 2)}" height="${n(viewport.h + pad * 2)}" fill="#ffffff"/>`,
  )
  out.push(
    `<rect x="${n(viewport.x)}" y="${n(viewport.y)}" width="${n(viewport.w)}" height="${n(viewport.h)}" fill="none" stroke="#cbd5e1" stroke-width="0.01"/>`,
  )

  if (result.primitives.length > 0) {
    const bounds = padBounds(result.bounds, 0.4)
    const worldW = (viewport.w * viewport.scale) / INCHES_PER_METRE
    const worldH = (viewport.h * viewport.scale) / INCHES_PER_METRE
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    const viewX = cx - worldW / 2
    const viewY = cy - worldH / 2
    out.push(
      `<svg x="${n(viewport.x)}" y="${n(viewport.y)}" width="${n(viewport.w)}" height="${n(viewport.h)}" viewBox="${n(viewX)} ${n(viewY)} ${n(worldW)} ${n(worldH)}">`,
    )
    // World units per rendered pixel inside the live window — what a
    // `non-scaling-stroke` width has to be converted through.
    const unitsPerPixel = worldW / (viewport.w * pxPerInch)
    for (const g of result.primitives) emit(g, out, unitsPerPixel)
    out.push('</svg>')
  }
  for (const g of result.plate ?? []) emit(g, out)

  for (const [i, warning] of (result.warnings ?? []).entries()) {
    out.push(
      `<text x="${n(viewport.x + 0.08)}" y="${n(viewport.y + viewport.h - 0.08 - ((result.warnings?.length ?? 1) - 1 - i) * 0.13)}" font-size="0.09" fill="#b45309" font-family="Helvetica, Arial, sans-serif">${esc(`! ${warning}`)}</text>`,
    )
  }
  out.push('</svg>')
  return out.join('\n')
}
