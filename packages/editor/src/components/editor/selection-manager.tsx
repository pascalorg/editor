import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  createSceneApi,
  emitter,
  floorPlatePaintRefusal,
  type GridEvent,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  getRoofSegmentSurfaceY,
  getSelectableKinds,
  type ItemNode,
  isRegistrySelectable,
  isSelectionHighlightEnabled,
  type NodeEvent,
  nodeRegistry,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentEvent,
  type RoofSegmentNode,
  resolveLevelId,
  type SlabNode,
  type StairEvent,
  type StairSegmentEvent,
  type StairSurfaceMaterialRole,
  sceneRegistry,
  useLiveNodeOverrides,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import {
  createMaterial,
  getRoofMaterialArray,
  registerMaterialCacheCleanup,
  resolveMaterialRef,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { type BufferGeometry, Color, type Material, type Mesh, type Object3D, Vector3 } from 'three'
import {
  hoverRoomFromHit,
  resolveEditorRoomHit,
  roomPickingEnabled,
  useRoomRecords,
} from '../../hooks/use-selected-room'
import {
  canDirectMoveNode,
  canDirectRotateNode,
  pointerEventHitsEditorHandle,
  resolveDirectManipulationNode,
  resolveDirectRotationDragDelta,
  resolveDirectRotationPatch,
  shouldStartDirectMoveDrag,
} from '../../lib/direct-manipulation'
import { createEditorApi } from '../../lib/editor-api'
import {
  isFootprintConstructionHit,
  isRoomOwnedPlate,
  roomOwnedPlateDrillTarget,
} from '../../lib/floor-footprints'
import { selectionEnabled } from '../../lib/interaction/scope'
import {
  type ActivePaintMaterial,
  buildRoofSegmentSurfaceMaterialPatch,
  buildRoofSurfaceMaterialPatch,
  hasActivePaintMaterial,
  resolveActivePaintMaterialFromSelection,
} from '../../lib/material-paint'
import { paintCommitRoute } from '../../lib/paint-commit-route'
import { eyedropperMaterial, paintMaterialKey } from '../../lib/paint-eyedropper'
import {
  openingPartHidden,
  paintPassesThrough,
  wallHitInOpening,
} from '../../lib/paint-pass-through'
import {
  combinePaintPreviews,
  createPaintPreviewOwner,
  type PaintPreviewCleanup,
} from '../../lib/paint-preview-owner'
import {
  bindPaintPickHold,
  isPaintErasing,
  isPaintPicking,
  paintPickReturnMode,
  paintRegionModeActive,
  usePaintRegionMode,
} from '../../lib/paint-region-mode'
import {
  commitPaintScopeFanout,
  effectivePaintScope,
  nodeSlotRoles,
  type PaintHoverInfo,
  paintHoverInfo,
  paintScopeRole,
  paintSurfaceLabel,
  resolvePaintScopeTargets,
  slotDisplayLabel,
  type WallPaintHit,
} from '../../lib/paint-scope'
import {
  ceilingAffectedSurfaces,
  mergePaintSurfaces,
  paintSurfaceMeshes,
  plateAffectedSurfaces,
  platePreviewSurfaces,
  usePaintOutline,
} from '../../lib/plate-paint-affected'
import { getHoveredRoofSegmentOutlineProxy } from '../../lib/roof-hover-outline-proxy'
import { sameRoom } from '../../lib/room-selection'
import { selectRoom, shouldInterceptRoom } from '../../lib/room-selection-commands'
import { roomKeyForZone } from '../../lib/room-zone-routing'
import {
  emitCanvasNodeSelection,
  enterBuildingFromCanvas,
  resolveCanvasBuildingId,
  resolveCanvasSelectionNode,
  resolveSelectedIdsForNodeClick,
  type SelectionModifierKeys,
  selectionModifiersFromEvent,
  shouldPreserveSelectedRoofHostTarget,
} from '../../lib/selection-routing'
import { emitDeleteSFX, sfxEmitter } from '../../lib/sfx-bus'
import {
  cancelPendingZonePaint,
  paintZoneMembership,
  zoneAtLevelPoint,
  zoneAtWorldPoint,
} from '../../lib/units'
import useDirectManipulationFeedback from '../../store/use-direct-manipulation-feedback'
import useEditor, { type MaterialTargetRole, type Phase } from './../../store/use-editor'
import useInteractionScope, {
  getEditingHole,
  getMovingNode,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { expandSessionSelectionForNode } from '../../store/use-session-groups'
import { boxSelectHandled, suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { armGroupMove3d } from './group-move-3d'
import { classifyParticipant } from './group-transform-shared'
import { swallowNextClick } from './node-arrow-handles'
import { RoomHighlight3D } from './room-highlight'
import { setEditorThreeContext } from './three-context-bridge'

const isNodeInCurrentLevel = (node: AnyNode): boolean => {
  // Elevators are building-scoped, so they stay selectable across level filters.
  if (node.type === 'elevator') return true
  const currentLevelId = useViewer.getState().selection.levelId
  if (!currentLevelId) return true // No level selected, allow all
  const nodeLevelId = resolveLevelId(node, useScene.getState().nodes)
  return nodeLevelId === currentLevelId
}

type PaintInteraction = {
  key: string
  apply: (() => void) | null
  hoverMode: HoverHighlightMode
  hoveredId: AnyNodeId
  preview: (() => PaintPreviewCleanup | null) | null
  // What the paint HUD chip should show for this hover (scopes + labels), or
  // null when the surface isn't paintable.
  paintHover: PaintHoverInfo | null
}

interface SelectionStrategy {
  handleSelect: (
    node: AnyNode,
    nativeEvent?: any,
    modifierKeys?: SelectionModifierKeys,
    baseSelectedIds?: readonly string[],
  ) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}

const DIRECT_DRAG_THRESHOLD_PX = 4
const DIRECT_ROTATE_EPSILON = 1e-6
const DIRECT_ROTATE_RADIANS_PER_PIXEL = Math.PI / 180

function pointerEventFromNodeEvent(event: NodeEvent): PointerEvent {
  const threeEvent = event.nativeEvent as unknown as PointerEvent & {
    nativeEvent?: PointerEvent
  }
  return threeEvent.nativeEvent ?? threeEvent
}

function isCommandModifier(event: Pick<PointerEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}

function pointerDistancePx(event: PointerEvent, startX: number, startY: number): number {
  return Math.hypot(event.clientX - startX, event.clientY - startY)
}

export const resolveBuildingId = (
  levelId: string,
  nodes: Record<string, AnyNode>,
): string | null => {
  const level = nodes[levelId]
  if (!level) return null
  if (level.parentId && nodes[level.parentId]?.type === 'building') {
    return level.parentId
  }
  return null
}

/**
 * Furnishings: picking one leaves the room context (a sofa is not part of the
 * room's shell). Door and window catalog items are openings, not furnishings.
 */
function isFurnishingNode(node: AnyNode): boolean {
  if (node.type === 'item') {
    const category = (node as ItemNode).asset.category
    return category !== 'door' && category !== 'window'
  }
  return nodeRegistry.get(node.type)?.category === 'furnish'
}

function resolveStairMaterialTarget(
  event: StairEvent | StairSegmentEvent,
): StairSurfaceMaterialRole | null {
  const hitObjectName = event.nativeEvent.object?.name ?? ''
  const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)

  if (hitObjectName.startsWith('stair-railing')) {
    return 'railing'
  }

  if (hitObjectName.startsWith('stair-side')) {
    return 'side'
  }

  if (materialIndex === 0) {
    return 'tread'
  }

  if (materialIndex === 1) {
    return 'side'
  }

  const normalY = event.normal?.[1]
  if (normalY !== undefined && normalY > 0.75) {
    return 'tread'
  }

  if (normalY !== undefined && Math.abs(normalY) <= 0.75) {
    return 'side'
  }

  return null
}

function resolveRoofMaterialTarget(
  event: RoofEvent | RoofSegmentEvent,
): 'top' | 'edge' | 'wall' | null {
  const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)
  if (materialIndex === 3) return 'top'
  if (materialIndex === 0) return 'edge'
  if (materialIndex === 1 || materialIndex === 2) return 'wall'

  const normalY = event.normal?.[1]
  if (normalY !== undefined && normalY > 0.35) return 'top'
  if (normalY !== undefined && Math.abs(normalY) <= 0.35) return 'edge'
  if (normalY !== undefined && normalY < -0.35) return 'wall'

  return null
}

function isCeilingGridHit(event: NodeEvent): boolean {
  return (
    !event.viaHandle &&
    event.node.type === 'ceiling' &&
    getEventObject(event)?.name === 'ceiling-grid'
  )
}

function getEventObject(event: NodeEvent): Object3D {
  const eventWithObject = event as NodeEvent & { object?: Object3D }
  return eventWithObject.object ?? event.nativeEvent.object
}

/**
 * Registry-driven in-scene click actions (`capabilities.sceneAction`): walk
 * the pointer hit's object chain, ask the clicked kind to resolve an action
 * target from each object's userData, and run it. Returns `true` when the
 * kind consumed the click (no selection change should happen).
 */
function dispatchSceneAction(node: AnyNode, object: Object3D | null): boolean {
  const sceneAction = nodeRegistry.get(node.type)?.capabilities?.sceneAction
  if (!sceneAction) return false
  let current: Object3D | null = object
  while (current) {
    const target = sceneAction.resolveTarget(current)
    if (target !== null) {
      return sceneAction.activate(node, target, createSceneApi(useScene))
    }
    current = current.parent
  }
  return false
}

function getIntersectionMaterialIndex(
  object: Object3D,
  faceIndex: number | undefined,
): number | undefined {
  if (faceIndex === undefined) return undefined

  const geometry = (object as Mesh).geometry as BufferGeometry | undefined
  if (!geometry || geometry.groups.length === 0) return undefined

  const triangleStart = faceIndex * 3
  const group = geometry.groups.find(
    (entry) => triangleStart >= entry.start && triangleStart < entry.start + entry.count,
  )

  return group?.materialIndex
}

function getRegisteredNodeObject(nodeId: string): Object3D | null {
  return sceneRegistry.nodes.get(nodeId) ?? null
}

function getRegisteredMesh(nodeId: string): Mesh | null {
  const object = getRegisteredNodeObject(nodeId)
  return object && (object as Mesh).isMesh ? (object as Mesh) : null
}

// Every distinct slot role on a node, read off the registered mesh subtree's
// `userData.slotId` tags (a tag may be a single role or an array, one per
// material group). The mesh-derived fallback behind `nodeSlotRoles` for kinds
// whose slots come from a GLB (items) rather than a `capabilities.slots`
// declaration; returns `[]` when the subtree isn't mounted.
function meshSlotRoles(node: AnyNode): string[] {
  const root = getRegisteredNodeObject(node.id)
  if (!root) return []
  const roles = new Set<string>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const tag = (mesh.userData as { slotId?: string | null | (string | null)[] }).slotId
    if (Array.isArray(tag)) {
      for (const entry of tag) if (typeof entry === 'string') roles.add(entry)
    } else if (typeof tag === 'string') {
      roles.add(tag)
    }
  })
  return [...roles]
}

