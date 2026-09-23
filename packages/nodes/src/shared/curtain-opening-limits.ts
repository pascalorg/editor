import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getCurtainWallConfig,
  getWallCurveLength,
  type WindowNode,
} from '@pascal-app/core'
import { resolveWallOpeningCeiling } from './wall-opening-ceiling'

type Opening = DoorNode | WindowNode

export function curtainOpeningResizeMax(
  opening: Opening,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  axis: 'x' | 'y',
  sign: number,
) {
  const limits = curtainOpeningLimits(opening, nodes)
  if (!limits) return undefined
  if (axis === 'y') {
    const anchor = opening.position[1] - (sign * opening.height) / 2
    return Math.max(0, sign > 0 ? limits.top - anchor : anchor - limits.bottom)
  }
  const direction = Math.cos(opening.rotation[1]) >= 0 ? sign : -sign
  const anchor = opening.position[0] - (direction * opening.width) / 2
  return Math.max(
    0,
    direction > 0 ? limits.length - limits.margin - anchor : anchor - limits.margin,
  )
}

export function curtainOpeningLimits(
  opening: Opening,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
) {
  const wall = nodes[(opening.parentId ?? opening.wallId) as AnyNodeId]
  if (wall?.type !== 'wall' || wall.wallType !== 'curtain') return null
  const margin = getCurtainWallConfig(wall).perimeterWidth
  const length = getWallCurveLength(wall)
  const top = resolveWallOpeningCeiling(wall, nodes) - margin
  const bottom = opening.type === 'door' ? 0 : margin
  return {
    margin,
    length,
    top,
    bottom,
    width: Math.max(
      0,
      2 * Math.min(opening.position[0] - margin, length - margin - opening.position[0]),
    ),
    height: Math.max(
      0,
      opening.type === 'door'
        ? top
        : 2 * Math.min(opening.position[1] - bottom, top - opening.position[1]),
    ),
  }
}

export function constrainCurtainOpening<T extends Opening>(
  opening: T,
  patch: Partial<T>,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): Partial<T> {
  const limits = curtainOpeningLimits(opening, nodes)
  if (!limits || !('width' in patch || 'height' in patch || 'position' in patch)) return patch
  const next = { ...opening, ...patch }
  const moving =
    patch.position !== undefined && patch.width === undefined && patch.height === undefined
  const availableWidth = Math.max(0, limits.length - 2 * limits.margin)
  const availableHeight = Math.max(0, limits.top - limits.bottom)
  const widthLimit = moving || limits.width < 0.01 ? availableWidth : limits.width
  const heightLimit = moving || limits.height < 0.01 ? availableHeight : limits.height
  const width = Math.min(Math.max(0.01, next.width), widthLimit)
  const height = Math.min(Math.max(0.01, next.height), heightLimit)
  if (width < 0.01 || height < 0.01) return {}
  const x = Math.max(
    limits.margin + width / 2,
    Math.min(limits.length - limits.margin - width / 2, next.position[0]),
  )
  const y =
    opening.type === 'door'
      ? height / 2
      : Math.max(limits.bottom + height / 2, Math.min(limits.top - height / 2, next.position[1]))
  return { ...patch, width, height, position: [x, y, next.position[2]] }
}
