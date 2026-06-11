import type { AssetInput, ItemNode } from '@pascal-app/core'
import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  type CeilingEvent,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  getScaledDimensions,
  type ItemEvent,
  movingFootprintAnchors,
  type RoofEvent,
  resolveLevelId,
  type ShelfEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
  useSpatialQuery,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { useAlignmentGuides } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  Euler,
  type Group,
  type LineSegments,
  Matrix4,
  type Mesh,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Ray,
  Vector3,
} from 'three'
import { distance, smoothstep, uv, vec2 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveAlignmentForActiveBuilding } from '../../../lib/world-grid-snap'
import useEditor from '../../../store/use-editor'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import {
  createLineGeometry,
  getBoxEdgePoints,
  type PreviewBounds,
  updateLineGeometry,
} from '../shared/placement-box-geometry'
import { getGridAlignedDimensions, snapToGrid, snapUpToGridStep } from './placement-math'
import {
  ceilingStrategy,
  checkCanPlace,
  floorStrategy,
  itemSurfaceStrategy,
  roofWallStrategy,
  shelfSurfaceStrategy,
  wallStrategy,
} from './placement-strategies'
import type { PlacementState, TransitionResult } from './placement-types'
import type { DraftNodeHandle } from './use-draft-node'

const DEFAULT_DIMENSIONS: [number, number, number] = [1, 1, 1]

/** Figma-style alignment-snap threshold (meters), matching the 2D
 *  floor-plan overlay and the 3D registry move tool. */
const ALIGNMENT_THRESHOLD_M = 0.08

/**
 * Expand `bounds` outward so each axis is rounded up to the active grid step.
 * The wireframe stays centered on the original bounds centre on each axis we
 * expand, so an off-centre mesh bbox stays off-centre. Wall-side items keep
 * `max.z = 0` (flush with the wall plane); the bottom (`min.y`) is preserved
 * so the box still sits on the floor / attachment plane.
 *
 * Floor / ceiling / item-surface: X and Z expand; Y stays exact.
 * Wall / wall-side: X and Y expand; Z stays exact.
 */
function expandBoundsToGrid(
  bounds: PreviewBounds,
  attachTo: AssetInput['attachTo'] | null | undefined,
  step: number,
): PreviewBounds {
  const [w, h, d] = bounds.dimensions
  const [cx, , cz] = bounds.center
  const onWall = attachTo === 'wall' || attachTo === 'wall-side'
  const expandedW = snapUpToGridStep(w, step)
  const expandedH = onWall ? snapUpToGridStep(h, step) : h
  const expandedD = onWall ? d : snapUpToGridStep(d, step)

  const minX = cx - expandedW / 2
  const maxX = cx + expandedW / 2
  const minY = bounds.min[1]
  const maxY = minY + expandedH

  let minZ: number
  let maxZ: number
  let newCz: number
  if (attachTo === 'wall-side') {
    maxZ = 0
    minZ = -expandedD
    newCz = -expandedD / 2
  } else {
    minZ = cz - expandedD / 2
    maxZ = cz + expandedD / 2
    newCz = cz
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    dimensions: [expandedW, expandedH, expandedD],
    center: [cx, (minY + maxY) / 2, newCz],
  }
}

function getFallbackPreviewBounds(
  item: import('@pascal-app/core').ItemNode | null,
  asset: AssetInput | null | undefined,
  attachTo: AssetInput['attachTo'] | null | undefined,
): PreviewBounds {
  const dims = item ? getScaledDimensions(item) : (asset?.dimensions ?? DEFAULT_DIMENSIONS)
  return {
    min: [-dims[0] / 2, 0, attachTo === 'wall-side' ? -dims[2] : -dims[2] / 2],
    max: [dims[0] / 2, dims[1], attachTo === 'wall-side' ? 0 : dims[2] / 2],
    dimensions: dims,
    center: [0, dims[1] / 2, attachTo === 'wall-side' ? -dims[2] / 2 : 0],
  }
}

function getGridAlignedPreviewNode(item: ItemNode): ItemNode {
  const scaled = getScaledDimensions(item)
  const aligned = getGridAlignedDimensions(scaled, item.asset.attachTo)
  if (scaled[0] === aligned[0] && scaled[1] === aligned[1] && scaled[2] === aligned[2]) {
    return item
  }

  const scaleAxis = (axis: 0 | 1 | 2) =>
    scaled[axis] === 0 ? item.scale[axis] : item.scale[axis] * (aligned[axis] / scaled[axis])

  return {
    ...item,
    scale: [scaleAxis(0), scaleAxis(1), scaleAxis(2)] as [number, number, number],
  }
}

// Shared materials for placement cursor - we just change colors, not swap materials
// Note: EdgesGeometry doesn't work with dashed lines, so using solid lines
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44, // red-500 (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const measurementMaterial = new LineBasicNodeMaterial({
  color: 0x0f_17_2a,
  linewidth: 2,
  depthTest: false,
  depthWrite: false,
})

const basePlaneMaterial = new MeshBasicNodeMaterial({
  color: 0xef_44_44, // red-500 (invalid)
  transparent: true,
  depthTest: false,
  depthWrite: false,
})

// Create radial opacity: transparent in center, opaque at edges
const center = vec2(0.5, 0.5)
const dist = distance(uv(), center)
const radialOpacity = smoothstep(0, 0.7, dist).mul(0.6)
basePlaneMaterial.opacityNode = radialOpacity

export interface PlacementCoordinatorConfig {
  asset: AssetInput | null
  draftNode: DraftNodeHandle
  initDraft: (gridPosition: Vector3) => void
  onCommitted: () => boolean
  onCancel?: () => void
  initialState?: PlacementState
  /** Scale to use when lazily creating a draft (e.g. for wall/ceiling duplicates). Defaults to [1,1,1]. */
  defaultScale?: [number, number, number]
  /** Move-mode sessions for floor items keep the grabbed item offset from the first floor-plane hit. */
  preserveFloorDragOffset?: boolean
}

