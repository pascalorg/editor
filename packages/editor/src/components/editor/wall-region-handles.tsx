'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
} from '@pascal-app/core'
import { getWallFaceBaseAt, getWallFinishData, useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  type Mesh,
  type Object3D,
  OrthographicCamera,
  Ray,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { WallRegionBounds } from '../../lib/paint-regions'
import { updateWallRegion } from '../../lib/paint-regions'
import { sfxEmitter } from '../../lib/sfx-bus'
import { resolveWallFaceBase } from '../../lib/wall-region-face'
import {
  buildOutlineRibbon,
  faceSurfacePoint,
  getWallFaceSurface,
  intersectFaceSurface,
  type RegionEdge,
  type RegionHandlePlacement,
  regionHandlePlacements,
  regionOutline,
  resolveRegionBoundDrag,
  resolveRegionBounds,
  type WallFaceSurface,
  wallLocalMatrix,
  withRegionBounds,
} from '../../lib/wall-region-handles'
import { wallRegionSnapTargets } from '../../lib/wall-region-snap'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import {
  handleWallRegionDeleteKey,
  installWallRegionSceneSync,
  syncWallRegionSelection,
  useWallRegionSelection,
} from '../../store/use-wall-region-handles-selection'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  HandleArrow,
  InvisibleHandleHitArea,
  NO_RAYCAST,
  useInvisibleHitAreaMaterial,
} from './handles/handle-arrow'
import { type HandleDragControls, useHandleDrag } from './handles/use-handle-drag'

// Resize handles for the paint regions of the one selected wall: a thin
// outline per region and an arrow on each bounded edge, shown only while the
// region is active, hovered or being resized so they do not crowd the wall's
// own arrows. Dragging an edge previews through a live override and commits
// one `updateWallRegion`.
// Clicking an outline or handle makes that region active, and Delete then
// removes the region instead of the wall.

export const PAINT_REGION_HANDLE = 'paint-region-bound'

const OUTLINE_HALF_WIDTH = 0.006
const OUTLINE_ACTIVE_HALF_WIDTH = 0.011
const OUTLINE_HIT_HALF_WIDTH = 0.04
const NOOP_DRAG_CONTROLS: HandleDragControls = { onStart: () => {}, onEnd: () => {} }
// The arrows sit on the outline: the delay lets the pointer cross from one to the other.
const ARROW_HIDE_DELAY_MS = 200

const outlineMaterials = new Map<boolean, MeshBasicNodeMaterial>()
function outlineMaterial(active: boolean) {
  let material = outlineMaterials.get(active)
  if (!material) {
    material = new MeshBasicNodeMaterial({
      color: new Color(active ? ARROW_HOVER_COLOR : ARROW_COLOR),
      side: DoubleSide,
      transparent: true,
      opacity: active ? 1 : 0.8,
      depthTest: false,
      depthWrite: false,
    })
    outlineMaterials.set(active, material)
  }
  return material
}

function isOwnScope(
  scope: ReturnType<typeof useInteractionScope.getState>['scope'],
  wallId: string | undefined,
) {
  return (
    scope.kind === 'handle-drag' && scope.handle === PAINT_REGION_HANDLE && scope.nodeId === wallId
  )
}

export function WallRegionHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const scope = useInteractionScope((state) => state.scope)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const wall = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'wall' && node.faceRegions?.length ? node : null
  })

  useEffect(() => syncWallRegionSelection(selectedIds), [selectedIds])

  // Capture phase, so an active region takes Delete before the global
  // use-keyboard arm deletes the wall.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleWallRegionDeleteKey(event)
    }
    window.addEventListener('keydown', onKeyDown, true)
    const uninstallSceneSync = installWallRegionSceneSync()
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      uninstallSceneSync()
    }
  }, [])

  const ownScope = isOwnScope(scope, wall?.id)
  const shouldRender =
    Boolean(wall) &&
    mode === 'select' &&
    (ownScope || (scope.kind === 'idle' && !isFloorplanHovered))

  if (!(shouldRender && wall)) return null
  return <WallRegionHandlesForWall wall={wall} />
}

