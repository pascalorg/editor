'use client'

import type { TemporalState } from 'zundo'
import { temporal } from 'zundo'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { parseMaterialRef, toSceneMaterialRef } from '../material-library'
import { nodeRegistry } from '../registry/registry'
import { BuildingNode } from '../schema'
import type { Collection, CollectionId } from '../schema/collections'
import { generateCollectionId } from '../schema/collections'
import { DoorNode as DoorNodeSchema } from '../schema/nodes/door'
import { ElevatorNode as ElevatorNodeSchema } from '../schema/nodes/elevator'
import { LevelNode } from '../schema/nodes/level'
import {
  getPitchFromActiveRoofHeight,
  type RoofSegmentNode,
  type RoofType,
} from '../schema/nodes/roof-segment'
import { segmentPointToRoofWallFace } from '../schema/nodes/roof-segment-walls'
import { ShelfNode as ShelfNodeSchema } from '../schema/nodes/shelf'
import { SiteNode } from '../schema/nodes/site'
import {
  getEffectiveStairSurfaceMaterial,
  StairNode as StairNodeSchema,
} from '../schema/nodes/stair'
import { StairSegmentNode as StairSegmentNodeSchema } from '../schema/nodes/stair-segment'
import { getEffectiveWallSurfaceMaterial, type WallSurfaceSide } from '../schema/nodes/wall'
import { WindowNode as WindowNodeSchema } from '../schema/nodes/window'
import {
  generateSceneMaterialId,
  type SceneMaterial,
  type SceneMaterialId,
} from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { healSceneNodes } from '../utils/heal-scene-graph'
import * as nodeActions from './actions/node-actions'
import { resetSceneHistoryPauseDepth } from './history-control'

function getFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getFiniteNumberInRange(value: unknown, fallback: number, min: number, max: number) {
  const finite = getFiniteNumber(value, fallback)
  return Math.min(Math.max(finite, min), max)
}

function getBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function getEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function getNullableString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function getVector3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) {
    return fallback
  }

  return [
    getFiniteNumber(value[0], fallback[0]),
    getFiniteNumber(value[1], fallback[1]),
    getFiniteNumber(value[2], fallback[2]),
  ]
}

function normalizeStairNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getFiniteNumber(node.rotation, 0),
    stairType: getEnumValue(node.stairType, ['straight', 'curved', 'spiral'] as const, 'straight'),
    fromLevelId: getNullableString(node.fromLevelId),
    toLevelId: getNullableString(node.toLevelId),
    slabOpeningMode: getEnumValue(node.slabOpeningMode, ['none', 'destination'] as const, 'none'),
    openingOffset: getFiniteNumber(node.openingOffset, 0),
    width: getFiniteNumber(node.width, 1),
    totalRise: getFiniteNumber(node.totalRise, 2.5),
    stepCount: getFiniteNumber(node.stepCount, 10),
    thickness: getFiniteNumber(node.thickness, 0.25),
    fillToFloor: getBoolean(node.fillToFloor, true),
    innerRadius: getFiniteNumber(node.innerRadius, 0.9),
    sweepAngle: getFiniteNumber(node.sweepAngle, Math.PI / 2),
    topLandingMode: getEnumValue(node.topLandingMode, ['none', 'integrated'] as const, 'none'),
    topLandingDepth: getFiniteNumber(node.topLandingDepth, 0.9),
    showCenterColumn: getBoolean(node.showCenterColumn, true),
    showStepSupports: getBoolean(node.showStepSupports, true),
    railingMode: getEnumValue(node.railingMode, ['none', 'left', 'right', 'both'] as const, 'none'),
    railingHeight: getFiniteNumber(node.railingHeight, 0.92),
    children: getStringArray(node.children),
  }

  const parsed = StairNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function normalizeStairSegmentNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getFiniteNumber(node.rotation, 0),
    segmentType: getEnumValue(node.segmentType, ['stair', 'landing'] as const, 'stair'),
    width: getFiniteNumber(node.width, 1),
    length: getFiniteNumber(node.length, 3),
    height: getFiniteNumber(node.height, 2.5),
    stepCount: getFiniteNumber(node.stepCount, 10),
    attachmentSide: getEnumValue(node.attachmentSide, ['front', 'left', 'right'] as const, 'front'),
    fillToFloor: getBoolean(node.fillToFloor, true),
    thickness: getFiniteNumber(node.thickness, 0.25),
  }

  const parsed = StairSegmentNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function normalizeDoorNode(node: Record<string, unknown>) {
  const parsed = DoorNodeSchema.safeParse(node)
  return parsed.success ? { ...node, ...parsed.data } : null
}

// Windows saved before a schema field existed (e.g. `columnRatios`/`rowRatios`/
// `frameThickness`) load without it; the mesh builder then reads undefined and
// throws every frame. Zod-parse on load so schema defaults land, like doors.
function normalizeWindowNode(node: Record<string, unknown>) {
  const parsed = WindowNodeSchema.safeParse(node)
  return parsed.success ? { ...node, ...parsed.data } : null
}

function normalizeShelfNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    children: getStringArray(node.children),
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getVector3(node.rotation, [0, 0, 0]),
    width: getFiniteNumberInRange(node.width, 1.2, 0.3, 3.0),
    depth: getFiniteNumberInRange(node.depth, 0.3, 0.1, 1.0),
    thickness: getFiniteNumberInRange(node.thickness, 0.04, 0.01, 0.1),
    height: getFiniteNumberInRange(node.height, 0.9, 0.05, 2.5),
    rows: Math.round(getFiniteNumberInRange(node.rows, 1, 1, 8)),
    columns: Math.round(getFiniteNumberInRange(node.columns, 1, 1, 6)),
    style: getEnumValue(
      node.style,
      ['wall-shelf', 'bookshelf', 'open-rack', 'cubby'] as const,
      'wall-shelf',
    ),
    withBack: getBoolean(node.withBack, false),
    withSides: getBoolean(node.withSides, true),
    withBottom: getBoolean(node.withBottom, false),
    bracketStyle: getEnumValue(
      node.bracketStyle,
      ['minimal', 'industrial', 'hidden'] as const,
      'minimal',
    ),
  }

  const parsed = ShelfNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function normalizeElevatorNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getFiniteNumber(node.rotation, 0),
    width: getFiniteNumber(node.width, 1.84),
    depth: getFiniteNumber(node.depth, 1.84),
    shaftWidth: node.shaftWidth === undefined ? undefined : getFiniteNumber(node.shaftWidth, 1.84),
    shaftDepth: node.shaftDepth === undefined ? undefined : getFiniteNumber(node.shaftDepth, 1.84),
    shaftWallThickness: getFiniteNumber(node.shaftWallThickness, 0.09),
    cabHeight: getFiniteNumber(node.cabHeight, 2.35),
    doorWidth: getFiniteNumber(node.doorWidth, 0.95),
    doorHeight: getFiniteNumber(node.doorHeight, 2.1),
    fromLevelId: getNullableString(node.fromLevelId),
    toLevelId: getNullableString(node.toLevelId),
    servedLevelIds:
      node.servedLevelIds === undefined ? undefined : getStringArray(node.servedLevelIds),
    disabledLevelIds: getStringArray(node.disabledLevelIds),
    serviceOnlyLevelIds: getStringArray(node.serviceOnlyLevelIds),
    defaultLevelId: getNullableString(node.defaultLevelId),
    speed: getFiniteNumber(node.speed, 2.2),
    doorDurationMs: getFiniteNumber(node.doorDurationMs, 900),
    dwellMs: getFiniteNumber(node.dwellMs, 1400),
  }

  const parsed = ElevatorNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function findBuildingIdForLevel(levelId: string, nodes: Record<string, any>): string | null {
  const level = nodes[levelId]
  const directBuildingId = typeof level?.parentId === 'string' ? level.parentId : null
  if (directBuildingId && nodes[directBuildingId]?.type === 'building') {
    return directBuildingId
  }

  for (const [candidateId, candidate] of Object.entries(nodes)) {
    if (candidate?.type !== 'building') continue
    if (getStringArray(candidate.children).includes(levelId)) {
      return candidateId
    }
  }

  return null
}

function migrateElevatorParent(
  id: string,
  node: Record<string, unknown>,
  nodes: Record<string, any>,
) {
  const parentId = typeof node.parentId === 'string' ? node.parentId : null
  if (!parentId) return node
  const parent = parentId ? nodes[parentId] : null
  if (parent?.type !== 'level') return node

  const buildingId = findBuildingIdForLevel(parentId, nodes)
  if (!buildingId) return node
  const building = buildingId ? nodes[buildingId] : null
  if (building?.type !== 'building') return node

  nodes[parentId] = {
    ...parent,
    children: getStringArray(parent.children).filter((childId) => childId !== id),
  }

  const buildingChildren = getStringArray(building.children)
  nodes[buildingId] = {
    ...building,
    children: buildingChildren.includes(id) ? buildingChildren : [...buildingChildren, id],
  }

  return {
    ...node,
    parentId: buildingId,
  }
}

// Reuse an already-minted scene material for an identical inline legacy
// material so a whole building painted one custom colour collapses to one
// shared datablock (mirrors `commitSlotPaint`'s dedupe-on-match).
function findMintedSceneMaterialRef(
  material: unknown,
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>,
): string | undefined {
  const target = JSON.stringify(material)
  for (const sceneMaterial of Object.values(mintedMaterials)) {
    if (JSON.stringify(sceneMaterial.material) === target) {
      return toSceneMaterialRef(sceneMaterial.id)
    }
  }
  return undefined
}

// Turn a legacy surface spec (`{ material, materialPreset }`) into a
// `MaterialRef`: a preset that's already a `library:`/`scene:` ref is used
// as-is; an inline material mints (or reuses) a scene material. Returns
// undefined when the spec carries no material. Shared by every legacy→slots
// migration below.
function legacySpecToMaterialRef(
  spec: { material?: unknown; materialPreset?: unknown },
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>,
): string | undefined {
  if (typeof spec.materialPreset === 'string' && parseMaterialRef(spec.materialPreset)) {
    return spec.materialPreset
  }
  if (spec.material !== undefined) {
    const existing = findMintedSceneMaterialRef(spec.material, mintedMaterials)
    if (existing) return existing
    const id = generateSceneMaterialId()
    mintedMaterials[id] = {
      id,
      name: `Material ${Object.keys(mintedMaterials).length + 1}`,
      material: spec.material as SceneMaterial['material'],
    }
    return toSceneMaterialRef(id)
  }
  return undefined
}

