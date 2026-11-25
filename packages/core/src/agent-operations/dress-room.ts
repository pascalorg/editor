import { refuse } from '../agent-tools/refusal'
import { ceilingRegionsOwner } from '../lib/ceiling-surface'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import { wallFaceBaseOffset } from '../lib/wall-face-script'
import type { MaterialSurface } from '../material-kinds'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import { queryNodes } from '../runtime/node-queries'
import {
  type AnyNode,
  CeilingFrameConfig,
  type CeilingFrameStyle,
  CeilingMedallionConfig,
  type CeilingMedallionStyle,
  type CeilingNode,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
  type WallTrimKind,
  type WallTrimProfile,
  type ZoneNode,
} from '../schema'
import { dressLevel, fixtureTarget, runTargets, standsAgainst } from './dress-targets'
import { requireMaterialRef } from './material-refs'
import { type RoomWallFace, roomBoundaryWalls, roomWallFaces } from './room-faces'
import type { AgentContext, AgentOperation, SceneNodes } from './types'
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
export type DressCeilingMedallionInput = {
  enabled?: boolean
  style?: CeilingMedallionStyle
  diameter?: number
  relief?: number
  offset?: [number, number]
  at?: [number, number]
  finish?: string
}
export type DressCeilingFrameInput = {
  enabled?: boolean
  style?: CeilingFrameStyle
  inset?: number
  width?: number
  relief?: number
  notchedCorners?: boolean
  finish?: string
}
export type DressRoomInput = {
  zoneIds: string[]
  layers?: DressLayer[]
  wallFinish?: string
  ceilingFinish?: string
  ceilingHeight?: number
  ceilingMedallion?: DressCeilingMedallionInput | null
  ceilingFrame?: DressCeilingFrameInput | null
  floorFinish?: string
  replaceScripts?: boolean
  dryRun?: boolean
}
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
export type DressedRoom = {
  zoneId: string
  name: string
  faces: DressedFace[]
  wallFinish?: string
  ceilingFinish?: string
  ceilingHeight?: number
  ceilingMedallion?: CeilingMedallionConfig | null
  ceilingFrame?: CeilingFrameConfig | null
  floorFinish?: string
  clearedScripts?: number
}
export type DressSkipped = { zoneId: string; layer?: number; why: string }
const isTrim = (kind: DressLayerKind): kind is WallTrimKind =>
  kind === 'skirting' || kind === 'chairRail' || kind === 'crown'

function resolveSlotFinish(
  asked: string,
  field: string,
  surface: MaterialSurface,
  context: AgentContext,
): { ref: string; note?: string } {
  if (/^#[0-9a-f]{6}$/i.test(asked)) {
    const match = nearestLibraryColorRef(asked)
    if (!match) refuse('invalid_color', `${asked} is no colour: give #rrggbb.`)
    return {
      ref: match.ref,
      note: `${asked}: nearest library colour ${match.name} (${match.color}), ΔE ${Math.round(match.distance)}.`,
    }
  }
  return { ref: requireMaterialRef(asked, field, surface, { materials: context.materials }) }
}

