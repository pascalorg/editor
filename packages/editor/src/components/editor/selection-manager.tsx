import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  createSceneApi,
  emitter,
  type GridEvent,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  getRoofSegmentSurfaceY,
  getSelectableKinds,
  type ItemNode,
  isRegistrySelectable,
  type NodeEvent,
  nodeRegistry,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentEvent,
  type RoofSegmentNode,
  resolveLevelId,
  type StairEvent,
  type StairSegmentEvent,
  type StairSurfaceMaterialRole,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

import {
  createMaterial,
  createMaterialFromPresetRef,
  getRoofMaterialArray,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { type BufferGeometry, Color, type Material, type Mesh, type Object3D, Vector3 } from 'three'
import {
  canDirectMoveNode,
  canDirectRotateNode,
  resolveDirectRotationDragDelta,
  resolveDirectRotationPatch,
} from '../../lib/direct-manipulation'
import { createEditorApi } from '../../lib/editor-api'
import {
  type ActivePaintMaterial,
  buildRoofSegmentSurfaceMaterialPatch,
  buildRoofSurfaceMaterialPatch,
  hasActivePaintMaterial,
  resolveActivePaintMaterialFromSelection,
} from '../../lib/material-paint'
import {
  availablePaintScopes,
  commitPaintScopeFanout,
  nodeSlotRoles,
  type PaintHoverInfo,
  resolvePaintScopeTargets,
  slotDisplayLabel,
} from '../../lib/paint-scope'
import { getHoveredRoofSegmentOutlineProxy } from '../../lib/roof-hover-outline-proxy'
import {
  resolveNodeSelectionTarget,
  resolveSelectedIdsForNodeClick,
  type SelectionModifierKeys,
  selectionModifiersFromEvent,
  shouldPreserveSelectedRoofHostTarget,
} from '../../lib/selection-routing'
import { emitDeleteSFX, sfxEmitter } from '../../lib/sfx-bus'
import useDirectManipulationFeedback from '../../store/use-direct-manipulation-feedback'
import useEditor, { type MaterialTargetRole } from './../../store/use-editor'
import useInteractionScope, {
  getEditingHole,
  getMovingNode,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { boxSelectHandled, suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { armGroupMove3d } from './group-move-3d'
import { classifyParticipant } from './group-transform-shared'
import { swallowNextClick } from './node-arrow-handles'
import { setEditorThreeContext } from './three-context-bridge'

const isNodeInCurrentLevel = (node: AnyNode): boolean => {
  // Elevators are building-scoped, so they stay selectable across level filters.
  if (node.type === 'elevator') return true
  const currentLevelId = useViewer.getState().selection.levelId
  if (!currentLevelId) return true // No level selected, allow all
  const nodeLevelId = resolveLevelId(node, useScene.getState().nodes)
  return nodeLevelId === currentLevelId
}

type SelectableNodeType =
  | 'wall'
  | 'fence'
  | 'item'
  | 'column'
  | 'building'
  | 'elevator'
  | 'zone'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'roof-segment'
  | 'stair'
  | 'stair-segment'
  | 'spawn'
  | 'window'
  | 'door'

type PaintPreviewCleanup = () => void

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
  types: SelectableNodeType[]
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

function getEventObject(event: NodeEvent): Object3D {
  const eventWithObject = event as NodeEvent & { object?: Object3D }
  return eventWithObject.object ?? event.nativeEvent.object
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

function resolveSelectModeNodeTarget(event: NodeEvent): AnyNode {
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
  const resolveSlot = (r: 'top' | 'edge' | 'wall'): Material | null => {
    const parentSpec = parent ? getEffectiveRoofSurfaceMaterial(parent, r) : undefined
    const spec = getEffectiveSegmentSurfaceMaterial(previewNode, r, parentSpec)
    if (typeof spec.materialPreset === 'string') {
      const resolved = createMaterialFromPresetRef(spec.materialPreset)
      if (resolved) return resolved
    }
    if (spec.material !== undefined) return createMaterial(spec.material)
    return null
  }
  const edge = resolveSlot('edge')
  const wall = resolveSlot('wall')
  const top = resolveSlot('top')
  if (!(edge || wall || top)) return null
  const fallback = parent ? getRoofMaterialArray(parent) : null
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
type HoverHighlightMode = 'default' | 'delete' | 'paint-ready' | 'paint-disabled'

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
  })
}

const SELECTION_STRATEGIES: Record<string, SelectionStrategy> = {
  site: {
    types: ['building'],
    handleSelect: (node) => {
      useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ buildingId: null })
    },
    isValid: (node) => node.type === 'building',
  },

  structure: {
    types: [
      'wall',
      'fence',
      'item',
      'column',
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
    ],
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

      if (node.type === 'zone') {
        updates.zoneId = node.id
        // Don't reset selectedIds in structure phase for zone, but if we changed level, it might reset them via hierarchy guard.
        // Wait, the hierarchy guard resets zoneId if levelId changes. That's fine since we provide zoneId.
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
      const structureLayer = useEditor.getState().structureLayer
      if (structureLayer === 'zones') {
        useViewer.getState().setSelection({ zoneId: null })
      } else {
        useViewer.getState().setSelection({ selectedIds: [] })
      }
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false
      const structureLayer = useEditor.getState().structureLayer
      if (structureLayer === 'zones') {
        if (node.type === 'zone') return true
        return false
      }
      if (
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
        node.type === 'spawn'
      )
        return true
      if (node.type === 'item') {
        return (
          (node as ItemNode).asset.category === 'door' ||
          (node as ItemNode).asset.category === 'window'
        )
      }
      if (node.type === 'window' || node.type === 'door') return true

      // Registry-driven: any kind whose NodeDefinition declares the
      // `selectable` capability is also selectable in structure phase. Phase 4
      // makes this the only path and deletes the hardcoded chain above.
      if (isRegistrySelectable(node.type)) return true

      return false
    },
  },

  furnish: {
    types: ['item'],
    handleSelect: (node, nativeEvent, modifierKeys, baseSelectedIds) => {
      const { selection, setSelection } = useViewer.getState()
      const nodes = useScene.getState().nodes
      const nodeLevelId = resolveLevelId(node, nodes)
      const buildingId = resolveBuildingId(nodeLevelId, nodes)

      const updates: any = {}
      if (nodeLevelId !== 'default' && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId
      }

      updates.selectedIds = computeNextIds(
        node,
        selection.selectedIds,
        nativeEvent,
        modifierKeys,
        baseSelectedIds,
      )
      setSelection(updates)
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ selectedIds: [] })
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false
      // Item: door/window-category items belong to structure phase, not furnish.
      if (node.type === 'item') {
        const item = node as ItemNode
        return item.asset.category !== 'door' && item.asset.category !== 'window'
      }
      // Registry-driven kinds with `category: 'furnish'` (shelf today,
      // future furniture kinds): selectable in furnish phase if their
      // definition declares the `selectable` capability. Without this
      // branch, shelf clicks routed to furnish phase via resolveNodeSelectionTarget
      // would be rejected here — single-click selection broken.
      const def = nodeRegistry.get(node.type)
      if (def && def.category === 'furnish' && def.capabilities.selectable) return true
      return false
    },
  },
}

