import {
  type AnyNode,
  type AnyNodeId,
  buildWallFinishLayout,
  type WallPaintRole as CoreWallPaintRole,
  getCurtainWallConfig,
  getEffectiveWallFaceMaterial,
  getWallFaceAtLocalPoint,
  getWallLevelZones,
  type MaterialSchema,
  type PaintCapability,
  type PaintPatchArgs,
  type PaintPreviewArgs,
  parseWallPaintRole as parseCoreWallPaintRole,
  parseMaterialRef,
  resolveWallFaceChain,
  resolveWallFinish,
  type SceneMaterialId,
  sceneRegistry,
  useScene,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallFace,
  type WallFaceChainFinish,
  type WallNode,
  type WallSurfaceSlotId,
  wallRegionRole,
  wallRoomFaceRole,
  wallRoomFinishRole,
  type ZoneNode,
} from '@pascal-app/core'
import {
  getWallFaceBaseAt,
  getWallFinishData,
  getWallFinishRefs,
  hasMaterialsForGroups,
  setSurfaceRaycastLayers,
} from '@pascal-app/viewer'
import {
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Ray,
  Raycaster,
  Vector3,
} from 'three'
import {
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
  type PaintLook,
  previewSlotByUserData,
  resolveSlotPaintMaterialRef,
} from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'
import { plannedWallIds, planWallPaint } from './paint-plan'

// Roles (see `parseWallPaintRole` in core): face / trim slots write
// `node.slots`, `region:<id>` a paint region, `room:<zoneId>/<face>` this face
// inside that room, `room:<zoneId>` every wall of the room (offered by the paint
// tool, never resolved from a click). A click on a face lands on the finish that
// shows there: a region, else the room's finish on that face, else the face slot.

type ResolvedWallPaintRole =
  | { kind: 'slot'; slotId: WallSurfaceSlotId | CurtainWallRole }
  | Exclude<CoreWallPaintRole, { kind: 'slot' }>

const WALL_SLOT_IDS = new Set<string>(Object.keys(WALL_SURFACE_SLOT_DEFAULTS))
// A curtain wall paints its frame, glass and solid panels (palette 0..2) instead of faces.
const CURTAIN_WALL_ROLES = ['curtain-frame', 'curtain-glass', 'curtain-solid'] as const
type CurtainWallRole = (typeof CURTAIN_WALL_ROLES)[number]
const isCurtainWallRole = (role: string): role is CurtainWallRole =>
  (CURTAIN_WALL_ROLES as readonly string[]).includes(role)

const FACE_MATERIAL_INDEX: Record<WallFace, number> = { a: 1, b: 2 }

export { wallRegionRole, wallRoomFaceRole, wallRoomFinishRole }

export function parseWallPaintRole(role: string): ResolvedWallPaintRole | null {
  return parseCoreWallPaintRole(
    role,
    (slotId) => WALL_SLOT_IDS.has(slotId) || isCurtainWallRole(slotId),
  ) as ResolvedWallPaintRole | null
}

const wallSlotRaycaster = new Raycaster()
setSurfaceRaycastLayers(wallSlotRaycaster.layers)

function resolveWallSlotByRay(node: WallNode, ray: Ray | undefined): WallSurfaceSlotId | null {
  if (!ray) return null
  const root = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!root) return null

  // A mesh caught between a rebuild and its new palette cannot be raycast (three
  // reads each group's material); no trim answers from it this move.
  let drawable = true
  root.traverse((object) => {
    drawable &&= hasMaterialsForGroups(object)
  })
  if (!drawable) return null
  wallSlotRaycaster.ray.copy(ray)
  const hits = wallSlotRaycaster.intersectObject(root, true)
  for (const hit of hits) {
    const slotId = (hit.object as Object3D).userData?.slotId
    if (typeof slotId === 'string' && WALL_SLOT_IDS.has(slotId)) {
      return slotId as WallSurfaceSlotId
    }
  }

  return null
}