// Move the retired inline `material*` / `interiorMaterial*` / `exteriorMaterial*`
// fields onto the unified `node.slots` model (interior / exterior → a
// `library:`/`scene:` ref), minting scene materials for inline customs into
// `mintedMaterials` (merged into the scene material map by the caller). Already
// slot-modelled walls and walls with no legacy material are left untouched.
function migrateWallSurfaceMaterials(
  node: Record<string, any>,
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>,
) {
  if (node.slots && (node.slots.interior !== undefined || node.slots.exterior !== undefined)) {
    return node
  }

  const slots: Record<string, string> = { ...(node.slots ?? {}) }
  for (const side of ['interior', 'exterior'] as WallSurfaceSide[]) {
    const spec = getEffectiveWallSurfaceMaterial(
      node as Parameters<typeof getEffectiveWallSurfaceMaterial>[0],
      side,
    )
    const ref = legacySpecToMaterialRef(spec, mintedMaterials)
    if (ref) slots[side] = ref
  }

  if (Object.keys(slots).length === 0) {
    return node
  }

  return {
    ...node,
    slots,
    material: undefined,
    materialPreset: undefined,
    interiorMaterial: undefined,
    interiorMaterialPreset: undefined,
    exteriorMaterial: undefined,
    exteriorMaterialPreset: undefined,
  }
}

// Move a kind's single legacy `material` / `materialPreset` onto its declared
// slots. A pre-slot-model node painted one material rendered that material on
// every part (each slot resolves `node.slots[slot]` → legacy → default), so the
// migration writes the same ref to every slot id the kind can expose — unused
// conditional slots are harmless. Already slot-modelled or unpainted nodes are
// left untouched. Mirrors `migrateWallSurfaceMaterials` for single-surface and
// whole-object kinds (slab, ceiling, fence, column, shelf).
function migrateSingleMaterialSlots(
  node: Record<string, any>,
  slotIds: readonly string[],
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>,
) {
  if (node.slots && Object.keys(node.slots).length > 0) {
    return node
  }

  const ref = legacySpecToMaterialRef(
    { material: node.material, materialPreset: node.materialPreset },
    mintedMaterials,
  )
  if (!ref) {
    return node
  }

  const slots: Record<string, string> = {}
  for (const slotId of slotIds) slots[slotId] = ref

  return { ...node, slots, material: undefined, materialPreset: undefined }
}

// Stair carries per-role legacy fields (`treadMaterial*` / `sideMaterial*` /
// `railingMaterial*`) plus a catch-all. Map each to its slot via the same
// fallback chain the renderer uses (`getEffectiveStairSurfaceMaterial`):
// tread→treads, side→body, railing→railing. Runs after
// `migrateStairSurfaceMaterials` has normalised the legacy fields.
function migrateStairSurfaceSlots(
  node: Record<string, any>,
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>,
) {
  if (node.slots && Object.keys(node.slots).length > 0) {
    return node
  }

  const roleToSlot = [
    ['tread', 'treads'],
    ['side', 'body'],
    ['railing', 'railing'],
  ] as const

  const slots: Record<string, string> = {}
  for (const [role, slotId] of roleToSlot) {
    const spec = getEffectiveStairSurfaceMaterial(
      node as Parameters<typeof getEffectiveStairSurfaceMaterial>[0],
      role,
    )
    const ref = legacySpecToMaterialRef(spec, mintedMaterials)
    if (ref) slots[slotId] = ref
  }

  if (Object.keys(slots).length === 0) {
    return node
  }

  return {
    ...node,
    slots,
    material: undefined,
    materialPreset: undefined,
    treadMaterial: undefined,
    treadMaterialPreset: undefined,
    sideMaterial: undefined,
    sideMaterialPreset: undefined,
    railingMaterial: undefined,
    railingMaterialPreset: undefined,
  }
}

function migrateStairSurfaceMaterials(node: Record<string, any>) {
  const hasRailing =
    node.railingMaterial !== undefined || typeof node.railingMaterialPreset === 'string'
  const hasTread = node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string'
  const hasSide = node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string'
  const legacyFinish = {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }

  const resolveBodyFallback = () => {
    if (node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string') {
      return {
        material: node.treadMaterial,
        materialPreset:
          typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
      }
    }

    if (node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string') {
      return {
        material: node.sideMaterial,
        materialPreset:
          typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
      }
    }

    return legacyFinish
  }

  if (!(hasRailing || hasTread || hasSide)) {
    if (legacyFinish.material === undefined && legacyFinish.materialPreset === undefined) {
      return node
    }

    return {
      ...node,
      railingMaterial: legacyFinish.material,
      railingMaterialPreset: legacyFinish.materialPreset,
      treadMaterial: legacyFinish.material,
      treadMaterialPreset: legacyFinish.materialPreset,
      sideMaterial: legacyFinish.material,
      sideMaterialPreset: legacyFinish.materialPreset,
    }
  }

  const next = { ...node }

  if (!hasTread) {
    const fallback =
      node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string'
        ? {
            material: node.sideMaterial,
            materialPreset:
              typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
          }
        : resolveBodyFallback()
    next.treadMaterial = fallback.material
    next.treadMaterialPreset = fallback.materialPreset
  }

  if (!hasSide) {
    const fallback =
      node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string'
        ? {
            material: node.treadMaterial,
            materialPreset:
              typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
          }
        : resolveBodyFallback()
    next.sideMaterial = fallback.material
    next.sideMaterialPreset = fallback.materialPreset
  }

  if (!hasRailing) {
    const fallback = resolveBodyFallback()
    next.railingMaterial = fallback.material
    next.railingMaterialPreset = fallback.materialPreset
  }

  return next
}