function useLevelObject(parentId: string | null | undefined) {
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    parentId ? (sceneRegistry.nodes.get(parentId) ?? null) : null,
  )
  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const next = parentId ? (sceneRegistry.nodes.get(parentId) ?? null) : null
      setLevelObject(next)
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [parentId])
  return levelObject
}

type WallFrame = {
  wall: WallNode
  baseElevation: number
  wallHeight: number
  angle: number
  levelObject: Object3D
}

function faceBaseSampler(wallId: string, face: WallFace) {
  const mesh = sceneRegistry.nodes.get(wallId as AnyNodeId) as Mesh | undefined
  const data = getWallFinishData(mesh?.geometry)
  return (u: number) => getWallFaceBaseAt(data, face, u)
}

function regionFaceHeight(
  region: WallFaceRegion,
  length: number,
  wallHeight: number,
  baseAt: (u: number) => number,
) {
  const midU = ((region.u0 ?? 0) + (region.u1 ?? length)) / 2
  return Math.max(0, wallHeight - baseAt(midU))
}

function WallRegionHandlesForWall({ wall }: { wall: WallNode }) {
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(wall.id))
  const effectiveWall = useMemo(
    () => (liveOverride ? ({ ...wall, ...liveOverride } as WallNode) : wall),
    [wall, liveOverride],
  )
  const nodes = useScene((state) => state.nodes)
  const levelObject = useLevelObject(wall.parentId)
  if (!levelObject) return null

  const frame: WallFrame = {
    wall: effectiveWall,
    baseElevation: getWallBaseElevationForNodes(effectiveWall, nodes),
    wallHeight: getWallEffectiveHeightForNodes(effectiveWall, nodes),
    angle: Math.atan2(
      effectiveWall.end[1] - effectiveWall.start[1],
      effectiveWall.end[0] - effectiveWall.start[0],
    ),
    levelObject,
  }

  return createPortal(
    <group
      position={[effectiveWall.start[0], frame.baseElevation, effectiveWall.start[1]]}
      rotation={[0, -frame.angle, 0]}
    >
      <FaceRegionHandles face="a" frame={frame} />
      <FaceRegionHandles face="b" frame={frame} />
    </group>,
    levelObject,
  )
}

function FaceRegionHandles({ face, frame }: { face: WallFace; frame: WallFrame }) {
  const { wall } = frame
  const groupRef = useRef<Group>(null)
  const cameraPosition = useRef(new Vector3())
  const [facing, setFacing] = useState(true)
  const { camera } = useThree()
  // Only the frame-defining fields: region edits must not rebuild the surface.
  const { start, end, curveOffset, thickness, justification } = wall
  const surface = useMemo(
    () => getWallFaceSurface({ start, end, curveOffset, thickness, justification }, face),
    [start, end, curveOffset, thickness, justification, face],
  )
  const regions = (wall.faceRegions ?? []).filter((region) => region.face === face)

  // A face turned away from the camera hides its handles: they draw on top of
  // everything, so they would read as belonging to the near face.
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    if (isOwnScope(useInteractionScope.getState().scope, wall.id)) return
    const local = group.worldToLocal(camera.getWorldPosition(cameraPosition.current))
    const point = faceSurfacePoint(surface, surface.length / 2)
    const next = (local.x - point.x) * point.nx + (local.z - point.z) * point.nz > 0
    if (next !== facing) setFacing(next)
  })

  if (regions.length === 0) return null
  const baseAt = faceBaseSampler(wall.id, face)
  return (
    <group ref={groupRef}>
      {facing &&
        regions.map((region) => (
          <RegionEditor
            baseAt={baseAt}
            frame={frame}
            key={region.id}
            region={region}
            surface={surface}
          />
        ))}
    </group>
  )
}