/**
 * Resolve which wall surface the user clicked: a trim slot, a paint region,
 * the room finish on that face, or the face slot itself. Returns null when the
 * click is too oblique (or lands on the wall's end-cap, etc.) to pick a face.
 */
export function resolveWallRole(args: {
  node: WallNode
  hitObject?: { userData?: { slotId?: unknown } }
  materialIndex: number | null
  normal: readonly [number, number, number] | undefined
  localPosition: readonly [number, number, number] | undefined
  ray?: Ray
  nodes?: Readonly<Record<string, AnyNode | undefined>>
}): string | null {
  const { node, hitObject, localPosition, ray } = args
  if (node.wallType === 'curtain') {
    const root = sceneRegistry.nodes.get(node.id)
    if (!(root && ray)) return null
    wallSlotRaycaster.ray.copy(ray)
    const hit = wallSlotRaycaster.intersectObject(root, false)[0]
    return CURTAIN_WALL_ROLES[hit?.face?.materialIndex ?? -1] ?? null
  }
  const directSlotId = hitObject?.userData?.slotId
  if (typeof directSlotId === 'string' && WALL_SLOT_IDS.has(directSlotId)) {
    return directSlotId
  }

  const raySlotId = resolveWallSlotByRay(node, ray)
  if (raySlotId) return raySlotId

  // The underpinning's stemwall, below the finish carried over the rim.
  if (node.underpinning && localPosition && localPosition[1] < -node.underpinning.rim) {
    return 'foundation'
  }

  // The physical face comes from where the hit lies, never from the material
  // index: a region can draw with a face slot's material on the other face.
  if (!localPosition) return null
  const face = getWallFaceAtLocalPoint(node, localPosition, args.normal)
  if (!face) return null

  const nodes = args.nodes ?? useScene.getState().nodes
  const layout = buildWallFinishLayout(node, getWallLevelZones(node, nodes))
  if (layout.plain) return face
  const mesh = sceneRegistry.nodes.get(node.id as AnyNodeId) as Mesh | undefined
  const u = localPosition[0]
  const v = localPosition[1] - getWallFaceBaseAt(getWallFinishData(mesh?.geometry), face, u)
  const hit = resolveWallFinish(layout, face, u, v)
  if (hit.source === 'region') return wallRegionRole(hit.regionId)
  if (hit.source === 'override' || hit.source === 'zone') return wallRoomFaceRole(hit.zoneId, face)
  return face
}

function zoneOf(
  zoneId: string,
  nodes: Readonly<Record<string, AnyNode | undefined>> = useScene.getState().nodes,
): ZoneNode | null {
  const node = nodes[zoneId]
  return node?.type === 'zone' ? node : null
}

/** The finish ref a non-slot role currently shows, if any. */
function currentRoleRef(
  wall: WallNode,
  role: ResolvedWallPaintRole,
  nodes?: Readonly<Record<string, AnyNode | undefined>>,
): string | undefined {
  if (role.kind === 'region') {
    return wall.faceRegions?.find((region) => region.id === role.regionId)?.finish
  }
  if (role.kind === 'room') return zoneOf(role.zoneId, nodes)?.wallMaterial
  if (role.kind === 'room-face') {
    const zone = zoneOf(role.zoneId, nodes)
    return (
      zone?.wallOverrides?.find((entry) => entry.wallId === wall.id && entry.face === role.face)
        ?.finish ?? zone?.wallMaterial
    )
  }
  return wall.slots?.[role.slotId]
}

function refToEffective(ref: string | undefined) {
  const parsed = parseMaterialRef(ref)
  if (parsed?.kind === 'library') return { material: undefined, materialPreset: ref }
  if (parsed?.kind === 'scene') {
    const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
    if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
  }
  return null
}