function migrateRoofSurfaceMaterials(node: Record<string, any>) {
  const hasTop = node.topMaterial !== undefined || typeof node.topMaterialPreset === 'string'
  const hasEdge = node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string'
  const hasWall = node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string'
  const legacyFinish = {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }

  if (!(hasTop || hasEdge || hasWall)) {
    if (legacyFinish.material === undefined && legacyFinish.materialPreset === undefined) {
      return node
    }

    return {
      ...node,
      topMaterial: legacyFinish.material,
      topMaterialPreset: legacyFinish.materialPreset,
      edgeMaterial: legacyFinish.material,
      edgeMaterialPreset: legacyFinish.materialPreset,
      wallMaterial: legacyFinish.material,
      wallMaterialPreset: legacyFinish.materialPreset,
    }
  }

  const next = { ...node }

  if (!hasTop) {
    next.topMaterial = legacyFinish.material
    next.topMaterialPreset = legacyFinish.materialPreset
  }

  if (!hasEdge) {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      next.edgeMaterial = node.wallMaterial
      next.edgeMaterialPreset =
        typeof node.wallMaterialPreset === 'string' ? node.wallMaterialPreset : undefined
    } else {
      next.edgeMaterial = legacyFinish.material
      next.edgeMaterialPreset = legacyFinish.materialPreset
    }
  }

  if (!hasWall) {
    if (node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string') {
      next.wallMaterial = node.edgeMaterial
      next.wallMaterialPreset =
        typeof node.edgeMaterialPreset === 'string' ? node.edgeMaterialPreset : undefined
    } else {
      next.wallMaterial = legacyFinish.material
      next.wallMaterialPreset = legacyFinish.materialPreset
    }
  }

  return next
}

