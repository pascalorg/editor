import {
  type AnyNode,
  type AnyNodeId,
  area,
  containsPoint,
  distanceToBoundary,
  type FloorPlatePaintRefusal,
  FOUNDATION_SLOT_DEFAULT,
  floorPlatePaintRefusal,
  floorStepKeysOf,
  floorStepOverrideFor,
  floorStepRoleCovers,
  intersection,
  type MaterialSchema,
  type PaintCapability,
  type PaintPatchArgs,
  type PaintPreviewArgs,
  parseFloorStepRole,
  parseMaterialRef,
  parseRoomFinishRole,
  roomFinishRole,
  runAsSingleSceneHistoryStep,
  type SceneMaterial,
  type SceneMaterialId,
  SLAB_TOP_SLOT_DEFAULT,
  type SlabNode,
  slabSlots,
  slotDefaultPaintMaterial,
  useScene,
  withFloorStepOverride,
  type ZoneNode,
} from '@pascal-app/core'
import type { Material, Mesh } from 'three'
import {
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
  declaredSlotLook,
  type PaintLook,
  previewGeometrySlot,
  resolveSlotPaintMaterialRef,
} from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

/**
 * Slab paint on the unified slot model. A plain slab exposes two faces —
 * `surface` (top) and `side` (walls + underside) — each its own mesh tagged
 * with `userData.slotId`, so the clicked face resolves to its slot; commit
 * writes `node.slots[slotId]` (a shared scene-material or `library:` ref).
 *
 * A floor plate draws more meshes and some of them are not the plate's to
 * paint. Its top is partitioned per room, so a mesh can carry a `room:<zoneId>`
 * role: that click paints the ROOM's `floor.finish` (or the region under the
 * cursor), because the finish belongs to the zone, not to the derived plate.
 * A room-owned step riser (`step:<zoneId>/<doorway>`) paints that doorway's
 * steps only; the room scope (`step:<zoneId>`) paints every step of the room.
 * Unpainted steps share the higher room's floor finish. Unowned construction
 * faces still write the slab's own slots.
 */

type ZoneFinish = NonNullable<ZoneNode['floor']>['finish']

function zoneOf(zoneId: string): ZoneNode | null {
  const node = useScene.getState().nodes[zoneId as AnyNodeId]
  return node?.type === 'zone' ? node : null
}

/**
 * The footprint whose edge band a room's edge falls back to: the base plate of
 * the level that overlaps `shape` most, as the renderer picks it.
 */
function edgeBandBase(shape: {
  parentId?: string | null
  polygon: SlabNode['polygon']
  holes?: SlabNode['holes']
}): SlabNode | undefined {
  const overlap = (slab: SlabNode) =>
    area(
      intersection(
        { outer: slab.polygon, holes: slab.holes },
        { outer: shape.polygon, holes: shape.holes ?? [] },
      ),
    )
  return Object.values(useScene.getState().nodes)
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.parentId === shape.parentId,
    )
    .sort((a, b) => overlap(b) - overlap(a) || a.id.localeCompare(b.id))[0]
}

function sideRole(role: string) {
  const step = parseFloorStepRole(role)
  if (step) return { ...step, field: 'floorStepFinish' as const }
  const edge = /^edge:(.+)$/.exec(role)
  return edge
    ? { zoneId: edge[1]!, key: null, step: null, field: 'floorEdgeFinish' as const }
    : null
}

/** The rooms on `zone`'s level — where a doorway's step paint may be stored. */
function levelZones(zone: ZoneNode): ZoneNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.parentId === zone.parentId,
  )
}

/** A doorway's own step paint, wherever it is stored. */
function stepOverride(zone: ZoneNode, key: string | null, step: number | null) {
  return key ? floorStepOverrideFor(zone, key, step, levelZones(zone)) : undefined
}

function readFinish(role: string): ZoneFinish | undefined {
  const side = sideRole(role)
  if (side) {
    const zone = zoneOf(side.zoneId)
    if (side.field === 'floorStepFinish')
      return (
        (zone && stepOverride(zone, side.key, side.step)?.finish) ??
        zone?.floorStepFinish ??
        zone?.floor?.finish ??
        SLAB_TOP_SLOT_DEFAULT
      )
    if (zone?.floorEdgeFinish) return zone.floorEdgeFinish
    return zone ? edgeBandBase(zone)?.slots?.edge : undefined
  }
  const parsed = parseRoomFinishRole(role)
  if (!parsed) return undefined
  const zone = zoneOf(parsed.zoneId)
  if (!zone) return undefined
  if (!parsed.regionId || parsed.regionId === ROOM_WIDE) return zone.floor?.finish
  return zone.floor?.regions?.find((region) => region.id === parsed.regionId)?.finish
}