const roofSelectionWorldPoint = new Vector3()
const wallPaintWorldPoint = new Vector3()

const roomHitPoint = new Vector3()
const roomHitXZ: [number, number] = [0, 0]
function roomForEvent(event: NodeEvent) {
  if (event.node.type !== 'wall' && event.node.type !== 'slab' && event.node.type !== 'ceiling')
    return null
  // The floor edge band and the foundation belong to the footprint, not the
  // room above: the plate takes the pick and opens Floor & foundation.
  if (isFootprintConstructionHit(event.node, event.object)) return null
  const levelId = resolveLevelId(event.node, useScene.getState().nodes)
  if (!levelId) return null
  if (event.viaHandle && event.node.type === 'ceiling') {
    roomHitXZ[0] = event.position[0]
    roomHitXZ[1] = event.position[2]
    return resolveEditorRoomHit(event.node, levelId, roomHitXZ, '3d')
  }
  const level = sceneRegistry.nodes.get(levelId)
  if (!level) return null
  level.updateWorldMatrix(true, false)
  roomHitPoint.set(...event.position)
  level.worldToLocal(roomHitPoint)
  roomHitXZ[0] = roomHitPoint.x
  roomHitXZ[1] = roomHitPoint.z
  return resolveEditorRoomHit(event.node, levelId, roomHitXZ, '3d')
}

function resolveWallPaintHit(event: NodeEvent): WallPaintHit | undefined {
  const wall = event.node
  if (wall.type !== 'wall') return undefined
  const root = getRegisteredNodeObject(wall.id)
  if (!root) return undefined

  root.updateWorldMatrix(true, false)
  wallPaintWorldPoint.set(...event.position)
  const local = root.worldToLocal(wallPaintWorldPoint)
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return {
    face: local.z >= 0 ? 'front' : 'back',
    point: [
      wall.start[0] + local.x * cos - local.z * sin,
      wall.start[1] + local.x * sin + local.z * cos,
    ],
  }
}

function resolveRoofSegmentSelectionTarget(event: NodeEvent): RoofSegmentNode | null {
  const roof = event.node
  if (roof.type !== 'roof') return null

  roofSelectionWorldPoint.set(...event.position)
  const nodes = useScene.getState().nodes
  let firstSegment: RoofSegmentNode | null = null
  let bestSegment: { node: RoofSegmentNode; score: number } | null = null

  for (const childId of roof.children ?? []) {
    const segment = nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (segment?.type !== 'roof-segment') continue

    const object = getRegisteredNodeObject(segment.id)
    if (!object) continue

    if (!firstSegment) firstSegment = segment

    object.updateWorldMatrix(true, false)
    const local = object.worldToLocal(roofSelectionWorldPoint.clone())
    const overhang = segment.overhang ?? 0
    const halfWidth = segment.width / 2 + overhang
    const halfDepth = segment.depth / 2 + overhang

    if (Math.abs(local.x) > halfWidth || Math.abs(local.z) > halfDepth) {
      continue
    }

    const score = Math.abs(local.y - getRoofSegmentSurfaceY(segment, local.x, local.z))
    if (!bestSegment || score < bestSegment.score) {
      bestSegment = { node: segment, score }
    }
  }

  return bestSegment?.node ?? firstSegment
}

function resolveSelectModeNodeTarget(event: NodeEvent, drill = false): AnyNode {
  if (!drill && event.node.type === 'stair-segment' && event.node.parentId) {
    const parent = useScene.getState().nodes[event.node.parentId as AnyNodeId]
    if (parent?.type === 'stair') return parent
  }
  if (event.node.type === 'roof') {
    if (
      shouldPreserveSelectedRoofHostTarget({
        node: event.node,
        selectedIds: useViewer.getState().selection.selectedIds,
        armedRoofId: useEditor.getState().roofHostDragArmedId,
      })
    ) {
      return event.node
    }
    return resolveRoofSegmentSelectionTarget(event) ?? event.node
  }

  return event.node
}

function previewMeshMaterial(mesh: Mesh, material: Material | Material[]): PaintPreviewCleanup {
  const previousMaterial = mesh.material
  mesh.material = material
  return () => {
    mesh.material = previousMaterial
  }
}

function previewCursor(cursor: string): PaintPreviewCleanup {
  const previousCursor = document.body.style.cursor
  document.body.style.cursor = cursor
  return () => {
    document.body.style.cursor = previousCursor
  }
}

function applyRoofPaintPreview(
  node: RoofNode,
  role: 'top' | 'edge' | 'wall',
  material: ActivePaintMaterial,
): PaintPreviewCleanup | null {
  const root = getRegisteredNodeObject(node.id)
  const mesh = root?.getObjectByName('merged-roof') as Mesh | undefined
  if (!mesh) return null

  const previewNode = {
    ...node,
    ...buildRoofSurfaceMaterialPatch(node, role, material.material, material.materialPreset),
  }
  const previewMaterial = getRoofMaterialArray(
    previewNode,
    useViewer.getState().shading,
    useViewer.getState().textures,
    useViewer.getState().colorPreset,
    useViewer.getState().sceneTheme,
    null,
    useScene.getState().materials,
  )
  if (!previewMaterial) return null

  return previewMeshMaterial(mesh, previewMaterial)
}

function applyRoofSegmentPaintPreview(
  node: RoofSegmentNode,
  parent: RoofNode | null,
  role: 'top' | 'edge' | 'wall',
  material: ActivePaintMaterial,
): PaintPreviewCleanup | null {
  const mesh = getRegisteredMesh(node.id)
  if (!mesh) return null

  // Synthesise the segment node as if the paint had committed, then build
  // the same 4-slot array the renderer would. Mirrors getRoofMaterialArray
  // layout (slot 0 ← edge, 1 ← wall, 2 ← wall, 3 ← top) so the preview
  // material lands on the matching CSG groups.
  const previewNode: RoofSegmentNode = {
    ...node,
    ...buildRoofSegmentSurfaceMaterialPatch(node, role, material.material, material.materialPreset),
  }
  const sceneMaterials = useScene.getState().materials
  const resolveSlot = (r: 'top' | 'edge' | 'wall'): Material | null => {
    const parentSpec = parent ? getEffectiveRoofSurfaceMaterial(parent, r) : undefined
    const spec = getEffectiveSegmentSurfaceMaterial(previewNode, r, parentSpec)
    const resolved = resolveMaterialRef(spec.materialPreset, sceneMaterials)
    if (resolved) return resolved
    if (spec.material !== undefined) return createMaterial(spec.material)
    return null
  }
  const edge = resolveSlot('edge')
  const wall = resolveSlot('wall')
  const top = resolveSlot('top')
  if (!(edge || wall || top)) return null
  const fallback = parent
    ? getRoofMaterialArray(parent, undefined, undefined, undefined, undefined, null, sceneMaterials)
    : null
  const fb = (n: number) => fallback?.[n] ?? null
  // Per-role only, then the parent's themed slot — matches the renderer so the
  // preview never bleeds a painted surface onto the segment's other surfaces.
  const arr: Material[] = [edge ?? fb(0)!, wall ?? fb(1)!, wall ?? fb(2)!, top ?? fb(3)!]
  if (arr.some((m) => !m)) return null
  return previewMeshMaterial(mesh, arr)
}

// Chimney + dormer paint dispatch lives on their NodeDefinition's
// `capabilities.paint` (see packages/nodes/src/{chimney,dormer}/
// paint.ts). The generic registry-driven arm in this file consults
// those entries — no per-kind helpers needed here.

function setSelectedMaterialTargetForNode(node: AnyNode, role: MaterialTargetRole | null) {
  if (!role) {
    const currentTarget = useEditor.getState().selectedMaterialTarget
    if (currentTarget?.nodeId !== node.id) {
      useEditor.getState().setSelectedMaterialTarget(null)
    }
    return
  }

  useEditor.getState().setSelectedMaterialTarget({
    nodeId: node.id as AnyNodeId,
    role,
  })
}

const HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.76,
    emissiveBlend: 0.92,
    emissiveIntensity: 0.46,
  },
  selection: {
    // Keep the real material/texture readable: no albedo tint, just a gentle
    // indigo emissive glow so it reads as selected.
    color: new Color('#818cf8'),
    blend: 0,
    emissiveBlend: 0.4,
    emissiveIntensity: 0.12,
  },
} as const

type HighlightKind = keyof typeof HIGHLIGHT_PROFILES
type HoverHighlightMode = 'default' | 'delete' | 'paint-ready' | 'erase-ready' | 'paint-disabled'

type HighlightableMaterial = Material & {
  color?: Color
  emissive?: Color
  emissiveIntensity?: number
  opacity?: number
  transparent?: boolean
  needsUpdate?: boolean
}

function isHighlightableMesh(object: Object3D): object is Mesh {
  return Boolean(
    (object as Mesh).isMesh &&
      (object as Mesh).material &&
      object.visible &&
      object.name !== 'collision-mesh',
  )
}

const TEXTURE_MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
] as const

