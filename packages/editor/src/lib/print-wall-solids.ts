import {
  type AnyNode,
  type DoorNode,
  getWallThickness,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Manufacturing geometry belongs to the editor layer, not the read-only viewer runtime.
const DIMENSION_EPSILON = 1e-7
const SOLID_JOIN_OVERLAP = 1e-5

type PrintWallOpening = DoorNode | WindowNode

type OpeningInterval = {
  node: PrintWallOpening
  left: number
  right: number
  bottom: number
  top: number
}

export type PrintWallSolidDiagnostic = {
  severity: 'error'
  code:
    | 'invalid_wall_print_dimensions'
    | 'unsupported_wall_print_curve'
    | 'unsupported_wall_print_terrain'
    | 'unsupported_wall_print_opening_shape'
    | 'invalid_wall_print_opening'
    | 'unresolved_wall_print_child'
  message: string
  nodeIds: string[]
}

export type PrintWallSolidOptions = {
  effectiveHeight: number
  includedNodeIds?: ReadonlySet<string>
}

export type PrintWallSolidResult =
  | { status: 'ready'; object: THREE.Group; diagnostics: [] }
  | { status: 'blocked'; object: null; diagnostics: PrintWallSolidDiagnostic[] }

function finite(values: number[]): boolean {
  return values.every(Number.isFinite)
}

function openingInterval(
  wall: WallNode,
  opening: PrintWallOpening,
  length: number,
  height: number,
): { interval: OpeningInterval | null; diagnostic: PrintWallSolidDiagnostic | null } {
  if (opening.wallId && opening.wallId !== wall.id) {
    return {
      interval: null,
      diagnostic: {
        severity: 'error',
        code: 'invalid_wall_print_opening',
        message: `Opening ${opening.id} is listed by wall ${wall.id} but references ${opening.wallId}.`,
        nodeIds: [wall.id, opening.id].sort(),
      },
    }
  }
  if (opening.openingShape !== 'rectangle') {
    return {
      interval: null,
      diagnostic: {
        severity: 'error',
        code: 'unsupported_wall_print_opening_shape',
        message: `Opening ${opening.id} uses a ${opening.openingShape} profile that does not yet have a printable wall fixture.`,
        nodeIds: [wall.id, opening.id].sort(),
      },
    }
  }

  const [centerX, centerY] = opening.position
  const { width, height: openingHeight } = opening
  if (
    !finite([centerX, centerY, width, openingHeight]) ||
    width <= DIMENSION_EPSILON ||
    openingHeight <= DIMENSION_EPSILON
  ) {
    return {
      interval: null,
      diagnostic: {
        severity: 'error',
        code: 'invalid_wall_print_opening',
        message: `Opening ${opening.id} has invalid printable dimensions.`,
        nodeIds: [wall.id, opening.id].sort(),
      },
    }
  }

  const interval = {
    node: opening,
    left: centerX - width / 2,
    right: centerX + width / 2,
    bottom: centerY - openingHeight / 2,
    top: centerY + openingHeight / 2,
  }
  if (
    interval.left < -DIMENSION_EPSILON ||
    interval.right > length + DIMENSION_EPSILON ||
    interval.bottom < -DIMENSION_EPSILON ||
    interval.top > height + DIMENSION_EPSILON ||
    interval.left >= interval.right - DIMENSION_EPSILON ||
    interval.bottom >= interval.top - DIMENSION_EPSILON
  ) {
    return {
      interval: null,
      diagnostic: {
        severity: 'error',
        code: 'invalid_wall_print_opening',
        message: `Opening ${opening.id} extends outside printable wall ${wall.id}.`,
        nodeIds: [wall.id, opening.id].sort(),
      },
    }
  }

  interval.left = THREE.MathUtils.clamp(interval.left, 0, length)
  interval.right = THREE.MathUtils.clamp(interval.right, 0, length)
  interval.bottom = THREE.MathUtils.clamp(interval.bottom, 0, height)
  interval.top = THREE.MathUtils.clamp(interval.top, 0, height)
  return { interval, diagnostic: null }
}

function collectOpenings(
  wall: WallNode,
  nodes: Record<string, AnyNode> | undefined,
  options: PrintWallSolidOptions,
  length: number,
): { openings: OpeningInterval[]; diagnostics: PrintWallSolidDiagnostic[] } {
  const openings: OpeningInterval[] = []
  const diagnostics: PrintWallSolidDiagnostic[] = []

  for (const childId of wall.children) {
    const child = nodes?.[childId]
    if (!child) {
      diagnostics.push({
        severity: 'error',
        code: 'unresolved_wall_print_child',
        message: `Wall ${wall.id} references unresolved child ${childId}.`,
        nodeIds: [wall.id, childId].sort(),
      })
      continue
    }
    if (options.includedNodeIds && !options.includedNodeIds.has(child.id)) continue
    if (child.type !== 'door' && child.type !== 'window') continue

    const result = openingInterval(wall, child, length, options.effectiveHeight)
    if (result.diagnostic) diagnostics.push(result.diagnostic)
    if (result.interval) openings.push(result.interval)
  }

  return { openings, diagnostics }
}

function uniqueBreakpoints(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const result: number[] = []
  for (const value of sorted) {
    if (result.length === 0 || value - result[result.length - 1]! > DIMENSION_EPSILON) {
      result.push(value)
    }
  }
  return result
}

function mergedVerticalCuts(openings: OpeningInterval[], x: number): [number, number][] {
  const intervals = openings
    .filter((opening) => opening.left < x && opening.right > x)
    .map((opening) => [opening.bottom, opening.top] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []

  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (!previous || interval[0] > previous[1] + DIMENSION_EPSILON) {
      merged.push([...interval])
    } else {
      previous[1] = Math.max(previous[1], interval[1])
    }
  }
  return merged
}

function addSolid(
  root: THREE.Group,
  wallId: string,
  index: number,
  left: number,
  right: number,
  bottom: number,
  top: number,
  thickness: number,
  wallLength: number,
) {
  if (right - left <= DIMENSION_EPSILON || top - bottom <= DIMENSION_EPSILON) return
  const joinedLeft = Math.max(0, left - (left > DIMENSION_EPSILON ? SOLID_JOIN_OVERLAP : 0))
  const joinedRight = Math.min(
    wallLength,
    right + (right < wallLength - DIMENSION_EPSILON ? SOLID_JOIN_OVERLAP : 0),
  )
  const box = new THREE.BoxGeometry(joinedRight - joinedLeft, top - bottom, thickness)
  box.deleteAttribute('normal')
  box.deleteAttribute('uv')
  const geometry = mergeVertices(box, DIMENSION_EPSILON)
  box.dispose()
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry)
  mesh.name = `print-wall-solid-${index}`
  mesh.position.set((joinedLeft + joinedRight) / 2, (bottom + top) / 2, 0)
  mesh.userData = { pascalId: wallId }
  root.add(mesh)
}

