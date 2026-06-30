'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  ColumnNode,
  DEFAULT_WALL_HEIGHT,
  DoorNode,
  ElevatorNode,
  emitter,
  FenceNode,
  generateId,
  getActiveRoofHeight,
  getEffectiveNode,
  getWallCurveLength,
  getWallThickness,
  ItemNode,
  isCurvedWall,
  isRegistryMovable,
  isRegistrySelectable,
  isSplineFence,
  nodeRegistry,
  RoofSegmentNode,
  type SlabNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
  sceneRegistry,
  summarizeSystemFor,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveOverlayPolicy } from '../../lib/interaction/overlay-policy'
import { curveReshapeScope, holeEditScope } from '../../lib/interaction/scope'
import { duplicateRoofSubtree } from '../../lib/roof-duplication'
import { emitDeleteSFX, sfxEmitter } from '../../lib/sfx-bus'
import { duplicateStairSubtree } from '../../lib/stair-duplication'
import useEditor from '../../store/use-editor'
import useInteractionScope, {
  useActiveHandleDrag,
  useEndpointReshape,
  useIsCurveReshape,
} from '../../store/use-interaction-scope'
import { formatMeasurement, MeasurementPill } from './measurement-pill'
import { NodeActionMenu } from './node-action-menu'

/**
 * A kind shows the system pill when it exposes typed ports — `def.ports`
 * is exactly what makes a node participate in the supply/return graph the
 * pill summarizes. Keeps the menu off a hand-maintained kind list.
 */
const hasPorts = (type: string) => nodeRegistry.get(type)?.ports != null

/**
 * A kind shows the rotation-axis pill when its R/T keyboard rotation
 * turns around a user-cyclable axis (`keyboardActions.axisCycling`) —
 * duct / pipe fittings with full 3D orientation.
 */
const hasAxisCycling = (type: string) =>
  nodeRegistry.get(type)?.keyboardActions?.axisCycling === true

const ALLOWED_TYPES = [
  'item',
  'door',
  'window',
  'elevator',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'wall',
  'fence',
  'column',
  'slab',
  'ceiling',
  'spawn',
]
const DELETE_ONLY_TYPES: string[] = []
const HOLE_TYPES = ['slab', 'ceiling']

// Menu scales with camera zoom so it feels anchored to the object, but is
// clamped on both ends so it stays readable when zoomed way out and doesn't
// dominate the screen when zoomed in close. Reference values are picked so
// scale = 1 lands near the editor's default framing.
const MIN_MENU_SCALE = 0.5
// Cap at 1 so zooming in doesn't grow the menu past its default pixel size —
// only zoom-out shrinks it (down to MIN_MENU_SCALE).
const MAX_MENU_SCALE = 1
const REF_ORTHO_ZOOM = 20
const REF_CAMERA_DISTANCE = 12

// World-space Y distance from a node's bbox top to the floating menu anchor.
// Per-type because in-world chrome above the node (height-resize arrows,
// measurement labels) varies in vertical reach.
// `EXTRA_MENU_LIFT` is a uniform global nudge — easier to tune one
// constant than to bump every per-type entry below.
const EXTRA_MENU_LIFT = 0.35
const MENU_Y_OFFSET_DEFAULT = 0.3
const MENU_Y_OFFSETS: Record<string, number> = {
  wall: 0.5,
  door: 0.6,
  window: 0.6,
  column: 0.6,
  // Fence: still clears the height-resize arrow (sits at fence.height +
  // 0.45) plus the chevron's visual size, but kept low so the menu sits
  // close to the fence rather than floating well above it.
  fence: 0.7,
  // Elevator: clears the cab-height arrow which sits above the SHAFT
  // top (resolved through level entries), so the menu floats above it.
  elevator: 0.9,
  stair: 0.2,
  'stair-stair': 1.1,
  'stair-landing': 0.9,
  // Slab: clears the height arrow that sits at elevation + 0.22 plus the
  // chevron's own visual reach, so the menu floats just above it.
  slab: 0.7,
  // Ceiling: clears the upward height arrow that sits ~0.22 above the
  // ceiling plane, plus extra headroom so the menu doesn't crowd the
  // chevron at any zoom level.
  ceiling: 1.0,
  // Shelf: clears the height arrow that sits at shelf.height + 0.22
  // plus the chevron's visual reach.
  shelf: 0.6,
}

