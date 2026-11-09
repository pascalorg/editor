import type { AnyNode, WallNode } from '@pascal-app/core'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { guardBoxGeometry } from '../stair/baluster-geometry'
import type { GuardBox } from '../stair/guard-path'
import { buildRailingWallGuard } from './railing-wall-guard'

/** The railing mesh's palette: its posts, rails and caps, then its infill (`wallSlots`). */
export const RAILING_FRAME_MATERIAL_INDEX = 0
export const RAILING_INFILL_MATERIAL_INDEX = 1

function boxesGeometry(boxes: readonly GuardBox[]): BufferGeometry | null {
  if (boxes.length === 0) return null
  const parts = boxes.map(guardBoxGeometry)
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  return merged
}

function emptyGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    ['uv2', 2],
  ] as const)
    geometry.setAttribute(name, new Float32BufferAttribute([], size))
  return geometry
}

/**
 * A railing wall's mesh in the wall's frame (`railing-wall-guard.ts`), from its floor at y 0: the
 * posts, rails and caps in group 0 and the infill (balusters, boards, cables, glass) in group 1,
 * so each takes its own slot. `walls` are the level's, read for the ends that die into a wall.
 */
export function buildRailingWallGeometry(
  wall: WallNode,
  children: readonly AnyNode[],
  walls: readonly WallNode[],
): BufferGeometry {
  const guard = buildRailingWallGuard(wall, children, walls, 'local')
  const parts = [
    { geometry: boxesGeometry(guard.frame), materialIndex: RAILING_FRAME_MATERIAL_INDEX },
    { geometry: boxesGeometry(guard.infill), materialIndex: RAILING_INFILL_MATERIAL_INDEX },
  ].filter((part): part is { geometry: BufferGeometry; materialIndex: number } => !!part.geometry)
  if (parts.length === 0) return emptyGeometry()
  const merged = mergeGeometries(
    parts.map((part) => part.geometry),
    true,
  )
  for (const part of parts) part.geometry.dispose()
  if (!merged) return emptyGeometry()
  // `mergeGeometries` numbers its groups by input; give each its slot's palette entry.
  merged.groups.forEach((group, index) => {
    group.materialIndex = parts[index]!.materialIndex
  })
  return merged
}
