import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'

export type FloorplanBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type FloorplanViewBox = { x: number; y: number; width: number; height: number }

export type FloorplanViewport = {
  left: number
  top: number
  width: number
  height: number
}

type PlanTransform = { tx: number; ty: number; rotation: number }

const IDENTITY: PlanTransform = { tx: 0, ty: 0, rotation: 0 }
const MIN_VIEWBOX_SIZE = 0.25
const MAX_VIEWBOX_SIZE = 500

function clientToViewBoxFraction(
  viewBox: FloorplanViewBox,
  viewport: FloorplanViewport,
  clientX: number,
  clientY: number,
): FloorplanPoint {
  const viewportWidth = Math.max(viewport.width, 1)
  const viewportHeight = Math.max(viewport.height, 1)
  const scale = Math.min(viewportWidth / viewBox.width, viewportHeight / viewBox.height)
  const renderedWidth = viewBox.width * scale
  const renderedHeight = viewBox.height * scale
  const renderedLeft = viewport.left + (viewportWidth - renderedWidth) / 2
  const renderedTop = viewport.top + (viewportHeight - renderedHeight) / 2
  return [(clientX - renderedLeft) / renderedWidth, (clientY - renderedTop) / renderedHeight]
}

export function clientToFloorplanPoint(
  viewBox: FloorplanViewBox,
  viewport: FloorplanViewport,
  clientX: number,
  clientY: number,
): FloorplanPoint {
  const [fractionX, fractionY] = clientToViewBoxFraction(viewBox, viewport, clientX, clientY)
  return [viewBox.x + fractionX * viewBox.width, viewBox.y + fractionY * viewBox.height]
}

export function scaleFloorplanViewBox(
  viewBox: FloorplanViewBox,
  factor: number,
  anchorX = 0.5,
  anchorY = 0.5,
): FloorplanViewBox {
  const minFactor = Math.max(MIN_VIEWBOX_SIZE / viewBox.width, MIN_VIEWBOX_SIZE / viewBox.height)
  const maxFactor = Math.min(MAX_VIEWBOX_SIZE / viewBox.width, MAX_VIEWBOX_SIZE / viewBox.height)
  const clampedFactor = Math.min(Math.max(factor, minFactor), maxFactor)
  const width = viewBox.width * clampedFactor
  const height = viewBox.height * clampedFactor
  return {
    x: viewBox.x + (viewBox.width - width) * anchorX,
    y: viewBox.y + (viewBox.height - height) * anchorY,
    width,
    height,
  }
}

export function scaleFloorplanViewBoxBetweenClients(
  viewBox: FloorplanViewBox,
  factor: number,
  viewport: FloorplanViewport,
  sourceClient: FloorplanPoint,
  targetClient: FloorplanPoint,
): FloorplanViewBox {
  const sourcePoint = clientToFloorplanPoint(viewBox, viewport, sourceClient[0], sourceClient[1])
  const [targetX, targetY] = clientToViewBoxFraction(
    viewBox,
    viewport,
    targetClient[0],
    targetClient[1],
  )
  const scaled = scaleFloorplanViewBox(viewBox, factor, 0, 0)
  return {
    ...scaled,
    x: sourcePoint[0] - targetX * scaled.width,
    y: sourcePoint[1] - targetY * scaled.height,
  }
}

export function panFloorplanViewBox(
  viewBox: FloorplanViewBox,
  viewport: FloorplanViewport,
  sourceClient: FloorplanPoint,
  targetClient: FloorplanPoint,
): FloorplanViewBox {
  const sourcePoint = clientToFloorplanPoint(viewBox, viewport, sourceClient[0], sourceClient[1])
  const targetPoint = clientToFloorplanPoint(viewBox, viewport, targetClient[0], targetClient[1])
  return {
    ...viewBox,
    x: viewBox.x + sourcePoint[0] - targetPoint[0],
    y: viewBox.y + sourcePoint[1] - targetPoint[1],
  }
}

function applyTransform(point: FloorplanPoint, transform: PlanTransform): FloorplanPoint {
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  return [
    point[0] * cos - point[1] * sin + transform.tx,
    point[0] * sin + point[1] * cos + transform.ty,
  ]
}