function migrateNodes(nodes: Record<string, any>): {
  nodes: Record<string, AnyNode>
  mintedMaterials: Record<SceneMaterialId, SceneMaterial>
} {
  // Repair pre-existing corruption (null children, zero-length walls) before
  // any per-type migration runs, so already-saved scenes load cleanly.
  const { nodes: healed } = healSceneNodes(nodes)
  const patchedNodes = { ...healed } as Record<string, any>

  // Scene materials minted while moving legacy wall fields onto `node.slots`;
  // merged into the scene material map by the caller (`setScene`).
  const mintedMaterials: Record<SceneMaterialId, SceneMaterial> = {}

  // Pass 1: all node types except elevator.
  // Elevator migration (migrateElevatorParent) mutates level.children to remove
  // the elevator ID. If the elevator is processed before its parent level in
  // Object.entries order, the level migration in this same pass would then see
  // a children array that still contains the elevator ID and filter it out as
  // "missing" — corrupting the level. Running elevators in a second pass after
  // all levels are stable avoids the race entirely.
  for (const [id, node] of Object.entries(patchedNodes)) {
    // 1. Item scale migration
    if (node.type === 'item' && !('scale' in node)) {
      patchedNodes[id] = { ...node, scale: [1, 1, 1] }
    }
    // 2. Old roof to new roof + segment migration
    if (node.type === 'roof' && !('children' in node)) {
      const oldRoof = node
      const suffix = id.includes('_') ? id.split('_')[1] : Math.random().toString(36).slice(2)
      const segmentId = `rseg_${suffix}`

      const segWidth = oldRoof.length ?? 8
      const segDepth = (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2)
      const legacyRoofHeight = oldRoof.height ?? 2.5
      const segment = {
        object: 'node',
        id: segmentId,
        type: 'roof-segment',
        parentId: id,
        visible: oldRoof.visible ?? true,
        metadata: {},
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: segWidth,
        depth: segDepth,
        // Schema default (0.5), NOT 0: a zero-height wall builds a flat,
        // degenerate CSG brush → "Coplanar clip not handled" + NaN geometry, so
        // the migrated legacy roof never renders. New roofs use 0.5 too.
        wallHeight: 0.5,
        pitch: getPitchFromActiveRoofHeight({
          roofType: 'gable',
          width: segWidth,
          depth: segDepth,
          roofHeight: legacyRoofHeight,
        }),
        wallThickness: 0.1,
        deckThickness: 0.1,
        overhang: 0.3,
        shingleThickness: 0.05,
      }

      patchedNodes[segmentId] = segment
      patchedNodes[id] = {
        ...oldRoof,
        children: [segmentId],
      }
    }

    // 2b. roof-segment: guarantee a valid positive pitch (degrees).
    // Saved scenes wrote `roofHeight` in metres; the schema now stores `pitch`
    // in degrees. Convert the legacy field when present, and — crucially — fall
    // back to the schema default for any segment that carries no usable pitch or
    // roofHeight (older/partial saves). Without this, the slope-frame guard
    // resolves a missing pitch to a FLAT frame, so the roof renders as a slab.
    // The migration result is cast, not zod-parsed, so the schema default never
    // applies on its own — this branch is the only place it lands.
    if (node.type === 'roof-segment') {
      const currentPitch = (node as { pitch?: unknown }).pitch
      const hasValidPitch = typeof currentPitch === 'number' && currentPitch > 0
      if (!hasValidPitch) {
        const { roofHeight, ...rest } = node as RoofSegmentNode & { roofHeight?: unknown }
        const width = typeof node.width === 'number' ? node.width : 8
        const depth = typeof node.depth === 'number' ? node.depth : 6
        const roofType = (typeof node.roofType === 'string' ? node.roofType : 'gable') as RoofType
        const derived =
          typeof roofHeight === 'number' && roofHeight > 0
            ? getPitchFromActiveRoofHeight({ roofType, width, depth, roofHeight })
            : 0
        // 40° matches the RoofSegmentNode schema default.
        patchedNodes[id] = { ...rest, pitch: derived > 0 ? derived : 40 }
      }
    }

    if (node.type === 'door') {
      const normalized = normalizeDoorNode(node)
      if (normalized) {
        patchedNodes[id] = normalized
      }
    }

    if (node.type === 'window') {
      const normalized = normalizeWindowNode(node)
      if (normalized) {
        patchedNodes[id] = normalized
      }
    }

    if (node.type === 'stair') {
      const normalized = normalizeStairNode(migrateStairSurfaceMaterials(node))
      if (normalized) {
        patchedNodes[id] = normalized
      }
      patchedNodes[id] = migrateStairSurfaceSlots(patchedNodes[id], mintedMaterials)
    }

    if (node.type === 'stair-segment') {
      const normalized = normalizeStairSegmentNode(node)
      if (normalized) {
        patchedNodes[id] = normalized
      }
    }

    if (node.type === 'wall') {
      patchedNodes[id] = migrateWallSurfaceMaterials(patchedNodes[id], mintedMaterials)
    }

    if (node.type === 'slab' || node.type === 'ceiling') {
      patchedNodes[id] = migrateSingleMaterialSlots(patchedNodes[id], ['surface'], mintedMaterials)
    }

    if (node.type === 'fence') {
      patchedNodes[id] = migrateSingleMaterialSlots(
        patchedNodes[id],
        ['posts', 'infill', 'base', 'rail'],
        mintedMaterials,
      )
    }

    if (node.type === 'column') {
      patchedNodes[id] = migrateSingleMaterialSlots(
        patchedNodes[id],
        ['shaft', 'base', 'capital', 'frame'],
        mintedMaterials,
      )
    }

    if (node.type === 'shelf') {
      const normalized = normalizeShelfNode(node)
      if (normalized) {
        patchedNodes[id] = normalized
      }
      patchedNodes[id] = migrateSingleMaterialSlots(
        patchedNodes[id],
        ['shelves', 'frame', 'back'],
        mintedMaterials,
      )
    }

    // Roof-segment hosting was added in this migration cycle (the same
    // pattern as shelf above). Older segments saved before the schema
    // gained `children` need the field initialised so
    // `createNode(chimney, segmentId)` finds an array to append to —
    // without this every "Add Element" click on the roof panel results
    // in an orphaned accessory (parented in scene state but never
    // appended to `seg.children`, so the renderer's recursive
    // `<NodeRenderer>` mount never sees it).
    if (node.type === 'roof-segment' && !Array.isArray((node as { children?: unknown }).children)) {
      patchedNodes[id] = { ...node, children: [] } as AnyNode
    }

    // Roof-hosted wall children (door / window / item) originally stored
    // SEGMENT-LOCAL positions with the face yaw in rotation[1]; the
    // format moved to explicit `roofFace` + FACE-LOCAL coords so the
    // renderer's face frame can track segment edits live. Convert in
    // place: face from the old cardinal yaw, u/v from the outer-plane
    // projection, z re-based from the outer plane to the wall mid-plane.
    if (
      (node.type === 'door' || node.type === 'window' || node.type === 'item') &&
      typeof (node as { roofSegmentId?: unknown }).roofSegmentId === 'string' &&
      (node as { roofFace?: unknown }).roofFace === undefined
    ) {
      const current = patchedNodes[id] as AnyNode & {
        roofSegmentId: string
        position: [number, number, number]
        rotation: [number, number, number]
      }
      const segment = patchedNodes[current.roofSegmentId] as
        | (AnyNode & { wallThickness?: number })
        | undefined
      if (segment?.type === 'roof-segment') {
        const tau = Math.PI * 2
        const yaw = (((current.rotation?.[1] ?? 0) % tau) + tau) % tau
        const eps = 1e-3
        const face =
          yaw < eps || tau - yaw < eps
            ? ('front' as const)
            : Math.abs(yaw - Math.PI) < eps
              ? ('back' as const)
              : Math.abs(yaw - Math.PI / 2) < eps
                ? ('right' as const)
                : Math.abs(yaw - (3 * Math.PI) / 2) < eps
                  ? ('left' as const)
                  : null
        if (face) {
          const { u, v, dist } = segmentPointToRoofWallFace(
            segment as never,
            face,
            current.position,
          )
          patchedNodes[id] = {
            ...current,
            roofFace: face,
            position: [u, v, dist + (segment.wallThickness ?? 0.1) / 2],
            rotation: [0, 0, 0],
          } as AnyNode
        }
      }
    }

    if (node.type === 'roof') {
      patchedNodes[id] = migrateRoofSurfaceMaterials(patchedNodes[id])
    }

    // Legacy: site.children used to hold nested BuildingNode / ItemNode
    // objects (see the SiteNode schema before the children-as-ids fix).
    // Flatten any leftover nested children into ids, and absorb the
    // embedded nodes into the flat map so the rest of the loader can
    // treat the site like every other parent.
    if (node.type === 'site' && Array.isArray(node.children)) {
      let needsFlatten = false
      const flattened: string[] = []
      for (const child of node.children) {
        if (typeof child === 'string') {
          flattened.push(child)
        } else if (child && typeof child === 'object' && typeof child.id === 'string') {
          needsFlatten = true
          flattened.push(child.id)
          if (!patchedNodes[child.id]) {
            patchedNodes[child.id] = { ...child, parentId: id }
          }
        }
      }
      if (needsFlatten) {
        patchedNodes[id] = { ...node, children: flattened }
      }
    }

    // Level children normalization.
    // Pre-0.9.1 JSONs may carry child IDs that no longer exist in the node
    // map (e.g. elevator IDs that lived under a level before the elevator
    // parent migration moved them up to building). If those dangling IDs are
    // left in place, collectReachableNodeIds marks the level as having
    // reachable children that don't exist, which corrupts the scene graph
    // traversal and leaves the LevelNode in a broken state — making floors
    // impossible to drag or delete after import.
    // We intentionally do NOT filter by type prefix here; being permissive
    // about which types are allowed as children prevents data loss when new
    // child types are added to the schema in the future.
    if (node.type === 'level') {
      const rawChildren = getStringArray(node.children)
      const validChildren = rawChildren.filter((childId) => {
        const exists = Boolean(patchedNodes[childId])
        if (!exists) {
          console.warn(
            '[migrateNodes] level',
            id,
            'references missing child',
            childId,
            '— dropping',
          )
        }
        return exists
      })
      const levelNumber = getFiniteNumber(node.level, 0)
      patchedNodes[id] = {
        ...node,
        level: levelNumber,
        children: validChildren,
      }
    }
  }

  // Pass 2: elevator migration.
  // migrateElevatorParent mutates the parent level's children array (removes
  // the elevator ID from it). Running this after Pass 1 guarantees that the
  // level normalization above has already seen a clean children list — if we
  // ran elevator migration inside Pass 1, the order of Object.entries
  // iteration would be non-deterministic: processing an elevator before its
  // parent level would mutate the level's children mid-iteration, potentially
  // causing the level branch above to see a stale node reference.
  for (const [id, node] of Object.entries(patchedNodes)) {
    if (node.type !== 'elevator') continue
    const parentMigrated = migrateElevatorParent(id, node, patchedNodes)
    const normalized = normalizeElevatorNode(parentMigrated)
    if (normalized) {
      patchedNodes[id] = normalized
    }
  }

  return { nodes: patchedNodes as Record<string, AnyNode>, mintedMaterials }
}