export const SelectionManager = () => {
  const phase = useEditor((s) => s.phase)
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
  })
  const clickHandledRef = useRef(false)

  const movingNode = useMovingNode()
  const isCurveReshape = useIsCurveReshape()

  useEffect(() => {
    const nextHoverMode: HoverHighlightMode = mode === 'delete' ? 'delete' : 'default'
    setHoverHighlightMode(nextHoverMode)

    return () => {
      setHoverHighlightMode('default')
    }
  }, [mode, setHoverHighlightMode])

  useEffect(() => {
    if (mode !== 'material-paint') return
    if (movingNode || isCurveReshape) return

    let activePreview: { key: string; restore: PaintPreviewCleanup } | null = null
    // The last hover event, replayed when the application scope cycles so the
    // preview + chip update under a stationary cursor (Shift fires no pointer move).
    let lastEnterEvent: NodeEvent | null = null

    const clearActivePreview = () => {
      activePreview?.restore()
      activePreview = null
    }

    const resolveActivePaintMaterial = () =>
      useEditor.getState().activePaintMaterial ??
      resolveActivePaintMaterialFromSelection({
        nodes: useScene.getState().nodes,
        selectedId:
          useViewer.getState().selection.selectedIds.length === 1
            ? (useViewer.getState().selection.selectedIds[0] ?? null)
            : null,
        selectedMaterialTarget: useEditor.getState().selectedMaterialTarget,
      })

    const getPaintInteraction = (event: NodeEvent): PaintInteraction | null => {
      const eraser = useEditor.getState().paintEraser
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
        const compatible = role !== null && paintEnabled
        // Derive the node's slots (declared, else mesh tags) once — drives both
        // the chip's available scopes and the whole-object fan-out.
        const slotRoles = compatible && role ? nodeSlotRoles(node, meshSlotRoles) : []
        // Resolve the application-scope fan-out once (this surface / whole object
        // / all matching / room). The scope is part of the key so cycling it
        // (Shift) re-keys the interaction → the preview re-applies for the new
        // spread instead of being deduped to the single-surface preview.
        const scope = useEditor.getState().paintScope
        const scopeTargets =
          compatible && role
            ? resolvePaintScopeTargets({
                node,
                role,
                scope,
                nodes: useScene.getState().nodes,
                spaces: useEditor.getState().spaces,
                slotRolesOf: () => slotRoles,
              })
            : []
        return {
          key: `${node.type}:${node.id}:${role ?? 'unsupported'}:${eraser ? 'erase' : 'paint'}:${scope}`,
          hoveredId: node.id as AnyNodeId,
          hoverMode: compatible ? 'paint-ready' : 'paint-disabled',
          paintHover:
            compatible && role
              ? {
                  scopes: availablePaintScopes({ node, slotRoles }),
                  slotLabel: slotDisplayLabel(node, role),
                  nodeNoun: node.type,
                }
              : null,
          apply:
            compatible && role
              ? () => {
                  // Spread targets are all the same slot-model kind, so one
                  // batched commit writes them in a single undo step; the
                  // single-surface case keeps the kind's own commit (covers
                  // non-slot kinds too).
                  if (scopeTargets.length > 1) {
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
                  const sceneNodes = useScene.getState().nodes
                  for (const target of scopeTargets) {
                    const targetNode = sceneNodes[target.nodeId]
                    const targetRoot = getRegisteredNodeObject(target.nodeId)
                    const targetCap = targetNode
                      ? nodeRegistry.get(targetNode.type)?.capabilities?.paint
                      : null
                    if (!(targetNode && targetRoot && targetCap)) continue
                    const restore = targetCap.applyPreview({
                      node: targetNode,
                      role: target.role,
                      material: paintSpec.material,
                      materialPreset: paintSpec.materialPreset,
                      root: targetRoot,
                    })
                    if (restore) restores.push(restore)
                  }
                  if (restores.length === 0) return null
                  return () => {
                    for (let index = restores.length - 1; index >= 0; index -= 1)
                      restores[index]?.()
                  }
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
          hoverMode: compatible ? 'paint-ready' : 'paint-disabled',
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

    const onEnter = (event: NodeEvent) => {
      // A host-driven drag (handle resize/rotate) sets `inputDragging`.
      // useNodeEvents now emits hover events during such a drag so surface
      // move tools keep tracking the cursor — but paint preview must not fire
      // mid-drag, so gate on `inputDragging` here too.
      if (boxSelectHandled || useViewer.getState().inputDragging) return

      const interaction = getPaintInteraction(event)
      if (!interaction) return

      event.stopPropagation()
      lastEnterEvent = event

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
      const interaction = getPaintInteraction(event)
      if (!interaction) return

      // Leaving any surface → the HUD shows the "hover a surface" hint again.
      lastEnterEvent = null
      useEditor.getState().setPaintHover(null)

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
      if (boxSelectHandled) return

      const interaction = getPaintInteraction(event)
      if (!interaction) return

      event.stopPropagation()

      if (!interaction.apply) {
        return
      }

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
      onEnter(lastEnterEvent)
    })

    return () => {
      unsubscribePaintScope()
      for (const type of subscribedKinds) {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:move` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:click` as any, onClick as any)
      }
      clearActivePreview()
      useViewer.setState({ hoveredId: null })
      setHoverHighlightMode('default')
      useEditor.getState().setPaintHover(null)
    }
  }, [isCurveReshape, mode, movingNode, setHoverHighlightMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = true
      if (event.key === 'Control') modifierKeysRef.current.ctrl = true
      if (event.key === 'Shift') modifierKeysRef.current.shift = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = false
      if (event.key === 'Control') modifierKeysRef.current.ctrl = false
      if (event.key === 'Shift') modifierKeysRef.current.shift = false
    }

    const clearModifiers = () => {
      modifierKeysRef.current.meta = false
      modifierKeysRef.current.ctrl = false
      modifierKeysRef.current.shift = false
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
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onPointerDown = (event: NodeEvent) => {
      const pointer = pointerEventFromNodeEvent(event)
      if (pointer.button !== 0) return

      // Plain press on a transformable member of a multi-selection arms the
      // group move — dragging slides the whole selection on the ground plane
      // (the 3D sibling of the 2D floorplan group drag, replacing the removed
      // group-move gizmo cross). A plain click (no drag) still falls through
      // to the normal click handling, which collapses to the pressed node.
      if (
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

      if (!isCommandModifier(pointer)) return

      const node = useScene.getState().nodes[event.node.id as AnyNodeId] ?? event.node
      if (!canDirectMoveNode(node)) return
      // Sole selection only: per-node direct manipulation stands down for a
      // multi-selection (the group sessions own plain drags there, and Cmd is
      // the selection-toggle key — a wobbly Cmd+click must not yank one
      // member out of the group).
      const currentSelectedIds = useViewer.getState().selection.selectedIds
      if (currentSelectedIds.length !== 1 || currentSelectedIds[0] !== node.id) return

      const startX = pointer.clientX
      const startY = pointer.clientY
      const pointerId = pointer.pointerId
      const pointerTarget = pointer.target instanceof EventTarget ? pointer.target : null
      let engaged = false

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
        requestAnimationFrame(() => {
          if (getMovingNode()?.id !== node.id) return
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
            if (getMovingNode()?.id !== node.id || !editor.placementDragMode) return
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
  }, [isCurveReshape, mode, movingNode, camera, raycaster, glDomElement])

  // Move cursor over the selected movable node: the visual cue that clicking it
  // picks it up (replaces the removed move-cross gizmo). Reacts only when the
  // hovered/selected node changes (not on every camera move) so it doesn't fight
  // the rotate/resize gizmos' own hover cursors. Clears only the cursor it owns.
  useEffect(() => {
    if (mode !== 'select') return
    let owns = false
    let prevKey = ' '
    const applyCursor = () => {
      const { selection, hoveredId } = useViewer.getState()
      const selectedIds = selection.selectedIds
      const sole = selectedIds.length === 1 ? selectedIds[0] : null
      const key = `${hoveredId ?? ''}|${sole ?? ''}|${selectedIds.length}`
      if (key === prevKey) return
      prevKey = key
      let wantsMove = false
      if (hoveredId && !getMovingNode()) {
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
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onClick = (event: NodeEvent) => {
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
      if (activeScope.kind === 'reshaping' && activeScope.reshape === 'endpoint') return

      const node = resolveSelectModeNodeTarget(event)

      // A ceiling is selectable only through its corner handles, never via
      // the `ceiling-grid` body mesh. When the grid is revealed (ceiling
      // selected, or an item placed beneath it) a top-down click hits the
      // grid first; selecting the ceiling there both re-selects it as a
      // no-op and stops propagation, blocking the hosted item below. By
      // ignoring non-handle ceiling clicks (without stopping propagation)
      // the click falls through to the item underneath.
      if (node.type === 'ceiling' && !event.viaHandle) return

      let currentPhase = useEditor.getState().phase
      let currentStructureLayer = useEditor.getState().structureLayer
      const selectedIdsBeforeRouting = useViewer.getState().selection.selectedIds

      // Auto-switch between zones, structure, and furnish when clicking elements on the same level.
      // Also auto-switch from site phase when clicking structural/furnish elements (e.g. 2D floorplan).
      if (currentPhase === 'structure' || currentPhase === 'furnish' || currentPhase === 'site') {
        if (isNodeInCurrentLevel(node)) {
          const target = resolveNodeSelectionTarget(node)
          if (target) {
            if (target.phase !== currentPhase) {
              useEditor.getState().setPhase(target.phase)
              currentPhase = target.phase
            }

            if (
              target.phase === 'structure' &&
              target.structureLayer &&
              target.structureLayer !== currentStructureLayer
            ) {
              useEditor.getState().setStructureLayer(target.structureLayer)
              currentStructureLayer = target.structureLayer
            }
          }
        }
      }

      const activeStrategy = SELECTION_STRATEGIES[currentPhase]
      if (activeStrategy?.isValid(node)) {
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

        let nodeToSelect = node
        if (node.type === 'stair-segment' && node.parentId) {
          const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
          if (parentNode && parentNode.type === 'stair') {
            nodeToSelect = parentNode
          }
        }

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
        const hasModifier = nativeEvent.shiftKey || isCommandModifier(nativeEvent)
        const isAlreadySole =
          selectedIdsBeforeRouting.length === 1 && selectedIdsBeforeRouting[0] === nodeToSelect.id
        if (!hasModifier && isAlreadySole && !getMovingNode() && canDirectMoveNode(nodeToSelect)) {
          sfxEmitter.emit('sfx:item-pick')
          useEditor.getState().setMovingNode(nodeToSelect as never)
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }

        activeStrategy.handleSelect(
          nodeToSelect,
          event.nativeEvent,
          modifierKeysRef.current,
          selectedIdsBeforeRouting,
        )

        let nextMaterialTargetHandled = false

        // Registry-driven paint-target resolve on click. Kinds with
        // `capabilities.paint` route through this entry — wall,
        // chimney, dormer use it today. The legacy stair / roof /
        // single-surface arms below stay until they migrate too.
        if (nodeToSelect.type === node.type) {
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
      const nativeEvent = event.nativeEvent
      if (nativeEvent?.metaKey || nativeEvent?.ctrlKey || nativeEvent?.shiftKey) return
      const { phase, structureLayer } = useEditor.getState()
      const activeStrategy = SELECTION_STRATEGIES[phase]
      if (activeStrategy) activeStrategy.handleDeselect()
      useEditor.getState().setSelectedMaterialTarget(null)

      // When deselecting from zone mode, return to structure select
      if (phase === 'structure' && structureLayer === 'zones') {
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('select')
      }
    }
    emitter.on('grid:click', onGridClick)

    return () => {
      subscribedKinds.forEach((type) => {
        emitter.off(`${type}:click` as any, onClick as any)
      })
      emitter.off('grid:click', onGridClick)
    }
  }, [isCurveReshape, mode, movingNode])

  // Global double-click handler for auto-switching phases and cross-phase hover
  useEffect(() => {
    if (mode !== 'select') return
    if (movingNode || isCurveReshape) return

    const onEnter = (event: NodeEvent) => {
      // A host-driven drag (handle resize/rotate, box-select) sets
      // `inputDragging`. useNodeEvents still emits hover events during it so
      // surface move tools keep tracking — but the select-hover outline must
      // stay put, so don't repaint under the cursor mid-drag.
      if (useViewer.getState().inputDragging) return
      const node = resolveSelectModeNodeTarget(event)
      const currentPhase = useEditor.getState().phase

      // Ignore site/building if we are already inside a building
      if (node.type === 'building' || node.type === 'site') {
        if (currentPhase === 'structure' || currentPhase === 'furnish') {
          return
        }
      }

      // Ignore zones unless specifically in zones layer
      if (node.type === 'zone') {
        if (currentPhase !== 'structure' || useEditor.getState().structureLayer !== 'zones') {
          return
        }
      }

      // Check level constraint for interior nodes
      if (currentPhase === 'structure' || currentPhase === 'furnish') {
        if (!isNodeInCurrentLevel(node)) return
      }

      event.stopPropagation()
      useViewer.setState({ hoveredId: node.id })
    }

    const onLeave = (event: NodeEvent) => {
      if (useViewer.getState().inputDragging) return
      const nodeId = resolveSelectModeNodeTarget(event)?.id
      if (nodeId && useViewer.getState().hoveredId === nodeId) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const onDoubleClick = (event: NodeEvent) => {
      let node = resolveSelectModeNodeTarget(event)

      const currentPhase = useEditor.getState().phase

      const selectedIdsBeforeRouting = useViewer.getState().selection.selectedIds
      const target = resolveNodeSelectionTarget(node)
      let targetPhase: 'site' | 'structure' | 'furnish' | null = target?.phase ?? null
      let targetStructureLayer = target?.structureLayer
      let forceSelect = false

      if (node.type === 'building' || node.type === 'site') {
        if (currentPhase === 'structure' || currentPhase === 'furnish') {
          return // Ignore building/site double clicks if we are already inside a building
        }
        if (node.type === 'building') {
          targetPhase = 'structure'
          targetStructureLayer = 'elements'
        }
      } else {
        if (node.type === 'roof-segment' && currentPhase === 'structure') {
          forceSelect = true // allow double click to dive into roof-segment even if already in structure phase
        }
        if (node.type === 'stair-segment' && currentPhase === 'structure') {
          forceSelect = true // allow double click to dive into stair-segment even if already in structure phase
        }
      }

      if (node.type === 'zone') {
        return
      }

      if ((targetPhase && targetPhase !== useEditor.getState().phase) || forceSelect) {
        event.stopPropagation()

        if (targetPhase && targetPhase !== useEditor.getState().phase) {
          useEditor.getState().setPhase(targetPhase)
        }

        if (
          targetPhase === 'structure' &&
          targetStructureLayer &&
          targetStructureLayer !== useEditor.getState().structureLayer
        ) {
          useEditor.getState().setStructureLayer(targetStructureLayer)
        }

        const strategy = SELECTION_STRATEGIES[targetPhase || currentPhase]
        if (strategy) {
          strategy.handleSelect(
            node,
            event.nativeEvent,
            modifierKeysRef.current,
            selectedIdsBeforeRouting,
          )
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
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:double-click` as any, onDoubleClick as any)
    })

    return () => {
      subscribedKinds.forEach((type) => {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:double-click` as any, onDoubleClick as any)
      })
    }
  }, [isCurveReshape, mode, movingNode])

  // Delete mode: click-to-delete (sledgehammer tool)
  useEffect(() => {
    if (mode !== 'delete') return

    const onClick = (event: NodeEvent) => {
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
      const node = event.node
      if (!isNodeInCurrentLevel(node)) return
      if (node.type === 'building' || node.type === 'site') return
      event.stopPropagation()
      useViewer.setState({ hoveredId: node.id })
    }

    const onLeave = (event: NodeEvent) => {
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
  }, [mode])

  return (
    <>
      <SelectionStateSync />
      <SelectionMaterialSync />
      <EditorOutlinerSync />
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
    const nextHighlightKinds = new Map<string, HighlightKind>()

    for (const id of new Set([...selectedIds, ...previewSelectedIds])) {
      nextHighlightKinds.set(id, 'selection')
    }

    if (hoverHighlightMode === 'delete' && hoveredId) {
      nextHighlightKinds.set(hoveredId, 'delete')
    }

    activeHighlightKindsRef.current = nextHighlightKinds
    syncSelectionMaterials()
  }, [hoverHighlightMode, hoveredId, previewSelectedIds, selectedIds, syncSelectionMaterials])

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
    return () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.highlightedMaterial) {
          mesh.material = entry.originalMaterial
        }
        disposeHighlightedMaterials(entry.highlightedMaterial)
      }

      highlightedMaterialsRef.current.clear()
    }
  }, [])

  return null
}

const EditorOutlinerSync = () => {
  const phase = useEditor((s) => s.phase)
  const selection = useViewer((s) => s.selection)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)
  const nodes = useScene((s) => s.nodes)

  useEffect(() => {
    let idsToHighlight: string[] = []

    // 1. Determine what should be highlighted based on Phase
    switch (phase) {
      case 'site':
        // Only highlight the building if one is selected
        if (selection.buildingId) idsToHighlight = [selection.buildingId]
        break

      case 'structure':
        // Highlight selected items (walls/slabs)
        // We IGNORE buildingId even if it's set in the store
        idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        break

      case 'furnish':
        // Highlight selected furniture/items
        idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        break

      default:
        // Pure Viewer mode: Highlight based on the "deepest" selection
        if (selection.selectedIds.length > 0 || previewSelectedIds.length > 0) {
          idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        } else if (selection.levelId) {
          idsToHighlight = [selection.levelId]
        } else if (selection.buildingId) {
          idsToHighlight = [selection.buildingId]
        }
    }

    // 2. Sync with the imperative outliner arrays (mutate in place to keep references)
    outliner.selectedObjects.length = 0
    for (const id of idsToHighlight) {
      if (!nodes[id as AnyNodeId]) continue
      const obj = sceneRegistry.nodes.get(id)
      if (obj?.parent) outliner.selectedObjects.push(obj)
    }

    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      if (!nodes[hoveredId as AnyNodeId]) {
        useViewer.setState({ hoveredId: null })
      } else {
        const hoveredNode = nodes[hoveredId as AnyNodeId]
        const obj =
          hoveredNode?.type === 'roof-segment'
            ? (getHoveredRoofSegmentOutlineProxy(hoveredId) ?? sceneRegistry.nodes.get(hoveredId))
            : sceneRegistry.nodes.get(hoveredId)
        if (obj?.parent) outliner.hoveredObjects.push(obj)
      }
    }
  }, [phase, previewSelectedIds, selection, hoveredId, outliner, nodes])

  return null
}
