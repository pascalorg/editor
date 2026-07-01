'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ArcResizeHandle,
  type Cursor,
  createSceneApi,
  DEFAULT_ANGLE_STEP,
  type HandleDescriptor,
  type HandlePortal,
  type LatchHandle,
  type LinearResizeHandle,
  nodeRegistry,
  type RadialResizeHandle,
  sceneRegistry,
  snapScalar,
  type TapActionHandle,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  type Object3D,
  OrthographicCamera,
  Plane,
  Quaternion,
  Ray,
  RingGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import { RESIZE_HANDLE_DRAG_LABEL, ROTATE_HANDLE_DRAG_LABEL } from '../../lib/contextual-help'
import { createEditorApi } from '../../lib/editor-api'
import { sfxEmitter } from '../../lib/sfx-bus'
import useDirectManipulationFeedback from '../../store/use-direct-manipulation-feedback'
import useEditor from '../../store/use-editor'
import useInteractionScope, {
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import useOpeningGuides from '../../store/use-opening-guides'
import { formatAngleRadians } from '../tools/shared/segment-angle'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  CORNER_HEX_RADIUS,
  HandleArrow,
  NO_RAYCAST,
} from './handles/handle-arrow'
import { type HandleDragControls, useHandleDrag } from './handles/use-handle-drag'

// Pooled scratch for the handle rig's world-relative pose mapping.
const _rigRelative = new Matrix4()
const _rigScratchScale = new Vector3()
const _resizeAxisW = new Vector3()
const _resizeScale = new Vector3()
const _resizeQuaternion = new Quaternion()
const _resizeOriginW = new Vector3()
const _resizePositionW = new Vector3()
const _resizeRay = new Ray()
const _resizeRayW = new Vector3()

// Tilt that stands a flat XZ-plane move cross up into a node's facing plane
// (its local XY = a wall face) for `plane: 'node-normal'` handles.
const NODE_NORMAL_TILT: [number, number, number] = [Math.PI / 2, 0, 0]

function axisVector(axis: 'x' | 'y' | 'z', target: Vector3) {
  target.set(0, 0, 0)
  if (axis === 'x') target.x = 1
  else if (axis === 'y') target.y = 1
  else target.z = 1
  return target
}

function axisScale(axis: 'x' | 'y' | 'z', scale: Vector3) {
  return axis === 'x' ? scale.x : axis === 'y' ? scale.y : scale.z
}

function closestAxisParameterToRay(axisOrigin: Vector3, axisDirection: Vector3, ray: Ray) {
  _resizeRayW.subVectors(axisOrigin, ray.origin)
  const b = axisDirection.dot(ray.direction)
  const d = axisDirection.dot(_resizeRayW)
  const e = ray.direction.dot(_resizeRayW)
  const denominator = 1 - b * b
  if (Math.abs(denominator) < 1e-6) {
    return -d
  }

  const axisParameter = (b * e - d) / denominator
  const rayParameter = e + b * axisParameter
  if (rayParameter < 0) {
    return -d
  }
  return axisParameter
}

export {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  createArrowHandleGeometry,
  createArrowHitAreaGeometry,
  createEndpointHitAreaGeometry,
  createMoveCrossHandleGeometry,
  createRotateArrowHandleGeometry,
  createRotateArrowHitAreaGeometry,
  HandleArrow,
  type HandleArrowInputShape,
  type HandleArrowPlacement,
  type HandleArrowProps,
  HIT_AREA_MARGIN,
  InvisibleHandleHitArea,
  NO_RAYCAST,
  useArrowMaterial,
  useInvisibleHitAreaMaterial,
} from './handles/handle-arrow'
export { swallowNextClick } from './handles/use-handle-drag'

// How far a DOWNWARD tracker's dashed leader pokes past its cube so the
// dashes visibly thread through it (the cube sits ON the line, not at
// its end). Upward trackers — wall / chimney height — stop at the cube.
const TRACKER_THROUGH = 0.12

// Mirrors the formatter used by wall / fence measurement labels so all
// in-world dimension chips read consistently.
function formatDimension(value: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') {
    const feet = value * 3.280_84
    const wholeFeet = Math.floor(feet)
    const inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) return `${wholeFeet + 1}'0"`
    return `${wholeFeet}'${inches}"`
  }
  return `${Number.parseFloat(value.toFixed(2))}m`
}

// In-world dimension chip rendered next to a resize arrow during hover
// or drag. Uses the same screen-space `<Html>` recipe + text-shadow
// halo as the wall measurement label so it reads at every camera angle.
function DimensionLabel({
  position,
  text,
}: {
  position: readonly [number, number, number]
  text: string
}) {
  return (
    <Html
      center
      position={position as unknown as [number, number, number]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[25, 0]}
    >
      <div
        className="whitespace-nowrap font-bold font-mono text-[13px]"
        style={{
          color: '#fafafa',
          textShadow:
            '-1.5px -1.5px 0 #0b0b0b, 1.5px -1.5px 0 #0b0b0b, -1.5px 1.5px 0 #0b0b0b, 1.5px 1.5px 0 #0b0b0b, 0 0 4px #0b0b0b',
        }}
      >
        {text}
      </div>
    </Html>
  )
}

export function NodeArrowHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const activeRotateNodeId = useDirectManipulationFeedback((state) => state.activeRotateNodeId)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useMovingNode()
  // Endpoint / curve drags reshape the selected wall or fence; hide its
  // resize arrows for the duration so they don't clutter (or get blocked
  // by) the drag's own cursor + dimension overlays. Mirrors the same guard
  // on the legacy wall handles (`WallMoveSideHandles`).
  const endpointReshape = useEndpointReshape()
  const isCurveReshape = useIsCurveReshape()

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : activeRotateNodeId
  const rawNode = useScene((state) =>
    selectedId ? (state.nodes[selectedId as AnyNodeId] ?? null) : null,
  )

  // Merge any live drag override so the arrows themselves (positions,
  // ring decorations) track the in-flight drag instead of freezing at
  // pre-drag values. Subscribe to just this node's entry so unrelated
  // override writes don't re-render the handle stack.
  const liveOverride = useLiveNodeOverrides((s) =>
    rawNode ? s.overrides.get(rawNode.id) : undefined,
  )
  const node = useMemo<AnyNode | null>(
    () => (rawNode && liveOverride ? ({ ...rawNode, ...liveOverride } as AnyNode) : rawNode),
    [rawNode, liveOverride],
  )
  const def = node ? nodeRegistry.get(node.type) : null
  const descriptors = useMemo(() => {
    if (!(node && def?.handles)) return null
    const all =
      typeof def.handles === 'function'
        ? def.handles(node as never)
        : (def.handles as HandleDescriptor[])
    // The whole-node move-cross gizmo is gone: moving is now click-to-move on
    // the selected node body (see selection-manager). Drop both flavours — the
    // `translate` ground cross (column/roof/shelf/spawn) and the `tap-action`
    // `move-cross` (item/door/window/elevator/stair) — keep rotate/resize.
    return all.filter((d) => d.kind !== 'translate' && !('shape' in d && d.shape === 'move-cross'))
  }, [node, def])

  const shouldRender =
    Boolean(node && descriptors?.length) &&
    !isFloorplanHovered &&
    mode !== 'delete' &&
    // Any whole-node move (placement or press-drag) hides the rig: the item is
    // following the cursor, so its rotate/resize handles would only clutter and
    // draw stray selection rays. The active handle-drag scope (resize/rotate)
    // sets `activeHandleDrag`, not `movingNode`, so those are unaffected.
    !movingNode &&
    !endpointReshape &&
    !isCurveReshape

  if (!shouldRender || !node || !descriptors) return null
  // Key by the selected node id so switching selection REMOUNTS the rig.
  // The portal target + ride-mesh refs are seeded from the scene registry
  // in `useState` initializers; without a remount they'd persist from the
  // previous selection and the arrows would ride the old node's world pose
  // (right local placements, wrong frame) until the resolve effect happened
  // to catch up. Remounting re-resolves both refs synchronously for the new
  // node, so the arrows land in the right place the instant it's selected.
  return <NodeArrowHandlesForNode descriptors={descriptors} key={node.id} node={node} />
}

