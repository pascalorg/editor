import {
  type AnyNode,
  getCatalogMaterialById,
  parseMaterialRef,
  roomSideFaces,
  type SceneMaterial,
  type SceneMaterialId,
  WALL_FACE_REGION_LIMIT,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
} from '@pascal-app/core'
import { getLinearUnitLabel, type LinearUnit, metersToLinearUnit } from './measurements'

// Rows for the wall panel's "Paint regions" list: finish swatch + name, the
// face in room terms when the wall has a room on exactly one side, and the
// bounds in the viewer unit.

const FALLBACK_SWATCH_COLOR = '#d4d4d8'

export type WallRegionFinish = { name: string; color: string; imageUrl?: string }

export type WallRegionRow = {
  id: string
  face: WallFace
  faceLabel: string
  finish: WallRegionFinish
  boundsText: string
}

/** "Inside" / "Outside" when a room sits on exactly one side of the wall, else "Face A" / "Face B". */
export function wallRegionFaceLabels(
  nodes: Readonly<Record<string, AnyNode>>,
  wallId: string,
): Record<WallFace, string> {
  try {
    const sides = roomSideFaces(nodes as Parameters<typeof roomSideFaces>[0], wallId)
    if (sides.inside && sides.outside) {
      return {
        [sides.inside]: 'Inside',
        [sides.outside]: 'Outside',
      } as Record<WallFace, string>
    }
  } catch {
    // Not a wall (any more): fall through to the neutral labels.
  }
  return { a: 'Face A', b: 'Face B' }
}

/** Name and swatch for a region's finish ref (library or scene material). */
export function describeRegionFinish(
  ref: string,
  materials: Readonly<Record<SceneMaterialId, SceneMaterial>>,
): WallRegionFinish {
  const parsed = parseMaterialRef(ref)
  if (parsed?.kind === 'scene') {
    const scene = materials[parsed.id as SceneMaterialId]
    return {
      name: scene?.name ?? 'Custom finish',
      color: scene?.material.properties?.color ?? FALLBACK_SWATCH_COLOR,
      ...(scene?.material.texture?.url ? { imageUrl: scene.material.texture.url } : {}),
    }
  }
  if (parsed?.kind === 'library') {
    const item = getCatalogMaterialById(parsed.id)
    const imageUrl = item?.previewThumbnailUrl ?? item?.preset.maps.albedoMap
    return {
      name: item?.label ?? 'Library finish',
      color: item?.previewColor ?? item?.preset.mapProperties.color ?? FALLBACK_SWATCH_COLOR,
      ...(imageUrl ? { imageUrl } : {}),
    }
  }
  return { name: 'Custom finish', color: FALLBACK_SWATCH_COLOR }
}

function range(low: number | undefined, high: number | undefined, unit: LinearUnit, axis: string) {
  const value = (meters: number) => metersToLinearUnit(meters, unit).toFixed(2)
  const label = getLinearUnitLabel(unit)
  if (low === undefined && high === undefined) return null
  if (low === undefined) return `0–${value(high!)} ${label} ${axis}`
  if (high === undefined)
    return axis === 'high' ? `Above ${value(low)} ${label}` : `From ${value(low)} ${label} along`
  return `${value(low)}–${value(high)} ${label} ${axis}`
}

/** "1.20–2.40 m along, 0–0.90 m high"; absent bounds run to the face edge. */
export function formatRegionBounds(
  region: Pick<WallFaceRegion, 'u0' | 'u1' | 'v0' | 'v1'>,
  unit: LinearUnit,
): string {
  const parts = [
    range(region.u0, region.u1, unit, 'along'),
    range(region.v0, region.v1, unit, 'high'),
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : 'Whole face'
}

export function wallRegionRows(
  wall: Pick<WallNode, 'faceRegions'>,
  faceLabels: Record<WallFace, string>,
  materials: Readonly<Record<SceneMaterialId, SceneMaterial>>,
  unit: LinearUnit,
): WallRegionRow[] {
  const regions = wall.faceRegions ?? []
  return (['a', 'b'] as const).flatMap((face) =>
    regions
      .filter((region) => region.face === face)
      .map((region) => ({
        id: region.id,
        face,
        faceLabel: faceLabels[face],
        finish: describeRegionFinish(region.finish, materials),
        boundsText: formatRegionBounds(region, unit),
      })),
  )
}

/** Faces that already hold the maximum number of regions. */
export function fullWallFaces(wall: Pick<WallNode, 'faceRegions'>): WallFace[] {
  const regions = wall.faceRegions ?? []
  return (['a', 'b'] as const).filter(
    (face) => regions.filter((region) => region.face === face).length >= WALL_FACE_REGION_LIMIT,
  )
}

/** The cap notice under the list, naming the full face when only one is. */
export function wallRegionCapNotice(
  wall: Pick<WallNode, 'faceRegions'>,
  faceLabels: Record<WallFace, string>,
): string | null {
  const full = fullWallFaces(wall)
  const cap = `up to ${WALL_FACE_REGION_LIMIT} regions per face`
  if (full.length === 0) return null
  if (full.length === 2) return `Up to ${WALL_FACE_REGION_LIMIT} regions per face`
  return `${faceLabels[full[0]!]} is full: ${cap}`
}