function findRoomCeiling(
  scratch: Readonly<Record<string, AnyNode>>,
  zone: ZoneNode,
): CeilingNode | undefined {
  let fallback: CeilingNode | undefined
  for (const node of Object.values(scratch)) {
    if (node.type !== 'ceiling' || node.zoneId !== zone.id) continue
    if (!zone.parentId || node.parentId === zone.parentId) return node
    fallback ??= node
  }
  return fallback
}

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
  if (input.zoneIds.length > 32) refuse('invalid_layer', 'Dress at most 32 rooms in one call.')
  const hasRoomChange =
    input.wallFinish !== undefined ||
    input.ceilingFinish !== undefined ||
    input.ceilingHeight !== undefined ||
    input.ceilingMedallion !== undefined ||
    input.ceilingFrame !== undefined ||
    input.floorFinish !== undefined
  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers) || input.layers.length > 8)
      refuse('invalid_layer', 'Dress at most eight layers in one call.')
    input.layers.forEach(checkLayer)
  } else if (!hasRoomChange) {
    refuse(
      'invalid_layer',
      'Supply layers or at least one room finish/ornament (wallFinish, ceilingFinish, ceilingHeight, ceilingMedallion, ceilingFrame, floorFinish).',
    )
  }
  if (
    input.ceilingHeight !== undefined &&
    !(Number.isFinite(input.ceilingHeight) && input.ceilingHeight >= 0.1)
  )
    refuse('invalid_size', 'ceilingHeight must be at least 0.1 m.', { field: 'ceilingHeight' })
  let medallionSpec: CeilingMedallionConfig | null | undefined
  let medallionNote: string | undefined
  if (input.ceilingMedallion !== undefined) {
    if (input.ceilingMedallion === null || input.ceilingMedallion.enabled === false) {
      medallionSpec = null
    } else {
      const finishResolved =
        input.ceilingMedallion.finish !== undefined
          ? resolveSlotFinish(
              input.ceilingMedallion.finish,
              'ceilingMedallion.finish',
              'ceiling',
              context,
            )
          : undefined
      medallionNote = finishResolved?.note
      const parsed = CeilingMedallionConfig.safeParse({
        ...input.ceilingMedallion,
        enabled: true,
        ...(finishResolved ? { finish: finishResolved.ref } : {}),
      })
      if (!parsed.success)
        refuse('invalid_size', 'ceilingMedallion has invalid dimensions, style or placement.', {
          field: 'ceilingMedallion',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        })
      medallionSpec = parsed.data
    }
  }
  let frameSpec: CeilingFrameConfig | null | undefined
  let frameNote: string | undefined
  if (input.ceilingFrame !== undefined) {
    if (input.ceilingFrame === null || input.ceilingFrame.enabled === false) {
      frameSpec = null
    } else {
      const finishResolved =
        input.ceilingFrame.finish !== undefined
          ? resolveSlotFinish(input.ceilingFrame.finish, 'ceilingFrame.finish', 'ceiling', context)
          : undefined
      frameNote = finishResolved?.note
      const parsed = CeilingFrameConfig.safeParse({
        ...input.ceilingFrame,
        enabled: true,
        ...(finishResolved ? { finish: finishResolved.ref } : {}),
      })
      if (!parsed.success)
        refuse('invalid_size', 'ceilingFrame has invalid dimensions or style.', {
          field: 'ceilingFrame',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        })
      frameSpec = parsed.data
    }
  }
  const zones = [...new Set(input.zoneIds)].map((id) => {
    const zone = nodes[id]
    if (zone?.type !== 'zone' || zone.spaceRole !== 'room')
      refuse('target_not_found', `${id} is not a room in the scene.`, { target: id })
    if (!roomBoundaryWalls(nodes, zone).length)
      refuse('no_walls', `Room ${zone.name} has no walls to dress.`, { target: id })
    return zone
  })
  const wallFinishResolved =
    input.wallFinish !== undefined
      ? resolveSlotFinish(input.wallFinish, 'wallFinish', 'wall', context)
      : undefined
  const ceilingFinishResolved =
    input.ceilingFinish !== undefined
      ? resolveSlotFinish(input.ceilingFinish, 'ceilingFinish', 'ceiling', context)
      : undefined
  const floorFinishResolved =
    input.floorFinish !== undefined
      ? resolveSlotFinish(input.floorFinish, 'floorFinish', 'floor', context)
      : undefined

  const scratch: Record<string, AnyNode> = { ...nodes }
  const skipped: DressSkipped[] = []
  const plans = zones.map((zone) => ({
    zone,
    stretches: roomWallFaces(nodes, zone),
    regions: new Map<string, FaceRegionPlan>(),
    trims: new Map<string, Set<WallTrimKind>>(),
    clearWallIds: new Set<string>(),
    clearedScripts: 0,
    wallFinish: undefined as string | undefined,
    ceilingFinish: undefined as string | undefined,
    ceilingHeight: undefined as number | undefined,
    ceilingMedallion: undefined as CeilingMedallionConfig | null | undefined,
    ceilingFrame: undefined as CeilingFrameConfig | null | undefined,
    floorFinish: undefined as string | undefined,
  }))
  let note: string | undefined =
    wallFinishResolved?.note ??
    ceilingFinishResolved?.note ??
    medallionNote ??
    frameNote ??
    floorFinishResolved?.note

  const clearFullHeightWallScript = (
    wallId: string,
    face: WallFace,
    plan: (typeof plans)[number],
  ) => {
    const wall = scratch[wallId]
    if (wall?.type !== 'wall') return
    const script = wall.finishScripts?.[face]
    if (!script || script.toHeight !== undefined) return
    const nextScripts = { ...wall.finishScripts }
    delete nextScripts[face]
    const nextWall = { ...wall }
    if (Object.keys(nextScripts).length) nextWall.finishScripts = nextScripts
    else delete nextWall.finishScripts
    scratch[wallId] = nextWall as WallNode
    plan.clearedScripts += 1
  }

  // Only remove existing owned regions when `layers` was supplied; omitting `layers` preserves them.
  if (input.layers !== undefined) {
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
  }

  for (const plan of plans) {
    if (wallFinishResolved !== undefined) {
      const seenFaces = new Set<string>()
      for (const stretch of plan.stretches) {
        const key = `${stretch.wallId}/${stretch.face}`
        if (seenFaces.has(key)) continue
        seenFaces.add(key)
        const wall = scratch[stretch.wallId]
        if (wall?.type !== 'wall') continue
        const script = wall.finishScripts?.[stretch.face]
        if (script && script.toHeight === undefined) {
          if (input.replaceScripts) clearFullHeightWallScript(stretch.wallId, stretch.face, plan)
          else
            refuse(
              'script_owns_face',
              `Side ${stretch.face.toUpperCase()} of ${wall.name?.trim() || wall.id} is built by a script, which owns its colours: remove the script or pass replaceScripts: true to finish that side.`,
              { target: wall.id, face: stretch.face },
            )
        }
      }
      const currentZone = scratch[plan.zone.id] as ZoneNode
      const nextZone: ZoneNode = { ...currentZone, wallMaterial: wallFinishResolved.ref }
      delete nextZone.wallOverrides
      scratch[plan.zone.id] = nextZone
      plan.wallFinish = wallFinishResolved.ref
    }

    if (floorFinishResolved !== undefined) {
      const currentZone = scratch[plan.zone.id] as ZoneNode
      if (currentZone.hasFloor === false) {
        skipped.push({ zoneId: plan.zone.id, why: `${plan.zone.name} has no floor to finish` })
      } else {
        const { script: floorScript, ...floorRest } = currentZone.floor ?? {}
        if (floorScript && !input.replaceScripts)
          refuse(
            'script_owns_floor',
            `${plan.zone.name?.trim() || plan.zone.id}'s floor is built by a script, which owns its colours: pass replaceScripts: true or remove the script to replace it.`,
            { target: plan.zone.id },
          )
        if (floorScript) plan.clearedScripts += 1
        scratch[plan.zone.id] = {
          ...currentZone,
          floor: { ...floorRest, finish: floorFinishResolved.ref },
        }
        plan.floorFinish = floorFinishResolved.ref
      }
    }

    if (
      ceilingFinishResolved !== undefined ||
      input.ceilingHeight !== undefined ||
      medallionSpec !== undefined ||
      frameSpec !== undefined
    ) {
      const currentZone = scratch[plan.zone.id] as ZoneNode
      const ceiling =
        currentZone.hasCeiling === false ? undefined : findRoomCeiling(scratch, currentZone)
      if (!ceiling) {
        skipped.push({
          zoneId: plan.zone.id,
          why: `${plan.zone.name} has no ceiling node to update`,
        })
      } else {
        const owner = ceilingRegionsOwner(ceiling)
        let nextCeiling: CeilingNode = {
          ...ceiling,
          ...(ceilingFinishResolved !== undefined
            ? { slots: { ...(ceiling.slots ?? {}), surface: ceilingFinishResolved.ref } }
            : {}),
          ...(input.ceilingHeight !== undefined ? { height: input.ceilingHeight } : {}),
        }
        let nextZone = currentZone
        if (input.ceilingHeight !== undefined) {
          nextZone = { ...nextZone, ceilingHeight: input.ceilingHeight }
          plan.ceilingHeight = input.ceilingHeight
        }
        if (ceilingFinishResolved !== undefined) plan.ceilingFinish = ceilingFinishResolved.ref
        if (medallionSpec !== undefined || frameSpec !== undefined) {
          if (owner.kind === 'zone') {
            const zc = { ...(nextZone.ceiling ?? {}) }
            if (medallionSpec === null) delete zc.medallion
            else if (medallionSpec !== undefined) zc.medallion = medallionSpec
            if (frameSpec === null) delete zc.frame
            else if (frameSpec !== undefined) zc.frame = frameSpec
            const updatedZone: ZoneNode = { ...nextZone }
            if (zc.regions?.length || zc.medallion || zc.frame) updatedZone.ceiling = zc
            else delete updatedZone.ceiling
            nextZone = updatedZone
            // Clear stale ceiling-level overrides when room owns the ornaments.
            if (medallionSpec !== undefined && nextCeiling.medallion !== undefined) {
              const cleaned = { ...nextCeiling }
              delete cleaned.medallion
              nextCeiling = cleaned
            }
            if (frameSpec !== undefined && nextCeiling.frame !== undefined) {
              const cleaned = { ...nextCeiling }
              delete cleaned.frame
              nextCeiling = cleaned
            }
          } else {
            const updatedCeiling = { ...nextCeiling }
            if (medallionSpec === null) delete updatedCeiling.medallion
            else if (medallionSpec !== undefined) updatedCeiling.medallion = medallionSpec
            if (frameSpec === null) delete updatedCeiling.frame
            else if (frameSpec !== undefined) updatedCeiling.frame = frameSpec
            nextCeiling = updatedCeiling
          }
          if (medallionSpec !== undefined) plan.ceilingMedallion = medallionSpec
          if (frameSpec !== undefined) plan.ceilingFrame = frameSpec
        }
        scratch[ceiling.id] = nextCeiling
        if (nextZone !== currentZone) scratch[plan.zone.id] = nextZone
      }
    }
  }

  input.layers?.forEach((layer, index) => {
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
  if (input.layers !== undefined) {
    for (const plan of plans) {
      if (input.replaceScripts) {
        for (const facePlan of plan.regions.values()) {
          if (facePlan.regions.length > 0)
            clearFullHeightWallScript(facePlan.wallId, facePlan.face, plan)
        }
      }
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
    return {
      zoneId: plan.zone.id,
      name: plan.zone.name,
      faces: [...faces.values()],
      ...(plan.wallFinish !== undefined ? { wallFinish: plan.wallFinish } : {}),
      ...(plan.ceilingFinish !== undefined ? { ceilingFinish: plan.ceilingFinish } : {}),
      ...(plan.ceilingHeight !== undefined ? { ceilingHeight: plan.ceilingHeight } : {}),
      ...(plan.ceilingMedallion !== undefined ? { ceilingMedallion: plan.ceilingMedallion } : {}),
      ...(plan.ceilingFrame !== undefined ? { ceilingFrame: plan.ceilingFrame } : {}),
      ...(plan.floorFinish !== undefined ? { floorFinish: plan.floorFinish } : {}),
      ...(plan.clearedScripts > 0 ? { clearedScripts: plan.clearedScripts } : {}),
    }
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
