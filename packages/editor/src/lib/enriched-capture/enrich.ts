import type {
  AnyNode,
  PointCamera,
  PointLegend,
  PointRoom,
  PointVisible,
  PointWorld,
  ZoneNode,
} from '@pascal-app/core'
import {
  assignColours,
  buildLegend,
  type IdBuffer,
  labelAnchors,
  type NamedColour,
  type PixelRect,
  regionWorldPoints,
  segmentationPixels,
  type VisibleShare,
  visibleShares,
  type ZoneFootprint,
  zoneShares,
} from '@pascal-app/viewer'
import { type CapturedCrop, captureViewCrop } from '../point-ask/capture-crop'
import type { Rect } from '../point-ask/types'
import type { EnrichedIdPass } from './requests'

/** Raised when ID-pass enrichment fails after the ordinary crop photo already succeeded. */
export class EnrichmentFallbackError extends Error {
  constructor(
    message: string,
    readonly crop: CapturedCrop,
  ) {
    super(message)
    this.name = 'EnrichmentFallbackError'
  }
}

export type EnrichedCapture = {
  crop: { dataUrl: string; width: number; height: number }
  camera: PointCamera
  /** Viewport CSS pixels and corresponding pixels inside the (possibly padded) crop. */
  region: { canvasRect: Rect; cropRect: PixelRect }
  world: PointWorld
  visible: PointVisible[]
  legend: PointLegend[]
  legendText: string
  rooms: PointRoom[]
  segmented: { dataUrl: string; width: number; height: number }
}

function zoneFootprints({ nodes, worldToLevels }: EnrichedIdPass): ZoneFootprint[] {
  const out: ZoneFootprint[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.visible === false) continue
    const zone = node as ZoneNode
    const matrix = zone.parentId ? worldToLevels.get(zone.parentId) : undefined
    if (!matrix || zone.polygon.length < 3) continue
    // The room's authored vertical extent, not the spike's fixed storey band.
    const floor = zone.floor?.elevation ?? -(zone.floor?.drop ?? 0)
    out.push({
      id: zone.id,
      polygon: zone.polygon,
      holes: zone.holes,
      worldToLevel: matrix,
      yMin: floor - 0.3,
      yMax: floor + (zone.ceilingHeight ?? 2.7),
    })
  }
  return out
}

