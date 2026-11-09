import {
  type AnyNode,
  type AnyNodeId,
  ceilingRegionsOwner,
  generateId,
  generateSceneMaterialId,
  type MaterialSchema,
  type SceneMaterial,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
  WALL_FACE_REGION_LIMIT,
  type WallFace,
  type WallFaceRegion,
} from '@pascal-app/core'

// Data writes for the paint tool's region sub-modes: a wall face region
// (`wall.faceRegions`), a room floor region (`zone.floor.regions`) or a ceiling
// region (`zone.ceiling.regions` for a room's ceiling, `ceiling.regions` for a
// manual one). Every
// write is one scene update, so one undo step; a one-off colour mints one
// shared scene material, the same way the paint fan-out does.

export const WALL_REGION_CAP_MESSAGE = `Up to ${WALL_FACE_REGION_LIMIT} regions per wall face`

type Resolved = { ref: string; newSceneMaterial: SceneMaterial | null }

function sameMaterial(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The finish ref for the paint material, minting a scene material when it is a one-off colour. */
export function resolvePaintRegionFinish(
  materials: Record<SceneMaterialId, SceneMaterial>,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Resolved | null {
  if (materialPreset) return { ref: materialPreset, newSceneMaterial: null }
  if (!material) return null
  const existing = Object.values(materials).find((scene) => sameMaterial(scene.material, material))
  if (existing) return { ref: toSceneMaterialRef(existing.id), newSceneMaterial: null }
  const id = generateSceneMaterialId()
  return {
    ref: toSceneMaterialRef(id),
    newSceneMaterial: { id, name: `Material ${Object.keys(materials).length + 1}`, material },
  }
}

export type WallRegionBounds = Pick<WallFaceRegion, 'u0' | 'u1' | 'v0' | 'v1'>
export type RegionWriteResult = { ok: true; id: string } | { ok: false; message: string }

/** Whether a face can take another region. */
export function wallFaceHasRoom(
  wall: { faceRegions?: WallFaceRegion[] } | undefined,
  face: WallFace,
): boolean {
  return (
    (wall?.faceRegions ?? []).filter((region) => region.face === face).length <
    WALL_FACE_REGION_LIMIT
  )
}

/** Adds a painted region to a wall face (later regions win). */
export function addWallRegion(
  wallId: string,
  face: WallFace,
  bounds: WallRegionBounds,
  paint: { material?: MaterialSchema; materialPreset?: string },
): RegionWriteResult {
  const state = useScene.getState()
  const wall = state.nodes[wallId as AnyNodeId]
  if (wall?.type !== 'wall') return { ok: false, message: 'Select a wall' }
  if (!wallFaceHasRoom(wall, face)) return { ok: false, message: WALL_REGION_CAP_MESSAGE }
  const resolved = resolvePaintRegionFinish(state.materials, paint.material, paint.materialPreset)
  if (!resolved) return { ok: false, message: 'Pick a material first' }
  const id = generateId('region')
  const region: WallFaceRegion = {
    id,
    face,
    ...Object.fromEntries(Object.entries(bounds).filter(([, value]) => value !== undefined)),
    finish: resolved.ref,
  }
  writeNode(
    wall.id,
    { faceRegions: [...(wall.faceRegions ?? []), region] },
    resolved.newSceneMaterial,
  )
  return { ok: true, id }
}

/** Replaces a region's bounds (absent = to the edge). */
export function updateWallRegion(wallId: string, regionId: string, bounds: WallRegionBounds) {
  const wall = useScene.getState().nodes[wallId as AnyNodeId]
  if (wall?.type !== 'wall') return false
  const regions = wall.faceRegions ?? []
  if (!regions.some((region) => region.id === regionId)) return false
  writeNode(wall.id, {
    faceRegions: regions.map((region) => {
      if (region.id !== regionId) return region
      const { u0: _u0, u1: _u1, v0: _v0, v1: _v1, ...rest } = region
      return {
        ...rest,
        ...Object.fromEntries(Object.entries(bounds).filter(([, value]) => value !== undefined)),
      } as WallFaceRegion
    }),
  })
  return true
}

export function removeWallRegion(wallId: string, regionId: string) {
  const wall = useScene.getState().nodes[wallId as AnyNodeId]
  if (wall?.type !== 'wall') return false
  const regions = wall.faceRegions ?? []
  if (!regions.some((region) => region.id === regionId)) return false
  const next = regions.filter((region) => region.id !== regionId)
  writeNode(wall.id, { faceRegions: next.length ? next : undefined })
  return true
}

/** Adds a painted region to a room floor (a polygon in level XZ, later wins). */
export function addFloorRegion(
  zoneId: string,
  polygon: [number, number][],
  paint: { material?: MaterialSchema; materialPreset?: string },
): RegionWriteResult {
  const state = useScene.getState()
  const zone = state.nodes[zoneId as AnyNodeId]
  if (zone?.type !== 'zone') return { ok: false, message: 'Select a room' }
  if (polygon.length < 3) return { ok: false, message: 'Draw at least three points' }
  const resolved = resolvePaintRegionFinish(state.materials, paint.material, paint.materialPreset)
  if (!resolved) return { ok: false, message: 'Pick a material first' }
  const id = generateId('region')
  const floor = { ...zone.floor }
  floor.regions = [...(floor.regions ?? []), { id, polygon, finish: resolved.ref }]
  writeNode(zone.id, { floor }, resolved.newSceneMaterial)
  return { ok: true, id }
}

/**
 * Adds a painted region to a ceiling's underside (a polygon in level XZ, later
 * wins). An automatic ceiling is rebuilt from its room, so its room keeps it.
 */
export function addCeilingRegion(
  ceilingId: string,
  polygon: [number, number][],
  paint: { material?: MaterialSchema; materialPreset?: string },
): RegionWriteResult {
  const state = useScene.getState()
  const ceiling = state.nodes[ceilingId as AnyNodeId]
  if (ceiling?.type !== 'ceiling') return { ok: false, message: 'Select a ceiling' }
  if (polygon.length < 3) return { ok: false, message: 'Draw at least three points' }
  const resolved = resolvePaintRegionFinish(state.materials, paint.material, paint.materialPreset)
  if (!resolved) return { ok: false, message: 'Pick a material first' }
  const owner = ceilingRegionsOwner(ceiling)
  const node = state.nodes[owner.id as AnyNodeId]
  const id = generateId('region')
  const region = { id, polygon, finish: resolved.ref }
  if (node?.type === 'zone')
    writeNode(
      node.id,
      { ceiling: { ...node.ceiling, regions: [...(node.ceiling?.regions ?? []), region] } },
      resolved.newSceneMaterial,
    )
  else if (node?.type === 'ceiling')
    writeNode(node.id, { regions: [...(node.regions ?? []), region] }, resolved.newSceneMaterial)
  else return { ok: false, message: 'Select a room' }
  useScene.getState().markDirty(ceiling.id as AnyNodeId)
  return { ok: true, id }
}

function writeNode(id: string, data: Partial<AnyNode>, newSceneMaterial?: SceneMaterial | null) {
  useScene.setState((current) => {
    if (current.readOnly) return current
    const node = current.nodes[id as AnyNodeId]
    if (!node) return current
    const next = { ...node, ...data } as Record<string, unknown>
    for (const [key, value] of Object.entries(data)) if (value === undefined) delete next[key]
    const nodes = { ...current.nodes, [id]: next as AnyNode }
    return {
      nodes,
      ...(newSceneMaterial
        ? {
            materials: {
              ...current.materials,
              [newSceneMaterial.id as SceneMaterialId]: newSceneMaterial,
            },
          }
        : {}),
    }
  })
  useScene.getState().markDirty(id as AnyNodeId)
}