/**
 * Write a room finish in one history step, minting the shared scene material
 * the same way `commitSlotPaint` does so a one-off colour is stored once.
 */
/** The region id a room-scope floor role carries: the whole room, every finish source. */
export const ROOM_WIDE = '*'

/** The zone a room-scope floor role (`room:<zoneId>/*`) names. */
export function roomWideZone(role: string): string | null {
  const parsed = parseRoomFinishRole(role)
  return parsed?.regionId === ROOM_WIDE ? parsed.zoneId : null
}

/** A floor role naming the room's whole floor, not one painted part: `room:<zoneId>`. */
function plainFloorZone(role: string): string | null {
  const parsed = parseRoomFinishRole(role)
  return parsed && !parsed.regionId ? parsed.zoneId : null
}

/** What a step shows with no paint of its own, its room's or its floor's. */
const UNPAINTED_STEP: PaintLook = { materialPreset: SLAB_TOP_SLOT_DEFAULT }

function lookMaterial(look: PaintLook | null): Material | null {
  return look ? buildSlotPreviewMaterial(look.material, look.materialPreset) : null
}

function swapPreviews(
  root: PaintPreviewArgs['root'],
  shown: (paintRole: string) => Material | null,
) {
  const restores: Array<() => void> = []
  root.traverse((object) => {
    const mesh = object as Mesh
    const { paintRole, __fromGeometry } = mesh.userData as {
      paintRole?: string
      __fromGeometry?: boolean
    }
    if (!(mesh.isMesh && __fromGeometry === true && typeof paintRole === 'string')) return
    const material = shown(paintRole)
    if (material) restores.push(swapPreviewMaterial(mesh, material))
  })
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

/**
 * A room floor's preview on one plate: the floor and the steps that follow it
 * (no room step finish, no doorway paint). Painted, they take the paint;
 * erased, the floor shows the plate's own top and its steps the unpainted step.
 * The whole room (`wide`) also covers its painted parts; erased, it clears its
 * edge too, and its steps whatever the room step finish.
 */
function previewRoomFloor(
  args: PaintPreviewArgs,
  zoneId: string,
  wide: boolean,
): (() => void) | null {
  const zone = zoneOf(zoneId)
  if (!zone) return null
  const erasing = args.material === undefined && args.materialPreset === undefined
  const paint = erasing ? null : buildSlotPreviewMaterial(args.material, args.materialPreset)
  const floorRole = roomFinishRole(zoneId)
  const followingStep = (role: string) => {
    const step = parseFloorStepRole(role)
    return step?.zoneId === zoneId && !stepOverride(zone, step.key, step.step) ? step : null
  }
  return swapPreviews(args.root, (role) => {
    const step = followingStep(role)
    const floorOrPart = role === floorRole || (wide && role.startsWith(`${floorRole}/`))
    if (!erasing) return floorOrPart || (step && !zone.floorStepFinish) ? paint : null
    if (floorOrPart) return lookMaterial(plateSlotLook(args.node, 'surface'))
    if (step && (wide || !zone.floorStepFinish)) return lookMaterial(UNPAINTED_STEP)
    if (wide && zone.floorEdgeFinish && role === `edge:${zoneId}`)
      return lookMaterial(footprintEdgeLook(args.node))
    return null
  })
}

/**
 * A footprint edge band's preview on one plate: the band itself on the
 * footprint, and on any plate the room edges that carry the band (rooms with no
 * edge finish of their own). Erased, each shows what it draws with no finish.
 */
function previewEdgeBand(args: PaintPreviewArgs): (() => void) | null {
  const erasing = args.material === undefined && args.materialPreset === undefined
  const paint = erasing ? null : buildSlotPreviewMaterial(args.material, args.materialPreset)
  return swapPreviews(args.root, (role) => {
    const edge = /^edge:(.+)$/.exec(role)
    if (role !== 'edge' && !(edge && !zoneOf(edge[1]!)?.floorEdgeFinish)) return null
    return paint ?? lookMaterial(bareSideLook(args.node, 'edge'))
  })
}

function commitRoomFinish(
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const side = sideRole(role)
  const parsed = side ? { zoneId: side.zoneId, regionId: null } : parseRoomFinishRole(role)
  if (!parsed) return
  const state = useScene.getState()
  const resolution = resolveSlotPaintMaterialRef(state.materials, material, materialPreset)
  if (!resolution) return
  const { ref, newSceneMaterial } = resolution

  if (side?.field === 'floorStepFinish') {
    commitStepFinish(side.zoneId, side.key, side.step, ref ?? undefined, newSceneMaterial)
    return
  }

  useScene.setState((current) => {
    if (current.readOnly) return current
    const zone = current.nodes[parsed.zoneId as AnyNodeId]
    if (zone?.type !== 'zone') return current
    const floor = { ...zone.floor }
    if (parsed.regionId === ROOM_WIDE) {
      // The room scope: painting gives the whole floor one finish, its painted
      // parts included; erasing clears everything that makes it look painted —
      // its finish, its painted parts, its steps and its edge.
      if (ref) floor.finish = ref
      else delete floor.finish
      delete floor.regions
    } else if (parsed.regionId) {
      const regions = floor.regions ?? []
      const index = regions.findIndex((region) => region.id === parsed.regionId)
      if (index < 0) return current
      // A region with no finish would fall through to the room finish, which is
      // what the eraser should do — but the schema requires one, so an erased
      // region drops out of the list instead.
      floor.regions = ref
        ? regions.map((region, at) => (at === index ? { ...region, finish: ref } : region))
        : regions.filter((_, at) => at !== index)
    } else if (ref) {
      floor.finish = ref
    } else {
      delete floor.finish
    }
    const next = (
      side ? { ...zone, [side.field]: ref ?? undefined } : { ...zone, floor }
    ) as ZoneNode
    if (parsed.regionId === ROOM_WIDE && !ref) {
      delete next.floorStepFinish
      delete next.floorEdgeFinish
    }
    return {
      ...(newSceneMaterial
        ? { materials: { ...current.materials, [newSceneMaterial.id]: newSceneMaterial } }
        : {}),
      nodes: { ...current.nodes, [parsed.zoneId as AnyNodeId]: next as AnyNode },
    }
  })
  useScene.getState().markDirty(parsed.zoneId as AnyNodeId)
}

/**
 * Paint (`ref`) or erase a room's steps in one history step. A doorway role
 * writes that doorway's override (see `withFloorStepOverride`); the room scope
 * sets the room's step finish and drops the doorway paint of every step the
 * room currently has, so all of them show it. Overrides of steps the room does
 * not have are someone else's and stay.
 */
function commitStepFinish(
  zoneId: string,
  key: string | null,
  step: number | null,
  ref: string | undefined,
  newSceneMaterial: SceneMaterial | null,
): void {
  const changed: AnyNodeId[] = []
  useScene.setState((current) => {
    if (current.readOnly) return current
    const owner = current.nodes[zoneId as AnyNodeId]
    if (owner?.type !== 'zone') return current
    const zones = new Map(
      Object.values(current.nodes)
        .filter(
          (node): node is ZoneNode => node.type === 'zone' && node.parentId === owner.parentId,
        )
        .map((zone) => [zone.id as string, zone]),
    )
    const apply = (doorway: string, finish: string | undefined) => {
      for (const zone of withFloorStepOverride(
        zones.get(zoneId)!,
        doorway,
        key ? step : null,
        finish,
        [...zones.values()],
      ))
        zones.set(zone.id, zone)
    }
    if (key) apply(key, ref)
    else {
      for (const doorway of floorStepKeysOf(current.nodes, owner.parentId ?? '', zoneId))
        apply(doorway, undefined)
      const next = { ...zones.get(zoneId)! }
      if (ref) next.floorStepFinish = ref
      else delete next.floorStepFinish
      zones.set(zoneId, next)
    }
    const nodes = { ...current.nodes }
    for (const [id, zone] of zones)
      if (zone !== current.nodes[id as AnyNodeId]) {
        nodes[id as AnyNodeId] = zone as AnyNode
        changed.push(id as AnyNodeId)
      }
    if (!changed.length && !newSceneMaterial) return current
    return {
      ...(newSceneMaterial
        ? { materials: { ...current.materials, [newSceneMaterial.id]: newSceneMaterial } }
        : {}),
      nodes,
    }
  })
  for (const id of changed) useScene.getState().markDirty(id)
}

function baseSurfaceRoom(node: AnyNode, point?: readonly [number, number, number]): string | null {
  if (node.type !== 'slab' || node.plateRole !== 'base') return null
  const zones = (node.zoneIds ?? [])
    .map(zoneOf)
    .filter((zone): zone is ZoneNode => !!zone && zone.hasFloor !== false)
  if (point)
    zones.sort((a, b) => {
      const distance = (zone: ZoneNode) => {
        const polygon = [{ outer: zone.polygon, holes: zone.holes }]
        const p: [number, number] = [point[0], point[2]]
        return containsPoint(polygon, p) ? 0 : distanceToBoundary(polygon, p)
      }
      return distance(a) - distance(b) || a.id.localeCompare(b.id)
    })
  return zones[0] ? `room:${zones[0].id}` : null
}

/** A finish ref or inline legacy material, as a look. */
function finishLook(finish: ZoneFinish | undefined): PaintLook | null {
  if (finish === undefined) return null
  return typeof finish === 'string'
    ? { materialPreset: finish }
    : { material: finish as MaterialSchema }
}

/** A plate slot as drawn: its value, else its legacy finish, else its declared default. */
function plateSlotLook(node: AnyNode, slot: string): PaintLook | null {
  return (
    base.getEffectiveMaterial?.({ node, role: slot, nodes: useScene.getState().nodes }) ??
    slotDefaultPaintMaterial(slabSlots().find((entry) => entry.slotId === slot)?.default)
  )
}

/**
 * A plate side face with no finish of its own: the pre-split `side` slot, else
 * the declared default — the renderer's fallback for edge, riser and underside.
 */
function bareSideLook(node: AnyNode, slot: 'edge' | 'riser' | 'underside'): PaintLook | null {
  return (
    finishLook((node as SlabNode).slots?.side) ??
    slotDefaultPaintMaterial(slabSlots().find((entry) => entry.slotId === slot)?.default)
  )
}

/** A room edge with no edge finish: its footprint's band, else the bare face. */
function footprintEdgeLook(node: AnyNode): PaintLook | null {
  const plate = node as SlabNode
  return finishLook(edgeBandBase(plate)?.slots?.edge) ?? bareSideLook(node, 'edge')
}

/**
 * What a floor surface shows once erased: a region falls to its room's floor
 * finish, a room's floor finish to the plate's own top, the room's steps to its
 * floor, its edge to the footprint's edge band, a plate's side faces to their
 * bare look, a slot to its declared default.
 */
export function erasedSlabLook({ node, role }: PaintPreviewArgs): PaintLook | null {
  if (role === 'foundation') return declaredSlotLook(node, role)
  if ((node as SlabNode).boundary === 'auto' && (role === 'riser' || role === 'underside'))
    return bareSideLook(node, role)
  const side = sideRole(role)
  if (side) {
    const zone = zoneOf(side.zoneId)
    // A doorway falls back to the room's steps, the room's steps to its floor,
    // then to the unpainted step; a room's edge to its footprint's band.
    return side.field === 'floorStepFinish'
      ? ((side.key ? finishLook(zone?.floorStepFinish) : null) ??
          finishLook(zone?.floor?.finish) ??
          UNPAINTED_STEP)
      : footprintEdgeLook(node)
  }
  const parsed = parseRoomFinishRole(role)
  if (!parsed) return declaredSlotLook(node, role)
  const floor = parsed.regionId ? zoneOf(parsed.zoneId)?.floor?.finish : undefined
  return finishLook(floor) ?? plateSlotLook(node, 'surface')
}

const base = createSlotPaintCapability({
  roomScope: true,
  // A floor, the whole room and a footprint's edge band preview their
  // followers too, erased included, so they build their own erased look.
  erasedLook: (args) =>
    roomWideZone(args.role) ||
    ((args.node as SlabNode).boundary === 'auto' &&
      (plainFloorZone(args.role) || args.role === 'edge'))
      ? null
      : erasedSlabLook(args),
  resolveRole: ({ node, hitObject, localPosition }) => {
    const paintRole = hitObject?.userData.paintRole
    if (typeof paintRole === 'string')
      return paintRole === 'surface'
        ? (baseSurfaceRoom(node, localPosition) ?? paintRole)
        : paintRole
    const slotId = (hitObject?.userData as { slotId?: string } | undefined)?.slotId
    if (typeof slotId !== 'string') return null
    return slotId === 'surface' ? (baseSurfaceRoom(node, localPosition) ?? slotId) : slotId
  },
  applyPreview: (args) => {
    const zoneId = roomWideZone(args.role)
    if (zoneId) return previewRoomFloor(args, zoneId, true)
    if ((args.node as SlabNode).boundary === 'auto') {
      const floor = plainFloorZone(args.role)
      if (floor) return previewRoomFloor(args, floor, false)
      if (args.role === 'edge') return previewEdgeBand(args)
    }
    return parseFloorStepRole(args.role)
      ? previewGeometrySlot(args, (meshRole) => floorStepRoleCovers(args.role, meshRole))
      : previewGeometrySlot(args)
  },
  // Legacy inline material applied to the whole slab → maps onto the top only;
  // the side picker shows its own default.
  legacyEffective: (node: AnyNode, role: string) => {
    if (role !== 'surface') return null
    const slab = node as SlabNode
    if (slab.materialPreset || slab.material) {
      return { material: slab.material, materialPreset: slab.materialPreset }
    }
    return null
  },
})

export const slabPaint: PaintCapability & {
  commit: (args: PaintPatchArgs) => undefined | FloorPlatePaintRefusal
} = {
  ...base,
  // "Steps · Kitchen": the room a floor finish belongs to, by name.
  roleLabel: (_node, role) => {
    if (role === 'foundation') return 'Foundation'
    const side = sideRole(role)
    const zoneId = side?.zoneId ?? parseRoomFinishRole(role)?.zoneId
    if (!zoneId) return null
    const part = side ? (side.field === 'floorStepFinish' ? 'Steps' : 'Floor edge') : 'Floor'
    const room = zoneOf(zoneId)?.name?.trim() || 'Room'
    if (!side?.key) return `${part} · ${room}`
    const through = useScene.getState().nodes[side.key as AnyNodeId]
    const label =
      through?.type === 'zone'
        ? through.name?.trim() || 'Room'
        : (through as { name?: string } | undefined)?.name?.trim() || 'Doorway'
    return `${part} · ${room} · ${label}`
  },
  buildPatch: (args: PaintPatchArgs) =>
    args.role === 'foundation' || sideRole(args.role) || parseRoomFinishRole(args.role)
      ? {}
      : base.buildPatch(args),
  commit: (args: PaintPatchArgs) => {
    if (args.role === 'surface' && args.node.type === 'slab' && args.node.plateRole === 'base') {
      const role = baseSurfaceRoom(args.node)
      if (!role)
        return floorPlatePaintRefusal(useScene.getState().nodes, args.node, args.role) ?? undefined
      commitRoomFinish(role, args.material, args.materialPreset)
      return
    }

    if (args.role === 'foundation') {
      const state = useScene.getState()
      const plate = state.nodes[args.node.id]
      if (plate?.type !== 'slab' || plate.plateRole !== 'base' || state.readOnly) return
      const resolution = resolveSlotPaintMaterialRef(
        state.materials,
        args.material,
        args.materialPreset,
      )
      if (!resolution) return
      const { ref, newSceneMaterial } = resolution
      runAsSingleSceneHistoryStep(useScene, () => {
        if (newSceneMaterial) useScene.getState().addSceneMaterial(newSceneMaterial)
        useScene.getState().updateNode(plate.id, {
          foundation: {
            ...plate.foundation,
            type: plate.foundation?.type ?? 'none',
            material: ref ?? undefined,
          },
        })
      })
      return
    }
    if (sideRole(args.role) || parseRoomFinishRole(args.role)) {
      commitRoomFinish(args.role, args.material, args.materialPreset)
      return
    }
    base.commit?.(args)
  },
  getEffectiveMaterial: (args) => {
    if (!(args.role === 'foundation' || sideRole(args.role) || parseRoomFinishRole(args.role)))
      return base.getEffectiveMaterial?.(args) ?? null
    const finish =
      args.role === 'foundation'
        ? ((args.node as SlabNode).foundation?.material ?? FOUNDATION_SLOT_DEFAULT)
        : readFinish(args.role)
    if (finish === undefined) {
      // Unpainted, a room's floor shows the plate's own top and its edge the
      // plate's edge band — each the slot's value, else its declared default.
      const slot = !args.rendered
        ? null
        : parseRoomFinishRole(args.role)
          ? 'surface'
          : sideRole(args.role)?.field === 'floorEdgeFinish'
            ? 'edge'
            : null
      if (!slot) return null
      const effective =
        base.getEffectiveMaterial?.({ ...args, role: slot }) ??
        slotDefaultPaintMaterial(slabSlots().find((entry) => entry.slotId === slot)?.default)
      return effective
        ? { material: effective.material, materialPreset: effective.materialPreset }
        : null
    }
    if (typeof finish !== 'string') {
      return { material: finish as MaterialSchema, materialPreset: undefined }
    }
    const parsed = parseMaterialRef(finish)
    if (parsed?.kind === 'library') return { material: undefined, materialPreset: finish }
    if (parsed?.kind === 'scene') {
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
    }
    return null
  },
}