export function usePlacementCoordinator(config: PlacementCoordinatorConfig): React.ReactNode {
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)
  const measurementWidthRef = useRef<LineSegments>(null!)
  const measurementDepthRef = useRef<LineSegments>(null!)
  const measurementHeightRef = useRef<LineSegments>(null!)
  const basePlaneRef = useRef<Mesh>(null!)
  const gridPosition = useRef(new Vector3(0, 0, 0))
  const lastRawPos = useRef(new Vector3(0, 0, 0))
  const lastWallDirtyAtRef = useRef(new Map<string, number>())
  const placementState = useRef<PlacementState>(
    config.initialState ?? {
      surface: 'floor',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    },
  )
  const shiftFreeRef = useRef(false)
  const previewBoundsSignatureRef = useRef<string | null>(null)
  // Goes true the first time a 3D pointer event drives this coordinator.
  // The per-frame mesh-position lerp below is only useful for that path;
  // when the move is being driven externally (2D `FloorplanRegistryMoveOverlay`
  // writing scene.position directly), the lerp fights React's render and
  // pulls the rendered item back toward its pre-move position. Gating
  // the lerp on this flag keeps 3D placement smooth without hijacking
  // 2D drags that share the same draft.
  const has3DPointerDrivenMoveRef = useRef(false)
  // The draft mesh's raycast is disabled while placing so the cursor ray
  // passes through it to the surface beneath (grid / item / shelf). Without
  // this, the ray hits the moving draft first and the surface strategy keeps
  // re-deriving the host point from the draft's own (just-moved) geometry —
  // on a multi-row shelf this oscillates the chosen row, jittering the item.
  // Mirrors MoveRegistryNodeTool. Reconciled per-frame (the draft mesh can be
  // recreated mid-session) and restored on unmount.
  const raycastDisabledMeshRef = useRef<Object3D | null>(null)
  const restoreRaycastsRef = useRef<Array<() => void>>([])
  const raycastDisabledChildrenRef = useRef(new WeakSet<Object3D>())
  const [dimensionBounds, setDimensionBounds] = useState<PreviewBounds | null>(null)

  // Live camera ref — the shelf-stickiness test reconstructs the cursor world
  // ray (camera → grid hit) to check it still points at the shelf volume.
  const camera = useThree((s) => s.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  // Store config callbacks in refs to avoid re-running effect when they change
  const configRef = useRef(config)
  configRef.current = config

  const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
  const { asset, draftNode } = config
  const unit = useViewer((state) => state.unit)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const updatePreviewGeometry = useCallback((bounds: PreviewBounds) => {
    const [width, height, depth] = bounds.dimensions
    const [centerX, centerY, centerZ] = bounds.center
    const signature = `${width.toFixed(4)}:${height.toFixed(4)}:${depth.toFixed(4)}:${centerX.toFixed(4)}:${centerY.toFixed(4)}:${centerZ.toFixed(4)}`

    if (previewBoundsSignatureRef.current === signature) return
    previewBoundsSignatureRef.current = signature

    const nextBasePlaneGeometry = new PlaneGeometry(width, depth)
    nextBasePlaneGeometry.rotateX(-Math.PI / 2)
    nextBasePlaneGeometry.translate(centerX, 0.01, centerZ)

    updateLineGeometry(edgesRef, getBoxEdgePoints(bounds))

    const oldBasePlaneGeometry = basePlaneRef.current.geometry
    basePlaneRef.current.geometry = nextBasePlaneGeometry
    oldBasePlaneGeometry.dispose()
  }, [])

  const updateDimensionGuides = useCallback((bounds: PreviewBounds) => {
    setDimensionBounds((current) => {
      if (
        current &&
        current.dimensions[0] === bounds.dimensions[0] &&
        current.dimensions[1] === bounds.dimensions[1] &&
        current.dimensions[2] === bounds.dimensions[2] &&
        current.center[0] === bounds.center[0] &&
        current.center[1] === bounds.center[1] &&
        current.center[2] === bounds.center[2]
      ) {
        return current
      }
      return bounds
    })

    const [width, , depth] = bounds.dimensions
    const [centerX, , centerZ] = bounds.center
    const minX = centerX - width / 2
    const maxX = centerX + width / 2
    const minZ = centerZ - depth / 2
    const maxZ = centerZ + depth / 2
    const guideOffset = 0.18
    const tick = 0.08
    const y = 0.02

    const widthPoints = [
      minX,
      y,
      maxZ + guideOffset,
      maxX,
      y,
      maxZ + guideOffset,

      minX,
      y,
      maxZ + guideOffset - tick,
      minX,
      y,
      maxZ + guideOffset + tick,

      maxX,
      y,
      maxZ + guideOffset - tick,
      maxX,
      y,
      maxZ + guideOffset + tick,
    ]

    const depthPoints = [
      maxX + guideOffset,
      y,
      minZ,
      maxX + guideOffset,
      y,
      maxZ,

      maxX + guideOffset - tick,
      y,
      minZ,
      maxX + guideOffset + tick,
      y,
      minZ,

      maxX + guideOffset - tick,
      y,
      maxZ,
      maxX + guideOffset + tick,
      y,
      maxZ,
    ]

    const heightPoints = [
      minX - guideOffset,
      0,
      minZ,
      minX - guideOffset,
      bounds.dimensions[1],
      minZ,

      minX - guideOffset - tick,
      0,
      minZ,
      minX - guideOffset + tick,
      0,
      minZ,

      minX - guideOffset - tick,
      bounds.dimensions[1],
      minZ,
      minX - guideOffset + tick,
      bounds.dimensions[1],
      minZ,
    ]

    const applyPoints = (ref: React.RefObject<LineSegments>, points: number[]) => {
      updateLineGeometry(ref, points)
    }

    applyPoints(measurementWidthRef, widthPoints)
    applyPoints(measurementDepthRef, depthPoints)
    applyPoints(measurementHeightRef, heightPoints)
  }, [])

  const getFloorVisualPosition = useCallback(
    (
      position: [number, number, number],
      nodeUpdate?: Partial<ItemNode>,
    ): [number, number, number] => {
      const draft = draftNode.current
      if (!(draft && !asset?.attachTo)) return position
      const previewNode = getGridAlignedPreviewNode({ ...draft, ...nodeUpdate } as ItemNode)
      return getFloorStackPreviewPosition({
        node: previewNode,
        position,
        rotation: previewNode.rotation,
      })
    },
    [asset?.attachTo, draftNode],
  )

  useEffect(() => {
    if (!asset) return
    useScene.temporal.getState().pause()

    const validators = { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling }

    // Lazily-gathered alignment candidates — the corner anchors of every
    // OTHER floor-placed node, excluding the draft. Computed on the first
    // floor move (once the draft id exists) and reused for the rest of the
    // drag; the scene graph is stable during placement. Coords are
    // building-local, matching the draft's grid position and the guide
    // layer's frame.
    let alignmentCandidates: AlignmentAnchor[] | null = null
    let floorDragAnchor: [number, number] | null = null

    // Reset placement state
    placementState.current = configRef.current.initialState ?? {
      surface: 'floor',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    }
    if (!asset.attachTo && placementState.current.surface === 'floor') {
      gridPosition.current.y = 0
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.y = 0
      }
    }

    // ---- Helpers ----

    const getContext = () => ({
      asset,
      levelId: useViewer.getState().selection.levelId,
      draftItem: draftNode.current,
      gridPosition: gridPosition.current,
      state: { ...placementState.current },
      currentCursorRotationY:
        cursorGroupRef.current?.rotation.y ?? draftNode.current?.rotation[1] ?? 0,
    })

    const getActiveValidators = () =>
      shiftFreeRef.current
        ? {
            canPlaceOnFloor: () => ({ valid: true }),
            canPlaceOnWall: () => ({ valid: true }),
            canPlaceOnCeiling: () => ({ valid: true }),
          }
        : validators

    const revalidate = (): boolean => {
      const placeable = shiftFreeRef.current || checkCanPlace(getContext(), validators)
      const color = placeable ? 0x22_c5_5e : 0xef_44_44 // green-500 : red-500
      edgeMaterial.color.setHex(color)
      basePlaneMaterial.color.setHex(color)
      return placeable
    }

    // Tool visuals are rendered inside the building-local ToolManager group, so all cursor
    // positions must be in building-local space. Wall/ceiling/item-surface strategies return
    // world-space cursor positions (from their event.position); convert them here.
    const worldToBuildingLocal = (x: number, y: number, z: number): Vector3 => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      return buildingMesh ? buildingMesh.worldToLocal(new Vector3(x, y, z)) : new Vector3(x, y, z)
    }

    const applyTransition = (result: TransitionResult) => {
      // Alignment guides are floor-only; clear them when the cursor moves
      // onto a wall / ceiling / item surface (only those paths call this).
      useAlignmentGuides.getState().clear()
      Object.assign(placementState.current, result.stateUpdate)
      gridPosition.current.set(...result.gridPosition)

      const c = worldToBuildingLocal(...result.cursorPosition)
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(c.x, c.y, c.z)
        if (result.cursorRotation) {
          cursorGroupRef.current.rotation.set(...result.cursorRotation)
        } else {
          cursorGroupRef.current.rotation.set(0, result.cursorRotationY, 0)
        }
      }

      const draft = draftNode.current
      if (draft) {
        // Update ref for validation — no store update during drag
        Object.assign(draft, result.nodeUpdate)
      }
      revalidate()
    }

    const ensureDraft = (result: TransitionResult) => {
      gridPosition.current.set(...result.gridPosition)
      const c = worldToBuildingLocal(...result.cursorPosition)
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(c.x, c.y, c.z)
        if (result.cursorRotation) {
          cursorGroupRef.current.rotation.set(...result.cursorRotation)
        } else {
          cursorGroupRef.current.rotation.set(0, result.cursorRotationY, 0)
        }
      }

      const initRotation: [number, number, number] = result.cursorRotation ?? [
        0,
        result.cursorRotationY,
        0,
      ]

      draftNode.create(gridPosition.current, asset, initRotation, configRef.current.defaultScale)

      const draft = draftNode.current
      if (draft) {
        Object.assign(draft, result.nodeUpdate)
        // One-time setup: put node in the right parent so it renders correctly
        useScene.getState().updateNode(draft.id, result.nodeUpdate)
      }

      const previewBounds = expandBoundsToGrid(
        getFallbackPreviewBounds(draftNode.current, asset, asset.attachTo),
        asset.attachTo,
        gridSnapStep,
      )
      updatePreviewGeometry(previewBounds)
      updateDimensionGuides(previewBounds)

      if (!revalidate()) {
        draftNode.destroy()
      }
    }

    // ---- Init draft ----
    configRef.current.initDraft(gridPosition.current)
    const preserveFloorDragOffset =
      configRef.current.preserveFloorDragOffset === true &&
      placementState.current.surface === 'floor' &&
      !asset.attachTo
    const relativeFloorStart = preserveFloorDragOffset ? gridPosition.current.clone() : null

    // Sync cursor to the draft mesh's world position and rotation
    if (draftNode.current) {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        const worldPos = new Vector3()
        mesh.getWorldPosition(worldPos)
        const localPos = worldToBuildingLocal(worldPos.x, worldPos.y, worldPos.z)
        if (cursorGroupRef.current) {
          cursorGroupRef.current.position.copy(localPos)
          if (draftNode.current.asset.attachTo) {
            // Wall/ceiling items: extract world Y rotation (handles wall-parented items correctly)
            const q = new Quaternion()
            mesh.getWorldQuaternion(q)
            cursorGroupRef.current.rotation.y = new Euler().setFromQuaternion(q, 'YXZ').y
          } else {
            // Floor items: the cursor group lives in building-local space, so use the
            // node's local Y rotation — the same value onGridMove applies. The world
            // quaternion would double-count any building rotation, leaving the initial
            // box mis-rotated until the first cursor move.
            cursorGroupRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
          }
        }
      } else if (cursorGroupRef.current) {
        cursorGroupRef.current.position.copy(gridPosition.current)
        cursorGroupRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
      }
    }

    revalidate()

    // ---- Press-drag commit-on-release ----
    // When the move was engaged by the press-drag move cross (vs. click-to-
    // place), commit on pointer-up instead of waiting for a click. Each surface
    // move handler records how to commit at the current cursor; the release
    // replays it. Captured once at setup — a fresh coordinator mounts per move.
    const dragMode = useEditor.getState().placementDragMode
    let releaseCommit: (() => void) | null = null
    // Eat the click the browser fires after pointer-up so the surface
    // `:click` handlers don't commit a second time.
    const swallowNextClick = () => {
      const swallow = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
    }
    const onReleaseCommit = () => {
      if (!releaseCommit) return
      const commit = releaseCommit
      releaseCommit = null
      swallowNextClick()
      commit()
    }

    // ---- Floor Handlers ----

    let previousGridPos: [number, number, number] | null = null

    // Scratch objects reused by the stickiness test (runs per grid:move).
    const stickyRay = new Ray()
    const stickyBox = new Box3()
    const stickyMat = new Matrix4()
    const stickyCamPos = new Vector3()

    // True while the cursor ray still points at the active shelf's volume.
    // Used to keep an item hosted on a shelf "sticky": from an angled camera
    // the cursor ray slips off the shelf's thin boards / through its gaps and
    // lands on the floor *behind* the shelf, which would otherwise thrash the
    // placement between the shelf row and the floor on every micro-move. We
    // reconstruct the world ray (camera → grid hit point) and test it against
    // the shelf's bounding box — so a ray that passes *through* the shelf but
    // lands behind it still counts as "on the shelf". Only a ray that misses
    // the shelf box entirely means the user genuinely moved off it. A simple
    // footprint test on the floor hit point can't distinguish those.
    const cursorRayIntersectsActiveShelf = (gridWorldPoint: [number, number, number]): boolean => {
      const shelfId = placementState.current.shelfId
      if (!shelfId) return false
      const shelfMesh = sceneRegistry.nodes.get(shelfId as AnyNodeId)
      const shelfNode = useScene.getState().nodes[shelfId as AnyNodeId] as
        | { width?: number; depth?: number; height?: number }
        | undefined
      if (!(shelfMesh && shelfNode?.width && shelfNode?.depth && shelfNode?.height)) return false

      cameraRef.current.getWorldPosition(stickyCamPos)
      stickyRay.origin.copy(stickyCamPos)
      stickyRay.direction
        .set(
          gridWorldPoint[0] - stickyCamPos.x,
          gridWorldPoint[1] - stickyCamPos.y,
          gridWorldPoint[2] - stickyCamPos.z,
        )
        .normalize()

      // Into shelf-local space, then test the shelf's local AABB (origin at the
      // base: y ∈ [0, height]) with a small margin.
      stickyRay.applyMatrix4(stickyMat.copy(shelfMesh.matrixWorld).invert())
      const m = 0.08
      stickyBox.min.set(-shelfNode.width / 2 - m, -m, -shelfNode.depth / 2 - m)
      stickyBox.max.set(shelfNode.width / 2 + m, shelfNode.height + m, shelfNode.depth / 2 + m)
      return stickyRay.intersectsBox(stickyBox)
    }

    const onGridMove = (event: GridEvent) => {
      releaseCommit = () => onGridClick(event)
      // Lazy draft creation: if no draft yet (e.g. level wasn't ready during init), create now
      if (draftNode.current === null && asset.attachTo === undefined) {
        configRef.current.initDraft(gridPosition.current)
      }

      has3DPointerDrivenMoveRef.current = true

      // Shelf stickiness: while hosting on a shelf, ignore floor events while
      // the cursor ray still points at the shelf volume (the ray merely slipped
      // off a board / through a gap and hit the floor behind). Detach to the
      // floor only once the ray misses the shelf entirely — without this the
      // item oscillates between the shelf row and the floor on every micro-move.
      if (placementState.current.surface === 'shelf-surface') {
        if (cursorRayIntersectsActiveShelf(event.position)) return
        detachItemSurfaceToFloor(event as unknown as ItemEvent)
      }

      const floorEvent =
        relativeFloorStart !== null
          ? (() => {
              const rawX = event.localPosition[0]
              const rawZ = event.localPosition[2]
              const anchor = floorDragAnchor ?? [rawX, rawZ]
              floorDragAnchor = anchor
              return {
                ...event,
                localPosition: [
                  relativeFloorStart.x + (rawX - anchor[0]),
                  event.localPosition[1],
                  relativeFloorStart.z + (rawZ - anchor[1]),
                ] as [number, number, number],
              }
            })()
          : event

      lastRawPos.current.set(
        floorEvent.localPosition[0],
        floorEvent.localPosition[1],
        floorEvent.localPosition[2],
      )
      if (!cursorGroupRef.current) return
      const result = floorStrategy.move(getContext(), floorEvent)
      if (!result) return

      // Figma-style alignment snap layered on top of the floor strategy's
      // grid snap: when the draft's edge lines up (on X or Z) with another
      // item's edge, snap and publish a guide. The guide connects to the
      // nearest real corner of the candidate (resolver tie-break), so the dot
      // always sits on an actual point. The delta is applied to BOTH the grid
      // and cursor positions below. Alt bypasses alignment; Shift bypasses all snap.
      const draft = draftNode.current
      let alignX = 0
      let alignZ = 0
      const bypassSnap = floorEvent.nativeEvent?.shiftKey === true
      const bypassAlign = floorEvent.nativeEvent?.altKey === true || bypassSnap
      if (!bypassAlign && draft) {
        alignmentCandidates ??= collectAlignmentAnchors(
          useScene.getState().nodes,
          draft.id,
          useViewer.getState().selection.levelId,
        )
        const ar = resolveAlignmentForActiveBuilding({
          moving: movingFootprintAnchors(
            draft as unknown as AnyNode,
            result.gridPosition[0],
            result.gridPosition[2],
            cursorGroupRef.current.rotation.y,
          ),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (ar.snap) {
          alignX = ar.snap.dx
          alignZ = ar.snap.dz
        }
        useAlignmentGuides.getState().set(ar.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      const gridPos: [number, number, number] = [
        result.gridPosition[0] + alignX,
        result.gridPosition[1],
        result.gridPosition[2] + alignZ,
      ]

      // Play snap sound when grid position changes
      if (
        !bypassSnap &&
        previousGridPos &&
        (gridPos[0] !== previousGridPos[0] || gridPos[2] !== previousGridPos[2])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPos = [...gridPos]
      gridPosition.current.set(...gridPos)
      const cursorPosition = getFloorVisualPosition(gridPos)
      cursorGroupRef.current.position.set(cursorPosition[0], cursorPosition[1], cursorPosition[2])
      // Floor items only rotate on Y; keep the preview box (and the live
      // transform the 2D floorplan mirrors) aligned with the draft's
      // rotation. Without this the box stays at its seed rotation until a
      // manual R/T, so a moved already-rotated item shows an axis-aligned box.
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      if (draft) draft.position = gridPos

      // Publish live transform for 2D floorplan
      if (draft) {
        useLiveTransforms.getState().set(draft.id, {
          position: gridPos,
          rotation: cursorGroupRef.current.rotation.y,
        })
      }

      revalidate()
    }

    const onGridClick = (event: GridEvent) => {
      // Drop alignment guides on click — the move commits (guides done) or
      // placement re-arms (the next move republishes them).
      useAlignmentGuides.getState().clear()
      const result = floorStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      // Preserve cursor rotation for the next draft
      const currentRotation: [number, number, number] = [
        0,
        cursorGroupRef.current?.rotation.y ?? draftNode.current?.rotation[1] ?? 0,
        0,
      ]

      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }

      draftNode.commit(result.nodeUpdate)
      if (configRef.current.onCommitted()) {
        draftNode.create(gridPosition.current, asset, currentRotation)
        const previewBounds = expandBoundsToGrid(
          getFallbackPreviewBounds(draftNode.current, asset, asset.attachTo),
          asset.attachTo,
          gridSnapStep,
        )
        updatePreviewGeometry(previewBounds)
        updateDimensionGuides(previewBounds)
        revalidate()
      }
    }

    // ---- Wall Handlers ----

    const onWallEnter = (event: WallEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const nodes = useScene.getState().nodes
      const result = wallStrategy.enter(
        getContext(),
        event,
        resolveLevelId,
        nodes,
        getActiveValidators(),
      )
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new wall
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.wallId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.wallId as AnyNodeId)
        }
      }
    }

    const onWallMove = (event: WallEvent) => {
      releaseCommit = () => onWallClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'wall') {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          ctx,
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
          if (enterResult.stateUpdate.wallId) {
            useScene.getState().dirtyNodes.add(enterResult.stateUpdate.wallId as AnyNodeId)
          }
        }
        return
      }

      if (!draftNode.current) {
        const nodes = useScene.getState().nodes
        const setup = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      const result = wallStrategy.move(ctx, event, getActiveValidators())
      if (!result) return

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      // Play snap sound when grid position changes
      if (event.nativeEvent?.shiftKey !== true && posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const wc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(wc.x, wc.y, wc.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft && result.nodeUpdate) {
        if ('side' in result.nodeUpdate) draft.side = result.nodeUpdate.side
        if ('rotation' in result.nodeUpdate)
          draft.rotation = result.nodeUpdate.rotation as [number, number, number]
      }

      const placeable = revalidate()

      if (draft && placeable) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) {
          mesh.position.copy(gridPosition.current)
          const rot = result.nodeUpdate?.rotation
          if (rot) mesh.rotation.y = rot[1]

          // Push wall-side items out by half the parent wall's thickness
          if (asset.attachTo === 'wall-side' && placementState.current.wallId) {
            const parentWall = useScene.getState().nodes[placementState.current.wallId as AnyNodeId]
            if (parentWall?.type === 'wall') {
              const wallThickness = (parentWall as WallNode).thickness ?? 0.1
              mesh.position.z = (wallThickness / 2) * (draft.side === 'front' ? 1 : -1)
            }
          }
        }
        // Mark parent wall dirty so it rebuilds geometry — only when position changed
        if (result.dirtyNodeId && posChanged) {
          const now = globalThis.performance?.now?.() ?? Date.now()
          const last = lastWallDirtyAtRef.current.get(result.dirtyNodeId) ?? 0
          // Wall rebuilds can trigger expensive CSG; throttle live previews to avoid FPS collapse.
          if (now - last > 120) {
            lastWallDirtyAtRef.current.set(result.dirtyNodeId, now)
            useScene.getState().dirtyNodes.add(result.dirtyNodeId)
          }
        }

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }
    }

    const onWallClick = (event: WallEvent) => {
      const result = wallStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)
      if (result.dirtyNodeId) {
        useScene.getState().dirtyNodes.add(result.dirtyNodeId)
      }

      if (configRef.current.onCommitted()) {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          validators,
        )
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onWallLeave = (event: WallEvent) => {
      const result = wallStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldWallId = placementState.current.wallId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldWallId) {
            useScene.getState().dirtyNodes.add(oldWallId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Roof Wall Handlers ----
    // Wall-attach items also host on the vertical wall faces a roof
    // segment generates (base walls + coplanar gable ends). Unlike walls,
    // crossing between segments inside ONE roof never re-fires
    // `roof:enter` (events come from the roof group), so the move handler
    // re-enters whenever the strategy reports a segment change.

    const enterRoofWall = (event: RoofEvent): boolean => {
      const result = roofWallStrategy.enter(getContext(), event, shiftFreeRef.current)
      if (!result) return false

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to the segment
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
      return true
    }

    const onRoofWallEnter = (event: RoofEvent) => {
      has3DPointerDrivenMoveRef.current = true
      enterRoofWall(event)
    }

    const onRoofWallMove = (event: RoofEvent) => {
      releaseCommit = () => onRoofWallClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'roof-wall' || !draftNode.current) {
        enterRoofWall(event)
        return
      }

      const result = roofWallStrategy.move(ctx, event, shiftFreeRef.current)
      if (!result) {
        // Different segment under the pointer (or no placeable face) —
        // try a fresh enter; a null resolve leaves the draft where it is.
        enterRoofWall(event)
        return
      }

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      if (!shiftFreeRef.current && posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const wc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(wc.x, wc.y, wc.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft && result.nodeUpdate) {
        if ('side' in result.nodeUpdate) draft.side = result.nodeUpdate.side
        if ('rotation' in result.nodeUpdate)
          draft.rotation = result.nodeUpdate.rotation as [number, number, number]
      }

      const placeable = revalidate()

      if (draft && placeable) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) {
          mesh.position.copy(gridPosition.current)
          // Wall-side items sit on the outer surface: mirror ItemSystem's
          // push (z = thickness/2 off the face frame's mid-plane) so the
          // drag preview doesn't sink into the wall until commit.
          if (asset.attachTo === 'wall-side' && placementState.current.roofSegmentId) {
            const segment =
              useScene.getState().nodes[placementState.current.roofSegmentId as AnyNodeId]
            if (segment?.type === 'roof-segment') {
              mesh.position.z = (segment.wallThickness ?? 0.1) / 2
            }
          }
          const rot = result.nodeUpdate?.rotation
          if (rot) mesh.rotation.y = rot[1]
        }
        // The 2D floor-plan live frame is wall-local; a segment-local
        // value would render garbage — clear instead of publishing.
        useLiveTransforms.getState().clear(draft.id)
      }
    }

    const onRoofWallClick = (event: RoofEvent) => {
      const result = roofWallStrategy.click(getContext(), event, shiftFreeRef.current)
      if (!result) return

      event.stopPropagation()
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        const enterResult = roofWallStrategy.enter(getContext(), event, shiftFreeRef.current)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onRoofWallLeave = (event: RoofEvent) => {
      const result = roofWallStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (draftNode.isAdopted) {
        // Move mode: keep draft alive, reparent to level
        applyTransition(result)
        const draft = draftNode.current
        if (draft) {
          useScene.getState().updateNode(draft.id, {
            parentId: result.nodeUpdate.parentId as string,
            roofSegmentId: undefined,
          })
        }
      } else {
        // Create mode: destroy transient and reset state
        draftNode.destroy()
        Object.assign(placementState.current, result.stateUpdate)
      }
    }

    // ---- Item Surface Handlers ----

    const detachItemSurfaceToFloor = (event: ItemEvent) => {
      const buildingLocalPoint = worldToBuildingLocal(
        event.position[0],
        event.position[1],
        event.position[2],
      )
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const wx = bypassSnap ? buildingLocalPoint.x : Math.round(buildingLocalPoint.x * 2) / 2
      const wz = bypassSnap ? buildingLocalPoint.z : Math.round(buildingLocalPoint.z * 2) / 2
      const floorPos: [number, number, number] = [wx, 0, wz]

      Object.assign(placementState.current, {
        surface: 'floor',
        surfaceItemId: null,
        shelfId: null,
      })
      gridPosition.current.set(wx, 0, wz)
      const levelId = useViewer.getState().selection.levelId as AnyNodeId | null
      const floorVisualPosition = getFloorVisualPosition(
        floorPos,
        levelId ? { parentId: levelId } : undefined,
      )
      if (cursorGroupRef.current) {
        cursorGroupRef.current.position.set(...floorVisualPosition)
      }

      const draft = draftNode.current
      if (draft) {
        draft.position = floorPos
        useScene.getState().updateNode(draft.id, {
          parentId: useViewer.getState().selection.levelId as string,
          position: floorPos,
        })
      }

      revalidate()
    }

    const onItemEnter = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      has3DPointerDrivenMoveRef.current = true
      const result = itemSurfaceStrategy.enter(getContext(), event)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to surface item
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
    }

    const onItemMove = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      releaseCommit = () => onItemClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      const ctx = getContext()

      if (ctx.state.surface !== 'item-surface') {
        // Try entering surface mode
        const enterResult = itemSurfaceStrategy.enter(ctx, event)
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
        }
        return
      }

      if (ctx.state.surface === 'item-surface' && event.node.id !== ctx.state.surfaceItemId) {
        const enterResult = itemSurfaceStrategy.enter(
          { ...ctx, state: { ...ctx.state, surface: 'floor', surfaceItemId: null } },
          event,
        )

        event.stopPropagation()
        if (enterResult) {
          applyTransition(enterResult)
          if (draftNode.current && enterResult.nodeUpdate.parentId) {
            useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
          }
        } else {
          detachItemSurfaceToFloor(event)
        }
        return
      }

      if (!draftNode.current) {
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (!enterResult) return
        event.stopPropagation()
        ensureDraft(enterResult)
        return
      }

      lastRawPos.current.set(event.position[0], event.position[1], event.position[2])
      const result = itemSurfaceStrategy.move(ctx, event)
      if (!result) return

      event.stopPropagation()

      gridPosition.current.set(...result.gridPosition)
      const ic = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(ic.x, ic.y, ic.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.set(...result.gridPosition)

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }

      revalidate()
    }

    const onItemLeave = (event: ItemEvent) => {
      if (event.node.id === draftNode.current?.id) return
      if (placementState.current.surface !== 'item-surface') return

      event.stopPropagation()

      // `event.localPosition` from useNodeEvents is in the LEAVING item's
      // local space (the sofa/table the draft is detaching from), not
      // building-local. Convert from world via worldToBuildingLocal instead,
      // otherwise the wireframe jumps to a surface-local-coordinate ghost
      // position until the next mouse move.
      detachItemSurfaceToFloor(event)
    }

    const onItemClick = (event: ItemEvent) => {
      // Click on the draft item itself. R3F dispatches click events to
      // the closest intersected mesh only — when the draft is hovering
      // on a host (shelf / table / etc.) the draft's mesh is *above*
      // the host's mesh, so the host's `${kind}:click` never fires.
      // If we're currently hosting on a shelf-surface, treat the
      // self-click as a commit on the active shelf so the user doesn't
      // have to aim around the cursor preview to drop the item.
      if (event.node.id === draftNode.current?.id) {
        const ctx = getContext()
        if (ctx.state.surface === 'shelf-surface' && ctx.state.shelfId) {
          const shelfNode = useScene.getState().nodes[ctx.state.shelfId as AnyNodeId]
          if (shelfNode && shelfNode.type === 'shelf') {
            const synthetic = { ...event, node: shelfNode } as unknown as ItemEvent
            const result = shelfSurfaceStrategy.click(ctx, synthetic as never)
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              draftNode.commit(result.nodeUpdate)
              if (configRef.current.onCommitted()) {
                const enterResult = shelfSurfaceStrategy.enter(ctx, synthetic as never)
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              }
              return
            }
          }
        }
        // Same self-click forwarding for item-surface hosts (tables,
        // counters) — the draft mesh sits on top of the host mesh, so
        // the host's own click event is blocked by the cursor preview.
        if (ctx.state.surface === 'item-surface' && ctx.state.surfaceItemId) {
          const hostNode = useScene.getState().nodes[ctx.state.surfaceItemId as AnyNodeId]
          if (hostNode && hostNode.type === 'item') {
            const synthetic = { ...event, node: hostNode } as ItemEvent
            const result = itemSurfaceStrategy.click(ctx, synthetic)
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              draftNode.commit(result.nodeUpdate)
              if (configRef.current.onCommitted()) {
                const enterResult = itemSurfaceStrategy.enter(ctx, synthetic)
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              }
              return
            }
          }
        }
        // Ceiling-hosted draft: when placing a ceiling-attached item the
        // draft hangs below the ceiling and intercepts the click ray
        // before the ceiling-grid mesh does — so `ceiling:click` never
        // fires and the user's commit click is dropped. Forward the
        // self-click to `ceilingStrategy.click` so placement commits the
        // same way it would from a click on the ceiling itself.
        if (ctx.state.surface === 'ceiling' && ctx.state.ceilingId) {
          const ceilingNode = useScene.getState().nodes[ctx.state.ceilingId as AnyNodeId]
          if (ceilingNode && ceilingNode.type === 'ceiling') {
            const synthetic = { ...event, node: ceilingNode } as unknown as CeilingEvent
            const result = ceilingStrategy.click(ctx, synthetic, getActiveValidators())
            if (result) {
              event.stopPropagation()
              if (draftNode.current) {
                useLiveTransforms.getState().clear(draftNode.current.id)
              }
              draftNode.commit(result.nodeUpdate)
              if (configRef.current.onCommitted()) {
                const nodes = useScene.getState().nodes
                const enterResult = ceilingStrategy.enter(
                  getContext(),
                  synthetic,
                  resolveLevelId,
                  nodes,
                )
                if (enterResult) {
                  applyTransition(enterResult)
                } else {
                  revalidate()
                }
              }
              return
            }
          }
        }
        return
      }

      const result = itemSurfaceStrategy.click(getContext(), event)
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        // Try to set up next draft on the same surface
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    // ---- Ceiling Handlers ----

    const onCeilingEnter = (event: CeilingEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const nodes = useScene.getState().nodes
      const result = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new ceiling
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.ceilingId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.ceilingId as AnyNodeId)
        }
      }
    }

    const onCeilingMove = (event: CeilingEvent) => {
      releaseCommit = () => onCeilingClick(event)
      has3DPointerDrivenMoveRef.current = true
      if (!cursorGroupRef.current) return
      if (!draftNode.current && placementState.current.surface === 'ceiling') {
        const nodes = useScene.getState().nodes
        const setup = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      lastRawPos.current.set(event.localPosition[0], event.localPosition[1], event.localPosition[2])
      const result = ceilingStrategy.move(getContext(), event)
      if (!result) return

      event.stopPropagation()

      // Play snap sound when grid position changes
      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      if (event.nativeEvent?.shiftKey !== true && posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const cc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(cc.x, cc.y, cc.z)

      revalidate()

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.copy(gridPosition.current)

        // Publish live transform for 2D floorplan. The item override in
        // `floorplan-registry-layer` treats `live.position` as building-local
        // plan coords (parentId forced to null so the resolver renders it
        // directly), so publish the building-local cursor — not the
        // world-space `result.cursorPosition`, which otherwise lands the 2D
        // visual off the cursor whenever the building isn't at the origin
        // with zero rotation.
        useLiveTransforms.getState().set(draft.id, {
          position: [cc.x, cc.y, cc.z],
          rotation: cursorGroupRef.current.rotation.y,
        })
      }
    }

    const onCeilingClick = (event: CeilingEvent) => {
      const result = ceilingStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        const nodes = useScene.getState().nodes
        const enterResult = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onCeilingLeave = (event: CeilingEvent) => {
      const result = ceilingStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldCeilingId = placementState.current.ceilingId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldCeilingId) {
            useScene.getState().dirtyNodes.add(oldCeilingId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Shelf Handlers ----
    //
    // Items can host on shelves the same way they host on tables and
    // counters (item-surface). The shelf's `surfaces.custom` exposes one
    // candidate Y per row; `shelfSurfaceStrategy` picks the closest one
    // to the cursor's local-Y so the user can target a specific row.

    const onShelfEnter = (event: ShelfEvent) => {
      has3DPointerDrivenMoveRef.current = true
      const result = shelfSurfaceStrategy.enter(getContext(), event)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
    }

    const onShelfMove = (event: ShelfEvent) => {
      releaseCommit = () => onShelfClick(event)
      has3DPointerDrivenMoveRef.current = true
      // A shelf event can fire before the cursor group mounts or after
      // teardown, leaving the ref null; bail before dereferencing it below.
      if (!cursorGroupRef.current) return
      const ctx = getContext()
      if (ctx.state.surface !== 'shelf-surface') {
        // Cursor entered via a move event without an enter — try
        // transitioning in so the user doesn't need to mouse out + back
        // in to start hosting.
        const enterResult = shelfSurfaceStrategy.enter(ctx, event)
        if (!enterResult) return
        event.stopPropagation()
        applyTransition(enterResult)
        if (!draftNode.current) {
          ensureDraft(enterResult)
        } else if (enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
        }
        return
      }
      const result = shelfSurfaceStrategy.move(ctx, event)
      if (!result) return

      event.stopPropagation()

      gridPosition.current.set(...result.gridPosition)
      const ic = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(ic.x, ic.y, ic.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.set(...result.gridPosition)
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }

      revalidate()
    }

    const onShelfLeave = (event: ShelfEvent) => {
      if (placementState.current.surface !== 'shelf-surface') return
      if (event.node.id !== placementState.current.shelfId) return
      // Intentionally do NOT detach to the floor here. `shelf:leave` fires
      // constantly while hosting because the cursor ray slips off the shelf's
      // thin boards and through its gaps — detaching on each of those would
      // thrash the item between the shelf row and the floor. The grid handler
      // owns the real shelf→floor transition (see `isOverActiveShelfFootprint`
      // in `onGridMove`): it detaches only once the cursor is clearly off the
      // shelf footprint, which is the genuine "left the shelf" signal.
      event.stopPropagation()
    }

    const onShelfClick = (event: ShelfEvent) => {
      const result = shelfSurfaceStrategy.click(getContext(), event)
      if (!result) return

      event.stopPropagation()
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        const enterResult = shelfSurfaceStrategy.enter(getContext(), event)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    // ---- Keyboard rotation ----

    // 45° increments — matches the R-key rotation step for already-placed
    // items (use-keyboard.ts) so the ghost/duplicate rotates the same way.
    const ROTATION_STEP = Math.PI / 4
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftFreeRef.current = true
        revalidate()
        return
      }

      // Don't intercept keys when focus is inside a text input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const draft = draftNode.current
      if (!draft) return

      // Roof-wall drafts live flat in the host face frame (yaw 0) —
      // manual rotation would skew them off the wall plane.
      if (placementState.current.surface === 'roof-wall') return

      let rotationDelta = 0
      if ((event.key === 'r' || event.key === 'R') && !event.metaKey && !event.ctrlKey)
        rotationDelta = ROTATION_STEP
      else if ((event.key === 't' || event.key === 'T') && !event.metaKey && !event.ctrlKey)
        rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        const currentRotation = draft.rotation
        const newRotationY = (currentRotation[1] ?? 0) + rotationDelta
        draft.rotation = [currentRotation[0], newRotationY, currentRotation[2]]

        // Ref + cursor mesh + item mesh — no store update during drag
        if (cursorGroupRef.current) {
          cursorGroupRef.current.rotation.y = newRotationY
        }
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.rotation.y = newRotationY

        // Re-snap position immediately with updated rotation (dimX/dimZ may swap at 90°)
        const surface = placementState.current.surface
        if (surface === 'floor' || surface === 'ceiling') {
          const dims = getScaledDimensions(draft)
          const [dimX, , dimZ] = dims
          const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
          const x = snapToGrid(lastRawPos.current.x, swapDims ? dimZ : dimX)
          const z = snapToGrid(lastRawPos.current.z, swapDims ? dimX : dimZ)
          gridPosition.current.set(x, gridPosition.current.y, z)
          draft.position = [x, gridPosition.current.y, z]
          if (cursorGroupRef.current) {
            if (surface === 'floor') {
              cursorGroupRef.current.position.set(
                ...getFloorVisualPosition([x, gridPosition.current.y, z]),
              )
            } else {
              cursorGroupRef.current.position.x = x
              cursorGroupRef.current.position.z = z
            }
          }
          if (mesh) {
            mesh.position.x = x
            mesh.position.z = z
            if (surface === 'floor') {
              mesh.position.y = getFloorVisualPosition([x, gridPosition.current.y, z])[1]
            }
          }
        } else if (surface === 'item-surface' && placementState.current.surfaceItemId) {
          const surfaceMesh = sceneRegistry.nodes.get(placementState.current.surfaceItemId)
          if (surfaceMesh) {
            const localPos = surfaceMesh.worldToLocal(lastRawPos.current.clone())
            const dims = getScaledDimensions(draft)
            const [dimX, , dimZ] = dims
            const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
            const x = snapToGrid(localPos.x, swapDims ? dimZ : dimX)
            const z = snapToGrid(localPos.z, swapDims ? dimX : dimZ)
            const y = gridPosition.current.y
            gridPosition.current.set(x, y, z)
            draft.position = [x, y, z]
            const worldSnapped = surfaceMesh.localToWorld(new Vector3(x, y, z))
            const localSnapped = worldToBuildingLocal(
              worldSnapped.x,
              worldSnapped.y,
              worldSnapped.z,
            )
            if (cursorGroupRef.current) {
              cursorGroupRef.current.position.set(localSnapped.x, localSnapped.y, localSnapped.z)
            }
            if (mesh) mesh.position.set(x, y, z)
          }
        }

        // Update live transform for 2D floorplan with post-snap position
        const currentLive = useLiveTransforms.getState().get(draft.id)
        if (currentLive) {
          const livePosition: [number, number, number] =
            surface === 'floor'
              ? [draft.position[0], draft.position[1], draft.position[2]]
              : cursorGroupRef.current
                ? [
                    cursorGroupRef.current.position.x,
                    cursorGroupRef.current.position.y,
                    cursorGroupRef.current.position.z,
                  ]
                : [draft.position[0], draft.position[1], draft.position[2]]
          useLiveTransforms.getState().set(draft.id, {
            ...currentLive,
            position: livePosition,
            rotation: newRotationY,
          })
        }

        revalidate()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftFreeRef.current = false
        revalidate()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // ---- tool:cancel (Escape / programmatic) ----
    const onCancel = () => {
      useAlignmentGuides.getState().clear()
      if (configRef.current.onCancel) {
        configRef.current.onCancel()
      }
    }
    emitter.on('tool:cancel', onCancel)

    // ---- Right-click cancel ----
    const onContextMenu = (event: MouseEvent) => {
      if (configRef.current.onCancel) {
        event.preventDefault()
        configRef.current.onCancel()
      }
    }
    window.addEventListener('contextmenu', onContextMenu)

    // ---- Bounding box geometry ----
    // Always derive the wireframe from `asset.dimensions × scale` rather than
    // the rendered mesh bounds. Asset dimensions describe the item's footprint
    // (e.g. only the trunk for a palm tree), while the mesh bbox would include
    // foliage or other visual overhang the snap logic intentionally ignores.

    const draft = draftNode.current
    const previewBounds = expandBoundsToGrid(
      getFallbackPreviewBounds(draft, asset, asset.attachTo),
      asset.attachTo,
      gridSnapStep,
    )
    updatePreviewGeometry(previewBounds)
    updateDimensionGuides(previewBounds)

    // ---- Undo protection ----
    // Undo replaces the entire `nodes` object with a previous snapshot, which doesn't
    // include the draft (created while temporal was paused). Re-insert it so the mesh
    // doesn't disappear mid-placement.
    // We defer via queueMicrotask to avoid nested setState during the undo callback.
    // Temporal is already paused during placement, so createNode won't enter the undo stack.
    let tearingDown = false
    const unsubDraftWatch = useScene.subscribe((state) => {
      if (tearingDown) return
      const draft = draftNode.current
      if (draft === null) return
      if (draft.id in state.nodes) return

      queueMicrotask(() => {
        if (tearingDown) return
        const draft = draftNode.current
        if (draft === null) return
        if (draft.id in useScene.getState().nodes) return
        // Temporal is paused during placement, createNode won't be tracked
        useScene.getState().createNode(draft, draft.parentId as AnyNodeId)
      })
    })

    // ---- Subscribe ----

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('item:enter', onItemEnter)
    emitter.on('item:move', onItemMove)
    emitter.on('item:leave', onItemLeave)
    emitter.on('item:click', onItemClick)
    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofWallEnter)
    emitter.on('roof:move', onRoofWallMove)
    emitter.on('roof:click', onRoofWallClick)
    emitter.on('roof:leave', onRoofWallLeave)
    emitter.on('ceiling:enter', onCeilingEnter)
    emitter.on('ceiling:move', onCeilingMove)
    emitter.on('ceiling:click', onCeilingClick)
    emitter.on('ceiling:leave', onCeilingLeave)
    emitter.on('shelf:enter', onShelfEnter)
    emitter.on('shelf:move', onShelfMove)
    emitter.on('shelf:click', onShelfClick)
    emitter.on('shelf:leave', onShelfLeave)
    if (dragMode) window.addEventListener('pointerup', onReleaseCommit)

    return () => {
      tearingDown = true
      if (dragMode) window.removeEventListener('pointerup', onReleaseCommit)
      unsubDraftWatch()
      useAlignmentGuides.getState().clear()
      // Clear live transform for any remaining draft
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.destroy()
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('item:enter', onItemEnter)
      emitter.off('item:move', onItemMove)
      emitter.off('item:leave', onItemLeave)
      emitter.off('item:click', onItemClick)
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('roof:enter', onRoofWallEnter)
      emitter.off('roof:move', onRoofWallMove)
      emitter.off('roof:click', onRoofWallClick)
      emitter.off('roof:leave', onRoofWallLeave)
      emitter.off('ceiling:enter', onCeilingEnter)
      emitter.off('ceiling:move', onCeilingMove)
      emitter.off('ceiling:click', onCeilingClick)
      emitter.off('ceiling:leave', onCeilingLeave)
      emitter.off('shelf:enter', onShelfEnter)
      emitter.off('shelf:move', onShelfMove)
      emitter.off('shelf:click', onShelfClick)
      emitter.off('shelf:leave', onShelfLeave)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [
    asset,
    canPlaceOnFloor,
    canPlaceOnWall,
    canPlaceOnCeiling,
    draftNode,
    getFloorVisualPosition,
    gridSnapStep,
    updateDimensionGuides,
    updatePreviewGeometry,
  ])

  // Refresh wireframe when the grid step changes mid-placement so the green/red
  // box snaps to the new cell size right away.
  useEffect(() => {
    if (!asset) return
    const draft = draftNode.current
    const previewBounds = expandBoundsToGrid(
      getFallbackPreviewBounds(draft, asset, asset.attachTo),
      asset.attachTo,
      gridSnapStep,
    )
    updatePreviewGeometry(previewBounds)
    updateDimensionGuides(previewBounds)
  }, [gridSnapStep, asset, draftNode, updateDimensionGuides, updatePreviewGeometry])
  // Wall/ceiling items are managed by their own surface entry events (ensureDraft / reparent).
  const viewerLevelId = useViewer((s) => s.selection.levelId)
  useEffect(() => {
    if (!asset) return
    const draft = draftNode.current
    if (!(draft && viewerLevelId) || asset.attachTo) return
    if (draft.parentId === viewerLevelId) return
    draft.parentId = viewerLevelId
    useScene.getState().updateNode(draft.id as AnyNodeId, { parentId: viewerLevelId })
  }, [viewerLevelId, draftNode, asset])

  // Disable raycasting on the live draft mesh (and restore it when the draft
  // changes or goes away) so the cursor ray passes through the item being
  // moved and lands on the surface beneath it.
  const reconcileDraftRaycast = useCallback((mesh: Object3D | null) => {
    if (raycastDisabledMeshRef.current !== mesh) {
      // New draft root (or cleared): restore the prior mesh and reset tracking.
      for (const restore of restoreRaycastsRef.current) restore()
      restoreRaycastsRef.current = []
      raycastDisabledChildrenRef.current = new WeakSet()
      raycastDisabledMeshRef.current = mesh
    }
    if (!mesh) return
    // Disable any descendant not handled yet. Item drafts are GLB models whose
    // child meshes mount asynchronously (Suspense), so a one-shot traverse
    // misses them — those late children keep intercepting the ray and corrupt
    // the shelf-row hit the moment the item moves onto a row. Re-walking each
    // frame is cheap: the WeakSet makes it idempotent, so only new children pay.
    mesh.traverse((child) => {
      if (raycastDisabledChildrenRef.current.has(child)) return
      raycastDisabledChildrenRef.current.add(child)
      const original = child.raycast
      child.raycast = () => {}
      restoreRaycastsRef.current.push(() => {
        child.raycast = original
      })
    })
  }, [])

  // Restore the draft mesh's raycast when the coordinator unmounts (tool change).
  useEffect(() => () => reconcileDraftRaycast(null), [reconcileDraftRaycast])

  useFrame((_, delta) => {
    if (!asset) {
      reconcileDraftRaycast(null)
      return
    }
    if (!draftNode.current) {
      reconcileDraftRaycast(null)
      return
    }
    const mesh = sceneRegistry.nodes.get(draftNode.current.id) ?? null
    reconcileDraftRaycast(mesh)
    // mitt listeners outlive the cursor group's mount; bail if it's gone
    // (mount/teardown race, #323). Placed after reconcileDraftRaycast so the
    // draft's raycast is still restored during that window.
    if (!cursorGroupRef.current) return
    // The mesh-position lerp below only makes sense once this coordinator
    // owns the move via a 3D pointer event. Skip until then so that
    // external drivers (e.g. the 2D `FloorplanRegistryMoveOverlay`
    // writing scene.position directly) aren't fought by useFrame pulling
    // the mesh back to its pre-move location.
    if (!has3DPointerDrivenMoveRef.current) return
    if (!mesh) return

    // Hide wall/ceiling-attached items when between surfaces (only cursor visible)
    if (asset.attachTo && placementState.current.surface === 'floor') {
      mesh.visible = false
      return
    }
    mesh.visible = true

    if (placementState.current.surface === 'floor') {
      const distance = mesh.position.distanceToSquared(gridPosition.current)
      if (distance > 1) {
        mesh.position.copy(gridPosition.current)
      } else {
        mesh.position.lerp(gridPosition.current, delta * 20)
      }

      // Adjust Y for slab elevation (floor items on top of slabs)
      if (!asset.attachTo) {
        const visualPosition = getFloorVisualPosition([
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ])
        mesh.position.y = visualPosition[1]
        cursorGroupRef.current.position.y = visualPosition[1]
      }
    }
  })

  const initialDraft = draftNode.current
  const initialAttachTo = config.asset?.attachTo
  const rawDims = initialDraft
    ? getScaledDimensions(initialDraft)
    : (config.asset?.dimensions ?? DEFAULT_DIMENSIONS)
  const dims = getGridAlignedDimensions(rawDims, initialAttachTo, gridSnapStep)
  const wallSideZOffset = initialAttachTo === 'wall-side' ? -dims[2] / 2 : 0
  const initialDimensionBounds = expandBoundsToGrid(
    getFallbackPreviewBounds(initialDraft, config.asset, initialAttachTo),
    initialAttachTo,
    gridSnapStep,
  )
  const initialEdgeGeometry = useMemo(
    () => createLineGeometry(getBoxEdgePoints(initialDimensionBounds)),
    [
      initialDimensionBounds.center[0],
      initialDimensionBounds.center[1],
      initialDimensionBounds.center[2],
      initialDimensionBounds.dimensions[0],
      initialDimensionBounds.dimensions[1],
      initialDimensionBounds.dimensions[2],
      initialDimensionBounds,
    ],
  )
  const basePlaneGeometry = useMemo(() => {
    const geometry = new PlaneGeometry(dims[0], dims[2])
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, 0.01, wallSideZOffset)
    return geometry
  }, [dims[0], dims[2], wallSideZOffset])
  const initialWidthGuideGeometry = useMemo(() => createLineGeometry(), [])
  const initialDepthGuideGeometry = useMemo(() => createLineGeometry(), [])
  const initialHeightGuideGeometry = useMemo(() => createLineGeometry(), [])
  const currentDimensionBounds = dimensionBounds ?? initialDimensionBounds
  const widthLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[0], unit)
  const depthLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[2], unit)
  const heightLabel = formatLinearMeasurement(currentDimensionBounds.dimensions[1], unit)
  const widthLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0],
    0.04,
    currentDimensionBounds.center[2] + currentDimensionBounds.dimensions[2] / 2 + 0.24,
  ]
  const depthLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0] + currentDimensionBounds.dimensions[0] / 2 + 0.24,
    0.04,
    currentDimensionBounds.center[2],
  ]
  const heightLabelPosition: [number, number, number] = [
    currentDimensionBounds.center[0] - currentDimensionBounds.dimensions[0] / 2 - 0.24,
    currentDimensionBounds.dimensions[1] / 2,
    currentDimensionBounds.center[2] - currentDimensionBounds.dimensions[2] / 2,
  ]

  const measurementContent = (
    <>
      <lineSegments
        geometry={initialWidthGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementWidthRef}
        renderOrder={998}
      />
      <lineSegments
        geometry={initialDepthGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementDepthRef}
        renderOrder={998}
      />
      <lineSegments
        geometry={initialHeightGuideGeometry}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        ref={measurementHeightRef}
        renderOrder={998}
      />
      <Html center position={widthLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {widthLabel}
        </div>
      </Html>
      <Html center position={depthLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {depthLabel}
        </div>
      </Html>
      <Html center position={heightLabelPosition} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.86)',
            border: '1px solid rgba(15, 23, 42, 0.65)',
            borderRadius: '999px',
            color: '#f8fafc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {heightLabel}
        </div>
      </Html>
    </>
  )

  return (
    <group ref={cursorGroupRef}>
      <lineSegments
        geometry={initialEdgeGeometry}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        ref={edgesRef}
        renderOrder={999}
      />
      {measurementContent}
      <mesh
        geometry={basePlaneGeometry}
        layers={EDITOR_LAYER}
        material={basePlaneMaterial}
        ref={basePlaneRef}
        renderOrder={999}
      />
    </group>
  )
}