export function buildPrintableWallSolids(
  node: WallNode,
  options: PrintWallSolidOptions,
  nodes?: Record<string, AnyNode>,
): PrintWallSolidResult {
  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = Math.hypot(dx, dz)
  const thickness = getWallThickness(node)
  const diagnostics: PrintWallSolidDiagnostic[] = []

  if (
    !finite([
      node.start[0],
      node.start[1],
      node.end[0],
      node.end[1],
      length,
      thickness,
      options.effectiveHeight,
    ]) ||
    length <= DIMENSION_EPSILON ||
    thickness <= DIMENSION_EPSILON ||
    options.effectiveHeight <= DIMENSION_EPSILON
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_wall_print_dimensions',
      message: `Wall ${node.id} has invalid printable length, thickness, or height.`,
      nodeIds: [node.id],
    })
  }
  if (Math.abs(node.curveOffset ?? 0) > DIMENSION_EPSILON) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported_wall_print_curve',
      message: `Curved wall ${node.id} does not yet have a canonical printable solid.`,
      nodeIds: [node.id],
    })
  }
  if (node.fillToTerrain) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported_wall_print_terrain',
      message: `Terrain-filled wall ${node.id} requires a terrain-aware printable base fixture.`,
      nodeIds: [node.id],
    })
  }
  if (diagnostics.length > 0) return { status: 'blocked', object: null, diagnostics }

  const collected = collectOpenings(node, nodes, options, length)
  diagnostics.push(...collected.diagnostics)
  if (diagnostics.length > 0) return { status: 'blocked', object: null, diagnostics }

  const root = new THREE.Group()
  root.name = 'print-wall-solids'
  root.userData = { pascalId: node.id }
  root.position.set(node.start[0], 0, node.start[1])
  root.rotation.y = -Math.atan2(dz, dx)

  const breakpoints = uniqueBreakpoints([
    0,
    length,
    ...collected.openings.flatMap((opening) => [opening.left, opening.right]),
  ])
  let solidIndex = 0
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const left = breakpoints[index]!
    const right = breakpoints[index + 1]!
    if (right - left <= DIMENSION_EPSILON) continue
    const cuts = mergedVerticalCuts(collected.openings, (left + right) / 2)
    let bottom = 0
    for (const [cutBottom, cutTop] of cuts) {
      addSolid(root, node.id, solidIndex, left, right, bottom, cutBottom, thickness, length)
      if (cutBottom - bottom > DIMENSION_EPSILON) solidIndex += 1
      bottom = Math.max(bottom, cutTop)
    }
    addSolid(
      root,
      node.id,
      solidIndex,
      left,
      right,
      bottom,
      options.effectiveHeight,
      thickness,
      length,
    )
    if (options.effectiveHeight - bottom > DIMENSION_EPSILON) solidIndex += 1
  }

  if (root.children.length === 0) {
    return {
      status: 'blocked',
      object: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'invalid_wall_print_opening',
          message: `Openings remove all printable material from wall ${node.id}.`,
          nodeIds: [node.id, ...collected.openings.map((opening) => opening.node.id)].sort(),
        },
      ],
    }
  }

  return { status: 'ready', object: root, diagnostics: [] }
}