/**
 * The wall mesh's palette entry a non-face slot draws with, when it is part of
 * the wall body rather than its own mesh: a curtain wall's frame / glass /
 * solid panels (0..2), or the underpinning's stemwall (a finish ref, 3..).
 */
function wallPaletteSlotIndex(wall: WallNode, slotId: string, mesh: Mesh): number | null {
  if (isCurtainWallRole(slotId)) return CURTAIN_WALL_ROLES.indexOf(slotId)
  if (slotId !== 'foundation' || !wall.underpinning) return null
  const ref = wall.slots?.foundation ?? WALL_SURFACE_SLOT_DEFAULTS.foundation
  const at = getWallFinishRefs(mesh.geometry).indexOf(ref)
  return at < 0 ? null : 3 + at
}

/** Swap one palette entry of a copy of the wall's material array; cleanup restores it. */
function previewPaletteEntry(args: PaintPreviewArgs, mesh: Mesh, index: number): () => void {
  const current = mesh.material
  if (!Array.isArray(current) || index >= current.length) return () => {}
  const preview = buildSlotPreviewMaterial(args.material, args.materialPreset)
  if (!preview) return () => {}
  const next = (current as Material[]).slice()
  next[index] = preview
  return swapPreviewMaterial(mesh, next)
}

/** The finish the preview plan writes, so the surfaces it lands on can be told apart. */
const PREVIEW_REF = '__paint-preview__'

function sameChain(a: WallFaceChainFinish, b: WallFaceChainFinish) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Preview a wall paint by drawing the plan the click commits: every face
 * triangle of this wall is resolved again against the planned wall and rooms,
 * and takes the material that resolution draws — the paint where the click
 * paints, what shows once erased where it erases. The material array is copied
 * (never the shared cache) and the triangles are regrouped; cleanup restores
 * both.
 */
function applyWallPreview(args: PaintPreviewArgs): (() => void) | null {
  const { role, material, materialPreset } = args
  const parsed = parseWallPaintRole(role)
  if (!parsed) return null
  const mesh = sceneRegistry.nodes.get(args.node.id as AnyNodeId) as Mesh | undefined
  if (parsed.kind === 'slot' && !(parsed.slotId === 'a' || parsed.slotId === 'b')) {
    const index = mesh?.isMesh
      ? wallPaletteSlotIndex(args.node as WallNode, parsed.slotId, mesh)
      : null
    return index === null ? previewSlotByUserData(args) : previewPaletteEntry(args, mesh!, index)
  }
  if (!mesh?.isMesh) return null
  const current = mesh.material
  if (!Array.isArray(current)) return null
  const erasing = material === undefined && materialPreset === undefined
  const paint = erasing ? null : buildSlotPreviewMaterial(material, materialPreset)
  if (!(erasing || paint)) return () => {}

  const nodes = useScene.getState().nodes
  const before = (nodes[args.node.id as AnyNodeId] ?? args.node) as WallNode
  const plan = planWallPaint(nodes, before, parsed, erasing ? undefined : PREVIEW_REF)
  const after: Record<string, AnyNode> = { ...nodes, ...plan }
  const wall = (after[before.id] ?? before) as WallNode
  const layout = buildWallFinishLayout(wall, getWallLevelZones(wall, after))
  const refs = getWallFinishRefs(mesh.geometry)
  const chains = {
    before: { a: resolveWallFaceChain(before, 'a'), b: resolveWallFaceChain(before, 'b') },
    after: { a: resolveWallFaceChain(wall, 'a'), b: resolveWallFaceChain(wall, 'b') },
  }

  const materials = (current as Material[]).slice()
  const added = new Map<string, number>()
  const extra = (key: string, make: () => Material | null) => {
    const known = added.get(key)
    if (known !== undefined) return known
    const made = make()
    if (!made) return null
    materials.push(made)
    added.set(key, materials.length - 1)
    return materials.length - 1
  }
  const lookIndex = (look: PaintLook) =>
    extra(`look:${JSON.stringify(look)}`, () =>
      buildSlotPreviewMaterial(look.material, look.materialPreset),
    )
  const indexFor = (face: WallFace, u: number, v: number): number | null => {
    const hit = resolveWallFinish(layout, face, u, v)
    if (hit.source !== 'slot') {
      if (hit.ref === PREVIEW_REF) return extra('paint', () => paint)
      const at = refs.indexOf(hit.ref)
      return at >= 0 ? 3 + at : lookIndex({ materialPreset: hit.ref })
    }
    const chain = chains.after[face]
    if (sameChain(chain, chains.before[face])) return FACE_MATERIAL_INDEX[face]
    if (chain.kind !== 'legacy' && chain.ref === PREVIEW_REF) return extra('paint', () => paint)
    return lookIndex(chain.kind === 'legacy' ? chain.spec : { materialPreset: chain.ref })
  }

  const geometry = mesh.geometry
  const groups = geometry.groups.map((group) => ({ ...group }))
  const regrouped = regroupWallFaces(geometry, before, indexFor)
  if (!regrouped) return () => {}
  geometry.groups = regrouped
  const restoreMaterial = swapPreviewMaterial(mesh, materials)
  return () => {
    restoreMaterial()
    if (mesh.geometry === geometry) geometry.groups = groups
  }
}

