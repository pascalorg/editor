import { refuse } from '../agent-tools/refusal'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import { wallFaceBaseOffset } from '../lib/wall-face-script'
import { queryNodes } from '../runtime/node-queries'
import type {
  AnyNode,
  WallFace,
  WallFaceRegion,
  WallNode,
  WallTrimKind,
  WallTrimProfile,
  ZoneNode,
} from '../schema'
import { dressLevel, fixtureTarget, runTargets, standsAgainst } from './dress-targets'
import { requireMaterialRef } from './material-refs'
import { type RoomWallFace, roomBoundaryWalls, roomWallFaces } from './room-faces'
import type { AgentOperation, SceneNodes } from './types'
import {
  dressRegionOwner,
  type FaceRegionPlan,
  type FaceRegionSpec,
  setWallFaceRegions,
} from './wall-face-regions'
import { sceneUpdates, setWallTrim } from './wall-skirting'

export type DressLayerKind = WallTrimKind | 'wainscot' | 'tiles' | 'splashback' | 'accent'
export type DressLayer = {
  kind: DressLayerKind
  finish?: string
  from?: number
  to?: number | 'full'
  height?: number
  depth?: number
  offsetY?: number
  profile?: WallTrimProfile
  where?: { walls?: string[]; around?: string[]; margin?: number; alongRun?: string }
}
export type DressRoomInput = { zoneIds: string[]; layers: DressLayer[]; dryRun?: boolean }
export type DressedTrim = {
  height: number
  depth: number
  profile: WallTrimProfile
  offsetY?: number
}
export type DressedFace = {
  wallId: string
  face: WallFace
  regions: Omit<WallFaceRegion, 'face'>[]
  trims: Partial<Record<WallTrimKind, DressedTrim>>
  count: number
}
export type DressedRoom = { zoneId: string; name: string; faces: DressedFace[] }
export type DressSkipped = { zoneId: string; layer?: number; why: string }
const isTrim = (kind: DressLayerKind): kind is WallTrimKind =>
  kind === 'skirting' || kind === 'chairRail' || kind === 'crown'

function checkLayer(layer: DressLayer, index: number) {
  const label = `Layer ${index} (${layer.kind})`
  if (
    !['skirting', 'chairRail', 'crown', 'wainscot', 'tiles', 'splashback', 'accent'].includes(
      layer.kind,
    )
  )
    refuse('invalid_layer', `${label}: unknown layer kind.`, { layer: index })
  for (const [field, value] of [
    ['height', layer.height],
    ['depth', layer.depth],
    ['offsetY', layer.offsetY],
    ['from', layer.from],
    ['margin', layer.where?.margin],
  ] as const)
    if (
      value !== undefined &&
      !(
        Number.isFinite(value) && (field === 'height' || field === 'depth' ? value > 0 : value >= 0)
      )
    )
      refuse(
        'invalid_size',
        `${label}: ${field} must be a valid nonnegative length (height and depth above zero).`,
        { layer: index, field },
      )
  if (isTrim(layer.kind)) {
    if (
      layer.from !== undefined ||
      layer.to !== undefined ||
      layer.where?.around !== undefined ||
      layer.where?.alongRun !== undefined ||
      layer.where?.margin !== undefined
    )
      refuse(
        'invalid_layer',
        `${label}: trims follow the room's wall stretches; finish placement and heights do not apply.`,
        { layer: index },
      )
    if (layer.offsetY !== undefined && layer.kind !== 'chairRail')
      refuse('invalid_layer', `${label}: offsetY belongs to a chair rail.`, { layer: index })
    return
  }
  if (
    [layer.height, layer.depth, layer.offsetY, layer.profile].some((value) => value !== undefined)
  )
    refuse('invalid_layer', `${label}: trim dimensions and profiles do not apply to a finish.`, {
      layer: index,
    })
  if (!layer.finish) refuse('finish_required', `${label} needs a finish.`, { layer: index })
  if (layer.kind === 'accent' && !layer.where?.walls?.length)
    refuse('walls_required', `${label}: name the feature walls in where.walls.`, { layer: index })
  const { around, alongRun, margin } = layer.where ?? {}
  if (
    (around !== undefined && alongRun !== undefined) ||
    (around !== undefined && (!around.length || around.length > 8)) ||
    (margin !== undefined && !around?.length) ||
    (layer.from !== undefined && layer.kind !== 'splashback')
  )
    refuse(
      'invalid_layer',
      `${label}: use around fixtures with optional margin, or alongRun; from belongs to a splashback.`,
      { layer: index },
    )
  if (
    layer.to !== undefined &&
    layer.to !== 'full' &&
    !(Number.isFinite(layer.to) && layer.to > (layer.from ?? 0))
  )
    refuse('invalid_size', `${label}: to must be above from, or full.`, { layer: index })
}