/** Flat/tinted PNG with exactly the legend's numbers, anchored inside the requested region. */
export async function segmentationImage(
  buffer: IdBuffer,
  colours: ReadonlyMap<number, NamedColour>,
  legend: readonly PointLegend[],
  shares: readonly VisibleShare[],
  options: { crop?: string; tint?: number; rect?: PixelRect } = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { width, height } = buffer
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas for the segmentation map')
  let crop: Uint8ClampedArray | undefined
  if (options.crop) {
    const image = new Image()
    image.src = options.crop
    await image.decode()
    context.drawImage(image, 0, 0, width, height)
    crop = context.getImageData(0, 0, width, height).data
  }
  const pixels = segmentationPixels(buffer, colours, {
    crop,
    tint: options.tint,
    rect: options.rect,
  })
  context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  const anchors = labelAnchors(buffer, options.rect)
  context.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  shares.forEach((share, i) => {
    const anchor = anchors.get(share.index)
    const row = legend[i]
    if (!anchor || !row || anchor.depth < 3) return
    context.beginPath()
    context.arc(anchor.x, anchor.y, 9, 0, Math.PI * 2)
    context.fillStyle = 'rgba(255,255,255,0.92)'
    context.fill()
    context.lineWidth = 1.5
    context.strokeStyle = '#111'
    context.stroke()
    context.fillStyle = '#111'
    context.fillText(String(row.n), anchor.x, anchor.y + 0.5)
  })
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

function defaultDescribe(nodes: Readonly<Record<string, AnyNode>>) {
  return (share: VisibleShare) => {
    const node = share.nodeId ? nodes[share.nodeId] : undefined
    const name = node?.name?.trim()
    const type = node?.type ?? share.nodeType ?? 'node'
    return name ? `${name} (${type})` : type
  }
}

/**
 * Capture a viewport-CSS rectangle with optional crop padding. Shares/rooms/world refer only to
 * the region, not its padding. Camera and semantic snapshot come from the same render as the crop.
 */
export async function captureEnrichedRegion(
  screenRect: Rect,
  options: {
    pad?: number
    describe?: (share: VisibleShare) => string
    tint?: number
    signal?: AbortSignal
  } = {},
): Promise<EnrichedCapture> {
  if (
    ![screenRect.x0, screenRect.y0, screenRect.x1, screenRect.y1].every(Number.isFinite) ||
    screenRect.x1 <= screenRect.x0 ||
    screenRect.y1 <= screenRect.y0
  )
    throw new Error('An enriched capture needs a non-empty finite rectangle')
  const crop = await captureViewCrop(screenRect, {
    pad: options.pad ?? 0,
    idPass: true,
    signal: options.signal,
  })
  if (options.signal?.aborted) throw new Error('Capture cancelled')
  try {
    if (!crop.idPass || !crop.cropRect) {
      throw new Error('The capture came back without its id buffer')
    }
    const { buffer, camera, nodes, canvasRect } = crop.idPass
    if (buffer.width !== crop.width || buffer.height !== crop.height) {
      throw new Error('The segmentation map and picture dimensions do not match')
    }
    const sx = buffer.width / Math.max(1, crop.cropRect.x1 - crop.cropRect.x0)
    const sy = buffer.height / Math.max(1, crop.cropRect.y1 - crop.cropRect.y0)
    const cropRect: PixelRect = {
      x0: Math.max(0, Math.round((screenRect.x0 - canvasRect.left - crop.cropRect.x0) * sx)),
      y0: Math.max(0, Math.round((screenRect.y0 - canvasRect.top - crop.cropRect.y0) * sy)),
      x1: Math.min(
        buffer.width,
        Math.round((screenRect.x1 - canvasRect.left - crop.cropRect.x0) * sx),
      ),
      y1: Math.min(
        buffer.height,
        Math.round((screenRect.y1 - canvasRect.top - crop.cropRect.y0) * sy),
      ),
    }
    const shares = visibleShares(buffer, cropRect)
    const colours = assignColours(shares)
    const legend = buildLegend(
      buffer,
      shares,
      colours,
      options.describe ?? defaultDescribe(nodes),
      labelAnchors(buffer, cropRect),
    )
    const visible: PointVisible[] = shares.map((share) =>
      share.nodeId && (share.kind === 'node' || share.kind === 'glass')
        ? {
            id: share.nodeId,
            ...(share.kind === 'glass' ? { class: 'glass' as const } : {}),
            share: share.share,
          }
        : { class: share.kind === 'node' ? 'unknown' : share.kind, share: share.share },
    )
    const rooms = zoneShares(buffer, zoneFootprints(crop.idPass), cropRect).map((room) => ({
      ...room,
      name: nodes[room.id]?.name?.trim() || 'Room',
    }))
    const segmented = await segmentationImage(buffer, colours, legend, shares, {
      crop: crop.dataUrl,
      tint: options.tint ?? 0.6,
      rect: cropRect,
    })
    return {
      crop: { dataUrl: crop.dataUrl, width: crop.width, height: crop.height },
      camera,
      region: { canvasRect: { ...screenRect }, cropRect },
      world: regionWorldPoints(buffer, cropRect),
      visible,
      legend,
      rooms,
      segmented,
      legendText: legend
        .map((row) => `${row.n} ${row.colourName} ${row.label} ${row.percent.toFixed(1)} %`)
        .join(' · '),
    }
  } catch (error) {
    throw new EnrichmentFallbackError(
      error instanceof Error ? error.message : 'Enriched capture failed',
      { dataUrl: crop.dataUrl, width: crop.width, height: crop.height },
    )
  }
}