/**
 * The wall's face triangles regrouped by the material index `indexFor` gives
 * each (the face and station its centre lies at); caps keep theirs. Null when
 * nothing moves.
 */
export function regroupWallFaces(
  geometry: BufferGeometry,
  wall: WallNode,
  indexFor: (face: WallFace, u: number, v: number) => number | null,
): BufferGeometry['groups'] | null {
  const position = geometry.getAttribute('position')
  if (!position) return null
  const index = geometry.getIndex()
  const vertex = (at: number) => (index ? index.getX(at) : at)
  const finish = getWallFinishData(geometry)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const out: BufferGeometry['groups'] = []
  let changed = false
  const push = (start: number, materialIndex: number) => {
    const last = out[out.length - 1]
    if (last && last.materialIndex === materialIndex && last.start + last.count === start)
      last.count += 3
    else out.push({ start, count: 3, materialIndex })
  }
  for (const group of geometry.groups) {
    const own = group.materialIndex ?? 0
    for (let at = group.start; at + 2 < group.start + group.count; at += 3) {
      let next = own
      if (own !== 0) {
        a.fromBufferAttribute(position, vertex(at))
        b.fromBufferAttribute(position, vertex(at + 1))
        c.fromBufferAttribute(position, vertex(at + 2))
        const centre: [number, number, number] = [
          (a.x + b.x + c.x) / 3,
          (a.y + b.y + c.y) / 3,
          (a.z + b.z + c.z) / 3,
        ]
        const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize()
        const face = getWallFaceAtLocalPoint(wall, centre, [normal.x, normal.y, normal.z])
        if (face) {
          const v = centre[1] - getWallFaceBaseAt(finish, face, centre[0])
          next = indexFor(face, centre[0], v) ?? own
        }
      }
      if (next !== own) changed = true
      push(at, next)
    }
  }
  return changed ? out : null
}

/**
 * Write a wall paint in one history step through the same plan the preview
 * draws, minting the shared scene material the way `commitSlotPaint` does so a
 * one-off colour is stored once.
 */
function commitWallPlan(
  wallId: string,
  role: ResolvedWallPaintRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const state = useScene.getState()
  const resolution = resolveSlotPaintMaterialRef(state.materials, material, materialPreset)
  if (!resolution) return
  const { ref, newSceneMaterial } = resolution
  let touched: string[] = []
  useScene.setState((current) => {
    if (current.readOnly) return current
    const wall = current.nodes[wallId as AnyNodeId]
    if (wall?.type !== 'wall') return current
    const plan = planWallPaint(current.nodes, wall, role, ref)
    if (!Object.keys(plan).length) return current
    touched = plannedWallIds(current.nodes, plan)
    return {
      ...(newSceneMaterial
        ? { materials: { ...current.materials, [newSceneMaterial.id]: newSceneMaterial } }
        : {}),
      nodes: { ...current.nodes, ...plan } as typeof current.nodes,
    }
  })
  for (const id of new Set([wallId, ...touched])) useScene.getState().markDirty(id as AnyNodeId)
}