type Placed = RoomWallFace & { worktop?: number }
function stretchesFor(
  nodes: SceneNodes,
  zone: ZoneNode,
  stretches: RoomWallFace[],
  layer: DressLayer,
  skipped: DressSkipped[],
  index: number,
): Placed[] {
  for (const id of layer.where?.walls ?? []) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') refuse('target_not_found', `${id} is not a wall.`, { target: id })
    if (wall.wallType === 'curtain' || wall.wallType === 'railing')
      refuse(
        `${wall.wallType}_wall`,
        `Wall ${id} is a ${wall.wallType}: it cannot carry this layer.`,
        { target: id },
      )
    if (!zone.boundaryWallIds?.includes(wall.id))
      refuse('not_on_room', `Wall ${id} does not bound ${zone.name}.`, { target: id })
    if (!stretches.some((stretch) => stretch.wallId === id))
      refuse('side_unknown', `Wall ${id} has no face looking into ${zone.name}.`, { target: id })
  }
  const here = layer.where?.walls
    ? stretches.filter((stretch) => layer.where!.walls!.includes(stretch.wallId))
    : stretches
  const { around, alongRun } = layer.where ?? {}
  if (!around?.length && alongRun === undefined) return here
  const levelId = dressLevel(nodes, zone.id)
  const targets = around?.length
    ? [...new Set(around)].map((id) => fixtureTarget(nodes, id, levelId))
    : runTargets(nodes, alongRun!, levelId)
  return targets.flatMap((target) => {
    const placed = here.flatMap((stretch): Placed[] => {
      if (stretch.curved) return []
      const wall = nodes[stretch.wallId] as WallNode
      const bounds = standsAgainst(
        wall,
        stretch,
        target.corners,
        around ? (layer.where?.margin ?? 0.1) : 0,
      )
      if (!bounds) return []
      const support = target.worktop === undefined ? undefined : wallSupportForNodes(wall, nodes)
      const worktop =
        support && target.worktop !== undefined
          ? target.worktop - support.elevation - wallFaceBaseOffset(support, stretch.face)
          : undefined
      return [{ ...stretch, ...bounds, whole: false, worktop }]
    })
    if (!placed.length)
      skipped.push({
        zoneId: zone.id,
        layer: index,
        why: `${target.id} stands against no selected straight face of ${zone.name}`,
      })
    return placed
  })
}