function getNodeChildIds(node: AnyNode): AnyNodeId[] {
  if (!('children' in node && Array.isArray(node.children))) {
    return []
  }

  return (node.children as unknown[])
    .map((child) => {
      if (typeof child === 'string') return child
      if (child && typeof child === 'object' && 'id' in child && typeof child.id === 'string') {
        return child.id
      }
      return null
    })
    .filter((id): id is AnyNodeId => typeof id === 'string')
}

function normalizeRootNodeIds(
  nodes: Record<AnyNodeId, AnyNode>,
  rootNodeIds: AnyNodeId[],
): AnyNodeId[] {
  const existingRootIds = rootNodeIds.filter((id) => Boolean(nodes[id]))
  const siteRootIds = existingRootIds.filter((id) => nodes[id]?.type === 'site')

  if (siteRootIds.length > 0) {
    return siteRootIds
  }

  return existingRootIds.filter((id) => nodes[id]?.parentId === null)
}

function collectReachableNodeIds(
  nodes: Record<AnyNodeId, AnyNode>,
  rootNodeIds: AnyNodeId[],
): Set<AnyNodeId> {
  const reachable = new Set<AnyNodeId>()
  const stack = [...rootNodeIds]
  const childIdsByParentId = new Map<AnyNodeId, AnyNodeId[]>()

  for (const node of Object.values(nodes)) {
    if (!node.parentId) continue
    const parentId = node.parentId as AnyNodeId
    const children = childIdsByParentId.get(parentId) ?? []
    children.push(node.id as AnyNodeId)
    childIdsByParentId.set(parentId, children)
  }

  while (stack.length > 0) {
    const id = stack.pop()
    if (!id || reachable.has(id)) continue

    const node = nodes[id]
    if (!node) continue

    reachable.add(id)
    stack.push(...getNodeChildIds(node))
    stack.push(...(childIdsByParentId.get(id) ?? []))
  }

  return reachable
}

export type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[]

  // 3. The "Dirty" Set: For the Wall/Physics systems
  dirtyNodes: Set<AnyNodeId>

  // 4. Relational metadata — not nodes
  collections: Record<CollectionId, Collection>
  materials: Record<SceneMaterialId, SceneMaterial>

  // 5. Read-only lock — when true all create/update/delete operations are no-ops
  readOnly: boolean
  setReadOnly: (readOnly: boolean) => void

  // Actions
  loadScene: () => void
  clearScene: () => void
  unloadScene: () => void
  setScene: (
    nodes: Record<AnyNodeId, AnyNode>,
    rootNodeIds: AnyNodeId[],
    extra?: {
      collections?: Record<CollectionId, Collection>
      materials?: Record<SceneMaterialId, SceneMaterial>
    },
  ) => void

  markDirty: (id: AnyNodeId) => void
  clearDirty: (id: AnyNodeId) => void

  createNode: (node: AnyNode, parentId?: AnyNodeId) => void
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void
  applyNodeChanges: (changes: {
    create?: { node: AnyNode; parentId?: AnyNodeId }[]
    update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
    delete?: AnyNodeId[]
  }) => void

  updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
  updateNodes: (updates: { id: AnyNodeId; data: Partial<AnyNode> }[]) => void

  deleteNode: (id: AnyNodeId) => void
  deleteNodes: (ids: AnyNodeId[]) => void

  // Collection actions
  createCollection: (name: string, nodeIds?: AnyNodeId[]) => CollectionId
  deleteCollection: (id: CollectionId) => void
  updateCollection: (id: CollectionId, data: Partial<Omit<Collection, 'id'>>) => void
  addToCollection: (id: CollectionId, nodeId: AnyNodeId) => void
  removeFromCollection: (id: CollectionId, nodeId: AnyNodeId) => void

  // Scene material actions
  addSceneMaterial: (material: SceneMaterial) => void
  updateSceneMaterial: (id: SceneMaterialId, data: Partial<Omit<SceneMaterial, 'id'>>) => void
  removeSceneMaterial: (id: SceneMaterialId) => void
}