// Resolves the portal target + ride mesh chain. Descriptor-level `portal`
// toggles between two layout patterns; descriptor placement is *always* in
// the selected node's local frame regardless of mode.
//
//  - 'parent' (default): mount inside the selected node's parent mesh.
//    The wrapper mirrors the node's own local pose, so handles live in
//    node-local coords directly. No inner group. Used by columns / walls
//    / anything where the node IS the thing the user selected and whose
//    rotation should drive the handle frame.
//  - 'grandparent': mount inside the grandparent mesh (to escape the
//    parent's selection-outline traversal). The wrapper mirrors the
//    parent mesh's local pose; a nested inner group mirrors the node's
//    own local pose. Handles end up in node-local coords. Used by doors /
//    windows — handles need to ride the wall's rotation but not be
//    children of the wall mesh.
function NodeArrowHandlesForNode({
  node,
  descriptors,
}: {
  node: AnyNode
  descriptors: HandleDescriptor[]
}) {
  const parentId = node.parentId ?? null
  const grandparentId = useScene((state) => {
    if (!parentId) return null
    const parent = state.nodes[parentId as AnyNodeId]
    return parent?.parentId ?? null
  })

  const portalMode: HandlePortal = descriptors.some((d) => d.portal === 'grandparent')
    ? 'grandparent'
    : 'parent'

  // Portal target: the mesh we createPortal into.
  const portalTargetId = portalMode === 'grandparent' ? grandparentId : parentId
  // Outer wrapper mirrors this mesh's local pose. For 'parent' mode the
  // outer IS the node (so handles + drag math both live in node-local).
  // For 'grandparent' the outer rides the parent and an inner group adds
  // the node's own pose.
  const outerRideId = portalMode === 'grandparent' ? parentId : (node.id as AnyNodeId)
  const innerRideId = portalMode === 'grandparent' ? (node.id as AnyNodeId) : null

  const [portalObject, setPortalObject] = useState<Object3D | null>(() =>
    portalTargetId ? (sceneRegistry.nodes.get(portalTargetId as AnyNodeId) ?? null) : null,
  )
  const [outerRide, setOuterRide] = useState<Object3D | null>(() =>
    outerRideId ? (sceneRegistry.nodes.get(outerRideId as AnyNodeId) ?? null) : null,
  )
  const [innerRide, setInnerRide] = useState<Object3D | null>(() =>
    innerRideId ? (sceneRegistry.nodes.get(innerRideId as AnyNodeId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const nextPortal = portalTargetId
        ? (sceneRegistry.nodes.get(portalTargetId as AnyNodeId) ?? null)
        : null
      const nextOuter = outerRideId
        ? (sceneRegistry.nodes.get(outerRideId as AnyNodeId) ?? null)
        : null
      const nextInner = innerRideId
        ? (sceneRegistry.nodes.get(innerRideId as AnyNodeId) ?? null)
        : null
      setPortalObject((cur) => (cur === nextPortal ? cur : nextPortal))
      setOuterRide((cur) => (cur === nextOuter ? cur : nextOuter))
      setInnerRide((cur) => (cur === nextInner ? cur : nextInner))
      // Inner ride is optional ('parent' mode skips it).
      const needInner = innerRideId !== null
      if (!nextPortal || !nextOuter || (needInner && !nextInner)) {
        frameId = window.requestAnimationFrame(resolve)
      }
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [portalTargetId, outerRideId, innerRideId])

  const outerRef = useRef<Group>(null)
  const innerRef = useRef<Group>(null)

  // Keep arrow objects on SCENE_LAYER so the post-processing scenePass
  // captures them in the depth/normal MRT — that's what feeds the ink-edge
  // shader, and it's the reason the wall height arrow (which also stays on
  // SCENE_LAYER) reads as a proper 3D plate with outlined edges. Putting
  // them on EDITOR_LAYER hides them from scenePass and the chevron renders
  // flat. Arrows are only mounted while a node is selected, so thumbnail
  // captures (which never have selection) don't need the layer-based
  // exclusion the wall arrow also goes without.

  useFrame(() => {
    if (innerRef.current && innerRide && portalObject) {
      // Grandparent mode: pose the rig by mapping the node's WORLD pose
      // into the portal target's frame. Copying the parent + node
      // registry poses (the previous approach) assumed the node mesh is
      // a DIRECT child of the parent's registered object — roof-hosted
      // openings break that with an intermediate face-frame group, which
      // the world-relative mapping absorbs for free. For wall children
      // the result is identical (portal⁻¹ ∘ node = wall.local ∘ node.local).
      if (outerRef.current) {
        outerRef.current.position.set(0, 0, 0)
        outerRef.current.quaternion.identity()
      }
      portalObject.updateWorldMatrix(true, false)
      innerRide.updateWorldMatrix(true, false)
      _rigRelative.copy(portalObject.matrixWorld).invert().multiply(innerRide.matrixWorld)
      _rigRelative.decompose(
        innerRef.current.position,
        innerRef.current.quaternion,
        _rigScratchScale,
      )
      return
    }
    if (outerRef.current && outerRide) {
      outerRef.current.position.copy(outerRide.position)
      outerRef.current.quaternion.copy(outerRide.quaternion)
    }
  })

  // Active-drag tracking. When a handle starts dragging, it claims its
  // descriptor index here and snapshots the store node at drag-start.
  // Non-active arrows re-render against the snapshot + a freeze offset
  // that undoes the mesh's `position` drift in node-local frame — so
  // asymmetric resize (width L/R, length L/R) doesn't visually slide the
  // depth / height / rotate chevrons. They stay anchored at their
  // pre-drag world positions for the duration of the drag.
  //
  // Hooks must sit ABOVE the early-return guard below — the registry-
  // resolve `useEffect` flips `portalObject` from null → object after
  // the first frame, so a guard between two hooks would change the
  // hook count between renders and trip React's rules-of-hooks check.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [preDragNode, setPreDragNode] = useState<AnyNode | null>(null)
  // Latch groups currently toggled open. A `latch` cube descriptor flips its
  // group here on click; arrows tagged with a `latchGroup` only render while
  // their group is in this set. Local to this mount, so it resets on deselect
  // (the rig remounts per selection — see the `key` on NodeArrowHandlesForNode).
  const [openLatchGroups, setOpenLatchGroups] = useState<ReadonlySet<string>>(() => new Set())
  const toggleLatchGroup = useMemo(
    () => (group: string) =>
      setOpenLatchGroups((prev) => {
        const next = new Set(prev)
        if (next.has(group)) next.delete(group)
        else next.add(group)
        return next
      }),
    [],
  )
  const dragControls = useMemo<HandleDragControls>(
    () => ({
      onStart: (index: number, snapshot: AnyNode) => {
        setActiveIndex(index)
        setPreDragNode(snapshot)
      },
      onEnd: () => {
        setActiveIndex(null)
        setPreDragNode(null)
      },
    }),
    [],
  )

  if (!portalObject || !outerRide || (innerRideId !== null && !innerRide)) return null

  // `arrowFrame` is the Object3D used as the spatial reference for the
  // per-arrow drag math — its world matrix maps node-local coords to
  // world. In 'parent' mode that's the outer ride (= the node mesh
  // itself). In 'grandparent' mode it's the inner ride (= the node mesh)
  // because the inner group mirrors the node's local pose under the
  // wall-riding outer wrapper.
  const arrowFrame = innerRide ?? outerRide

  // A translate drag moves `position`, so the whole handle rig should travel
  // with the mesh — the freeze-at-pre-drag mechanism (built for asymmetric
  // resize that re-centres the mesh) must NOT fire for the non-active arrows
  // here, or they'd lag behind the moving item.
  const activeIsTranslate = activeIndex !== null && descriptors[activeIndex]?.kind === 'translate'
  // While a rotate gizmo is mid-drag, drop the opposite-side move cross: you
  // can't move and rotate at once, so it only clutters the rotation.
  const activeDescriptor = activeIndex !== null ? descriptors[activeIndex] : undefined
  const activeIsRotate =
    !!activeDescriptor && 'shape' in activeDescriptor && activeDescriptor.shape === 'rotate'

  const arrows = descriptors.map((descriptor, index) => {
    if (activeIsRotate && 'shape' in descriptor && descriptor.shape === 'move-cross') return null
    // A `latch` cube toggles its group's visibility; render it always.
    if (descriptor.kind === 'latch') {
      return (
        <LatchCube
          descriptor={descriptor}
          key={index}
          node={node}
          onToggle={toggleLatchGroup}
          open={openLatchGroups.has(descriptor.group)}
        />
      )
    }
    // Arrows tagged with a latch group stay hidden until that group is open.
    const latchGroup = descriptor.kind === 'linear-resize' ? descriptor.latchGroup : undefined
    if (latchGroup && !openLatchGroups.has(latchGroup)) return null
    return (
      <ArrowHandle
        activeIndex={activeIndex}
        descriptor={descriptor}
        dragControls={dragControls}
        handleIndex={index}
        // Descriptors come from a per-node-kind static list, so index is a
        // stable identity within this node's selection cycle.
        key={index}
        liveNode={node}
        preDragNode={preDragNode}
        rideObject={arrowFrame}
        suppressFreeze={activeIsTranslate}
      />
    )
  })

  return createPortal(
    <group ref={outerRef}>
      {innerRideId !== null ? <group ref={innerRef}>{arrows}</group> : arrows}
    </group>,
    portalObject,
  )
}

// Offset, in node-local frame, that compensates for `position` drift on
// the mesh during an asymmetric resize. Width/length L+R recompute
// `position` so the anchored edge stays world-fixed — the renderer
// follows that override, the ride object moves, and every arrow under
// it would drift along with the mesh center. Subtracting this offset
// from a non-active arrow's local placement undoes that drift so it
// stays at its pre-drag world position.
//
// Rotation drags don't change `position`, so the offset collapses to
// zero and non-active arrows naturally rotate with the mesh — which is
// the desired behaviour (the whole rig rotates as a unit).
function computeFreezeOffset(liveNode: AnyNode, preDragNode: AnyNode): [number, number, number] {
  // Not every node in the union carries a `position` field (sites are the
  // notable holdout — they don't have handles anyway, but TypeScript still
  // requires us to discriminate). Guarded access keeps the freeze logic
  // safe for the few node kinds that lack the field.
  const liveP = (liveNode as { position?: readonly [number, number, number] }).position ?? [0, 0, 0]
  const preP = (preDragNode as { position?: readonly [number, number, number] }).position ?? [
    0, 0, 0,
  ]
  const deltaWorldX = liveP[0] - preP[0]
  const deltaWorldY = liveP[1] - preP[1]
  const deltaWorldZ = liveP[2] - preP[2]
  const rotY = (preDragNode as { rotation?: number }).rotation ?? 0
  // World → node-local for Y-axis rotation by rotY (THREE.Object3D
  // rotation-y convention): inverse is rotation by -rotY around +Y.
  const cosR = Math.cos(rotY)
  const sinR = Math.sin(rotY)
  const deltaLocalX = cosR * deltaWorldX - sinR * deltaWorldZ
  const deltaLocalZ = sinR * deltaWorldX + cosR * deltaWorldZ
  return [deltaLocalX, deltaWorldY, deltaLocalZ]
}

function ArrowHandle({
  descriptor,
  liveNode,
  preDragNode,
  activeIndex,
  handleIndex,
  dragControls,
  rideObject,
  suppressFreeze,
}: {
  descriptor: HandleDescriptor
  liveNode: AnyNode
  preDragNode: AnyNode | null
  activeIndex: number | null
  handleIndex: number
  dragControls: HandleDragControls
  rideObject: Object3D
  /** When the active drag is a translate, non-active arrows ride the moving
   *  mesh instead of freezing at their pre-drag world position. */
  suppressFreeze?: boolean
}) {
  // During a drag, non-active arrows render against the pre-drag store
  // snapshot. The active arrow always uses the live (override-merged)
  // node so it tracks the cursor.
  const isOtherActive = activeIndex !== null && activeIndex !== handleIndex && preDragNode !== null
  const placementNode = isOtherActive ? (preDragNode as AnyNode) : liveNode
  const freezeOffset =
    isOtherActive && preDragNode && !suppressFreeze
      ? computeFreezeOffset(liveNode, preDragNode)
      : null

  if (descriptor.kind === 'linear-resize' || descriptor.kind === 'radial-resize') {
    return (
      <LinearArrow
        descriptor={descriptor}
        dragControls={dragControls}
        freezeOffset={freezeOffset}
        handleIndex={handleIndex}
        liveNode={liveNode}
        node={placementNode}
        rideObject={rideObject}
      />
    )
  }
  if (descriptor.kind === 'arc-resize') {
    return (
      <ArcArrow
        descriptor={descriptor}
        dragControls={dragControls}
        freezeOffset={freezeOffset}
        handleIndex={handleIndex}
        liveNode={liveNode}
        node={placementNode}
        rideObject={rideObject}
      />
    )
  }
  if (descriptor.kind === 'tap-action') {
    // Tap-action handles (fence side-move arrows, corner pickers) aren't
    // resize handles, so the freeze-at-pre-drag mechanism — which only
    // exists to stop arrows sliding when an asymmetric width/length resize
    // re-centers the mesh — doesn't apply to them. Track the live node so
    // their height-dependent placement (side arrows ride the top, corner
    // leaders span the full height) follows a height drag in real time.
    return <TapActionArrow descriptor={descriptor} node={liveNode} />
  }
  // endpoint-move not yet implemented.
  return null
}

function pickCursor(descriptor: LinearResizeHandle<AnyNode> | RadialResizeHandle<AnyNode>): Cursor {
  if (descriptor.kind === 'linear-resize' && descriptor.cursor) return descriptor.cursor
  return descriptor.axis === 'y' ? 'ns-resize' : 'ew-resize'
}

function resolveBound(
  bound:
    | number
    | ((node: AnyNode, sceneApi: ReturnType<typeof createSceneApi>) => number)
    | undefined,
  fallback: number,
  node: AnyNode,
  sceneApi: ReturnType<typeof createSceneApi>,
): number {
  if (bound === undefined) return fallback
  return typeof bound === 'function' ? bound(node, sceneApi) : bound
}

function LinearArrow({
  descriptor,
  node,
  liveNode,
  freezeOffset,
  handleIndex,
  dragControls,
  rideObject,
}: {
  descriptor: LinearResizeHandle<AnyNode> | RadialResizeHandle<AnyNode>
  /** Effective node for placement (preDrag snapshot when another arrow is active). */
  node: AnyNode
  /** Always the live (override-merged) node — used inside drag handlers. */
  liveNode: AnyNode
  /** Node-local offset that undoes the mesh's `position` drift; null when not frozen. */
  freezeOffset: [number, number, number] | null
  handleIndex: number
  dragControls: HandleDragControls
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE
  const unit = useViewer((s) => s.unit)

  // Suppress "declared but unused" for `liveNode` — LinearArrow's apply
  // operates on `initialNode` (snapshot inside activate) and reads value
  // updates back via `useLiveNodeOverrides`. The prop is required for
  // uniformity with ArrowHandle's variant dispatch but isn't consumed in
  // this variant's render path.
  void liveNode

  const cursor = pickCursor(descriptor)
  // When a handle declares `measureLabel`, its readout is routed to the
  // floating dimension pill (via `activeHandleDrag`) and its own in-world
  // chip is suppressed — matches the wall height handle.
  const measureLabel = descriptor.kind === 'linear-resize' ? descriptor.measureLabel : undefined
  // Optional per-tick feedback hook (doors/windows publish proximity/sill guides
  // for the edge being resized); cleared when the drag ends.
  const onDrag = descriptor.kind === 'linear-resize' ? descriptor.onDrag : undefined
  const placementSceneApi = useMemo(() => createSceneApi(useScene), [])
  const basePosition = descriptor.placement.position(node, placementSceneApi)
  // `freezeOffset` (in node-local frame) cancels the mesh's `position`
  // drift while another arrow is being dragged — `basePosition` is
  // computed against the pre-drag snapshot, then we subtract the offset
  // so the arrow's WORLD location matches its pre-drag world location.
  // Active arrows + idle state have `freezeOffset === null`, so the
  // position passes through unchanged.
  const position: [number, number, number] = freezeOffset
    ? [
        basePosition[0] - freezeOffset[0],
        basePosition[1] - freezeOffset[1],
        basePosition[2] - freezeOffset[2],
      ]
    : [basePosition[0], basePosition[1], basePosition[2]]
  const baseRotationY = descriptor.placement.rotationY?.(node, placementSceneApi) ?? 0
  // Default chevron points +X. Rotate around Y to face the chosen axis.
  const axisRotationY = descriptor.axis === 'z' ? -Math.PI / 2 : 0
  // For axis === 'y' we orient the chevron up. Z-rotation by π/2 then
  // Y-rotation chains via the parent <group> below.
  const rotationY = baseRotationY + axisRotationY

  const activate = useHandleDrag({
    kind: 'drag',
    cursor,
    dragControls,
    handleIndex,
    node,
    rideObject,
    setIsDragging,
    onStart: ({
      event,
      getPointerRay,
      initialNode,
      nodeId,
      rideObject: dragRideObject,
      sceneApi,
    }) => {
      dragRideObject.matrixWorld.decompose(_resizePositionW, _resizeQuaternion, _resizeScale)
      _resizeOriginW.set(...position).applyMatrix4(dragRideObject.matrixWorld)
      axisVector(descriptor.axis, _resizeAxisW).applyQuaternion(_resizeQuaternion).normalize()
      const localToWorldScale = axisScale(descriptor.axis, _resizeScale)
      if (Math.abs(localToWorldScale) < 1e-6 || _resizeAxisW.lengthSq() === 0) return null

      const initialPointer =
        closestAxisParameterToRay(
          _resizeOriginW,
          _resizeAxisW,
          getPointerRay(event.nativeEvent.clientX, event.nativeEvent.clientY, _resizeRay),
        ) / localToWorldScale

      const overrideId =
        (descriptor.kind === 'linear-resize'
          ? descriptor.overrideTarget?.(initialNode as never, sceneApi)
          : undefined) ?? nodeId
      const initialValue = descriptor.currentValue(initialNode)
      const minBound = resolveBound(descriptor.min, Number.NEGATIVE_INFINITY, initialNode, sceneApi)
      const maxBound = resolveBound(descriptor.max, Number.POSITIVE_INFINITY, initialNode, sceneApi)
      const gridSnapStep =
        descriptor.kind === 'linear-resize' && descriptor.gridSnap
          ? useEditor.getState().gridSnapStep
          : null
      const factor =
        descriptor.kind === 'radial-resize'
          ? 1
          : descriptor.anchor === 'center'
            ? 2
            : descriptor.anchor === 'min'
              ? 1
              : -1

      // Last value an emitted resize tick fired at — a new tick fires only
      // when the (snapped + clamped) value actually changes, so the cue
      // tracks real size steps instead of every sub-pixel pointer jitter.
      let lastTickValue = initialValue

      return {
        overrideId,
        onBegin: () => {
          // Always claim the handle-drag scope so the HUD knows a resize is the
          // active interaction (keeps the idle select hints off-screen). The
          // dimension-pill handles carry their `measureLabel`; plain resize
          // arrows use the generic label.
          useInteractionScope.getState().begin({
            kind: 'handle-drag',
            nodeId,
            handle: measureLabel ?? RESIZE_HANDLE_DRAG_LABEL,
          })
        },
        onEnd: () => {
          useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
          if (onDrag) useOpeningGuides.getState().clear()
        },
        move: ({ event: moveEvent, getPointerRay: getMovePointerRay }) => {
          const currentPointer =
            closestAxisParameterToRay(
              _resizeOriginW,
              _resizeAxisW,
              getMovePointerRay(moveEvent.clientX, moveEvent.clientY, _resizeRay),
            ) / localToWorldScale
          const delta = currentPointer - initialPointer
          const rawNext = initialValue + delta * factor
          const snappedNext =
            !moveEvent.shiftKey && gridSnapStep && gridSnapStep > 0
              ? snapScalar(rawNext, gridSnapStep)
              : rawNext
          const next = Math.min(maxBound, Math.max(minBound, snappedNext))
          if (next !== lastTickValue) {
            lastTickValue = next
            sfxEmitter.emit('sfx:resize')
          }
          const patch = descriptor.apply(initialNode as never, next, sceneApi) as Partial<AnyNode>
          // Let the kind publish live guides for the edge being resized.
          onDrag?.({ ...(initialNode as object), ...patch } as AnyNode, sceneApi)
          return patch
        },
      }
    },
  })

  // For axis === 'y' (vertical handles), tilt the chevron up via local
  // X+Z rotation chain matching DoorHeightArrowHandle. When the handle
  // sits below the node (placement Y < 0, e.g. window bottom arrow),
  // flip the Z rotation so the chevron points outward (downward).
  //
  // For axis === 'x' with `faceNormal` (wall-mounted opening width arrows),
  // roll the blade 90° about its own pointing (X) axis so it stands up from
  // the horizontal XZ plane into the node's facing plane (XY = the wall
  // face) — otherwise the blade is seen edge-on from the front.
  const faceNormalX =
    descriptor.kind === 'linear-resize' && descriptor.axis === 'x' && descriptor.faceNormal === true
  const innerRotation: [number, number, number] =
    descriptor.axis === 'y'
      ? [0, Math.PI / 2, position[1] < 0 ? -Math.PI / 2 : Math.PI / 2]
      : faceNormalX
        ? [Math.PI / 2, 0, 0]
        : [0, 0, 0]

  // Optional guide decoration — linear handles use it for curved-stair
  // width / inner-radius rings; radial handles use it for the column's
  // round footprint ring.
  const decoration = descriptor.decoration
  const showDecoration = Boolean(decoration) && (isHovered || isDragging)

  // Dimension chip — shows the live value the drag is steering. `node`
  // is already the effective (override-merged) node, so currentValue
  // returns the in-flight value during a drag and the label tracks
  // smoothly without an extra subscription.
  // `measureLabel` handles route their readout to the floating dimension
  // pill, so suppress the inline chip here to avoid showing it twice.
  const showLabel = (isHovered || isDragging) && !measureLabel
  const labelText = showLabel ? formatDimension(descriptor.currentValue(node), unit) : ''

  // `tracker` shape on a linear-resize handle: render a dashed vertical
  // leader from the floor up to a small cube at `placement.position`. The
  // cube is the drag target and reuses the same `activate` pointer handler
  // as the chevron path, so all the override/commit plumbing is unchanged.
  // Only valid for axis='y' resize handles — the leader is rendered at
  // (0,0,0)→(0,position.y,0) in the same group as the cube, so for x/z
  // axes the leader would still climb vertically and look wrong.
  const shape =
    descriptor.kind === 'linear-resize' && descriptor.shape === 'tracker' ? 'tracker' : 'arrow'

  if (shape === 'tracker') {
    // Descriptors can pin the leader's bottom Y above the floor — e.g.
    // chimney body height starts at the deck plane, not at y=0, so the
    // dashed leader spans only the body's visible extent.
    const trackerDescriptor = descriptor as LinearResizeHandle<AnyNode>
    const baseY = trackerDescriptor.trackerBaseY?.(node as never, placementSceneApi) ?? 0
    // Leader spans base ↔ cube either direction. Upward (cube above base:
    // wall / chimney height) it stops at the cube as before. Downward
    // (cube below base: a downspout's length cube under the gutter
    // outlet) it pokes `TRACKER_THROUGH` past the cube so the dashes
    // thread through it instead of the leader collapsing to nothing.
    const cubeY = position[1]
    const cubeBelowBase = cubeY < baseY
    const leaderBottomY = Math.min(baseY, cubeY) - (cubeBelowBase ? TRACKER_THROUGH : 0)
    const leaderHeight = Math.max(Math.max(baseY, cubeY) - leaderBottomY, 0)
    return (
      <>
        {showDecoration && decoration ? (
          <GuideRing
            radius={decoration.radius(node as never)}
            y={decoration.y?.(node as never) ?? 0}
          />
        ) : null}
        {showLabel ? (
          <DimensionLabel
            position={[position[0], position[1] + 0.22, position[2]]}
            text={labelText}
          />
        ) : null}
        <TrackerShape
          basePosition={[position[0], leaderBottomY, position[2]]}
          baseScale={zoom}
          cubePosition={position}
          cursor={cursor}
          hover={isHovered}
          leaderHeight={leaderHeight}
          onHoverChange={setIsHovered}
          onPointerDown={activate}
        />
      </>
    )
  }

  return (
    <>
      {showDecoration && decoration ? (
        <GuideRing
          radius={decoration.radius(node as never)}
          y={decoration.y?.(node as never) ?? 0}
        />
      ) : null}
      <HandleArrow
        cursor={cursor}
        hover={isHovered}
        indicatorRotation={innerRotation}
        onHoverChange={setIsHovered}
        onPointerDown={activate}
        placement={{ position, rotation: [0, rotationY, 0], baseScale }}
        shape="chevron"
        thin
      >
        {showLabel ? <DimensionLabel position={[0, 0.22, 0]} text={labelText} /> : null}
      </HandleArrow>
    </>
  )
}

// Thin horizontal ring used as a visual guide alongside a resize arrow —
// e.g. the curved-stair width arrow traces the outer rim, the inner-radius
// arrow traces the central pillar. Floats at node-local `y`, lies in the
// XZ plane.
export function GuideRing({ radius, y }: { radius: number; y: number }) {
  const safeRadius = Math.max(radius, 0.01)
  const ringGeometry = useMemo(() => {
    const inner = Math.max(safeRadius - 0.015, 0.001)
    const outer = safeRadius + 0.015
    return new RingGeometry(inner, outer, 96)
  }, [safeRadius])
  const ringMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
  useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

  return (
    <mesh
      frustumCulled={false}
      geometry={ringGeometry}
      material={ringMaterial}
      position={[0, y, 0]}
      renderOrder={1009}
      rotation={[-Math.PI / 2, 0, 0]}
    />
  )
}

const ROTATION_GUIDE_COLOR = ARROW_COLOR
const ROTATION_GUIDE_SEGMENTS = 48

// Live rotation readout shown while a whole-node rotate gizmo is dragged.
// Mirrors the wall-draft angle arc: a filled wedge + outline swept from the
// pointer's bearing at grab (`startAngle`) to its current bearing
// (`endAngle`) around the rotation pivot, plus a degree chip at the wedge's
// midpoint. All coordinates are world-space — the guide is portalled to the
// scene root so it stays fixed while the node mesh rotates underneath it.
export type RotationGuideData = {
  center: [number, number, number]
  startAngle: number
  endAngle: number
  radius: number
  labelPos: [number, number, number]
  /** Swept magnitude in radians, for the degree chip. */
  sweep: number
}

export function RotationGuide({ data }: { data: RotationGuideData }) {
  const { center, startAngle, endAngle, radius, labelPos, sweep } = data
  const { outline, fill } = useMemo(() => {
    const span = endAngle - startAngle
    const count = Math.max(8, Math.ceil((Math.abs(span) / Math.PI) * ROTATION_GUIDE_SEGMENTS))
    const arc = Array.from({ length: count + 1 }, (_, index) => {
      const angle = startAngle + (span * index) / count
      return new Vector3(
        center[0] + Math.cos(angle) * radius,
        center[1],
        center[2] + Math.sin(angle) * radius,
      )
    })
    const centerV = new Vector3(center[0], center[1], center[2])
    const outlineGeo = new BufferGeometry().setFromPoints([centerV, ...arc, centerV])
    const positions: number[] = []
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i]
      const b = arc[i + 1]
      if (!a || !b) continue
      positions.push(centerV.x, centerV.y, centerV.z, a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const fillGeo = new BufferGeometry()
    fillGeo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return { outline: outlineGeo, fill: fillGeo }
  }, [center, startAngle, endAngle, radius])
  useEffect(() => () => outline.dispose(), [outline])
  useEffect(() => () => fill.dispose(), [fill])

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={fill}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        renderOrder={1008}
      >
        <meshBasicMaterial
          color={ROTATION_GUIDE_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.18}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <RotationGuideOutline geometry={outline} />
      <DimensionLabel position={labelPos} text={formatAngleRadians(sweep)} />
    </>
  )
}

function RotationGuideOutline({ geometry }: { geometry: BufferGeometry }) {
  return (
    // @ts-expect-error - R3F accepts Three line primitives, matching the wall draft arc.
    <line frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={1009}>
      <lineBasicNodeMaterial
        color={ROTATION_GUIDE_COLOR}
        depthTest={false}
        depthWrite={false}
        linewidth={2}
        opacity={0.95}
        transparent
      />
    </line>
  )
}

// Live whole-node rotation readout for a single-node rotate gizmo, rendered as
// a CHILD of the node frame (sibling of its guide ring). Because it lives in
// the node's own frame, it is automatically concentric and coplanar with the
// ring — on flat ground the frame's XZ is world-horizontal, on a pitched roof
// it follows the slope, with no world-space basis math.
//
// The wedge fills the node-local XZ plane at the ring's height `y`. Its leading
// edge sits at the rotate handle's bearing `handleAngle` (which is fixed in the
// node frame, so it tracks the orbiting handle), and it opens BACKWARD by the
// swept `delta` — so the trailing edge stays pinned to the grab direction in
// world while the node spins. `orbitRadius` is the handle's in-plane distance
// from the pivot; the fill is pulled inside it so it reads as the handle
// swinging around rather than overlapping the icon.
function RotationWedge({
  delta,
  handleAngle,
  orbitRadius,
  y,
}: {
  delta: number
  handleAngle: number
  orbitRadius: number
  y: number
}) {
  const radius = Math.min(Math.max(orbitRadius * 0.72, 0.3), 1.6)
  const { outline, fill } = useMemo(() => {
    const start = handleAngle - delta
    const span = delta
    const count = Math.max(8, Math.ceil((Math.abs(span) / Math.PI) * ROTATION_GUIDE_SEGMENTS))
    const arc = Array.from({ length: count + 1 }, (_, index) => {
      const angle = start + (span * index) / count
      return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    })
    const centerV = new Vector3(0, 0, 0)
    const outlineGeo = new BufferGeometry().setFromPoints([centerV, ...arc, centerV])
    const positions: number[] = []
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i]
      const b = arc[i + 1]
      if (!a || !b) continue
      positions.push(0, 0, 0, a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const fillGeo = new BufferGeometry()
    fillGeo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return { outline: outlineGeo, fill: fillGeo }
  }, [delta, handleAngle, radius])
  useEffect(() => () => outline.dispose(), [outline])
  useEffect(() => () => fill.dispose(), [fill])

  const labelRadius = radius + 0.22
  const midAngle = handleAngle - delta / 2
  const labelPos: [number, number, number] = [
    Math.cos(midAngle) * labelRadius,
    0,
    Math.sin(midAngle) * labelRadius,
  ]

  return (
    <group position={[0, y, 0]}>
      <mesh
        frustumCulled={false}
        geometry={fill}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        renderOrder={1008}
      >
        <meshBasicMaterial
          color={ROTATION_GUIDE_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.18}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <RotationGuideOutline geometry={outline} />
      <DimensionLabel position={labelPos} text={formatAngleRadians(Math.abs(delta))} />
    </group>
  )
}

// Angular drag: project pointer to a horizontal plane at the arrow's Y
// and measure the signed angle around the node's local origin (in world
// XZ). Pass the normalised delta to `apply` — the descriptor owns the
// per-field math (sweep handles write `sweepAngle` AND `rotation` from
// the same delta to keep the opposite edge world-fixed).
function ArcArrow({
  descriptor,
  node,
  liveNode,
  freezeOffset,
  handleIndex,
  dragControls,
  rideObject,
}: {
  descriptor: ArcResizeHandle<AnyNode>
  /** Effective node for placement (preDrag snapshot when another arrow is active). */
  node: AnyNode
  /** Always the live (override-merged) node — used inside drag handlers. */
  liveNode: AnyNode
  /** Node-local offset that undoes the mesh's `position` drift; null when not frozen. */
  freezeOffset: [number, number, number] | null
  handleIndex: number
  dragControls: HandleDragControls
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  // 'rotate' descriptors (whole-node rotation handles like the elevator
  // corner) render a two-headed curved arrow; everything else (stair
  // sweep, etc.) keeps the chevron.
  const isRotateShape = descriptor.shape === 'rotate'
  const activeRotateNodeId = useDirectManipulationFeedback((state) => state.activeRotateNodeId)
  const isDirectRotating = isRotateShape && activeRotateNodeId === liveNode.id
  // 'node-normal' spins the node about its local +Z (a wall item flat against
  // its wall) instead of yaw about world-Y. The drag plane and the icon both
  // tilt into that plane, and the horizontal-only wedge/ring readout is
  // suppressed.
  const isNodeNormalRot = descriptor.rotationPlane === 'node-normal'
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  // The rotate icon is denser than the chevron; pump scale a touch so the
  // ribbon reads at the same on-screen size as the other handles.
  const arrowScale = isRotateShape ? ARROW_SCALE * 1.05 : ARROW_SCALE
  const baseScale = zoom * arrowScale
  // Live rotation amount (radians swept since grab) — non-null only while a
  // `shape: 'rotate'` gizmo is mid-drag. Drives the in-frame wedge readout.
  const [rotationDelta, setRotationDelta] = useState<number | null>(null)

  const placementSceneApi = useMemo(() => createSceneApi(useScene), [])
  const basePosition = descriptor.placement.position(node, placementSceneApi)
  // See the LinearArrow note on freezeOffset — for rotation drags the
  // delta collapses to zero (position doesn't change), so the rotate
  // gizmo naturally rotates with the mesh while another arrow is being
  // dragged. The offset only kicks in for asymmetric resize drags that
  // recompute `position` to anchor the opposite edge.
  const position: [number, number, number] = freezeOffset
    ? [
        basePosition[0] - freezeOffset[0],
        basePosition[1] - freezeOffset[1],
        basePosition[2] - freezeOffset[2],
      ]
    : [basePosition[0], basePosition[1], basePosition[2]]
  const rotationY = descriptor.placement.rotationY?.(node, placementSceneApi) ?? 0
  // Rotation gizmo: hover signals "grabbable", active drag signals
  // "grabbed". `ew-resize` was wrong — it implies linear width drag.
  const hoverCursor: Cursor = 'grab'
  const dragCursor: Cursor = 'grabbing'

  // Optional guide ring (elevator rotation circle) shown while the arc
  // arrow is hovered or dragging. Same recipe as the linear / radial
  // decoration path.
  const decoration = descriptor.decoration
  const showDecoration = Boolean(decoration) && (isHovered || isDragging || isDirectRotating)

  const activate = useHandleDrag({
    kind: 'drag',
    cursor: dragCursor,
    dragControls,
    handleIndex,
    node,
    rideObject,
    setIsDragging,
    onStart: ({ event, initialNode, intersectPlane, rideObject: dragRideObject, sceneApi }) => {
      const centerWorld =
        descriptor.rotationCenter !== undefined
          ? new Vector3(...descriptor.rotationCenter(node as never, sceneApi)).applyMatrix4(
              dragRideObject.matrixWorld,
            )
          : new Vector3().setFromMatrixPosition(dragRideObject.matrixWorld)
      const arrowWorld = new Vector3(...position).applyMatrix4(dragRideObject.matrixWorld)
      const planeY = arrowWorld.y
      const axis = isNodeNormalRot
        ? new Vector3().setFromMatrixColumn(dragRideObject.matrixWorld, 2).normalize()
        : new Vector3(0, 1, 0)
      const plane = isNodeNormalRot
        ? new Plane().setFromNormalAndCoplanarPoint(axis, centerWorld)
        : new Plane(new Vector3(0, 1, 0), -planeY)

      let basisU: Vector3
      if (isNodeNormalRot) {
        const up = new Vector3(0, 1, 0)
        basisU = up.clone().addScaledVector(axis, -up.dot(axis))
        if (basisU.lengthSq() < 1e-6) {
          const x = new Vector3(1, 0, 0)
          basisU = x.addScaledVector(axis, -x.dot(axis))
        }
        basisU.normalize()
      } else {
        basisU = new Vector3(1, 0, 0)
      }
      const basisV = isNodeNormalRot
        ? new Vector3().crossVectors(axis, basisU).normalize()
        : new Vector3(0, 0, 1)
      const angleOf = (p: Vector3) => {
        const d = new Vector3().subVectors(p, centerWorld)
        return Math.atan2(d.dot(basisV), d.dot(basisU))
      }

      const hitWorld = new Vector3()
      if (!intersectPlane(event.nativeEvent.clientX, event.nativeEvent.clientY, plane, hitWorld)) {
        return null
      }
      const initialAngle = angleOf(hitWorld)

      // Advertise the rotate interaction so the contextual HUD can surface the
      // Shift = free-rotation toggle (the angle-step bypass below). Resize
      // handles route a measurement label here; rotate gets a sentinel label so
      // the HUD shows the rotate hint, not a dimension pill.
      if (isRotateShape) {
        useInteractionScope
          .getState()
          .begin({ kind: 'handle-drag', nodeId: node.id, handle: ROTATE_HANDLE_DRAG_LABEL })
      }

      return {
        onEnd: () => {
          setRotationDelta(null)
          if (isRotateShape) {
            useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
          }
        },
        move: ({ event: moveEvent, intersectPlane: intersectMovePlane }) => {
          const hit = new Vector3()
          if (!intersectMovePlane(moveEvent.clientX, moveEvent.clientY, plane, hit)) return null
          const currentAngle = angleOf(hit)
          let delta = currentAngle - initialAngle
          while (delta > Math.PI) delta -= 2 * Math.PI
          while (delta < -Math.PI) delta += 2 * Math.PI

          if (!moveEvent.shiftKey && descriptor.shape === 'rotate') {
            delta = Math.round(delta / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP
          }

          if (isRotateShape && !isNodeNormalRot) {
            setRotationDelta(Math.abs(delta) < 0.0087 ? null : delta)
          }
          return descriptor.apply(initialNode as never, delta, sceneApi) as Partial<AnyNode>
        },
      }
    },
  })

  return (
    <>
      {showDecoration && decoration ? (
        <GuideRing
          radius={decoration.radius(node as never)}
          y={decoration.y?.(node as never) ?? 0}
        />
      ) : null}
      {/* Live rotation readout. Rendered HERE (a child of the node frame, the
          same frame the guide ring lives in) rather than portalled to world
          space, so the wedge is automatically concentric and coplanar with the
          ring on any surface — flat ground or a pitched roof. */}
      {rotationDelta !== null ? (
        <RotationWedge
          delta={rotationDelta}
          handleAngle={Math.atan2(position[2], position[0])}
          orbitRadius={Math.hypot(position[0], position[2])}
          y={decoration?.y?.(node as never) ?? 0}
        />
      ) : null}
      <HandleArrow
        activeCursor={dragCursor}
        cursor={hoverCursor}
        hover={isHovered || isDirectRotating}
        onHoverChange={setIsHovered}
        onPointerDown={activate}
        placement={{
          position,
          // The curved arrow is built flat in XZ. For a wall-normal spin, tilt
          // it up about X so it lies in the item-local XY plane (the wall face).
          rotation: isNodeNormalRot ? [Math.PI / 2, 0, rotationY] : [0, rotationY, 0],
          baseScale,
        }}
        shape={isRotateShape ? 'curved-arrow' : 'chevron'}
        thin
      />
    </>
  )
}

// Click-to-engage affordance — no drag plumbing, just a click target. The
// descriptor's `onActivate` receives sceneApi + editorApi so it can engage
// move tools, endpoint drags, or any other editor-state transition without
// importing editor internals from the node-def layer.
function TapActionArrow({
  descriptor,
  node,
}: {
  descriptor: TapActionHandle<AnyNode>
  node: AnyNode
}) {
  const [isHovered, setIsHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1

  const placementSceneApi = useMemo(() => createSceneApi(useScene), [])
  const position = descriptor.placement.position(node, placementSceneApi)
  const rotationY = descriptor.placement.rotationY?.(node, placementSceneApi) ?? 0
  const shape = descriptor.shape ?? 'arrow'
  const cursor: Cursor = descriptor.cursor ?? (shape === 'corner-picker' ? 'move' : 'ew-resize')
  const round = descriptor.round ?? false

  const onActivate = useHandleDrag({
    kind: 'tap',
    onTap: () => {
      setIsHovered(false)
      descriptor.onActivate(node as never, createSceneApi(useScene), createEditorApi())
    },
  })

  if (shape === 'corner-picker') {
    const height = descriptor.nodeHeight?.(node) ?? 1
    return (
      <CornerPickerShape
        baseScale={zoom}
        cursor={cursor}
        height={height}
        hover={isHovered}
        onHoverChange={setIsHovered}
        onPointerDown={onActivate}
        position={position}
        round={round}
      />
    )
  }

  const baseScale = zoom * ARROW_SCALE
  // A `move-cross` with `plane: 'node-normal'` stands up into the node's facing
  // plane (a wall face) like the door / window / wall-item move grips; other
  // tap-actions keep their in-plane `rotationY`.
  const rotation: [number, number, number] =
    descriptor.plane === 'node-normal' ? NODE_NORMAL_TILT : [0, rotationY, 0]
  return (
    <HandleArrow
      cursor={cursor}
      hover={isHovered}
      onHoverChange={setIsHovered}
      onPointerDown={onActivate}
      placement={{ position, rotation, baseScale }}
      shape={shape === 'move-cross' ? 'move-cross' : 'chevron'}
      thin
    />
  )
}

// Click-to-latch cube. A persistent grip (the `tracker` cube) that toggles
// the visibility of every arrow tagged with its `latchGroup` on click. Sized
// to match the duct selection cube (`baseScale = zoom`, full TRACKER_CUBE_SIZE)
// so every latch grip reads the same across the app. Stays highlighted while
// its group is open so the user can tell it's engaged.
function LatchCube({
  descriptor,
  node,
  open,
  onToggle,
}: {
  descriptor: LatchHandle<AnyNode>
  node: AnyNode
  open: boolean
  onToggle: (group: string) => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom

  const placementSceneApi = useMemo(() => createSceneApi(useScene), [])
  const position = descriptor.placement.position(node, placementSceneApi)
  const rotationY = descriptor.placement.rotationY?.(node, placementSceneApi) ?? 0

  // Route through the shared tap path so the cube click is swallowed before it
  // reaches the select tool — stops R3F propagation, suppresses box-select, and
  // eats the trailing DOM click that would otherwise select the host node.
  const onPointerDown = useHandleDrag({
    kind: 'tap',
    onTap: () => {
      setIsHovered(false)
      onToggle(descriptor.group)
    },
  })

  return (
    <HandleArrow
      cursor="grab"
      hover={isHovered || open}
      hoverScale={1.15}
      onHoverChange={setIsHovered}
      onPointerDown={onPointerDown}
      placement={{ position, rotation: [0, rotationY, 0], baseScale }}
      shape="tracker"
    />
  )
}

// Wall corner-picker visual: dashed vertical leader from floor up to
// `height` + billboarded hex disc (the click target) + outer ring. The
// hex disc is the only mesh with a pointer-down handler; the dashes and
// ring are decorative.
const CORNER_DASH_SIZE = 0.1
const CORNER_GAP_SIZE = 0.07
const CORNER_DASH_THICKNESS = 0.006
const CORNER_FLOOR_OFFSET = 0.01

function buildDashedVerticalGeometry(height: number) {
  const dashes: BufferGeometry[] = []
  let y = 0
  while (y < height) {
    const end = Math.min(y + CORNER_DASH_SIZE, height)
    const length = end - y
    const cylinder = new CylinderGeometry(CORNER_DASH_THICKNESS, CORNER_DASH_THICKNESS, length, 8)
    cylinder.translate(0, y + length / 2, 0)
    dashes.push(cylinder)
    y = end + CORNER_GAP_SIZE
  }
  const merged = mergeGeometries(dashes, false) ?? dashes[0]
  for (const dash of dashes) dash.dispose()
  return merged
}

function CornerPickerShape({
  position,
  height,
  baseScale,
  cursor,
  hover,
  onHoverChange,
  onPointerDown,
  round = false,
}: {
  position: readonly [number, number, number]
  height: number
  baseScale: number
  cursor: Cursor
  hover: boolean
  onHoverChange: (hovered: boolean) => void
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  round?: boolean
}) {
  const dashedGeometry = useMemo(() => buildDashedVerticalGeometry(height), [height])
  useEffect(() => () => dashedGeometry.dispose(), [dashedGeometry])

  const dashMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const ringMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => {
    const next = hover ? ARROW_HOVER_COLOR : ARROW_COLOR
    dashMaterial.color.set(next)
    ringMaterial.color.set(next)
  }, [dashMaterial, ringMaterial, hover])
  useEffect(() => () => dashMaterial.dispose(), [dashMaterial])
  useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

  const billboardRef = useRef<Group>(null)
  const { camera } = useThree()
  // Billboard the disc to the camera so the picker remains readable at any
  // viewing angle. The disc lives under the building-rotated tool group
  // (and possibly a rotated level), so copying `camera.quaternion` onto
  // the local quaternion no longer yields camera-aligned WORLD rotation
  // when the parent has a rotation of its own — compute the local
  // quaternion that, composed with the parent's world rotation, equals
  // the camera's world rotation.
  const parentWorldQuat = useMemo(() => new Quaternion(), [])
  const invParentWorldQuat = useMemo(() => new Quaternion(), [])
  useFrame(() => {
    const group = billboardRef.current
    if (!group) return
    if (group.parent) {
      group.parent.getWorldQuaternion(parentWorldQuat)
      invParentWorldQuat.copy(parentWorldQuat).invert()
      group.quaternion.copy(invParentWorldQuat).multiply(camera.quaternion)
    } else {
      group.quaternion.copy(camera.quaternion)
    }
  })

  const scale = (hover ? 1.25 : 1) * baseScale

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={dashedGeometry}
        material={dashMaterial}
        position={position}
        renderOrder={1001}
      />
      <group position={[position[0], CORNER_FLOOR_OFFSET, position[2]]} ref={billboardRef}>
        <HandleArrow
          cursor={cursor}
          hover={hover}
          hoverScale={1.25}
          onHoverChange={onHoverChange}
          onPointerDown={onPointerDown}
          placement={{ position: [0, 0, 0], baseScale }}
          round={round}
          shape="corner-picker"
        />
        <mesh material={ringMaterial} renderOrder={1002} scale={scale}>
          <ringGeometry args={[CORNER_HEX_RADIUS, CORNER_HEX_RADIUS * 1.18, round ? 32 : 6]} />
        </mesh>
      </group>
    </>
  )
}

// Tracker visual for the `linear-resize` handle's `shape: 'tracker'` option.
// Mirrors the corner picker (dashed vertical leader from the floor) but caps
// the leader with a small draggable cube instead of a hex disc, and the cube
// sits at the TOP of the leader rather than the floor — the visual reads as
// "this cube is the wall top; drag it to raise/lower." All interactivity
// (pointer-down → linear-resize drag) is wired by the parent `LinearArrow`.
function TrackerShape({
  basePosition,
  baseScale,
  cubePosition,
  cursor,
  hover,
  leaderHeight,
  onHoverChange,
  onPointerDown,
}: {
  basePosition: readonly [number, number, number]
  baseScale: number
  cubePosition: readonly [number, number, number]
  cursor: Cursor
  hover: boolean
  leaderHeight: number
  onHoverChange: (hovered: boolean) => void
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
}) {
  // `leaderHeight === 0` (wallHeight collapsed to floor) would make the
  // dashed builder return an empty geometry — skip the mesh entirely in
  // that case so the cube still renders by itself.
  const hasLeader = leaderHeight > 0.0001
  const dashedGeometry = useMemo(
    () => (hasLeader ? buildDashedVerticalGeometry(leaderHeight) : null),
    [hasLeader, leaderHeight],
  )
  useEffect(() => () => dashedGeometry?.dispose(), [dashedGeometry])

  const dashMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => {
    const next = hover ? ARROW_HOVER_COLOR : ARROW_COLOR
    dashMaterial.color.set(next)
  }, [dashMaterial, hover])
  useEffect(() => () => dashMaterial.dispose(), [dashMaterial])

  return (
    <>
      {dashedGeometry ? (
        <mesh
          frustumCulled={false}
          geometry={dashedGeometry}
          material={dashMaterial}
          position={basePosition}
          renderOrder={1001}
        />
      ) : null}
      <HandleArrow
        cursor={cursor}
        hover={hover}
        hoverScale={1.25}
        onHoverChange={onHoverChange}
        onPointerDown={onPointerDown}
        placement={{ position: cubePosition, baseScale }}
        shape="tracker"
      />
    </>
  )
}