const base = createSlotPaintCapability({
  roomScope: true,
  // The preview draws the erase plan itself.
  erasedLook: () => null,
  resolveRole: ({ node, hitObject, materialIndex, normal, localPosition, ray }) =>
    resolveWallRole({
      node: node as WallNode,
      hitObject: hitObject as { userData?: { slotId?: unknown } } | undefined,
      materialIndex,
      normal,
      localPosition,
      ray,
    }),
  applyPreview: applyWallPreview,
  legacyEffective: (node: AnyNode, role: string) => {
    if (node.type === 'wall' && node.wallType === 'curtain') {
      const config = getCurtainWallConfig(node as WallNode)
      const color =
        role === 'curtain-frame'
          ? config.frameColor
          : role === 'curtain-glass'
            ? config.glassColor
            : role === 'curtain-solid'
              ? config.solidColor
              : undefined
      if (!color) return null
      return {
        materialPreset: undefined,
        material: {
          preset: 'custom',
          properties: {
            color,
            roughness: role === 'curtain-glass' ? config.glassRoughness : 0.4,
            metalness: role === 'curtain-frame' ? 0.65 : 0,
            opacity: role === 'curtain-glass' ? config.glassOpacity : 1,
            transparent: role === 'curtain-glass',
            side: 'front',
          },
        },
      }
    }
    if (role === 'a' || role === 'b') {
      const spec = getEffectiveWallFaceMaterial(node as WallNode, role)
      if (spec.material === undefined && spec.materialPreset === undefined) return null
      return { material: spec.material, materialPreset: spec.materialPreset }
    }
    if (role in WALL_SURFACE_SLOT_DEFAULTS) {
      return {
        material: undefined,
        materialPreset: WALL_SURFACE_SLOT_DEFAULTS[role as WallSurfaceSlotId],
      }
    }
    return null
  },
})

/**
 * Capability binding for the wall kind on the unified slot model. Face and trim
 * slots write `node.slots[slotId]` like every other kind; regions write the
 * region's finish and room roles write the zone, because a room's wall finish
 * belongs to the room, not to one of its walls.
 */
export const wallPaint: PaintCapability = {
  ...base,
  roleLabel: (_node, role) => {
    const parsed = parseWallPaintRole(role)
    if (parsed?.kind === 'region' || parsed?.kind === 'room-face') return 'Face'
    if (parsed?.kind === 'room') return 'Room'
    return null
  },
  buildPatch: (args: PaintPatchArgs) =>
    parseWallPaintRole(args.role)?.kind === 'slot' ? base.buildPatch(args) : {},
  commit: (args: PaintPatchArgs) => {
    const parsed = parseWallPaintRole(args.role)
    if (!parsed) return
    // A trim is a slot like any other; faces, regions and rooms go through the plan.
    if (parsed.kind === 'slot' && parsed.slotId !== 'a' && parsed.slotId !== 'b') {
      base.commit?.(args)
      return
    }
    commitWallPlan(args.node.id, parsed, args.material, args.materialPreset)
  },
  getEffectiveMaterial: (args) => {
    const parsed = parseWallPaintRole(args.role)
    if (!parsed) return null
    if (parsed.kind === 'slot') return base.getEffectiveMaterial?.(args) ?? null
    return refToEffective(
      currentRoleRef(
        args.node as WallNode,
        parsed,
        args.nodes as Readonly<Record<string, AnyNode | undefined>> | undefined,
      ),
    )
  },
}