// type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

type UseSceneStore = UseBoundStore<StoreApi<SceneState>> & {
  temporal: StoreApi<
    TemporalState<Pick<SceneState, 'nodes' | 'rootNodeIds' | 'collections' | 'materials'>>
  >
}

const useScene: UseSceneStore = create<SceneState>()(
  temporal(
    (set, get) => ({
      // 1. Flat dictionary of all nodes
      nodes: {},

      // 2. Root node IDs
      rootNodeIds: [],

      // 3. Dirty set
      dirtyNodes: new Set<AnyNodeId>(),

      // 4. Collections
      collections: {} as Record<CollectionId, Collection>,
      materials: {} as Record<SceneMaterialId, SceneMaterial>,

      // 5. Read-only lock
      readOnly: false,
      setReadOnly: (readOnly: boolean) => set({ readOnly }),

      unloadScene: () => {
        set({
          nodes: {},
          rootNodeIds: [],
          dirtyNodes: new Set<AnyNodeId>(),
          collections: {},
          materials: {},
        })
      },

      clearScene: () => {
        get().unloadScene()
        get().loadScene() // Default scene
      },

      setScene: (nodes, rootNodeIds, extra) => {
        // Apply backward compatibility migrations
        const { nodes: patchedNodes, mintedMaterials } = migrateNodes(nodes)
        // Scene materials minted by the wall legacy→slots migration join the
        // loaded palette (existing refs win on id collision — there are none,
        // ids are freshly generated).
        const materials = { ...mintedMaterials, ...(extra?.materials ?? {}) }

        // Remove orphans: nodes whose parentId points to a non-existent node
        const cleanedNodes = { ...patchedNodes }
        for (const node of Object.values(cleanedNodes)) {
          if (node.parentId && !cleanedNodes[node.parentId]) {
            console.warn(
              '[Scene] Removing orphan node',
              node.id,
              '(parentId',
              node.parentId,
              'not found)',
            )
            delete cleanedNodes[node.id]
          }
        }

        set({
          nodes: cleanedNodes,
          rootNodeIds,
          dirtyNodes: new Set<AnyNodeId>(),
          collections: extra?.collections ?? {},
          materials,
        })

        const normalizedRootNodeIds = normalizeRootNodeIds(cleanedNodes, rootNodeIds)
        const reachableNodeIds = collectReachableNodeIds(cleanedNodes, normalizedRootNodeIds)
        if (normalizedRootNodeIds.length > 0) {
          for (const node of Object.values(cleanedNodes)) {
            if (reachableNodeIds.has(node.id as AnyNodeId)) continue
            console.warn('[Scene] Removing unreachable node', node.id)
            delete cleanedNodes[node.id]
          }
        }

        set({
          nodes: cleanedNodes,
          rootNodeIds: normalizedRootNodeIds,
          dirtyNodes: new Set<AnyNodeId>(),
          collections: extra?.collections ?? {},
          materials,
        })
        // Mark all nodes as dirty to trigger re-validation
        Object.values(cleanedNodes).forEach((node) => {
          get().markDirty(node.id)
        })
      },

      loadScene: () => {
        if (get().rootNodeIds.length > 0) {
          // Assign all nodes as dirty to force re-validation
          Object.values(get().nodes).forEach((node) => {
            get().markDirty(node.id)
          })
          return // Scene already loaded
        }

        // Create hierarchy: Site → Building → Level
        const level0 = LevelNode.parse({
          level: 0,
          children: [],
        })

        const building = BuildingNode.parse({
          children: [level0.id],
        })

        const site = SiteNode.parse({
          children: [building.id],
        })

        // Define all nodes flat
        const nodes: Record<AnyNodeId, AnyNode> = {
          [site.id]: site,
          [building.id]: building,
          [level0.id]: level0,
        }

        // Site is the root
        const rootNodeIds = [site.id]

        set({ nodes, rootNodeIds })
      },

      markDirty: (id) => {
        const node = get().nodes[id]
        if (node && nodeRegistry.get(node.type)?.dirtyTracking === false) return
        get().dirtyNodes.add(id)
      },

      clearDirty: (id) => {
        get().dirtyNodes.delete(id)
      },

      createNodes: (ops) => nodeActions.createNodesAction(set, get, ops),
      createNode: (node, parentId) => nodeActions.createNodesAction(set, get, [{ node, parentId }]),
      applyNodeChanges: (changes) => nodeActions.applyNodeChangesAction(set, get, changes),

      updateNodes: (updates) => nodeActions.updateNodesAction(set, get, updates),
      updateNode: (id, data) => nodeActions.updateNodesAction(set, get, [{ id, data }]),

      // --- DELETE ---

      deleteNodes: (ids) => nodeActions.deleteNodesAction(set, get, ids),

      deleteNode: (id) => nodeActions.deleteNodesAction(set, get, [id]),

      // --- COLLECTIONS ---

      createCollection: (name, nodeIds = []) => {
        if (get().readOnly) return '' as CollectionId
        const id = generateCollectionId()
        const collection: Collection = { id, name, nodeIds }
        set((state) => {
          const nextCollections = { ...state.collections, [id]: collection }
          // Denormalize: stamp collectionId onto each node
          const nextNodes = { ...state.nodes }
          for (const nodeId of nodeIds) {
            const node = nextNodes[nodeId]
            if (!node) continue
            const existing =
              ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
            nextNodes[nodeId] = { ...node, collectionIds: [...existing, id] } as AnyNode
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
        return id
      },

      deleteCollection: (id) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          const nextCollections = { ...state.collections }
          delete nextCollections[id]
          // Remove collectionId from all member nodes
          const nextNodes = { ...state.nodes }
          for (const nodeId of col?.nodeIds ?? []) {
            const node = nextNodes[nodeId]
            if (!(node && 'collectionIds' in node)) continue
            nextNodes[nodeId] = {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      updateCollection: (id, data) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          return { collections: { ...state.collections, [id]: { ...col, ...data } } }
        })
      },

      addToCollection: (id, nodeId) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col || col.nodeIds.includes(nodeId)) return state
          const nextCollections = {
            ...state.collections,
            [id]: { ...col, nodeIds: [...col.nodeIds, nodeId] },
          }
          const node = state.nodes[nodeId]
          if (!node) return { collections: nextCollections }
          const existing =
            ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
          const nextNodes = {
            ...state.nodes,
            [nodeId]: { ...node, collectionIds: [...existing, id] } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      removeFromCollection: (id, nodeId) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          const nextCollections = {
            ...state.collections,
            [id]: { ...col, nodeIds: col.nodeIds.filter((n) => n !== nodeId) },
          }
          const node = state.nodes[nodeId]
          if (!(node && 'collectionIds' in node)) return { collections: nextCollections }
          const nextNodes = {
            ...state.nodes,
            [nodeId]: {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      // --- SCENE MATERIALS ---

      addSceneMaterial: (material) => {
        if (get().readOnly) return
        set((state) => ({
          materials: { ...state.materials, [material.id]: material },
        }))
      },

      updateSceneMaterial: (id, data) => {
        if (get().readOnly) return
        set((state) => {
          const material = state.materials[id]
          if (!material) return state
          return { materials: { ...state.materials, [id]: { ...material, ...data } } }
        })
      },

      removeSceneMaterial: (id) => {
        if (get().readOnly) return
        set((state) => {
          const materials = { ...state.materials }
          delete materials[id]
          return { materials }
        })
      },
    }),
    {
      partialize: (state) => {
        const { nodes, rootNodeIds, collections, materials } = state
        return { nodes, rootNodeIds, collections, materials }
      },
      limit: 50, // Limit to last 50 actions
    },
  ),
)

export default useScene

// Track previous temporal state lengths and node snapshot for diffing
let prevPastLength = 0
let prevFutureLength = 0
let prevNodesSnapshot: Record<AnyNodeId, AnyNode> | null = null

export function clearSceneHistory() {
  resetSceneHistoryPauseDepth()
  useScene.temporal.getState().clear()
  prevPastLength = 0
  prevFutureLength = 0
  prevNodesSnapshot = null
}

// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state) => {
  const currentPastLength = state.pastStates.length
  const currentFutureLength = state.futureStates.length

  // Undo: futureStates increases (state moved from past to future)
  // Redo: pastStates increases while futureStates decreases (state moved from future to past)
  const didUndo = currentFutureLength > prevFutureLength
  const didRedo = currentPastLength > prevPastLength && currentFutureLength < prevFutureLength

  if (didUndo || didRedo) {
    // Capture the previous snapshot before RAF fires
    const snapshotBefore = prevNodesSnapshot

    // Defer to a microtask so the scene store has settled before we diff,
    // but still mark walls/items dirty before the next paint.
    queueMicrotask(() => {
      const currentNodes = useScene.getState().nodes
      const { markDirty } = useScene.getState()

      if (snapshotBefore) {
        // Diff: only mark nodes that actually changed
        for (const [id, node] of Object.entries(currentNodes) as [AnyNodeId, AnyNode][]) {
          if (snapshotBefore[id] !== node) {
            markDirty(id)
            // Also mark parent so merged geometries update
            if (node.parentId) markDirty(node.parentId as AnyNodeId)
          }
        }
        // Nodes that were deleted (exist in prev but not current)
        for (const [id, node] of Object.entries(snapshotBefore) as [AnyNodeId, AnyNode][]) {
          if (!currentNodes[id]) {
            const parentId = node.parentId as AnyNodeId | undefined
            if (parentId) {
              markDirty(parentId)
              // Mark sibling nodes dirty so they can update their geometry
              // (e.g. adjacent walls need to recalculate miter/junction geometry)
              const parent = currentNodes[parentId]
              if (parent && 'children' in parent && Array.isArray(parent.children)) {
                for (const childId of parent.children) {
                  markDirty(childId as AnyNodeId)
                }
              }
            }
          }
        }
      } else {
        // No snapshot to diff against — fall back to marking all
        for (const node of Object.values(currentNodes)) {
          markDirty(node.id)
        }
      }
    })
  }

  // Update tracked lengths and snapshot
  prevPastLength = currentPastLength
  prevFutureLength = currentFutureLength
  prevNodesSnapshot = useScene.getState().nodes
})