function getMenuYOffset(node: AnyNode | null): number {
  if (!node) return MENU_Y_OFFSET_DEFAULT + EXTRA_MENU_LIFT
  if (node.type === 'stair-segment') {
    return (MENU_Y_OFFSETS[`stair-${node.segmentType}`] ?? MENU_Y_OFFSET_DEFAULT) + EXTRA_MENU_LIFT
  }
  return (MENU_Y_OFFSETS[node.type] ?? MENU_Y_OFFSET_DEFAULT) + EXTRA_MENU_LIFT
}

function getAttributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined,
): number {
  return attribute && 'version' in attribute && typeof attribute.version === 'number'
    ? attribute.version
    : 0
}

// Pooled scratch for the per-frame anchor recompute (see useFrame below) so a
// dragged node doesn't allocate a fresh Box3 + Vector3 every frame.
const _anchorBox = new THREE.Box3()
const _anchorCenter = new THREE.Vector3()

function getObjectGeometryKey(object: THREE.Object3D): string {
  const parts: string[] = []
  object.traverse((child) => {
    const geometry = (child as Partial<THREE.Mesh>).geometry
    if (!geometry) return

    parts.push(
      [
        geometry.id,
        getAttributeVersion(geometry.getAttribute('position')),
        getAttributeVersion(geometry.getIndex()),
      ].join(':'),
    )
  })
  return parts.join('|')
}

function setNodeDerivedMenuAnchor(
  node: AnyNode,
  object: THREE.Object3D,
  target: THREE.Vector3,
): boolean {
  if (node.type !== 'roof-segment') return false

  const visualTop =
    node.wallHeight +
    getActiveRoofHeight(node) +
    Math.max(0, node.deckThickness ?? 0) +
    Math.max(0, node.shingleThickness ?? 0)

  target.set(0, visualTop, 0).applyMatrix4(object.matrixWorld)
  target.y += getMenuYOffset(node)
  return true
}

// Fence schema defaults — mirror packages/nodes/src/fence/definition.ts so the
// pill reads sensibly before an explicit height / thickness is set.
const FENCE_DEFAULT_HEIGHT = 1.8
const FENCE_DEFAULT_THICKNESS = 0.08

// Dimensions for the height-drag pill. Walls and fences both carry
// start/end/curveOffset, so getWallCurveLength covers length for either.
function getHeightPillDimensions(node: WallNode | FenceNode): {
  height: number
  length: number
  thickness: number
} {
  if (node.type === 'wall') {
    return {
      height: node.height ?? DEFAULT_WALL_HEIGHT,
      length: getWallCurveLength(node),
      thickness: getWallThickness(node),
    }
  }
  return {
    height: node.height ?? FENCE_DEFAULT_HEIGHT,
    length: getWallCurveLength(node),
    thickness: node.thickness ?? FENCE_DEFAULT_THICKNESS,
  }
}