function createHighlightedMaterial(material: Material, kind: HighlightKind): Material {
  const highlightedMaterial = material.clone() as HighlightableMaterial
  // `NodeMaterial.clone()` on the WebGPU backend drops the texture-map node
  // assignments, so the clone renders flat. Re-attach the maps from the source
  // material (they're shared by reference — same texture object) so the
  // selected object keeps its texture under the highlight.
  const src = material as unknown as Record<string, unknown>
  const dst = highlightedMaterial as unknown as Record<string, unknown>
  for (const key of TEXTURE_MAP_KEYS) {
    if (src[key]) dst[key] = src[key]
  }
  const profile = HIGHLIGHT_PROFILES[kind]

  if (highlightedMaterial.color instanceof Color) {
    highlightedMaterial.color = highlightedMaterial.color.clone().lerp(profile.color, profile.blend)
  }

  if (highlightedMaterial.emissive instanceof Color) {
    highlightedMaterial.emissive = highlightedMaterial.emissive
      .clone()
      .lerp(profile.color, profile.emissiveBlend)
    highlightedMaterial.emissiveIntensity = Math.max(
      highlightedMaterial.emissiveIntensity ?? 0,
      profile.emissiveIntensity,
    )
  }

  if (typeof highlightedMaterial.opacity === 'number' && highlightedMaterial.opacity < 1) {
    highlightedMaterial.transparent = true
    highlightedMaterial.opacity = Math.min(1, highlightedMaterial.opacity + 0.08)
  }

  highlightedMaterial.needsUpdate = true
  return highlightedMaterial
}

function createHighlightedMaterials(
  material: Material | Material[],
  kind: HighlightKind,
): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => createHighlightedMaterial(entry, kind))
  }

  return createHighlightedMaterial(material, kind)
}

function disposeHighlightedMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.dispose()
    })
    return
  }

  material.dispose()
}

const computeNextIds = (
  node: AnyNode,
  selectedIds: readonly string[],
  event?: any,
  modifierKeys?: SelectionModifierKeys,
  baseSelectedIds?: readonly string[],
): string[] => {
  return resolveSelectedIdsForNodeClick({
    baseSelectedIds,
    currentSelectedIds: selectedIds,
    modifierKeys: selectionModifiersFromEvent(event, modifierKeys),
    nodeId: node.id,
    expandIdsForNode: expandSessionSelectionForNode,
  })
}

const SELECTION_STRATEGIES: Record<Phase, SelectionStrategy> = {
  site: {
    handleSelect: (node) => {
      useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ buildingId: null })
    },
    isValid: (node) => node.type === 'building',
  },

  building: {
    handleSelect: (node, nativeEvent, modifierKeys, baseSelectedIds) => {
      const { selection, setSelection } = useViewer.getState()
      const nodes = useScene.getState().nodes
      const nodeLevelId = node.type === 'elevator' ? null : resolveLevelId(node, nodes)
      const buildingId =
        node.type === 'elevator' &&
        node.parentId &&
        nodes[node.parentId as AnyNodeId]?.type === 'building'
          ? node.parentId
          : nodeLevelId
            ? resolveBuildingId(nodeLevelId, nodes)
            : null

      const updates: any = {}
      if (nodeLevelId && nodeLevelId !== 'default' && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId
      }

      if (node.type === 'zone' && !useViewer.getState().focusedUnitId) {
        const room = roomKeyForZone(node.id)
        if (room) {
          if (!sameRoom(useEditor.getState().room, room)) selectRoom(room)
          return
        }
      }
      if (node.type === 'zone') {
        updates.zoneId = node.id
        setSelection(updates)
      } else {
        updates.selectedIds = computeNextIds(
          node,
          selection.selectedIds,
          nativeEvent,
          modifierKeys,
          baseSelectedIds,
        )
        setSelection(updates)
      }
    },
    handleDeselect: () => {
      useEditor.getState().clearRoom()
      useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false
      return (
        node.type === 'wall' ||
        node.type === 'fence' ||
        node.type === 'column' ||
        node.type === 'elevator' ||
        node.type === 'slab' ||
        node.type === 'ceiling' ||
        node.type === 'roof' ||
        node.type === 'roof-segment' ||
        node.type === 'stair' ||
        node.type === 'stair-segment' ||
        node.type === 'spawn' ||
        node.type === 'window' ||
        node.type === 'door' ||
        node.type === 'item' ||
        isRegistrySelectable(node.type)
      )
    },
  },
}

