import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getCurtainWallConfig,
  getDoorOpeningSize,
  getWallCurveLength,
  openingHostFacing,
  type WindowNode,
} from '@pascal-app/core'
import { clampDoorToWall } from '@pascal-app/core/building'
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
  const size = getDoorOpeningSize(opening)
  const extraWidth = size.width - opening.width
  const extraHeight = size.height - opening.height
  const centerX = opening.position[0] - size.leafOffsetX * openingHostFacing(opening)
  if (axis === 'y') {
    const anchor = opening.position[1] + extraHeight / 2 - (sign * size.height) / 2
    return Math.max(
      0,
      sign > 0 ? limits.top - anchor - extraHeight : anchor - limits.bottom - extraHeight,
    )
  }
  const direction = Math.cos(opening.rotation[1]) >= 0 ? sign : -sign
  const anchor = centerX - (direction * size.width) / 2
  return Math.max(
    0,
    direction > 0
      ? limits.length - limits.margin - anchor - extraWidth
      : anchor - limits.margin - extraWidth,
  )
}

export function curtainOpeningLimits(
  opening: Opening,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
) {
  const wall = nodes[(opening.parentId ?? opening.wallId) as AnyNodeId]
  if (wall?.type !== 'wall' || wall.wallType !== 'curtain') return null
  const size = getDoorOpeningSize(opening)
  const centerX = opening.position[0] - size.leafOffsetX * openingHostFacing(opening)
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
      2 * Math.min(centerX - margin, length - margin - centerX) - (size.width - opening.width),
    ),
    height: Math.max(
      0,
      opening.type === 'door'
        ? top - (size.height - opening.height)
        : 2 * Math.min(opening.position[1] - bottom, top - opening.position[1]),
    ),
  }
}

export function constrainCurtainOpening<T extends Opening>(
  opening: T,
  patch: Partial<T>,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): Partial<T> {
  let next = { ...opening, ...patch }
  const wall = nodes[(next.parentId ?? next.wallId) as AnyNodeId]
  if (
    next.type === 'door' &&
    wall?.type === 'wall' &&
    'transomHeight' in next &&
    next.transomHeight
  ) {
    const { transomHeight } = clampDoorToWall(
      wall,
      next.position[0],
      next.width,
      next.height,
      next,
      nodes,
    )
    if (transomHeight !== undefined && transomHeight !== next.transomHeight) {
      patch = { ...patch, transomHeight }
      next = { ...opening, ...patch }
    }
  }
  const limits = curtainOpeningLimits(next, nodes)
  if (
    !limits ||
    !(
      'width' in patch ||
      'height' in patch ||
      'position' in patch ||
      'sidelightLeft' in patch ||
      'sidelightRight' in patch ||
      'transomHeight' in patch
    )
  )
    return patch
  const size = getDoorOpeningSize(next)
  const extraWidth = size.width - next.width
  const extraHeight = size.height - next.height
  const offset = size.leafOffsetX * openingHostFacing(next)
  const moving =
    patch.position !== undefined && patch.width === undefined && patch.height === undefined
  const availableWidth = Math.max(0, limits.length - 2 * limits.margin - extraWidth)
  const availableHeight = Math.max(0, limits.top - limits.bottom - extraHeight)
  const widthLimit = moving || limits.width < 0.01 ? availableWidth : limits.width
  const heightLimit = moving || limits.height < 0.01 ? availableHeight : limits.height
  const width = Math.min(Math.max(0.01, next.width), widthLimit)
  const height = Math.min(Math.max(0.01, next.height), heightLimit)
  if (width < 0.01 || height < 0.01) return {}
  const x = Math.max(
    limits.margin + (width + extraWidth) / 2,
    Math.min(limits.length - limits.margin - (width + extraWidth) / 2, next.position[0] - offset),
  )
  const y =
    opening.type === 'door'
      ? height / 2
      : Math.max(limits.bottom + height / 2, Math.min(limits.top - height / 2, next.position[1]))
  return { ...patch, width, height, position: [x + offset, y, next.position[2]] }
}