/** One scratch plan for all rooms; only the final outcome may be applied by a host. */
export const dressRoom: AgentOperation<DressRoomInput> = (nodes, input, context) => {
  if (!input.zoneIds?.length) refuse('target_required', 'Name the rooms (zoneIds) to dress.')
  if (input.zoneIds.length > 16 || !Array.isArray(input.layers) || input.layers.length > 8)
    refuse('invalid_layer', 'Dress at most 16 rooms with at most eight layers.')
  input.layers.forEach(checkLayer)
  const zones = [...new Set(input.zoneIds)].map((id) => {
    const zone = nodes[id]
    if (zone?.type !== 'zone' || zone.spaceRole !== 'room')
      refuse('target_not_found', `${id} is not a room in the scene.`, { target: id })
    if (!roomBoundaryWalls(nodes, zone).length)
      refuse('no_walls', `Room ${zone.name} has no walls to dress.`, { target: id })
    return zone
  })
  const scratch: Record<string, AnyNode> = { ...nodes }
  const skipped: DressSkipped[] = []
  const plans = zones.map((zone) => ({
    zone,
    stretches: roomWallFaces(nodes, zone),
    regions: new Map<string, FaceRegionPlan>(),
    trims: new Map<string, Set<WallTrimKind>>(),
    clearWallIds: new Set<string>(),
  }))
  let note: string | undefined

  // Remove all requested owners before counting replacements: stale regions of a later room
  // must not make an otherwise valid multi-room plan exceed the cap transiently.
  const owners = zones.map((zone) => dressRegionOwner(zone.id))
  for (const wall of queryNodes(nodes, { type: 'wall' })) {
    if (wall.type !== 'wall') continue
    const kept = wall.faceRegions?.filter(
      (region) => !owners.some((owner) => region.id.startsWith(owner)),
    )
    if (kept && kept.length !== wall.faceRegions?.length) {
      for (const plan of plans)
        if (
          wall.faceRegions?.some((region) => region.id.startsWith(dressRegionOwner(plan.zone.id)))
        )
          plan.clearWallIds.add(wall.id)
      scratch[wall.id] = { ...wall, faceRegions: kept }
    }
  }

  input.layers.forEach((layer, index) => {
    const placed = plans.map((plan) =>
      stretchesFor(nodes, plan.zone, plan.stretches, layer, skipped, index),
    )
    if (isTrim(layer.kind)) {
      const kind = layer.kind
      const outcome = setWallTrim(
        scratch,
        {
          kind,
          zoneIds: zones.map((zone) => zone.id),
          roomWallIds: layer.where?.walls,
          height: layer.height,
          depth: layer.depth,
          offsetY: layer.offsetY,
          profile: layer.profile,
          finish: layer.finish,
        },
        context,
      )
      for (const { id, data } of outcome.changes?.update ?? [])
        scratch[id] = { ...scratch[id], ...data } as AnyNode
      // Always execute the operation before retaining the first colour-matching note.
      note ??= outcome.result.note as string | undefined
      plans.forEach((plan, at) => {
        for (const stretch of placed[at]!) {
          const key = `${stretch.wallId}/${stretch.face}`
          plan.trims.set(key, new Set([...(plan.trims.get(key) ?? []), kind]))
        }
      })
      return
    }
    const finish = /^#[0-9a-f]{6}$/i.test(layer.finish!)
      ? layer.finish!
      : requireMaterialRef(layer.finish!, 'finish', 'wall', { materials: context.materials })
    plans.forEach((plan, at) => {
      for (const stretch of placed[at]!) {
        if (stretch.curved && !stretch.whole) {
          skipped.push({
            zoneId: plan.zone.id,
            layer: index,
            why: `${stretch.wallId} is curved and the room covers only part of its face; bounded finishes are unsupported`,
          })
          continue
        }
        const from =
          layer.kind === 'splashback' ? (layer.from ?? stretch.worktop ?? 0.9) : undefined
        const to =
          layer.to === 'full'
            ? undefined
            : (layer.to ??
              (layer.kind === 'wainscot'
                ? 0.9
                : layer.kind === 'tiles'
                  ? 1.2
                  : layer.kind === 'splashback'
                    ? (from ?? 0.9) + 0.6
                    : undefined))
        if (to !== undefined && to <= (from ?? 0))
          refuse(
            'invalid_size',
            `Layer ${index}: to must be above the splashback's starting height.`,
            { layer: index },
          )
        const spec: FaceRegionSpec = {
          finish,
          ...(stretch.whole ? {} : { u0: stretch.u0, u1: stretch.u1 }),
          ...(from ? { v0: from } : {}),
          ...(to === undefined ? {} : { v1: to }),
        }
        const key = `${stretch.wallId}/${stretch.face}`
        const entry = plan.regions.get(key) ?? {
          wallId: stretch.wallId,
          face: stretch.face,
          regions: [],
        }
        entry.regions.push(spec)
        plan.regions.set(key, entry)
      }
    })
  })
  for (const plan of plans) {
    const outcome = setWallFaceRegions(
      scratch,
      {
        owner: dressRegionOwner(plan.zone.id),
        faces: [...plan.regions.values()],
        clearWallIds: [...plan.clearWallIds],
      },
      context,
    )
    for (const { id, data } of outcome.changes?.update ?? [])
      scratch[id] = { ...scratch[id], ...data } as AnyNode
    for (const skip of (outcome.result.skipped ?? []) as {
      wallId: string
      face: WallFace
      why: string
    }[])
      skipped.push({ zoneId: plan.zone.id, why: `${skip.wallId} side ${skip.face}: ${skip.why}` })
  }
  const rooms: DressedRoom[] = plans.map((plan) => {
    const faces = new Map<string, DressedFace>()
    for (const stretch of plan.stretches) {
      const { wallId, face } = stretch
      const key = `${wallId}/${face}`
      if (faces.has(key)) continue
      const wall = scratch[wallId] as WallNode
      const regions = (wall.faceRegions ?? []).filter((region) => region.face === face)
      const owned = regions.filter((region) => region.id.startsWith(dressRegionOwner(plan.zone.id)))
      const trims: DressedFace['trims'] = {}
      for (const kind of plan.trims.get(key) ?? []) {
        const config = wall[kind]!
        trims[kind] = {
          height: config.height,
          depth: config.proud,
          profile: config.profile,
          ...(kind === 'chairRail' ? { offsetY: config.offsetY } : {}),
        }
      }
      faces.set(key, {
        wallId,
        face,
        regions: owned.map(({ face: _face, ...region }) => region),
        trims,
        count: regions.length,
      })
    }
    return { zoneId: plan.zone.id, name: plan.zone.name, faces: [...faces.values()] }
  })
  return {
    result: {
      ok: true,
      written: !input.dryRun,
      rooms,
      conflicts: [],
      ...(skipped.length ? { skipped } : {}),
      ...(note ? { note } : {}),
    },
    changes: input.dryRun ? {} : { update: sceneUpdates(nodes, scratch) },
  }
}