function composeTransform(
  parent: PlanTransform,
  child: NonNullable<Extract<FloorplanGeometry, { kind: 'group' }>['transform']>,
): PlanTransform {
  const translated = applyTransform(child.translate ?? [0, 0], parent)
  return {
    tx: translated[0],
    ty: translated[1],
    rotation: parent.rotation + (child.rotate ?? 0),
  }
}

function includePoint(bounds: FloorplanBounds | null, point: FloorplanPoint): FloorplanBounds {
  if (!bounds) return { minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] }
  return {
    minX: Math.min(bounds.minX, point[0]),
    minY: Math.min(bounds.minY, point[1]),
    maxX: Math.max(bounds.maxX, point[0]),
    maxY: Math.max(bounds.maxY, point[1]),
  }
}

function includePoints(
  bounds: FloorplanBounds | null,
  points: readonly FloorplanPoint[],
  transform: PlanTransform,
): FloorplanBounds | null {
  let next = bounds
  for (const point of points) next = includePoint(next, applyTransform(point, transform))
  return next
}

function geometryBounds(
  geometry: FloorplanGeometry,
  transform: PlanTransform,
  bounds: FloorplanBounds | null,
): FloorplanBounds | null {
  switch (geometry.kind) {
    case 'group': {
      const nextTransform = geometry.transform
        ? composeTransform(transform, geometry.transform)
        : transform
      return geometry.children.reduce(
        (next, child) => geometryBounds(child, nextTransform, next),
        bounds,
      )
    }
    case 'polygon':
    case 'polyline':
    case 'hatch':
      return includePoints(bounds, geometry.points, transform)
    case 'rect':
      return includePoints(
        bounds,
        [
          [geometry.x, geometry.y],
          [geometry.x + geometry.width, geometry.y],
          [geometry.x + geometry.width, geometry.y + geometry.height],
          [geometry.x, geometry.y + geometry.height],
        ],
        transform,
      )
    case 'circle': {
      const center = applyTransform([geometry.cx, geometry.cy], transform)
      return includePoints(
        bounds,
        [
          [center[0] - geometry.r, center[1] - geometry.r],
          [center[0] + geometry.r, center[1] + geometry.r],
        ],
        IDENTITY,
      )
    }
    case 'line':
    case 'hit-line':
    case 'edge-handle':
      return includePoints(
        bounds,
        [
          [geometry.x1, geometry.y1],
          [geometry.x2, geometry.y2],
        ],
        transform,
      )
    case 'text':
      return includePoint(bounds, applyTransform([geometry.x, geometry.y], transform))
    case 'image': {
      const halfWidth = geometry.width / 2
      const halfHeight = geometry.height / 2
      const imageTransform = composeTransform(transform, {
        translate: geometry.center,
        rotate: geometry.rotation,
      })
      return includePoints(
        bounds,
        [
          [-halfWidth, -halfHeight],
          [halfWidth, -halfHeight],
          [halfWidth, halfHeight],
          [-halfWidth, halfHeight],
        ],
        imageTransform,
      )
    }
    case 'endpoint-handle':
    case 'midpoint-handle':
    case 'move-handle':
    case 'move-arrow':
    case 'rotate-arrow':
    case 'equal-spacing-badge':
      return includePoint(bounds, applyTransform(geometry.point, transform))
    case 'dimension-label':
      return includePoint(bounds, applyTransform([geometry.cx, geometry.cy], transform))
    case 'dimension':
      return includePoints(
        bounds,
        [
          geometry.start,
          geometry.end,
          geometry.dimensionStart ?? geometry.start,
          geometry.dimensionEnd ?? geometry.end,
        ],
        transform,
      )
    case 'dimension-string':
      return geometry.segments.reduce(
        (next, segment) =>
          includePoints(
            next,
            [
              segment.start,
              segment.end,
              segment.dimensionStart ?? segment.start,
              segment.dimensionEnd ?? segment.end,
            ],
            transform,
          ),
        bounds,
      )
    case 'path':
      return bounds
    default:
      return bounds
  }
}

export function getFloorplanBounds(
  geometries: readonly FloorplanGeometry[],
): FloorplanBounds | null {
  return geometries.reduce(
    (bounds, geometry) => geometryBounds(geometry, IDENTITY, bounds),
    null as FloorplanBounds | null,
  )
}

export function padFloorplanBounds(bounds: FloorplanBounds, ratio = 0.12): FloorplanBounds {
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const padding = Math.max(Math.max(width, height) * ratio, 0.75)
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  }
}