function useRibbonGeometry(positions: Float32Array) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(positions, 3))
    next.computeBoundingSphere()
    return next
  }, [positions])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function RegionEditor({
  region,
  surface,
  frame,
  baseAt,
}: {
  region: WallFaceRegion
  surface: WallFaceSurface
  frame: WallFrame
  baseAt: (u: number) => number
}) {
  const { wall } = frame
  const [outlineHovered, setOutlineHovered] = useState(false)
  const [hoveredArrow, setHoveredArrow] = useState<RegionEdge | null>(null)
  const [draggingEdge, setDraggingEdge] = useState<RegionEdge | null>(null)
  const [arrowsLinger, setArrowsLinger] = useState(false)
  const isActive = useWallRegionSelection(
    (state) => state.active?.wallId === wall.id && state.active.regionId === region.id,
  )
  const faceHeight = regionFaceHeight(region, surface.length, frame.wallHeight, baseAt)
  const boundsKey = [region.u0, region.u1, region.v0, region.v1, faceHeight, surface.length].join(
    ':',
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: boundsKey captures every input
  const outline = useMemo(
    () => regionOutline(surface, region, faceHeight, baseAt),
    [boundsKey, surface],
  )
  const placements = regionHandlePlacements(surface, region, faceHeight, baseAt, draggingEdge)
  const hovered =
    outlineHovered ||
    (hoveredArrow !== null && placements.some((placement) => placement.edge === hoveredArrow))
  const showArrows = isActive || hovered || arrowsLinger || draggingEdge !== null
  const halfWidth = isActive || hovered ? OUTLINE_ACTIVE_HALF_WIDTH : OUTLINE_HALF_WIDTH
  const ribbon = useRibbonGeometry(
    useMemo(() => buildOutlineRibbon(outline, halfWidth), [outline, halfWidth]),
  )
  const hitRibbon = useRibbonGeometry(
    useMemo(() => buildOutlineRibbon(outline, OUTLINE_HIT_HALF_WIDTH), [outline]),
  )
  const hitMaterial = useInvisibleHitAreaMaterial()
  const select = () =>
    useWallRegionSelection.getState().setActive({ wallId: wall.id, regionId: region.id })
  const activateTap = useHandleDrag({ kind: 'tap', onTap: select })
  const onArrowHoverChange = (edge: RegionEdge, next: boolean) =>
    setHoveredArrow((current) => (next ? edge : current === edge ? null : current))

  useEffect(() => {
    if (hovered) {
      setArrowsLinger(true)
      return
    }
    const timer = window.setTimeout(() => setArrowsLinger(false), ARROW_HIDE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [hovered])

  useEffect(
    () => () => {
      if (document.body.style.cursor === 'pointer') document.body.style.cursor = ''
    },
    [],
  )

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={ribbon}
        material={outlineMaterial(isActive || hovered)}
        raycast={NO_RAYCAST}
        renderOrder={1001}
      />
      <InvisibleHandleHitArea
        geometry={hitRibbon}
        material={hitMaterial}
        onPointerDown={activateTap}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setOutlineHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setOutlineHovered(false)
          if (document.body.style.cursor === 'pointer') document.body.style.cursor = ''
        }}
        scale={1}
      />
      {showArrows &&
        placements.map((placement) => (
          <RegionEdgeHandle
            frame={frame}
            key={placement.edge}
            onDraggingChange={setDraggingEdge}
            onHoverChange={onArrowHoverChange}
            onSelect={select}
            placement={placement}
            regionId={region.id}
          />
        ))}
    </>
  )
}