export const SelectionManager = () => {
  const roomLevelId = useViewer((s) => s.selection.levelId)
  useRoomRecords(roomLevelId)
  useEffect(
    () =>
      useViewer.subscribe((state, previous) => {
        if (
          state.selection.levelId !== previous.selection.levelId ||
          (state.selection.zoneId !== previous.selection.zoneId && state.selection.zoneId) ||
          (state.selection.selectedIds !== previous.selection.selectedIds &&
            state.selection.selectedIds.some((id) => {
              const node = useScene.getState().nodes[id as AnyNodeId]
              return node && isFurnishingNode(node)
            }))
        ) {
          useEditor.getState().clearRoom()
        }
      }),
    [],
  )
  const mode = useEditor((s) => s.mode)
  // The canvas element — cursor styling must land here, not on `document.body`:
  // the editor wraps the canvas in a div with a custom `cursor: url(...)`, which
  // (being a closer ancestor) overrides any body cursor over the canvas.
  const glDomElement = useThree((s) => s.gl.domElement)
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)
  const setHoverHighlightMode = useViewer((s) => s.setHoverHighlightMode)

  // Publish the live three context for DOM-level sessions (group pick-up
  // move) that raycast the 3D view from outside the R3F tree.
  useEffect(() => {
    setEditorThreeContext({ camera, raycaster, domElement: glDomElement })
    return () => setEditorThreeContext(null)
  }, [camera, raycaster, glDomElement])
  const modifierKeysRef = useRef<SelectionModifierKeys>({
    meta: false,
    ctrl: false,
    shift: false,
    alt: false,
  })
  const clickHandledRef = useRef(false)

  const movingNode = useMovingNode()
  const isCurveReshape = useIsCurveReshape()
  // Plugin kinds register AFTER mount (async dynamic-import discovery), so
  // every effect below that snapshots `getSelectableKinds()` into an emitter
  // subscription list depends on this version — a late plugin load re-runs
  // them and picks up the new kinds (hover / click / double-click / paint /
  // pointerdown). Without it, plugin nodes select-but-never-hover in prod.
  const registryVersion = useRegistryVersion()

  useEffect(() => {
    const nextHoverMode: HoverHighlightMode = mode === 'delete' ? 'delete' : 'default'
    setHoverHighlightMode(nextHoverMode)

    return () => {
      setHoverHighlightMode('default')
    }
  }, [mode, setHoverHighlightMode])

  useEffect(() => {
    // re-subscribe when plugin kinds register after mount (async plugin load)
    void registryVersion
    if (mode !== 'material-paint') return
    if (movingNode || isCurveReshape) return

    const previewOwner = createPaintPreviewOwner()
    let activePreview: { key: string; restore: PaintPreviewCleanup } | null = null
    // The last hover event, replayed when the application scope cycles so the
    // preview + chip update under a stationary cursor (Shift fires no pointer move).
    let lastEnterEvent: NodeEvent | null = null
    // Paint hover never stops a pointer event. R3F keeps a hover that stopped
    // propagation stopping every later move over that object, which would pin
    // the pointer to a door or a wall it should pass through where it opens
    // (see `paint-pass-through`). So the nearest surface that takes a pointer
    // event claims it; farther ones see the claim and stand down.
    let claimedEvent: unknown = null
    let hoveredNodeId: string | null = null
    const claim = (event: NodeEvent) => {
      claimedEvent = event.nativeEvent.nativeEvent
    }
    const claimedByNearer = (event: NodeEvent) =>
      claimedEvent !== null && claimedEvent === event.nativeEvent.nativeEvent

    const clearActivePreview = () => {
      activePreview?.restore()
      activePreview = null
    }

    const resolveActivePaintMaterial = () =>
      useEditor.getState().activePaintMaterial ??
      resolveActivePaintMaterialFromSelection({
        nodes: useScene.getState().nodes,
        materials: useScene.getState().materials,
        selectedId:
          useViewer.getState().selection.selectedIds.length === 1
            ? (useViewer.getState().selection.selectedIds[0] ?? null)
            : null,
        selectedMaterialTarget: useEditor.getState().selectedMaterialTarget,
      })

    // The eyedropper: the hover shows what a click would take (the cursor
    // swatch), the click takes it and returns to the sub-mode it came from.
    const pickInteraction = (
      node: AnyNode,
      role: string | null,
      event: NodeEvent,
      materialIndex: number | null,
    ): PaintInteraction => {
      const picked = role
        ? eyedropperMaterial({
            node,
            role,
            nodes: useScene.getState().nodes,
            materials: useScene.getState().materials,
            hitObject: getEventObject(event),
            materialIndex,
          })
        : null
      return {
        key: `pick:${node.id}:${role ?? 'none'}:${paintMaterialKey(picked)}`,
        hoveredId: node.id as AnyNodeId,
        hoverMode: picked ? 'paint-ready' : 'paint-disabled',
        paintHover:
          picked && role
            ? { scopes: ['single'], slotLabel: paintSurfaceLabel(node, role), nodeNoun: node.type }
            : null,
        apply: picked
          ? () => useEditor.getState().armMaterialPaint(picked, paintPickReturnMode())
          : null,
        preview: () => {
          usePaintRegionMode.setState({ picked })
          return () => {
            if (usePaintRegionMode.getState().picked === picked)
              usePaintRegionMode.setState({ picked: null })
          }
        },
      }
    }

    const resolvePaintInteraction = (event: NodeEvent): PaintInteraction | null => {
      // A region sub-mode draws its own region before painting; the
      // whole-surface hover and click stand down.
      if (paintRegionModeActive('material-paint')) return null
      const eraser = isPaintErasing()
      const activePaintMaterial = resolveActivePaintMaterial()
      const node = event.node

      if (!isNodeInCurrentLevel(node)) return null

      // The eraser clears a surface back to its default by painting with an
      // empty material — every `build*SurfaceMaterialPatch` interprets
      // `undefined` material/preset as "reset this role". So a single spec
      // with both fields undefined drives the same apply/preview paths as a
      // real material; only the enabled-gate differs (no material required).
      const paintEnabled = eraser || hasActivePaintMaterial(activePaintMaterial)
      const paintSpec: ActivePaintMaterial = eraser
        ? {
            material: undefined,
            materialPreset: undefined,
            sourceTarget:
              activePaintMaterial?.sourceTarget ?? useEditor.getState().activePaintTarget,
          }
        : (activePaintMaterial ?? {
            material: undefined,
            materialPreset: undefined,
            sourceTarget: useEditor.getState().activePaintTarget,
          })

      // Registry-driven paint dispatch — kinds that declare
      // `capabilities.paint` route hover / click / preview through
      // their definition. Wall, chimney, and dormer use this; legacy
      // roof / stair / single-surface arms below stay until they
      // migrate too.
      const paintCap = nodeRegistry.get(node.type)?.capabilities?.paint
      if (paintCap) {
        const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)
        const role = paintCap.resolveRole({
          node,
          materialIndex: materialIndex ?? null,
          normal: event.normal,
          localPosition: event.localPosition as readonly [number, number, number] | undefined,
          hitObjectName: event.nativeEvent.object?.name,
          hitObject: getEventObject(event),
          ray: event.nativeEvent.ray,
        })
        // Not claiming the hover lets the pointer event reach the surface behind:
        // an empty door or window, or a wall's collision hit in one of its holes.
        if (
          paintPassesThrough(node, role) ||
          ((node.type === 'door' || node.type === 'window') &&
            openingPartHidden(
              getRegisteredNodeObject(node.id),
              event.nativeEvent.ray,
              event.nativeEvent.intersections,
            )) ||
          (node.type === 'wall' &&
            wallHitInOpening(
              getRegisteredNodeObject(node.id),
              event.nativeEvent.ray,
              event.nativeEvent.distance,
            ))
        )
          return null
        if (isPaintPicking()) return pickInteraction(node, role, event, materialIndex ?? null)
        const compatible = role !== null && paintEnabled
        // Derive the node's slots (declared, else mesh tags) once — drives both
        // the chip's available scopes and the whole-object fan-out.
        const slotRoles = compatible && role ? nodeSlotRoles(node, meshSlotRoles) : []
        // Resolve the application-scope fan-out once (this surface / whole object
        // / all matching / room). The scope is part of the key so cycling it
        // (Shift) re-keys the interaction → the preview re-applies for the new
        // spread instead of being deduped to the single-surface preview.
        const hover = compatible && role ? paintHoverInfo(node, role, slotRoles) : null
        // A scope carried over from another surface paints what the chip
        // shows for this one: the narrowest when it isn't offered here.
        const scope = effectivePaintScope(
          useEditor.getState().paintScope,
          hover?.scopes ?? ['single'],
        )
        const wallHit = resolveWallPaintHit(event)
        const scopeTargets =
          compatible && role
            ? resolvePaintScopeTargets({
                node,
                role,
                scope,
                nodes: useScene.getState().nodes,
                spaces: useEditor.getState().spaces,
                slotRolesOf: () => slotRoles,
                wallHit,
              })
            : []
        // What the click changes on floor plates, fallbacks included (a room's
        // floor carries its unpainted steps): the outline. The preview draws
        // the same set, each follower through the surface it follows.
        const scopeRole = compatible && role ? paintScopeRole(node, role, scope) : null
        const sceneNodes = useScene.getState().nodes
        const affected = scopeRole
          ? (plateAffectedSurfaces(sceneNodes, node, scopeRole, { erasing: eraser }) ??
            ceilingAffectedSurfaces(node, scopeRole))
          : null
        const previewTargets = mergePaintSurfaces(
          scopeTargets,
          scopeRole
            ? (platePreviewSurfaces(sceneNodes, node, scopeRole) ??
                ceilingAffectedSurfaces(node, scopeRole))
            : null,
        )
        const scopeTargetKey = previewTargets
          .map((target) => `${target.nodeId}:${target.role}`)
          .sort()
          .join(',')
        return {
          key: `${node.type}:${node.id}:${role ?? 'unsupported'}:${eraser ? 'erase' : 'paint'}:${scope}:${scopeTargetKey}`,
          hoveredId: node.id as AnyNodeId,
          hoverMode: compatible ? (eraser ? 'erase-ready' : 'paint-ready') : 'paint-disabled',
          paintHover: hover,
          apply:
            compatible && role
              ? () => {
                  // A surface with nothing of its own to paint (a footprint's
                  // top where no room stands) says so instead of painting.
                  const refusal = floorPlatePaintRefusal(useScene.getState().nodes, node, role)
                  usePaintRegionMode.getState().setNotice(refusal?.message ?? null)
                  if (refusal) return
                  // Spread targets are all the same slot-model kind, so one
                  // batched commit writes them in a single undo step; only
                  // the hovered surface itself keeps the kind's own commit
                  // (covers non-slot kinds too) — see `paintCommitRoute`.
                  if (paintCommitRoute(scopeTargets, node.id, role) === 'fanout') {
                    commitPaintScopeFanout(
                      scopeTargets,
                      paintSpec.material,
                      paintSpec.materialPreset,
                    )
                    return
                  }
                  const args = {
                    node,
                    role,
                    material: paintSpec.material,
                    materialPreset: paintSpec.materialPreset,
                  }
                  if (paintCap.commit) {
                    paintCap.commit(args)
                  } else {
                    useScene
                      .getState()
                      .updateNode(
                        node.id as AnyNodeId,
                        paintCap.buildPatch(args) as Partial<AnyNode>,
                      )
                  }
                }
              : null,
          preview:
            compatible && role
              ? () => {
                  // Preview every surface the click would paint, so room /
                  // whole-item / all-matching show the full spread, not just the
                  // hovered surface. Each target is the same kind, so its own
                  // paint capability builds the preview; restores combine.
                  const restores: PaintPreviewCleanup[] = []
                  const liveNodes = useScene.getState().nodes
                  if (affected) {
                    usePaintOutline.setState({ surfaces: affected })
                    restores.push(() => usePaintOutline.setState({ surfaces: null }))
                  }
                  try {
                    for (const target of previewTargets) {
                      const targetNode = liveNodes[target.nodeId]
                      const targetRoot = getRegisteredNodeObject(target.nodeId)
                      const targetCap = targetNode
                        ? nodeRegistry.get(targetNode.type)?.capabilities?.paint
                        : null
                      if (!(targetNode && targetRoot && targetCap)) continue
                      const restore = targetCap.applyPreview({
                        node: targetNode,
                        nodes: liveNodes,
                        materials: useScene.getState().materials,
                        role: target.role,
                        material: paintSpec.material,
                        materialPreset: paintSpec.materialPreset,
                        root: targetRoot,
                      })
                      if (restore) restores.push(restore)
                    }
                  } catch (error) {
                    combinePaintPreviews(restores)()
                    throw error
                  }
                  if (restores.length === 0) return null
                  return combinePaintPreviews(restores)
                }
              : () => previewCursor('not-allowed'),
        }
      }

      if (node.type === 'roof' || node.type === 'roof-segment') {
        const isSegmentHit = node.type === 'roof-segment'
        const roofNode =
          node.type === 'roof'
            ? node
            : node.parentId
              ? useScene.getState().nodes[node.parentId as AnyNodeId]
              : null
        if (roofNode?.type !== 'roof') return null

        const role = resolveRoofMaterialTarget(event as RoofEvent | RoofSegmentEvent)
        if (isPaintPicking())
          return pickInteraction(isSegmentHit ? node : roofNode, role, event, null)
        const compatible = role !== null && paintEnabled
        // Painting directly on a segment (only possible in segment edit
        // mode, where the per-segment mesh is visible) writes to the
        // segment's own role-specific fields. Painting the merged shell
        // — or a roof node directly — keeps fanning to the parent roof.
        const segmentTarget = isSegmentHit ? (node as RoofSegmentNode) : null
        return {
          key: `${segmentTarget ? 'roof-segment' : 'roof'}:${
            segmentTarget ? segmentTarget.id : roofNode.id
          }:${role ?? 'unsupported'}:${eraser ? 'erase' : 'paint'}`,
          hoveredId: (segmentTarget ? segmentTarget.id : roofNode.id) as AnyNodeId,
          hoverMode: compatible ? (eraser ? 'erase-ready' : 'paint-ready') : 'paint-disabled',
          // Roof isn't on the slot model (role-specific fields, custom commit),
          // so it offers only the single surface — but still labels it.
          paintHover:
            compatible && role
              ? {
                  scopes: ['single'],
                  slotLabel: slotDisplayLabel(roofNode, role),
                  nodeNoun: 'roof',
                }
              : null,
          apply:
            compatible && role
              ? () => {
                  const sceneState = useScene.getState()
                  if (segmentTarget) {
                    sceneState.updateNode(
                      segmentTarget.id as AnyNodeId,
                      buildRoofSegmentSurfaceMaterialPatch(
                        segmentTarget,
                        role,
                        paintSpec.material,
                        paintSpec.materialPreset,
                      ),
                    )
                  } else {
                    sceneState.updateNode(
                      roofNode.id as AnyNodeId,
                      buildRoofSurfaceMaterialPatch(
                        roofNode as RoofNode,
                        role,
                        paintSpec.material,
                        paintSpec.materialPreset,
                      ),
                    )
                  }
                }
              : null,
          preview:
            compatible && role
              ? () =>
                  segmentTarget
                    ? applyRoofSegmentPaintPreview(
                        segmentTarget,
                        roofNode as RoofNode,
                        role,
                        paintSpec,
                      )
                    : applyRoofPaintPreview(roofNode as RoofNode, role, paintSpec)
              : () => previewCursor('not-allowed'),
        }
      }

      // Only `roof` / `roof-segment` reach a legacy paint arm (above) — every
      // other paintable kind declares `capabilities.paint` and returns from the
      // registry-driven dispatch at the top of this function.

      const disabledNodeTypes = ['zone']
      if (disabledNodeTypes.includes(node.type)) {
        return {
          key: `${node.type}:${node.id}:unsupported`,
          hoveredId: node.id as AnyNodeId,
          hoverMode: 'paint-disabled',
          paintHover: null,
          apply: null,
          preview: () => previewCursor('not-allowed'),
        }
      }

      return null
    }

    const getPaintInteraction = (event: NodeEvent) =>
      previewOwner.wrap(resolvePaintInteraction(event))

    const onEnter = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      // A host-driven drag (handle resize/rotate) sets `inputDragging`.
      // useNodeEvents now emits hover events during such a drag so surface
      // move tools keep tracking the cursor — but paint preview must not fire
      // mid-drag, so gate on `inputDragging` here too.
      if (boxSelectHandled || useViewer.getState().inputDragging) return
      if (claimedByNearer(event)) return

      const interaction = getPaintInteraction(event)
      if (!interaction) return

      claim(event)
      lastEnterEvent = event
      hoveredNodeId = interaction.hoveredId

      // Drive the paint HUD off this hover: the interaction carries the scopes +
      // labels for the painted surface (`null` when it isn't paintable — no
      // slots, etc. — which makes the HUD show the "hover a surface" hint).
      useEditor.getState().setPaintHover(interaction.paintHover)

      if (activePreview?.key === interaction.key) {
        return
      }

      clearActivePreview()
      useViewer.setState({ hoveredId: interaction.hoveredId })
      setHoverHighlightMode(interaction.hoverMode)

      const restore = interaction.preview?.()
      if (restore) {
        activePreview = { key: interaction.key, restore }
      }
    }

    const onLeave = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      const interaction = getPaintInteraction(event)
      // A surface behind the hovered one (under an opening that never stops
      // the pointer) leaving says nothing about the hover.
      if (!interaction || interaction.hoveredId !== hoveredNodeId) return

      // Leaving any surface → the HUD shows the "hover a surface" hint again.
      hoveredNodeId = null
      lastEnterEvent = null
      useEditor.getState().setPaintHover(null)
      usePaintOutline.setState({ surfaces: null })

      if (activePreview?.key !== interaction.key) {
        return
      }

      clearActivePreview()
      if (useViewer.getState().hoveredId === interaction.hoveredId) {
        useViewer.setState({ hoveredId: null })
      }
      setHoverHighlightMode('default')
    }

    const onClick = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      if (boxSelectHandled) return
      if (claimedByNearer(event)) return

      const interaction = getPaintInteraction(event)
      if (!interaction) return

      claim(event)

      if (!interaction.apply) {
        return
      }

      // Picking switches sub-mode synchronously and replays the hover, replacing
      // the event claim. Consume this click before a farther hit can paint.
      if (isPaintPicking()) event.stopPropagation()
      interaction.apply()
      sfxEmitter.emit('sfx:paint-apply')
      if (activePreview?.key === interaction.key) {
        activePreview = null
      } else {
        clearActivePreview()
      }
      setHoverHighlightMode(interaction.hoverMode)
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'column',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
      'zone',
    ] as const

    // Registry-driven kinds get the same subscriptions as the hardcoded list,
    // so future built-in nodes don't need to edit allTypes per migration.
    const registryKinds = getSelectableKinds().filter(
      (k) => !(allTypes as readonly string[]).includes(k),
    )
    const subscribedKinds = [...(allTypes as readonly string[]), ...registryKinds]

    for (const type of subscribedKinds) {
      emitter.on(`${type}:enter` as any, onEnter as any)
      // Re-evaluate on move so the hover preview tracks the cursor across a
      // kind's sub-parts (door/window panel↔frame↔glass↔hardware, wall
      // interior↔exterior) — not just on the initial enter. onEnter is
      // idempotent (no-ops when the resolved part is unchanged).
      emitter.on(`${type}:move` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:click` as any, onClick as any)
    }

    // Cycling the application scope (Shift) fires no pointer event, so replay
    // the last hover to re-resolve the spread and re-apply the preview at once.
    const unsubscribePaintScope = useEditor.subscribe((state, prev) => {
      if (state.paintScope === prev.paintScope || !lastEnterEvent) return
      clearActivePreview()
      claimedEvent = null
      onEnter(lastEnterEvent)
    })
    const releasePickHold = bindPaintPickHold(window)
    // So does switching the sub-mode (the eyedropper held on Alt, a mode icon).
    const unsubscribePaintMode = usePaintRegionMode.subscribe((state, prev) => {
      if (state.mode === prev.mode || !lastEnterEvent) return
      clearActivePreview()
      claimedEvent = null
      onEnter(lastEnterEvent)
    })

    return () => {
      unsubscribePaintScope()
      unsubscribePaintMode()
      releasePickHold()
      for (const type of subscribedKinds) {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:move` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:click` as any, onClick as any)
      }
      clearActivePreview()
      useViewer.setState({ hoveredId: null })
      usePaintOutline.setState({ surfaces: null })
      setHoverHighlightMode('default')
      useEditor.getState().setPaintHover(null)
    }
  }, [isCurveReshape, mode, movingNode, setHoverHighlightMode, registryVersion])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = true
      if (event.key === 'Control') modifierKeysRef.current.ctrl = true
      if (event.key === 'Shift') modifierKeysRef.current.shift = true
      if (event.key === 'Alt') modifierKeysRef.current.alt = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = false
      if (event.key === 'Control') modifierKeysRef.current.ctrl = false
      if (event.key === 'Shift') modifierKeysRef.current.shift = false
      if (event.key === 'Alt') modifierKeysRef.current.alt = false
    }

    const clearModifiers = () => {
      modifierKeysRef.current.meta = false
      modifierKeysRef.current.ctrl = false
      modifierKeysRef.current.shift = false
      modifierKeysRef.current.alt = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearModifiers)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearModifiers)
    }
  }, [])

  useEffect(() => {
    // re-subscribe when plugin kinds register after mount (async plugin load)
    void registryVersion
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onPointerDown = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      if (!selectionEnabled(useInteractionScope.getState().scope)) return
      if (useEditor.getState().phase === 'site') return
      const pointer = pointerEventFromNodeEvent(event)
      if (pointer.button !== 0 || pointer.altKey) return
      if (
        roomPickingEnabled() &&
        shouldInterceptRoom(
          roomForEvent(event),
          selectionModifiersFromEvent(pointer),
          event.node.id,
        )
      )
        return
      const handleOwnsPointer = pointerEventHitsEditorHandle(event.nativeEvent)

      // Plain press on a transformable member of a multi-selection arms the
      // group move — dragging slides the whole selection on the ground plane
      // (the 3D sibling of the 2D floorplan group drag, replacing the removed
      // group-move gizmo cross). A plain click (no drag) still falls through
      // to the normal click handling, which collapses to the pressed node.
      if (
        !handleOwnsPointer &&
        !(pointer.shiftKey || pointer.altKey || isCommandModifier(pointer)) &&
        armGroupMove3d({
          nodeId: event.node.id as AnyNodeId,
          clientX: pointer.clientX,
          clientY: pointer.clientY,
          pointerId: pointer.pointerId,
          nativeEvent: pointer,
          camera,
          raycaster,
          domElement: glDomElement,
        })
      ) {
        return
      }

      const eventNode = useScene.getState().nodes[event.node.id as AnyNodeId] ?? event.node
      const node = resolveCanvasSelectionNode({
        node: eventNode,
        nodes: useScene.getState().nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      })
      if (!canDirectMoveNode(node)) return
      const currentSelectedIds = useViewer.getState().selection.selectedIds
      const allowPlainDrag = nodeRegistry.get(node.type)?.capabilities?.movable?.directDrag === true
      if (
        !shouldStartDirectMoveDrag({
          allowPlainDrag,
          commandModifier: isCommandModifier(pointer),
          handleOwnsPointer,
          nodeId: node.id,
          selectedIds: currentSelectedIds,
        })
      ) {
        return
      }

      const startX = pointer.clientX
      const startY = pointer.clientY
      const pointerId = pointer.pointerId
      const pointerTarget = pointer.target instanceof EventTarget ? pointer.target : null
      let engaged = false
      let engagedTargetId: AnyNodeId | null = null

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        if (engaged) {
          useViewer.getState().setInputDragging(false)
        }
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        if (engaged) return
        if (pointerDistancePx(moveEvent, startX, startY) < DIRECT_DRAG_THRESHOLD_PX) return

        engaged = true
        event.stopPropagation()
        suppressBoxSelectForPointer(event.nativeEvent)
        useViewer.getState().setInputDragging(true)
        swallowNextClick()
        createEditorApi().engageMoveDrag(node)
        engagedTargetId = (getMovingNode()?.id as AnyNodeId | undefined) ?? null
        requestAnimationFrame(() => {
          if (!getMovingNode()) return
          pointerTarget?.dispatchEvent(
            new PointerEvent('pointermove', {
              altKey: moveEvent.altKey,
              bubbles: true,
              buttons: moveEvent.buttons,
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              ctrlKey: moveEvent.ctrlKey,
              metaKey: moveEvent.metaKey,
              pointerId,
              pointerType: moveEvent.pointerType,
              shiftKey: moveEvent.shiftKey,
            }),
          )
        })
      }

      const onEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return
        cleanup()
        if (engaged) {
          requestAnimationFrame(() => {
            const editor = useEditor.getState()
            if (getMovingNode()?.id !== engagedTargetId || !editor.placementDragMode) return
            editor.setMovingNode(null)
          })
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'column',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
      'zone',
      'shelf',
      'spawn',
      'elevator',
      'building',
    ] as const
    const registryKinds = getSelectableKinds().filter(
      (kind) => !(allTypes as readonly string[]).includes(kind),
    )
    const subscribedKinds = [...(allTypes as readonly string[]), ...registryKinds]

    for (const type of subscribedKinds) {
      emitter.on(`${type}:pointerdown` as any, onPointerDown as any)
    }

    return () => {
      for (const type of subscribedKinds) {
        emitter.off(`${type}:pointerdown` as any, onPointerDown as any)
      }
    }
  }, [isCurveReshape, mode, movingNode, camera, raycaster, glDomElement, registryVersion])

  // Move cursor over the selected movable node: the visual cue that clicking it
  // picks it up (replaces the removed move-cross gizmo). Reacts only when the
  // hovered/selected node changes (not on every camera move) so it doesn't fight
  // the rotate/resize gizmos' own hover cursors. Clears only the cursor it owns.
  useEffect(() => {
    if (mode !== 'select') return
    let owns = false
    let prevKey = '\0'
    const applyCursor = () => {
      const { selection, hoveredId } = useViewer.getState()
      const selectedIds = selection.selectedIds
      const sole = selectedIds.length === 1 ? selectedIds[0] : null
      const key = `${hoveredId ?? ''}|${sole ?? ''}|${selectedIds.length}`
      if (key === prevKey) return
      prevKey = key
      let wantsMove = false
      if (hoveredId && !getMovingNode() && selectionEnabled(useInteractionScope.getState().scope)) {
        if (sole === hoveredId) {
          const node = useScene.getState().nodes[sole as AnyNodeId]
          wantsMove = !!node && canDirectMoveNode(node)
        } else if (selectedIds.length > 1 && selectedIds.includes(hoveredId)) {
          // Group member: dragging it slides the whole selection.
          const nodes = useScene.getState().nodes
          wantsMove =
            classifyParticipant(nodes[hoveredId as AnyNodeId], selection.levelId, nodes) !== null
        }
      }
      if (wantsMove) {
        glDomElement.style.cursor = 'move'
        owns = true
      } else if (owns) {
        glDomElement.style.cursor = ''
        owns = false
      }
    }
    applyCursor()
    const unsub = useViewer.subscribe(applyCursor)
    return () => {
      unsub()
      if (owns) glDomElement.style.cursor = ''
    }
  }, [mode, glDomElement])

  // While a node is actively being moved (click-to-move / Move button, or a
  // fresh preset placement), show a grabbing hand. Mode-independent: presets
  // move in build mode. Overrides the hover 'move' cursor (which bails while a
  // movingNode exists), and clears back to the canvas's custom cursor on drop.
  useEffect(() => {
    if (!movingNode) return
    glDomElement.style.cursor = 'grabbing'
    return () => {
      glDomElement.style.cursor = ''
    }
  }, [movingNode, glDomElement])

  useEffect(() => {
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2 || !isCommandModifier(event)) return
      if (!(event.target instanceof HTMLCanvasElement)) return

      // Sole selection only — same stand-down as the Cmd-drag move above.
      const selectedIds = useViewer.getState().selection.selectedIds
      const hoveredId = useViewer.getState().hoveredId as AnyNodeId | null
      if (!hoveredId || selectedIds.length !== 1 || selectedIds[0] !== hoveredId) return

      const node = useScene.getState().nodes[hoveredId]
      if (!node || !canDirectRotateNode(node)) return

      event.preventDefault()
      event.stopPropagation()

      const nodeId = node.id as AnyNodeId
      const pointerId = event.pointerId
      const startX = event.clientX
      const sceneApi = createSceneApi(useScene)
      let lastPatch: Partial<AnyNode> | null = null

      const applyDelta = (moveEvent: PointerEvent) => {
        const delta = resolveDirectRotationDragDelta(
          startX,
          moveEvent.clientX,
          DIRECT_ROTATE_RADIANS_PER_PIXEL,
          moveEvent.shiftKey,
        )
        if (Math.abs(delta) < DIRECT_ROTATE_EPSILON) {
          lastPatch = null
          useLiveNodeOverrides.getState().clear(nodeId)
          useScene.getState().markDirty(nodeId)
          return
        }
        const patch = resolveDirectRotationPatch(node, delta, sceneApi)
        if (!patch) return
        lastPatch = patch
        useLiveNodeOverrides.getState().set(nodeId, patch as Record<string, unknown>)
        useScene.getState().markDirty(nodeId)
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onCancel, true)
        window.removeEventListener('contextmenu', preventContextMenu, true)
        useLiveNodeOverrides.getState().clear(nodeId)
        useScene.getState().markDirty(nodeId)
        useDirectManipulationFeedback.getState().clearActiveRotateNodeId(nodeId)
        useScene.temporal.getState().resume()
        useViewer.getState().setInputDragging(false)
        if (document.body.style.cursor === 'ew-resize') {
          document.body.style.cursor = ''
        }
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        moveEvent.stopPropagation()
        applyDelta(moveEvent)
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        upEvent.preventDefault()
        upEvent.stopPropagation()
        swallowNextClick()
        if (lastPatch) {
          sceneApi.update(nodeId, lastPatch)
          sfxEmitter.emit('sfx:item-place')
        }
        cleanup()
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return
        cleanup()
      }

      const preventContextMenu = (contextEvent: Event) => {
        contextEvent.preventDefault()
        contextEvent.stopPropagation()
      }

      useViewer.getState().setInputDragging(true)
      useDirectManipulationFeedback.getState().setActiveRotateNodeId(nodeId)
      useScene.temporal.getState().pause()
      document.body.style.cursor = 'ew-resize'
      sfxEmitter.emit('sfx:item-pick')
      applyDelta(event)

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
      window.addEventListener('contextmenu', preventContextMenu, true)
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isCurveReshape, mode, movingNode])

  useEffect(() => {
    // re-subscribe when plugin kinds register after mount (async plugin load)
    void registryVersion
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onClick = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      // Skip if box-select just completed (drag ended over a node)
      if (boxSelectHandled) return

      // node:click is synthesized on pointer-up (use-node-events). A wall/fence
      // endpoint handle sits ON the wall body, so from a 3D angle the wall mesh
      // is raycast-hit behind it and the SAME pointer-up also emits the wall's
      // click — which would select + arm the wall move tool on top of the
      // endpoint move. While an endpoint reshape owns the pointer, ignore the
      // body click so only the reshape tool handles the release. (Scoped to
      // `endpoint`: hole-edit relies on node clicks to exit, just below.)
      const activeScope = useInteractionScope.getState().scope
      if (
        !selectionEnabled(activeScope) &&
        !(activeScope.kind === 'reshaping' && activeScope.reshape === 'hole')
      )
        return

      if (dispatchSceneAction(event.node, getEventObject(event))) {
        event.stopPropagation()
        clickHandledRef.current = true
        setTimeout(() => {
          clickHandledRef.current = false
        }, 50)
        return
      }

      const node = resolveCanvasSelectionNode({
        node: resolveSelectModeNodeTarget(event),
        nodes: useScene.getState().nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      })

      // Unit focus turns clicks inside a zone into the paint gesture:
      // membership toggles, the zone stays unselected, focus stays.
      const focusedUnitId = useViewer.getState().focusedUnitId
      if (focusedUnitId) {
        const zone =
          node.type === 'zone'
            ? node
            : zoneAtWorldPoint(event.position[0], event.position[2], event.position[1])
        if (zone) {
          event.stopPropagation()
          clickHandledRef.current = true
          setTimeout(() => {
            clickHandledRef.current = false
          }, 50)
          paintZoneMembership(focusedUnitId, zone.id)
          return
        }
      }

      // From site the house is one thing: a hit anywhere on it picks its
      // building and goes inside, where the next click picks a room or element.
      if (useEditor.getState().phase === 'site') {
        if (!enterBuildingFromCanvas(node)) return
        event.stopPropagation()
        clickHandledRef.current = true
        setTimeout(() => {
          clickHandledRef.current = false
        }, 50)
        return
      }

      if (isNodeInCurrentLevel(node) && roomPickingEnabled()) {
        const room = roomForEvent(event)
        if (
          room &&
          shouldInterceptRoom(
            room,
            selectionModifiersFromEvent(event.nativeEvent, modifierKeysRef.current),
            node.id,
          )
        ) {
          event.stopPropagation()
          clickHandledRef.current = true
          setTimeout(() => {
            clickHandledRef.current = false
          }, 50)
          selectRoom(room)
          return
        }
        useEditor.getState().setHoveredRoom(null)
      }

      const selectedIdsBeforeRouting = useViewer.getState().selection.selectedIds
      const activeStrategy = SELECTION_STRATEGIES.building
      if (activeStrategy.isValid(node)) {
        event.stopPropagation()
        clickHandledRef.current = true
        // Reset the handled flag after a short delay so the grid:click that the
        // SAME DOM click also raycasts is ignored (it fires synchronously, before
        // this 50ms macrotask). Scheduled here — right after the flag is set — so
        // EVERY branch below clears it, including the click-to-move early return
        // (which previously skipped the reset and left empty-click deselect stuck
        // until the next normal select).
        setTimeout(() => {
          clickHandledRef.current = false
        }, 50)

        // Room first: a raised or sunken room's plate and a mezzanine's plate
        // belong to their room, never selected on their own. Past the room (the
        // drill click, or Alt) a raised or sunken room continues to the
        // footprint floor it stands on, like a ground-level room; a mezzanine
        // stays on its mezzanine.
        let footprint: SlabNode | null = null
        if (roomPickingEnabled() && isRoomOwnedPlate(node)) {
          footprint = roomOwnedPlateDrillTarget(useScene.getState().nodes, node as SlabNode)
          if (!footprint) {
            const hit = roomForEvent(event)
            if (hit) selectRoom(hit)
            return
          }
        }

        let nodeToSelect: AnyNode = footprint ?? node
        nodeToSelect = resolveCanvasSelectionNode({
          node: nodeToSelect,
          nodes: useScene.getState().nodes,
          selectedIds: selectedIdsBeforeRouting,
        })
        // Clicking any node (e.g. the slab surface outside a hole) exits slab
        // hole-edit mode. The hole handles + hit mesh stopPropagation, so a
        // click reaching here means the user clicked outside the hole.
        if (getEditingHole()) {
          useInteractionScope
            .getState()
            .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'hole')
        }

        // Click-to-move: clicking the already-selected sole movable node with
        // no modifiers picks it up instead of re-selecting — the move-cross
        // gizmo's old job, now on the node body. `setMovingNode` arms the
        // registry move tool in click-to-commit mode, exactly like the floating
        // Move button. The first (selecting) click can't hit this because the
        // node isn't yet in `selectedIdsBeforeRouting`.
        const nativeEvent = event.nativeEvent
        const hasModifier =
          nativeEvent.altKey || nativeEvent.shiftKey || isCommandModifier(nativeEvent)
        const isAlreadySole =
          selectedIdsBeforeRouting.length === 1 && selectedIdsBeforeRouting[0] === nodeToSelect.id
        if (
          useEditor.getState().mode !== 'delete' &&
          !hasModifier &&
          isAlreadySole &&
          !expandSessionSelectionForNode(nodeToSelect.id) &&
          !getMovingNode() &&
          canDirectMoveNode(nodeToSelect)
        ) {
          sfxEmitter.emit('sfx:item-pick')
          const moveTarget = resolveDirectManipulationNode(nodeToSelect, useScene.getState().nodes)
          useEditor.getState().setMovingNode(moveTarget as never)
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }

        activeStrategy.handleSelect(
          nodeToSelect,
          event.nativeEvent,
          modifierKeysRef.current,
          selectedIdsBeforeRouting,
        )
        emitCanvasNodeSelection(nodeToSelect)

        let nextMaterialTargetHandled = false

        // Registry-driven paint-target resolve on click. Kinds with
        // `capabilities.paint` route through this entry — wall,
        // chimney, dormer use it today. The legacy stair / roof /
        // single-surface arms below stay until they migrate too.
        if (!footprint && nodeToSelect.type === node.type) {
          const paintCap = nodeRegistry.get(node.type)?.capabilities?.paint
          if (paintCap) {
            const materialIndex = getIntersectionMaterialIndex(
              getEventObject(event),
              event.faceIndex,
            )
            const role = paintCap.resolveRole({
              node,
              materialIndex: materialIndex ?? null,
              normal: event.normal,
              localPosition: event.localPosition as readonly [number, number, number] | undefined,
              hitObjectName: event.nativeEvent.object?.name,
              hitObject: getEventObject(event),
              ray: event.nativeEvent.ray,
            })
            if (role) {
              setSelectedMaterialTargetForNode(nodeToSelect, role as MaterialTargetRole)
              nextMaterialTargetHandled = true
            }
          }
        }

        if (
          !nextMaterialTargetHandled &&
          (node.type === 'stair' || node.type === 'stair-segment') &&
          nodeToSelect.type === 'stair'
        ) {
          setSelectedMaterialTargetForNode(
            nodeToSelect,
            resolveStairMaterialTarget(event as StairEvent | StairSegmentEvent),
          )
          nextMaterialTargetHandled = true
        }

        if (
          !nextMaterialTargetHandled &&
          (node.type === 'roof' || node.type === 'roof-segment') &&
          nodeToSelect.type === 'roof'
        ) {
          setSelectedMaterialTargetForNode(
            nodeToSelect,
            resolveRoofMaterialTarget(event as RoofEvent | RoofSegmentEvent),
          )
          nextMaterialTargetHandled = true
        }

        if (
          !nextMaterialTargetHandled &&
          (node.type === 'fence' ||
            node.type === 'slab' ||
            node.type === 'ceiling' ||
            node.type === 'shelf') &&
          nodeToSelect.type === node.type
        ) {
          setSelectedMaterialTargetForNode(nodeToSelect, 'surface')
          nextMaterialTargetHandled = true
        }

        if (!nextMaterialTargetHandled && useEditor.getState().selectedMaterialTarget) {
          useEditor.getState().setSelectedMaterialTarget(null)
        }
      }
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'column',
      'building',
      'elevator',
      'zone',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'spawn',
      'window',
      'door',
    ]
    // Registry-driven kinds get the same subscriptions as the hardcoded list,
    // so future built-in nodes don't need to edit allTypes per migration.
    const registryKinds = getSelectableKinds().filter(
      (k) => !(allTypes as readonly string[]).includes(k),
    )
    const subscribedKinds = [...(allTypes as readonly string[]), ...registryKinds]

    subscribedKinds.forEach((type) => {
      emitter.on(`${type}:click` as any, onClick as any)
    })

    const onGridClick = (event: GridEvent) => {
      if (clickHandledRef.current) return
      if (boxSelectHandled) return
      if (!selectionEnabled(useInteractionScope.getState().scope)) return
      const nativeEvent = event.nativeEvent
      if (nativeEvent?.metaKey || nativeEvent?.ctrlKey || nativeEvent?.shiftKey) return
      // Unit focus: a ground click inside a zone paints it; elsewhere it
      // leaves focus and the unit selection alone.
      const focusedUnitId = useViewer.getState().focusedUnitId
      if (focusedUnitId) {
        const zone = zoneAtLevelPoint(
          event.localPosition[0],
          event.localPosition[2],
          event.localPosition[1],
        )
        if (zone) paintZoneMembership(focusedUnitId, zone.id)
        return
      }
      SELECTION_STRATEGIES[useEditor.getState().phase].handleDeselect()
      useEditor.getState().setSelectedMaterialTarget(null)
    }
    emitter.on('grid:click', onGridClick)

    return () => {
      subscribedKinds.forEach((type) => {
        emitter.off(`${type}:click` as any, onClick as any)
      })
      emitter.off('grid:click', onGridClick)
    }
  }, [isCurveReshape, mode, movingNode, registryVersion])

  // Hover and double-click
  useEffect(() => {
    // re-subscribe when plugin kinds register after mount (async plugin load)
    void registryVersion
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onEnter = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      if (!selectionEnabled(useInteractionScope.getState().scope)) return
      // A host-driven drag (handle resize/rotate, box-select) sets
      // `inputDragging`. useNodeEvents still emits hover events during it so
      // surface move tools keep tracking — but the select-hover outline must
      // stay put, so don't repaint under the cursor mid-drag.
      if (useViewer.getState().inputDragging) return
      // An editor handle anywhere along the ray owns the pointer — it takes the
      // press (handles draw on top of walls), so it takes the hover too: no
      // stopPropagation, so the handle behind the wall still hears its enter.
      if (pointerEventHitsEditorHandle(event.nativeEvent)) {
        clearSelectHover(event)
        return
      }
      const node = resolveCanvasSelectionNode({
        node: resolveSelectModeNodeTarget(event),
        nodes: useScene.getState().nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      })
      // From site the click picks the whole building, so the hover shows it.
      if (useEditor.getState().phase === 'site') {
        const buildingId = resolveCanvasBuildingId(node, useScene.getState().nodes)
        if (!buildingId) return
        event.stopPropagation()
        useViewer.getState().setHoveredId(buildingId as AnyNodeId)
        return
      }

      if (node.type === 'building' || node.type === 'site') return
      // Rooms hover through their walls and floors; a zone's own volume never does.
      if (node.type === 'zone') return
      if (!isNodeInCurrentLevel(node)) return

      event.stopPropagation()
      if (
        roomPickingEnabled() &&
        hoverRoomFromHit(
          roomForEvent(event),
          selectionModifiersFromEvent(event.nativeEvent, modifierKeysRef.current),
          node.id,
        )
      )
        return
      useViewer.getState().setHoveredId(node.id)
    }

    const clearSelectHover = (event: NodeEvent) => {
      useEditor.getState().setHoveredRoom(null)
      if (useViewer.getState().inputDragging) return
      const nodes = useScene.getState().nodes
      const node = resolveCanvasSelectionNode({
        node: resolveSelectModeNodeTarget(event),
        nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      })
      const nodeId =
        useEditor.getState().phase === 'site' ? resolveCanvasBuildingId(node, nodes) : node.id
      if (nodeId && useViewer.getState().hoveredId === nodeId) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const onLeave = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      clearSelectHover(event)
    }

    const onDoubleClick = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      if (useInteractionScope.getState().scope.kind === 'mesh-editing') return
      const node = resolveCanvasSelectionNode({
        node: resolveSelectModeNodeTarget(event, true),
        nodes: useScene.getState().nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      })
      if (useEditor.getState().phase !== 'building' || !isNodeInCurrentLevel(node)) return

      // While a unit is focused a double-click inside a zone selects that
      // zone (focus stays); the two clicks before it cancel each other's paint.
      if (useViewer.getState().focusedUnitId) {
        const zone =
          node.type === 'zone'
            ? node
            : zoneAtWorldPoint(event.position[0], event.position[2], event.position[1])
        if (zone) {
          event.stopPropagation()
          cancelPendingZonePaint(zone.id)
          SELECTION_STRATEGIES.building.handleSelect(
            zone,
            event.nativeEvent,
            modifierKeysRef.current,
            [],
          )
          return
        }
      }

      // A single click selects the whole roof or stair; the double-click dives
      // into the segment under the cursor.
      if (node.type === 'roof-segment' || node.type === 'stair-segment') {
        event.stopPropagation()
        SELECTION_STRATEGIES.building.handleSelect(
          node,
          event.nativeEvent,
          modifierKeysRef.current,
          useViewer.getState().selection.selectedIds,
        )
      }
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'column',
      'building',
      'elevator',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'spawn',
      'window',
      'door',
      'zone',
      'site',
    ]
    const registryKinds = getSelectableKinds().filter(
      (k) => !(allTypes as readonly string[]).includes(k),
    )
    const subscribedKinds = [...(allTypes as readonly string[]), ...registryKinds]

    subscribedKinds.forEach((type) => {
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:move` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:double-click` as any, onDoubleClick as any)
    })

    return () => {
      subscribedKinds.forEach((type) => {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:move` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:double-click` as any, onDoubleClick as any)
      })
    }
  }, [isCurveReshape, mode, movingNode, registryVersion])

  // Delete mode: click-to-delete (sledgehammer tool)
  useEffect(() => {
    // re-subscribe when plugin kinds register after mount (async plugin load)
    void registryVersion
    if (mode !== 'delete') return

    const onClick = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      const node = event.node
      if (!isNodeInCurrentLevel(node)) return

      event.stopPropagation()

      // Play appropriate SFX
      emitDeleteSFX(node.type)

      useScene.getState().deleteNode(node.id as AnyNodeId)
      if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)

      // Clear hover since the node is gone
      if (useViewer.getState().hoveredId === node.id) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const onEnter = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      const node = event.node
      if (!isNodeInCurrentLevel(node)) return
      if (node.type === 'building' || node.type === 'site') return
      event.stopPropagation()
      useViewer.getState().setHoveredId(node.id)
    }

    const onLeave = (event: NodeEvent) => {
      if (isCeilingGridHit(event)) return
      const nodeId = event?.node?.id
      if (nodeId && useViewer.getState().hoveredId === nodeId) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'column',
      'elevator',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'spawn',
      'window',
      'door',
      'zone',
    ] as const

    const registryKinds = getSelectableKinds().filter(
      (k) => !(allTypes as readonly string[]).includes(k),
    )
    const subscribedKinds = [...(allTypes as readonly string[]), ...registryKinds]

    for (const type of subscribedKinds) {
      emitter.on(`${type}:click` as any, onClick as any)
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
    }

    return () => {
      for (const type of subscribedKinds) {
        emitter.off(`${type}:click` as any, onClick as any)
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
      }
      useViewer.setState({ hoveredId: null })
    }
  }, [mode, registryVersion])

  return (
    <>
      <SelectionStateSync />
      <SelectionMaterialSync />
      <EditorOutlinerSync />
      <RoomHighlight3D />
    </>
  )
}

const SelectionStateSync = () => {
  const selectedMaterialTarget = useEditor((s) => s.selectedMaterialTarget)
  const setSelectedMaterialTarget = useEditor((s) => s.setSelectedMaterialTarget)
  const roofHostDragArmedId = useEditor((s) => s.roofHostDragArmedId)
  const setRoofHostDragArmedId = useEditor((s) => s.setRoofHostDragArmedId)
  const singleSelectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )

  useEffect(() => {
    return useScene.subscribe((state) => {
      const { buildingId, levelId, zoneId, selectedIds } = useViewer.getState().selection

      if (buildingId && !state.nodes[buildingId as AnyNodeId]) {
        useViewer.getState().setSelection({ buildingId: null })
        return
      }

      if (levelId && !state.nodes[levelId as AnyNodeId]) {
        useViewer.getState().setSelection({ levelId: null })
        return
      }

      if (zoneId && !state.nodes[zoneId as AnyNodeId]) {
        useViewer.getState().setSelection({ zoneId: null })
        return
      }

      if (selectedIds.length === 0) return

      const nextSelectedIds = selectedIds.filter((id) => state.nodes[id as AnyNodeId])
      if (nextSelectedIds.length !== selectedIds.length) {
        useViewer.getState().setSelection({ selectedIds: nextSelectedIds })
      }
    })
  }, [])

  useEffect(() => {
    if (!roofHostDragArmedId) return
    if (singleSelectedId === roofHostDragArmedId) return
    setRoofHostDragArmedId(null)
  }, [roofHostDragArmedId, setRoofHostDragArmedId, singleSelectedId])

  useEffect(() => {
    if (!selectedMaterialTarget) return

    if (!singleSelectedId) {
      setSelectedMaterialTarget(null)
      return
    }

    const selectedNode = useScene.getState().nodes[singleSelectedId as AnyNodeId]
    if (
      !selectedNode ||
      (!nodeRegistry.get(selectedNode.type)?.capabilities?.paint &&
        selectedNode.type !== 'wall' &&
        selectedNode.type !== 'fence' &&
        selectedNode.type !== 'slab' &&
        selectedNode.type !== 'ceiling' &&
        selectedNode.type !== 'stair' &&
        selectedNode.type !== 'roof')
    ) {
      setSelectedMaterialTarget(null)
      return
    }

    if (selectedMaterialTarget.nodeId !== selectedNode.id) {
      setSelectedMaterialTarget(null)
    }
  }, [selectedMaterialTarget, setSelectedMaterialTarget, singleSelectedId])

  return null
}

const SelectionMaterialSync = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const hoverHighlightMode = useViewer((s) => s.hoverHighlightMode)
  const registryVersion = useRegistryVersion()
  const geometryRevision = useViewer((s) => s.geometryRevision)
  const activeHighlightKindsRef = useRef(new Map<string, HighlightKind>())
  const highlightedMaterialsRef = useRef(
    new Map<
      Mesh,
      {
        originalMaterial: Material | Material[]
        highlightedMaterial: Material | Material[]
        kind: HighlightKind
      }
    >(),
  )

  const syncSelectionMaterials = useCallback(() => {
    const activeMeshes = new Set<Mesh>()

    for (const [id, kind] of activeHighlightKindsRef.current.entries()) {
      const node = useScene.getState().nodes[id as AnyNodeId]
      if (node?.type === 'wall') {
        continue
      }

      if (node && !isSelectionHighlightEnabled(node.type)) {
        continue
      }

      const rootObject = sceneRegistry.nodes.get(id)
      if (!rootObject) {
        continue
      }

      rootObject.traverse((child) => {
        if (!isHighlightableMesh(child)) {
          return
        }

        activeMeshes.add(child)
        const existingEntry = highlightedMaterialsRef.current.get(child)
        if (existingEntry) {
          const materialWasOverwritten = child.material !== existingEntry.highlightedMaterial
          if (materialWasOverwritten || existingEntry.kind !== kind) {
            disposeHighlightedMaterials(existingEntry.highlightedMaterial)
            const originalMaterial = materialWasOverwritten
              ? child.material
              : existingEntry.originalMaterial
            const highlightedMaterial = createHighlightedMaterials(originalMaterial, kind)
            child.material = highlightedMaterial
            highlightedMaterialsRef.current.set(child, {
              originalMaterial,
              highlightedMaterial,
              kind,
            })
          }
          return
        }

        const originalMaterial = child.material
        const highlightedMaterial = createHighlightedMaterials(originalMaterial, kind)
        child.material = highlightedMaterial
        highlightedMaterialsRef.current.set(child, {
          originalMaterial,
          highlightedMaterial,
          kind,
        })
      })
    }

    for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
      if (activeMeshes.has(mesh)) {
        continue
      }

      if (mesh.material === entry.highlightedMaterial) {
        mesh.material = entry.originalMaterial
      }
      disposeHighlightedMaterials(entry.highlightedMaterial)
      highlightedMaterialsRef.current.delete(mesh)
    }
  }, [])

  useEffect(() => {
    void registryVersion
    void geometryRevision
    const nextHighlightKinds = new Map<string, HighlightKind>()

    for (const id of new Set([...selectedIds, ...previewSelectedIds])) {
      nextHighlightKinds.set(id, 'selection')
    }

    if (hoverHighlightMode === 'delete' && hoveredId) {
      nextHighlightKinds.set(hoveredId, 'delete')
    }

    activeHighlightKindsRef.current = nextHighlightKinds
    syncSelectionMaterials()
  }, [
    geometryRevision,
    registryVersion,
    hoverHighlightMode,
    hoveredId,
    previewSelectedIds,
    selectedIds,
    syncSelectionMaterials,
  ])

  useEffect(() => {
    return useScene.subscribe((state, prevState) => {
      if (state.nodes === prevState.nodes) return
      syncSelectionMaterials()
    })
  }, [syncSelectionMaterials])

  useEffect(() => {
    const restoreForCapture = () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.highlightedMaterial) {
          mesh.material = entry.originalMaterial
        }
      }
    }

    const reapplyAfterCapture = () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.originalMaterial) {
          mesh.material = entry.highlightedMaterial
        }
      }
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [])

  useEffect(() => {
    const clearHighlights = () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.highlightedMaterial) {
          mesh.material = entry.originalMaterial
        }
        disposeHighlightedMaterials(entry.highlightedMaterial)
      }

      highlightedMaterialsRef.current.clear()
    }
    const unsubscribe = registerMaterialCacheCleanup(clearHighlights)
    return () => {
      unsubscribe()
      clearHighlights()
    }
  }, [])

  return null
}

const EditorOutlinerSync = () => {
  const phase = useEditor((s) => s.phase)
  const selection = useViewer((s) => s.selection)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const geometryRevision = useViewer((s) => s.geometryRevision)
  const registryVersion = useRegistryVersion()
  const outliner = useViewer((s) => s.outliner)
  const nodes = useScene((s) => s.nodes)
  const paintOutline = usePaintOutline((s) => s.surfaces)

  useEffect(() => {
    void geometryRevision
    void registryVersion
    let idsToHighlight: string[] = []

    // 1. Site outlines the building; inside it, the selection.
    if (phase === 'site') {
      if (selection.buildingId) idsToHighlight = [selection.buildingId]
    } else {
      idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
    }

    // 2. Sync with the imperative outliner arrays (mutate in place to keep references)
    outliner.selectedObjects.length = 0
    for (const id of idsToHighlight) {
      const node = nodes[id as AnyNodeId]
      if (!(node && isSelectionHighlightEnabled(node.type))) continue
      const obj = sceneRegistry.nodes.get(id)
      if (obj?.parent) outliner.selectedObjects.push(obj)
    }

    outliner.hoveredObjects.length = 0
    if (paintOutline) {
      // Paint on a floor plate: exactly the surfaces the click changes.
      for (const mesh of paintSurfaceMeshes(paintOutline, (id) => sceneRegistry.nodes.get(id)))
        if (mesh.parent) outliner.hoveredObjects.push(mesh)
    } else if (hoveredId) {
      if (!nodes[hoveredId as AnyNodeId]) {
        useViewer.setState({ hoveredId: null })
      } else {
        const hoveredNode = nodes[hoveredId as AnyNodeId]
        if (hoveredNode && isSelectionHighlightEnabled(hoveredNode.type)) {
          const obj =
            hoveredNode.type === 'roof-segment'
              ? (getHoveredRoofSegmentOutlineProxy(hoveredId) ?? sceneRegistry.nodes.get(hoveredId))
              : sceneRegistry.nodes.get(hoveredId)
          if (obj?.parent) outliner.hoveredObjects.push(obj)
        }
      }
    }
  }, [
    geometryRevision,
    registryVersion,
    phase,
    previewSelectedIds,
    selection,
    hoveredId,
    outliner,
    nodes,
    paintOutline,
  ])

  return null
}
