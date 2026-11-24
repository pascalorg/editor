import type { CameraPose, PointCamera } from '@pascal-app/core'
import type { Rect } from '../../lib/point-ask/types'

export type FloorplanRay = {
  origin: [number, number, number]
  direction: [number, number, number]
}

export type FloorplanHit = {
  nodeId: string | null
  roomZoneId: string | null
  point: [number, number, number]
  normal: [number, number, number]
  planPoint: [number, number]
}

export type EditorFloorplanContext = {
  svgElement: SVGSVGElement
  sceneElement: SVGGElement | null
  getRect: () => DOMRect | null
  projectWorld: (point: readonly [number, number, number]) => { x: number; y: number; ok: boolean }
  screenToWorld: (clientX: number, clientY: number) => [number, number, number] | null
  cameraRay: (clientX: number, clientY: number) => FloorplanRay | null
  getCamera: () => PointCamera | null
  pickAtScreenPoint: (clientX: number, clientY: number) => FloorplanHit | null
  getLevelY: () => number
  isSpacePanPressed: () => boolean
  captureCrop: (
    screenRect: Rect,
    options?: { pad?: number; signal?: AbortSignal },
  ) => Promise<{ dataUrl: string; width: number; height: number }>
  applyPose?: (pose: CameraPose) => void
}

let current: EditorFloorplanContext | null = null

export function setEditorFloorplanContext(ctx: EditorFloorplanContext | null) {
  current = ctx
}

export function getEditorFloorplanContext(): EditorFloorplanContext | null {
  return current
}

export function applyFloorplanCameraPose(pose: CameraPose): boolean {
  if (!current?.applyPose) return false
  current.applyPose(pose)
  return true
}

const CROP_LONG_SIDE_MIN = 512
const CROP_LONG_SIDE_MAX = 768
const COPIED_CSS_VARS = [
  '--background',
  '--foreground',
  '--border',
  '--muted',
  '--muted-foreground',
  '--primary',
  '--card',
] as const

function clampPaddedRect(box: Rect, bounds: { width: number; height: number }, pad = 0.25): Rect {
  const w = Math.max(48, box.x1 - box.x0)
  const h = Math.max(48, box.y1 - box.y0)
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const halfX = (w * (1 + pad * 2)) / 2
  const halfY = (h * (1 + pad * 2)) / 2
  return {
    x0: Math.max(0, cx - halfX),
    y0: Math.max(0, cy - halfY),
    x1: Math.min(bounds.width, cx + halfX),
    y1: Math.min(bounds.height, cy + halfY),
  }
}

function parseSvgViewBox(
  svg: SVGSVGElement,
): { minX: number; minY: number; width: number; height: number } | null {
  const raw = svg.getAttribute('viewBox')
  if (!raw) return null
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null
  const [minX, minY, width, height] = parts as [number, number, number, number]
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

function loadSvgImage(markup: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  if (signal?.aborted) return Promise.reject(new Error('Capture cancelled'))
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      URL.revokeObjectURL(url)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Capture cancelled'))
    }
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('Failed to rasterize 2D floorplan SVG'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    img.src = url
  })
}

/** Rasterize a viewport-CSS rectangle of the live 2D floorplan SVG into a scaled JPEG data URL. */
export async function captureFloorplanSvgCrop(
  svg: SVGSVGElement,
  screenRect: Rect,
  options: { pad?: number; backgroundColor?: string; signal?: AbortSignal } = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (options.signal?.aborted) throw new Error('Capture cancelled')
  const svgRect = svg.getBoundingClientRect()
  const viewBox = parseSvgViewBox(svg)
  if (!(svgRect.width > 0 && svgRect.height > 0 && viewBox)) {
    throw new Error('The 2D plan view is not ready')
  }

  const local: Rect = {
    x0: screenRect.x0 - svgRect.left,
    y0: screenRect.y0 - svgRect.top,
    x1: screenRect.x1 - svgRect.left,
    y1: screenRect.y1 - svgRect.top,
  }
  const cropRect = clampPaddedRect(local, svgRect, options.pad ?? 0.25)
  const localWidth = Math.max(1, cropRect.x1 - cropRect.x0)
  const localHeight = Math.max(1, cropRect.y1 - cropRect.y0)

  const long = Math.max(localWidth, localHeight)
  const scale =
    long > CROP_LONG_SIDE_MAX
      ? CROP_LONG_SIDE_MAX / long
      : long < CROP_LONG_SIDE_MIN
        ? CROP_LONG_SIDE_MIN / long
        : 1
  const outWidth = Math.max(1, Math.round(localWidth * scale))
  const outHeight = Math.max(1, Math.round(localHeight * scale))

  const subMinX = viewBox.minX + (cropRect.x0 / svgRect.width) * viewBox.width
  const subMinY = viewBox.minY + (cropRect.y0 / svgRect.height) * viewBox.height
  const subWidth = (localWidth / svgRect.width) * viewBox.width
  const subHeight = (localHeight / svgRect.height) * viewBox.height

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${subMinX} ${subMinY} ${subWidth} ${subHeight}`)
  clone.setAttribute('width', String(outWidth))
  clone.setAttribute('height', String(outHeight))
  clone.style.transform = ''
  clone.style.transformOrigin = ''
  clone.style.willChange = ''

  const computedSvg = typeof getComputedStyle === 'function' ? getComputedStyle(svg) : null
  const computedRoot =
    typeof getComputedStyle === 'function' && typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null
  if (computedSvg) {
    if (computedSvg.color) clone.style.color = computedSvg.color
    if (computedSvg.fontFamily) clone.style.fontFamily = computedSvg.fontFamily
  }
  for (const name of COPIED_CSS_VARS) {
    const value =
      computedSvg?.getPropertyValue(name).trim() || computedRoot?.getPropertyValue(name).trim()
    if (value) clone.style.setProperty(name, value)
  }

  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas to capture the 2D plan')

  const serializer = new XMLSerializer()
  const renderToDataUrl = async (node: SVGSVGElement) => {
    const markup = serializer.serializeToString(node)
    const img = await loadSvgImage(markup, options.signal)
    if (options.signal?.aborted) throw new Error('Capture cancelled')
    context.clearRect(0, 0, outWidth, outHeight)
    const fill =
      options.backgroundColor ||
      computedSvg?.backgroundColor ||
      computedRoot?.getPropertyValue('--background').trim() ||
      '#ffffff'
    if (fill && fill !== 'transparent' && fill !== 'rgba(0, 0, 0, 0)') {
      context.fillStyle = fill
      context.fillRect(0, 0, outWidth, outHeight)
    }
    context.drawImage(img, 0, 0, outWidth, outHeight)
    return canvas.toDataURL('image/jpeg', 0.84)
  }

  try {
    return { dataUrl: await renderToDataUrl(clone), width: outWidth, height: outHeight }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      // Cross-origin <image> guides can taint the canvas; strip external images and retry once.
      for (const imageEl of clone.querySelectorAll('image')) imageEl.remove()
      return { dataUrl: await renderToDataUrl(clone), width: outWidth, height: outHeight }
    }
    throw error
  }
}