function RegionEdgeHandle({
  frame,
  regionId,
  placement,
  onSelect,
  onDraggingChange,
  onHoverChange,
}: {
  frame: WallFrame
  regionId: string
  placement: RegionHandlePlacement
  onSelect: () => void
  onDraggingChange: (edge: RegionEdge | null) => void
  onHoverChange: (edge: RegionEdge, hovered: boolean) => void
}) {
  const { wall, levelObject } = frame
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const edge: RegionEdge = placement.edge
  const cursor = edge[0] === 'u' ? 'ew-resize' : 'ns-resize'

  const activate = useHandleDrag({
    kind: 'drag',
    cursor,
    dragControls: NOOP_DRAG_CONTROLS,
    handleIndex: 0,
    node: wall,
    rideObject: levelObject,
    setIsDragging: (next) => {
      setDragging(next)
      onDraggingChange(next ? edge : null)
    },
    onStart: ({ event, getPointerRay, initialNode, nodeId, rideObject }) => {
      if (initialNode.type !== 'wall') return null
      const regions = initialNode.faceRegions ?? []
      const region = regions.find((entry) => entry.id === regionId)
      if (!region) return null
      onSelect()
      const nodes = useScene.getState().nodes
      const face = region.face
      const faceSurface = getWallFaceSurface(initialNode, face)
      const baseAt = faceBaseSampler(initialNode.id, face)
      const wallHeight = getWallEffectiveHeightForNodes(initialNode, nodes)
      const faceHeight = regionFaceHeight(region, faceSurface.length, wallHeight, baseAt)
      const bounds = resolveRegionBounds(region, faceSurface.length, faceHeight)
      const midU = (bounds.u0 + bounds.u1) / 2
      const mesh = sceneRegistry.nodes.get(initialNode.id) as Mesh | undefined
      const runs = resolveWallFaceBase(initialNode, mesh?.geometry, nodes)?.[face] ?? null
      const faceTargets = wallRegionSnapTargets(initialNode, face, nodes, runs, {
        excludeRegionId: regionId,
      })
      const snapTargets = edge[0] === 'u' ? faceTargets.u : faceTargets.v

      rideObject.updateWorldMatrix(true, false)
      const toWallLocal = rideObject.matrixWorld
        .clone()
        .multiply(wallLocalMatrix(initialNode, getWallBaseElevationForNodes(initialNode, nodes)))
        .invert()
      const ray = new Ray()
      const pointerValue = (worldRay: Ray) => {
        ray.copy(worldRay).applyMatrix4(toWallLocal)
        const hit = intersectFaceSurface(faceSurface, ray.origin, ray.direction)
        if (!hit) return null
        return edge[0] === 'u' ? hit.u : hit.y - baseAt(midU)
      }
      const initialValue = bounds[edge]
      const initialPointer =
        pointerValue(getPointerRay(event.nativeEvent.clientX, event.nativeEvent.clientY, ray)) ??
        initialValue
      let lastBounds: WallRegionBounds | null = null

      return {
        onBegin: () => {
          useInteractionScope
            .getState()
            .begin({ kind: 'handle-drag', nodeId, handle: PAINT_REGION_HANDLE })
        },
        onEnd: () => {
          useInteractionScope.getState().endIf((scope) => isOwnScope(scope, nodeId))
        },
        move: ({ event: moveEvent, getPointerRay: getMoveRay }) => {
          const value = pointerValue(getMoveRay(moveEvent.clientX, moveEvent.clientY, new Ray()))
          if (value === null) return null
          const next = resolveRegionBoundDrag({
            region,
            edge,
            raw: initialValue + (value - initialPointer),
            length: faceSurface.length,
            faceHeight,
            gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : null,
            edgeSnap: isMagneticSnapActive(),
            snapTargets,
          })
          if (lastBounds && lastBounds[edge] !== next[edge]) sfxEmitter.emit('sfx:resize')
          lastBounds = next
          return { faceRegions: withRegionBounds(regions, regionId, next) } as Partial<AnyNode>
        },
        commit: () => {
          if (lastBounds) updateWallRegion(nodeId, regionId, lastBounds)
        },
      }
    },
  })

  return (
    <group rotation={[0, placement.yaw, 0]} position={placement.position}>
      <HandleArrow
        activeCursor={cursor}
        cursor={cursor}
        hover={hovered || dragging}
        indicatorRotation={[Math.PI / 2, placement.tipAngle, 0]}
        onHoverChange={(next) => {
          setHovered(next)
          onHoverChange(edge, next)
        }}
        onPointerDown={activate}
        placement={{ position: [0, 0, 0], baseScale: zoom * ARROW_SCALE }}
        shape="chevron"
        thin
      />
    </group>
  )
}