export function FloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const updateNode = useScene((s) => s.updateNode)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const canFindNode = useEditor((s) => s.canFindNode)
  const endpointReshape = useEndpointReshape()
  const isCurveReshape = useIsCurveReshape()
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)
  const unit = useViewer((s) => s.unit)
  // Drives the height-drag dimension pill below the menu. `activeHandleDrag`
  // flips only at drag start / end, so subscribing here is cheap — the live
  // height value is written imperatively in the useFrame below.
  const activeHandleDrag = useActiveHandleDrag()
  // R/T rotation axis for kinds with full 3D orientation (duct fittings).
  const rotationAxis = useEditor((s) => s.rotationAxis)
  // The floating action menu is an action-conflicting control: hard-hidden
  // during any active interaction so it never competes with the live action.
  const scope = useInteractionScope((s) => s.scope)
  const menuStepBack = resolveOverlayPolicy(scope).conflictingControls === 'hidden'

  const groupRef = useRef<THREE.Group>(null)
  const menuScaleRef = useRef<HTMLDivElement>(null)
  const pillHeightRef = useRef<HTMLSpanElement>(null)

  // Cached world anchor. The anchor is derived from `Box3.setFromObject`,
  // which traverses the selected object's children — so a node with a
  // continuously-animating child (the spinning turbine-vent head) makes the
  // AABB wobble a few millimetres every frame, and the menu drifts even with
  // a still camera. We instead recompute the box only when the selection,
  // the object's world transform, or its geometry actually changes, and
  // reuse the cached anchor otherwise. (Also removes a per-frame
  // `setFromObject` for every selection.)
  const anchorRef = useRef(new THREE.Vector3())
  const hasAnchorRef = useRef(false)
  const lastMatrixRef = useRef(new THREE.Matrix4())
  const lastAnchorKeyRef = useRef<{
    id: string | null
    node: AnyNode | null
    geometryKey: string | null
  }>({
    id: null,
    node: null,
    geometryKey: null,
  })

  // Only show for single selection of specific types
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null

  // Subscribe just to the selected node so unrelated scene updates do not
  // re-render this menu.
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null))
  // ALLOWED_TYPES is the hardcoded set; registry-driven kinds (any
  // NodeDefinition with `capabilities.selectable`) get the floating menu
  // by default too. Phase 4 collapses these into a single registry check.
  const isValidType = node
    ? ALLOWED_TYPES.includes(node.type) || isRegistrySelectable(node.type)
    : false

  // Height-drag pill: shown just above the menu only while the selected
  // wall/fence height arrow is being dragged. Length + thickness are fixed
  // during a height drag, so they're computed here; the live height value
  // is updated imperatively in the useFrame (same pattern as the scale).
  const pillNode = node?.type === 'wall' || node?.type === 'fence' ? node : null
  const isHeightDragPill =
    pillNode !== null &&
    activeHandleDrag?.nodeId === selectedId &&
    activeHandleDrag?.label === 'height'
  const pillDims = pillNode ? getHeightPillDimensions(pillNode) : null

  // Boolean selector, only re-renders when curving availability actually flips.
  const canCurveSelectedWall = useScene((s) => {
    if (!selectedId) return false
    const selectedNode = s.nodes[selectedId as AnyNodeId]
    if (selectedNode?.type !== 'wall') return false
    return !(selectedNode.children ?? []).some((childId) => {
      const child = s.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = child.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
  })

  useFrame((state) => {
    if (!(selectedId && node && isValidType && groupRef.current)) return

    // Scale the HTML menu with camera zoom (ortho) or inverse distance
    // (perspective) so it feels anchored to the world, clamped on both ends
    // so it stays readable at extreme zoom-out and doesn't fill the screen
    // when zoomed in close.
    if (menuScaleRef.current) {
      const raw =
        state.camera instanceof THREE.OrthographicCamera
          ? state.camera.zoom / REF_ORTHO_ZOOM
          : REF_CAMERA_DISTANCE /
            Math.max(state.camera.position.distanceTo(groupRef.current.position), 0.001)
      const scale = Math.min(MAX_MENU_SCALE, Math.max(MIN_MENU_SCALE, raw))
      menuScaleRef.current.style.transform = `scale(${scale})`
    }

    // Live height readout for the drag pill. The dragged height lands in
    // `useLiveNodeOverrides` (not the scene store) each frame, so read it
    // imperatively here instead of forcing a per-frame React re-render.
    if (
      pillHeightRef.current &&
      (node?.type === 'wall' || node?.type === 'fence') &&
      activeHandleDrag?.nodeId === selectedId &&
      activeHandleDrag?.label === 'height'
    ) {
      const override = useLiveNodeOverrides.getState().overrides.get(selectedId) as
        | { height?: number }
        | undefined
      const fallbackHeight = node.type === 'wall' ? DEFAULT_WALL_HEIGHT : FENCE_DEFAULT_HEIGHT
      const liveHeight = override?.height ?? node.height ?? fallbackHeight
      pillHeightRef.current.textContent = `H ${formatMeasurement(liveHeight, unit)}`
    }

    const obj = sceneRegistry.nodes.get(selectedId)
    if (obj) {
      obj.updateWorldMatrix(true, false)

      // Recompute the anchor only when the object genuinely changes —
      // reselected, moved (its own world matrix changed), or resized
      // (a fresh store node on commit, or a live override / handle drag
      // mid-resize). A spinning child changes the head's matrix, not the
      // registered group's, so it never triggers a recompute → the menu
      // holds still.
      // Cheapest guards first: a selection swap, the object's own world
      // transform changing (true every frame during a drag), a live override,
      // or an active handle drag all force a recompute on their own — so skip
      // the geometry traversal (`getObjectGeometryKey` walks the whole subtree
      // reading attribute versions) until none of them fired and a
      // geometry-only change is the only thing left that could move the anchor.
      const overrideActive = useLiveNodeOverrides.getState().overrides.get(selectedId) != null
      const dragActive = activeHandleDrag?.nodeId === selectedId
      const selectionChanged =
        lastAnchorKeyRef.current.id !== selectedId || lastAnchorKeyRef.current.node !== node
      const matrixChanged = !lastMatrixRef.current.equals(obj.matrixWorld)

      let geometryKey = lastAnchorKeyRef.current.geometryKey
      let needsRecompute = selectionChanged || matrixChanged || overrideActive || dragActive
      // Only when nothing cheaper fired do we pay for the subtree traversal —
      // a geometry-only change is the lone remaining trigger. When a cheaper
      // guard already forced a recompute the stored key is reused; the matrix
      // (or override/drag) keeps recomputing the anchor every frame, so a
      // geometry edit mid-drag is absorbed, and the next idle frame refreshes
      // the key against the live geometry.
      if (!needsRecompute) {
        geometryKey = getObjectGeometryKey(obj)
        if (geometryKey !== lastAnchorKeyRef.current.geometryKey) needsRecompute = true
      }

      if (needsRecompute) {
        const effectiveNode = getEffectiveNode(node)
        if (!setNodeDerivedMenuAnchor(effectiveNode, obj, anchorRef.current)) {
          _anchorBox.setFromObject(obj)
          if (!_anchorBox.isEmpty()) {
            _anchorBox.getCenter(_anchorCenter)
            // Position above the object. Per-type offsets clear each kind's
            // in-world chrome (height-resize arrows, measurement labels).
            anchorRef.current.set(
              _anchorCenter.x,
              _anchorBox.max.y + getMenuYOffset(effectiveNode),
              _anchorCenter.z,
            )
            hasAnchorRef.current = true
          }
        } else {
          hasAnchorRef.current = true
        }
        lastMatrixRef.current.copy(obj.matrixWorld)
        lastAnchorKeyRef.current = { id: selectedId, node, geometryKey }
      }

      if (hasAnchorRef.current) {
        groupRef.current.position.copy(anchorRef.current)
      }
    }
  })

  const handleCurve = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      if (node.type === 'wall') {
        if (!canCurveSelectedWall) return
        useInteractionScope.getState().begin(curveReshapeScope(node.id))
      } else if (node.type === 'fence') {
        useInteractionScope.getState().begin(curveReshapeScope(node.id))
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [canCurveSelectedWall, node, setSelection],
  )
  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node as any)
      setSelection({ selectedIds: [] })
    },
    [node, setMovingNode, setSelection],
  )
  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node?.parentId) return
      sfxEmitter.emit('sfx:item-pick')

      if (node.type === 'roof') {
        try {
          duplicateRoofSubtree(node.id as AnyNodeId, { mode: 'move' })
        } catch (error) {
          console.error('Failed to duplicate roof', error)
        }
        return
      }

      useScene.temporal.getState().pause()

      let duplicateInfo = structuredClone(node) as any
      delete duplicateInfo.id
      duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }

      let duplicate: AnyNode | null = null
      try {
        if (node.type === 'door') {
          duplicate = DoorNode.parse(duplicateInfo)
        } else if (node.type === 'window') {
          duplicate = WindowNode.parse(duplicateInfo)
        } else if (node.type === 'item') {
          duplicate = ItemNode.parse(duplicateInfo)
        } else if (node.type === 'elevator') {
          duplicate = ElevatorNode.parse(duplicateInfo)
        } else if (node.type === 'column') {
          duplicate = ColumnNode.parse(duplicateInfo)
        } else if (node.type === 'wall') {
          duplicate = WallNode.parse(duplicateInfo)
        } else if (node.type === 'fence') {
          duplicate = FenceNode.parse(duplicateInfo)
          duplicate.start = [duplicate.start[0] + 1, duplicate.start[1] + 1]
          duplicate.end = [duplicate.end[0] + 1, duplicate.end[1] + 1]
        } else if (node.type === 'roof-segment') {
          duplicateInfo.id = generateId('rseg')
          duplicate = RoofSegmentNode.parse(duplicateInfo)
        } else if (node.type === 'stair') {
          duplicateInfo.children = []
          duplicateInfo.metadata = { ...duplicateInfo.metadata }
          delete duplicateInfo.metadata?.isNew
          duplicate = StairNode.parse(duplicateInfo)
        } else if (node.type === 'stair-segment') {
          duplicate = StairSegmentNode.parse(duplicateInfo)
        } else if (node.type === 'spawn') {
          duplicate = SpawnNode.parse(duplicateInfo)
        }

        // Registry-driven fallback: any kind with a NodeDefinition can be
        // duplicated through its schema's parse(). Future built-in kinds
        // get duplicate for free.
        if (!duplicate) {
          const def = nodeRegistry.get(node.type)
          if (def) {
            duplicate = def.schema.parse(duplicateInfo) as AnyNode
          }
        }
      } catch (error) {
        console.error('Failed to parse duplicate', error)
        useScene.temporal.getState().resume()
        return
      }

      if (!duplicate) {
        useScene.temporal.getState().resume()
        return
      }

      if (duplicate) {
        if (
          duplicate.type === 'door' ||
          duplicate.type === 'window' ||
          duplicate.type === 'elevator'
        ) {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'wall') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'fence') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (
          duplicate.type === 'roof-segment' ||
          duplicate.type === 'stair' ||
          duplicate.type === 'stair-segment'
        ) {
          // Add small offset to make it visible
          if ('position' in duplicate) {
            duplicate.position = [
              duplicate.position[0] + 1,
              duplicate.position[1],
              duplicate.position[2] + 1,
            ]
          }
          if (node.type === 'stair' && duplicate.type === 'stair') {
            duplicateStairSubtree(node.id as AnyNodeId, { mode: 'move' })
          } else {
            useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
          }

          // Duplicate children for stair nodes
        } else if (
          duplicate.type === 'item' ||
          duplicate.type === 'chimney' ||
          duplicate.type === 'dormer'
        ) {
          // Items, chimneys & dormers use pure drag-to-place: NO node is
          // inserted into the scene until the user clicks to commit. The
          // `setMovingNode` call below hands the clone (with
          // `metadata.isNew = true` + no id) to its move tool —
          // `MoveItemTool` / `MoveChimneyTool` / `MoveDormerTool` — which
          // create a draft and call `createNode` on the commit click.
          // Pre-creating here would drop a second copy into the scene
          // before any click — the furnish-tab "duplicate auto-places an
          // item without clicking" bug. (Item has its own
          // draft-committing move tool, so it must skip the generic
          // registry auto-create branch below.)
        } else if (
          duplicate.type === 'duct-segment' ||
          duplicate.type === 'duct-fitting' ||
          duplicate.type === 'pipe-segment' ||
          duplicate.type === 'lineset' ||
          duplicate.type === 'liquid-line'
        ) {
          // Duct runs & fittings, DWV pipe runs, and refrigerant linesets use
          // pure drag-to-place: NO node is inserted into the scene until the
          // commit click. `setMovingNode` below hands the clone (with
          // `metadata.isNew`) to its ghost tool (`MoveDuctSegmentTool` /
          // `MoveDuctFittingTool` / `MovePipeSegmentTool` / `MoveLinesetTool`),
          // which previews a translucent copy inside a footprint bounding box
          // on the cursor and calls `createNode` on the drop click.
          // Pre-creating here would drop a copy before any click — the
          // "auto-places it" bug.
        } else if (nodeRegistry.has(duplicate.type)) {
          // Registry-driven kinds: offset slightly so the duplicate doesn't
          // overlap exactly, then create + hand to the move tool. Mirrors the
          // roof-segment / stair-segment behavior.
          if ('position' in duplicate && Array.isArray((duplicate as any).position)) {
            const pos = (duplicate as { position: [number, number, number] }).position
            ;(duplicate as { position: [number, number, number] }).position = [
              pos[0] + 1,
              pos[1],
              pos[2] + 1,
            ]
          } else if ('path' in duplicate && Array.isArray((duplicate as any).path)) {
            // Other polyline kinds (pipe / lineset) carry a `path`, not a
            // `position`. Create the copy HIDDEN so nothing is auto-placed:
            // their shared path mover reveals it as a cursor-following
            // preview on the first mouse move and commits on the next click.
            ;(duplicate as { visible?: boolean }).visible = false
          }
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        }
        if (
          duplicate.type === 'item' ||
          duplicate.type === 'elevator' ||
          duplicate.type === 'column' ||
          duplicate.type === 'wall' ||
          duplicate.type === 'fence' ||
          duplicate.type === 'window' ||
          duplicate.type === 'door' ||
          duplicate.type === 'roof-segment' ||
          duplicate.type === 'spawn' ||
          duplicate.type === 'stair-segment' ||
          // Registry-driven kinds get picked up by MoveTool's generic
          // fallback (MoveRegistryNodeTool) so the user can reposition.
          nodeRegistry.has(duplicate.type)
        ) {
          setMovingNode(duplicate as any)
        } else if (duplicate.type === 'stair') {
          setSelection({ selectedIds: [duplicate.id as AnyNodeId] })
        }
        if (duplicate.type !== 'stair') {
          setSelection({ selectedIds: [] })
        }
      }
    },
    [node, setMovingNode, setSelection],
  )

  const handleAddHole = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!(node && selectedId && (node.type === 'slab' || node.type === 'ceiling'))) return

      const polygon = (node as SlabNode | CeilingNode).polygon
      let cx = 0
      let cz = 0
      for (const [x, z] of polygon) {
        cx += x
        cz += z
      }
      cx /= polygon.length
      cz /= polygon.length

      const holeSize = 0.5
      const newHole: Array<[number, number]> = [
        [cx - holeSize, cz - holeSize],
        [cx + holeSize, cz - holeSize],
        [cx + holeSize, cz + holeSize],
        [cx - holeSize, cz + holeSize],
      ]
      const surfaceNode = node as SlabNode | CeilingNode
      const currentHoles = surfaceNode.holes || []
      const currentMetadata = currentHoles.map(
        (_, index) => surfaceNode.holeMetadata?.[index] ?? { source: 'manual' as const },
      )
      updateNode(selectedId as AnyNodeId, {
        holes: [...currentHoles, newHole],
        holeMetadata: [...currentMetadata, { source: 'manual' }],
      })
      useInteractionScope
        .getState()
        .begin(holeEditScope({ nodeId: selectedId, holeIndex: currentHoles.length }))
      // Re-assert selection so the node stays selected
      setSelection({ selectedIds: [selectedId] })
    },
    [node, selectedId, updateNode, setSelection],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!selectedId) return
      emitDeleteSFX(node?.type)
      setSelection({ selectedIds: [] })
      useScene.getState().deleteNode(selectedId as AnyNodeId)
    },
    [node?.type, selectedId, setSelection],
  )

  // "Find in catalog": the editor only signals intent — the host (community)
  // listens for `selection:find-node` and reveals the node in its browser.
  const handleFind = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (node) emitter.emit('selection:find-node' as never, node as never)
    },
    [node],
  )

  if (
    !(selectedId && node && isValidType && !isFloorplanHovered && mode !== 'delete') ||
    endpointReshape ||
    isCurveReshape ||
    menuStepBack
  )
    return null

  return (
    <group>
      <group ref={groupRef}>
        <Html
          center
          style={{
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
          zIndexRange={[25, 0]}
        >
          <div className="relative" ref={menuScaleRef} style={{ transformOrigin: 'center center' }}>
            <NodeActionMenu
              onFind={node && canFindNode ? handleFind : undefined}
              onAddHole={node && HOLE_TYPES.includes(node.type) ? handleAddHole : undefined}
              onCurve={
                (node?.type === 'fence' && !isSplineFence(node) && !isCurvedWall(node)) ||
                (node?.type === 'wall' && canCurveSelectedWall)
                  ? handleCurve
                  : undefined
              }
              onMove={
                // Fully registry-driven: any kind that declares
                // `capabilities.movable`, a `floorplanMoveTarget`, or a
                // 3D `affordanceTools.move` mover gets the Move button.
                // Adding a new movable kind never touches this file.
                node && isRegistryMovable(node.type) ? handleMove : undefined
              }
              onDelete={handleDelete}
              onDuplicate={
                node &&
                node.type !== 'spawn' &&
                !DELETE_ONLY_TYPES.includes(node.type) &&
                !HOLE_TYPES.includes(node.type)
                  ? handleDuplicate
                  : undefined
              }
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            />
            {/* Height-drag dimension pill. Absolutely positioned just above
                the menu (away from the height arrow below it) so it rides the
                same scale transform + anchor, never overlaps the menu, and
                needs no menu lift — which is what caused the click flicker.
                Non-interactive. */}
            {isHeightDragPill && pillDims ? (
              <div className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-2">
                <MeasurementPill
                  height={pillDims.height}
                  length={pillDims.length}
                  primary="height"
                  ref={pillHeightRef}
                  thickness={pillDims.thickness}
                  unit={unit}
                />
              </div>
            ) : null}
            {/* HVAC chrome above the menu — same slot as the wall height
                pill. System pill (which tree, run length, equipment reach)
                for every distribution kind; the rotation-axis pill stacks
                under it for duct fittings. */}
            {node && hasPorts(node.type) ? (
              <div className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-2 flex flex-col items-center gap-1">
                <SystemSummaryPill nodeId={node.id} unit={unit} />
                {hasAxisCycling(node.type) ? (
                  <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
                    <span className="font-medium text-foreground">
                      Axis {rotationAxis.toUpperCase()}
                    </span>
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-muted-foreground">R/T rotate</span>
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-muted-foreground">⌥ axis</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </Html>
      </group>
    </group>
  )
}

/**
 * System summary pill for a selected distribution kind (HVAC duct / DWV
 * pipe / refrigerant lineset): which supply/return tree it belongs to, its
 * run length, and whether it actually reaches a piece of equipment.
 *
 * Mounted only while an HVAC node is selected, so the full-`nodes`
 * subscription it needs (connectivity changes when ANY joint moves) doesn't
 * re-render the always-mounted parent menu on every unrelated scene tick.
 */
function SystemSummaryPill({ nodeId, unit }: { nodeId: AnyNodeId; unit: 'metric' | 'imperial' }) {
  const allNodes = useScene((s) => s.nodes)
  const summary = useMemo(() => summarizeSystemFor(nodeId, allNodes), [nodeId, allNodes])
  if (!summary) return null
  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
      <span className="font-medium text-foreground">
        {summary.systems.length > 0
          ? summary.systems.map((sys) => sys[0]!.toUpperCase() + sys.slice(1)).join(' + ')
          : 'System'}
      </span>
      {summary.runCount > 0 ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">
            {formatMeasurement(summary.runLengthM, unit)} · {summary.runCount}{' '}
            {summary.runCount === 1 ? 'run' : 'runs'}
          </span>
        </>
      ) : null}
      {summary.terminalCount > 0 ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">
            {summary.terminalCount} {summary.terminalCount === 1 ? 'register' : 'registers'}
          </span>
        </>
      ) : null}
      {summary.connectedToEquipment ? null : (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="font-medium text-amber-500">⚠ no equipment</span>
        </>
      )}
    </div>
  )
}
