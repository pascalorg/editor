'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ArcResizeHandle,
  type Cursor,
  createSceneApi,
  type HandleDescriptor,
  type HandlePortal,
  type LinearResizeHandle,
  nodeRegistry,
  type RadialResizeHandle,
  sceneRegistry,
  type TapActionHandle,
  type TranslateHandle,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  type Object3D,
  OrthographicCamera,
  Plane,
  Quaternion,
  RingGeometry,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import { createEditorApi } from '../../lib/editor-api'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { snapToGrid } from '../tools/item/placement-math'
import { formatAngleRadians } from '../tools/shared/segment-angle'

export const ARROW_SCALE = 0.65
export const ARROW_COLOR = '#8381ed'
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
export const ARROW_HOVER_COLOR = '#a5b4fc'

// Two-headed curved-arrow silhouette for whole-node rotation handles
// (today: the elevator's corner rotate gizmo). Symmetric arc centred on
// +X with sweeps to ±halfSweep, arrowhead wings + tangentially-extended
// tips at each end. Drawn in 2D then extruded and rotated to lie in the
// XZ plane — same final-orientation contract as the chevron, so the
// outer rotation Y and inner-rotation chain in the renderer are reused
// unchanged.
export function createRotateArrowHandleGeometry() {
  const R = 0.2
  const ribbonHalfWidth = 0.02 // ribbon thickness / 2
  const halfSweep = Math.PI / 3 // 60° per side → 120° total arc
  const headHalfWidth = 0.045 // arrowhead wings extend this far past ribbon
  const headOvershoot = 0.075 // tangential reach of the arrowhead tip
  const rIn = R - ribbonHalfWidth
  const rOut = R + ribbonHalfWidth
  const a1 = halfSweep
  const a2 = -halfSweep

  // Tip positions: at radius R, displaced tangentially past the ribbon end.
  // CCW tangent at a1: (-sin a1, cos a1) → push past a1.
  // CW tangent at a2: (+sin a2, -cos a2) → push past a2 the other way.
  const tip1: [number, number] = [
    R * Math.cos(a1) - headOvershoot * Math.sin(a1),
    R * Math.sin(a1) + headOvershoot * Math.cos(a1),
  ]
  const tip2: [number, number] = [
    R * Math.cos(a2) + headOvershoot * Math.sin(a2),
    R * Math.sin(a2) - headOvershoot * Math.cos(a2),
  ]
  const innerWing1: [number, number] = [
    (rIn - headHalfWidth) * Math.cos(a1),
    (rIn - headHalfWidth) * Math.sin(a1),
  ]
  const outerWing1: [number, number] = [
    (rOut + headHalfWidth) * Math.cos(a1),
    (rOut + headHalfWidth) * Math.sin(a1),
  ]
  const innerWing2: [number, number] = [
    (rIn - headHalfWidth) * Math.cos(a2),
    (rIn - headHalfWidth) * Math.sin(a2),
  ]
  const outerWing2: [number, number] = [
    (rOut + headHalfWidth) * Math.cos(a2),
    (rOut + headHalfWidth) * Math.sin(a2),
  ]
  const innerCorner1: [number, number] = [rIn * Math.cos(a1), rIn * Math.sin(a1)]
  const outerCorner1: [number, number] = [rOut * Math.cos(a1), rOut * Math.sin(a1)]
  const innerCorner2: [number, number] = [rIn * Math.cos(a2), rIn * Math.sin(a2)]
  const outerCorner2: [number, number] = [rOut * Math.cos(a2), rOut * Math.sin(a2)]

  const shape = new Shape()
  // Trace: top inner-corner → top inner-wing → top tip → top outer-wing →
  //        top outer-corner → outer arc CW → bot outer-corner →
  //        bot outer-wing → bot tip → bot inner-wing → bot inner-corner →
  //        inner arc CCW → back to top inner-corner.
  shape.moveTo(innerCorner1[0], innerCorner1[1])
  shape.lineTo(innerWing1[0], innerWing1[1])
  shape.lineTo(tip1[0], tip1[1])
  shape.lineTo(outerWing1[0], outerWing1[1])
  shape.lineTo(outerCorner1[0], outerCorner1[1])
  shape.absarc(0, 0, rOut, a1, a2, true)
  shape.lineTo(outerWing2[0], outerWing2[1])
  shape.lineTo(tip2[0], tip2[1])
  shape.lineTo(innerWing2[0], innerWing2[1])
  shape.lineTo(innerCorner2[0], innerCorner2[1])
  shape.absarc(0, 0, rIn, a2, a1, false)
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.012,
    bevelOffset: 0,
    bevelSegments: 6,
    curveSegments: 24,
    steps: 1,
  })
  geometry.translate(0, 0, -0.03)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// Reused chevron+shaft silhouette — matches every other handle file. The
// chevron points along +X by default; descriptors with `axis: 'z'` rotate
// it around Y, and `axis: 'y'` rotates so it points up.
function createArrowHandleGeometry() {
  const shape = new Shape()
  shape.moveTo(0.22, 0)
  shape.lineTo(-0.04, 0.12)
  shape.lineTo(-0.04, 0.035)
  shape.lineTo(-0.2, 0.035)
  shape.lineTo(-0.2, -0.035)
  shape.lineTo(-0.04, -0.035)
  shape.lineTo(-0.04, -0.12)
  shape.lineTo(0.22, 0)
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelOffset: 0,
    bevelSegments: 10,
    curveSegments: 16,
    steps: 1,
  })
  geometry.translate(0, 0, -0.04)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// Double-headed straight arrow silhouette, drawn in 2D pointing along ±X.
// A thin ribbon between two arrowheads. Two of these (one rotated 90°)
// merge into the 4-way move cross.
function createDoubleArrowShape(): Shape {
  const L = 0.36 // half-length to each tip
  const rw = 0.03 // ribbon half-width
  const hw = 0.12 // arrowhead half-width
  // Long inner ribbon so opposing arrowheads sit well apart rather than
  // meeting in a cramped knot at the centre.
  const hx = 0.2 // where each arrowhead meets the ribbon
  const shape = new Shape()
  shape.moveTo(L, 0) // right tip
  shape.lineTo(hx, hw)
  shape.lineTo(hx, rw)
  shape.lineTo(-hx, rw)
  shape.lineTo(-hx, hw)
  shape.lineTo(-L, 0) // left tip
  shape.lineTo(-hx, -hw)
  shape.lineTo(-hx, -rw)
  shape.lineTo(hx, -rw)
  shape.lineTo(hx, -hw)
  shape.closePath()
  return shape
}

// 4-way move cross: two double-headed arrows (±X and ±Z) lying flat in the
// XZ plane. Drawn on top (depthTest off, shared arrow material) so it reads
// as a floor-move grip centred on the item.
function createMoveCrossHandleGeometry() {
  const shape = createDoubleArrowShape()
  const extrudeOpts = {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.012,
    bevelOffset: 0,
    bevelSegments: 6,
    curveSegments: 8,
    steps: 1,
  }
  const armX = new ExtrudeGeometry(shape, extrudeOpts)
  armX.translate(0, 0, -0.03)
  armX.rotateX(-Math.PI / 2) // lay flat → points along ±X in XZ
  const armZ = armX.clone()
  armZ.rotateY(Math.PI / 2) // second arm → points along ±Z
  const merged = mergeGeometries([armX, armZ], false)
  if (!merged) {
    armZ.dispose()
    armX.computeVertexNormals()
    armX.computeBoundingSphere()
    return armX
  }
  armX.dispose()
  armZ.dispose()
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

function swallowNextClick() {
  const swallow = (clickEvent: Event) => {
    clickEvent.stopPropagation()
    clickEvent.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    window.removeEventListener('click', swallow, { capture: true })
  }, 300)
}

export function NodeArrowHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  // Endpoint / curve drags reshape the selected wall or fence; hide its
  // resize arrows for the duration so they don't clutter (or get blocked
  // by) the drag's own cursor + dimension overlays. Mirrors the same guard
  // on the legacy wall handles (`WallMoveSideHandles`).
  const movingWallEndpoint = useEditor((state) => state.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
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
    return typeof def.handles === 'function'
      ? def.handles(node as never)
      : (def.handles as HandleDescriptor[])
  }, [node, def])

  const shouldRender =
    Boolean(node && descriptors?.length) &&
    !isFloorplanHovered &&
    mode !== 'delete' &&
    !movingNode &&
    !movingWallEndpoint &&
    !movingFenceEndpoint &&
    !curvingWall &&
    !curvingFence

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
    if (outerRef.current && outerRide) {
      outerRef.current.position.copy(outerRide.position)
      outerRef.current.quaternion.copy(outerRide.quaternion)
    }
    if (innerRef.current && innerRide) {
      innerRef.current.position.copy(innerRide.position)
      innerRef.current.quaternion.copy(innerRide.quaternion)
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
  const dragControls = useMemo(
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

  const arrows = descriptors.map((descriptor, index) => (
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
  ))

  return createPortal(
    <group ref={outerRef}>
      {innerRideId !== null ? <group ref={innerRef}>{arrows}</group> : arrows}
    </group>,
    portalObject,
  )
}

type DragControls = {
  onStart: (index: number, snapshot: AnyNode) => void
  onEnd: () => void
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
  dragControls: DragControls
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
  if (descriptor.kind === 'translate') {
    return (
      <TranslateArrow
        descriptor={descriptor}
        dragControls={dragControls}
        handleIndex={handleIndex}
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

export function useArrowMaterial(): MeshBasicNodeMaterial {
  return useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        // `depthTest: false` keeps the chevron drawing on top of any
        // geometry under it; `depthWrite: true` puts the chevron's depth
        // into the scenePass buffer so the ink-edge shader's depth
        // Laplacian fires on its silhouette from every angle. Without
        // depthWrite, only the normal-discontinuity branch can detect
        // the chevron, and that signal collapses when the arrow's faces
        // happen to align with whatever sits behind them in screen space
        // — which is why the lines used to drop out depending on the view.
        depthTest: false,
        depthWrite: true,
        transparent: true,
        opacity: 1,
      }),
    [],
  )
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
  dragControls: DragControls
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const unit = useViewer((s) => s.unit)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

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

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Raycast plane at the handle's world position, perpendicular to the
    // camera's projected horizontal direction. For axis='y' we need the
    // plane to be vertical too — projection.y maps directly.
    rideObject.updateMatrixWorld()
    // Freeze the ride frame at drag-start. Some kinds park their mesh
    // position on the field being dragged (ceiling: mesh.position.y =
    // height) — using the *live* matrix in `onMove` would chase that
    // moving frame and the value stalls or jitters. The inverse is
    // captured once so local-coord math stays anchored to the pre-drag
    // pose for the duration of the drag.
    const initialFrameInverse = new Matrix4().copy(rideObject.matrixWorld).invert()
    const worldOrigin = new Vector3(...position).applyMatrix4(rideObject.matrixWorld)
    const planeNormal = new Vector3().subVectors(camera.position, worldOrigin).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, worldOrigin)

    const ndc = new Vector2()
    const setNDC = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
    }

    setNDC(event.nativeEvent.clientX, event.nativeEvent.clientY)
    raycaster.setFromCamera(ndc, camera)
    const hitWorld = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hitWorld)) return
    const hitLocal = hitWorld.clone().applyMatrix4(initialFrameInverse)

    // Capture node + initial value at drag start so `apply` can reference
    // pre-drag state (e.g. door right-width anchors the LEFT edge at
    // `initial.position[0] - initial.width/2` — using the live node would
    // drift as width updates each frame).
    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode
    // Cross-node handles (a downspout sliding its gutter's outlet) redirect
    // the live override + commit to another node; defaults to the selected
    // node. `currentValue` / `apply` still see the selected node.
    const overrideId =
      (descriptor.kind === 'linear-resize'
        ? descriptor.overrideTarget?.(initialNode as never, sceneApi)
        : undefined) ?? nodeId
    const initialValue = descriptor.currentValue(initialNode)
    const initialPointer =
      descriptor.axis === 'x' ? hitLocal.x : descriptor.axis === 'y' ? hitLocal.y : hitLocal.z

    const minBound = resolveBound(descriptor.min, Number.NEGATIVE_INFINITY, initialNode, sceneApi)
    const maxBound = resolveBound(descriptor.max, Number.POSITIVE_INFINITY, initialNode, sceneApi)

    // Anchor factor maps pointer delta to value delta:
    //   center: ×2 (both edges move ±delta, total span grows by 2·delta)
    //   min:    ×1 ( +axis edge moves with pointer; -axis edge anchored)
    //   max:    ×−1 (-axis edge moves with pointer; +axis edge anchored)
    //   radial: ×1 (the visible edge follows the pointer 1:1)
    const factor =
      descriptor.kind === 'radial-resize'
        ? 1
        : descriptor.anchor === 'center'
          ? 2
          : descriptor.anchor === 'min'
            ? 1
            : -1

    document.body.style.cursor = cursor
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    setIsDragging(true)
    // Claim active-drag status — `NodeArrowHandlesForNode` will pass the
    // snapshot to every OTHER arrow so they render at their pre-drag
    // world positions while this drag runs. The snapshot must be the
    // pre-override store node (not the merged `liveNode`) so subsequent
    // re-renders don't pollute it with this drag's own patch.
    dragControls.onStart(handleIndex, initialNode)
    // Publish the dimension being steered so the floating pill can show it.
    if (measureLabel) {
      useEditor.getState().setActiveHandleDrag({ nodeId, label: measureLabel })
    }

    let lastPatch: Partial<AnyNode> | null = null

    // Drag publishes the patch (e.g. door `{ width, position }`, wall
    // `{ height }`) to `useLiveNodeOverrides` + markDirty. The node's
    // system reads via `getEffectiveNode` and rebuilds the mesh
    // imperatively, so zustand stays at the pre-drag values until
    // commit — no per-frame React tree re-renders, no history churn.
    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      // Use the frozen drag-start frame, not the live one. See the
      // `initialFrameInverse` comment above.
      const intersectionLocal = intersection.clone().applyMatrix4(initialFrameInverse)
      const currentPointer =
        descriptor.axis === 'x'
          ? intersectionLocal.x
          : descriptor.axis === 'y'
            ? intersectionLocal.y
            : intersectionLocal.z
      const delta = currentPointer - initialPointer
      const next = Math.min(maxBound, Math.max(minBound, initialValue + delta * factor))
      // apply sees the node-at-drag-start so it can compute anchors from
      // pre-drag geometry (door-width re-centers on the opposite edge).
      const patch = descriptor.apply(initialNode as never, next, sceneApi)
      lastPatch = patch as Partial<AnyNode>
      useLiveNodeOverrides.getState().set(overrideId, patch as Record<string, unknown>)
      useScene.getState().markDirty(overrideId)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      setIsDragging(false)
      if (measureLabel) {
        useEditor.getState().setActiveHandleDrag(null)
      }
      // Release the active-drag claim so non-active arrows return to
      // live-tracking (and so the next drag can claim its own snapshot).
      dragControls.onEnd()
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      // Commit: one tracked write to the scene store, then drop the
      // override so subscribers read from scene again.
      if (lastPatch) {
        sceneApi.update(overrideId, lastPatch)
      }
      useLiveNodeOverrides.getState().clear(overrideId)
      useScene.getState().markDirty(overrideId)
      cleanup()
    }
    const onCancel = () => {
      // Revert: drop the override + mark dirty so the system rebuilds
      // against the original scene values.
      useLiveNodeOverrides.getState().clear(overrideId)
      useScene.getState().markDirty(overrideId)
      cleanup()
    }
    dragCleanupRef.current = cleanup

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // For axis === 'y' (vertical handles), tilt the chevron up via local
  // X+Z rotation chain matching DoorHeightArrowHandle. When the handle
  // sits below the node (placement Y < 0, e.g. window bottom arrow),
  // flip the Z rotation so the chevron points outward (downward).
  const innerRotation: [number, number, number] =
    descriptor.axis === 'y'
      ? [0, Math.PI / 2, position[1] < 0 ? -Math.PI / 2 : Math.PI / 2]
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
          cubePosition={position}
          leaderHeight={leaderHeight}
          isHovered={isHovered}
          onActivate={activate}
          onEnter={(event) => {
            event.stopPropagation()
            setIsHovered(true)
            document.body.style.cursor = cursor
          }}
          onLeave={(event) => {
            event.stopPropagation()
            setIsHovered(false)
            if (document.body.style.cursor === cursor) {
              document.body.style.cursor = ''
            }
          }}
          zoom={zoom}
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
      <group position={position} rotation={[0, rotationY, 0]}>
        {showLabel ? <DimensionLabel position={[0, 0.22, 0]} text={labelText} /> : null}
        <group rotation={innerRotation} scale={scale}>
          <mesh
            frustumCulled={false}
            geometry={arrowGeometry}
            material={arrowMaterial}
            onPointerDown={activate}
            onPointerEnter={(event) => {
              event.stopPropagation()
              setIsHovered(true)
              document.body.style.cursor = cursor
            }}
            onPointerLeave={(event) => {
              event.stopPropagation()
              setIsHovered(false)
              if (document.body.style.cursor === cursor) {
                document.body.style.cursor = ''
              }
            }}
            renderOrder={1010}
          />
        </group>
      </group>
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
const NO_RAYCAST = () => null

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
  dragControls: DragControls
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  // 'rotate' descriptors (whole-node rotation handles like the elevator
  // corner) render a two-headed curved arrow; everything else (stair
  // sweep, etc.) keeps the chevron.
  const isRotateShape = descriptor.shape === 'rotate'
  // 'node-normal' spins the node about its local +Z (a wall item flat against
  // its wall) instead of yaw about world-Y. The drag plane and the icon both
  // tilt into that plane, and the horizontal-only wedge/ring readout is
  // suppressed.
  const isNodeNormalRot = descriptor.rotationPlane === 'node-normal'
  const arrowGeometry = useMemo(
    () => (isRotateShape ? createRotateArrowHandleGeometry() : createArrowHandleGeometry()),
    [isRotateShape],
  )
  const arrowMaterial = useArrowMaterial()
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  // The rotate icon is denser than the chevron; pump scale a touch so the
  // ribbon reads at the same on-screen size as the other handles.
  const arrowScale = isRotateShape ? ARROW_SCALE * 1.05 : ARROW_SCALE
  const scale = (isHovered ? 1.12 : 1) * zoom * arrowScale
  const dragCleanupRef = useRef<(() => void) | null>(null)
  // Live rotation amount (radians swept since grab) — non-null only while a
  // `shape: 'rotate'` gizmo is mid-drag. Drives the in-frame wedge readout.
  const [rotationDelta, setRotationDelta] = useState<number | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

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
  const showDecoration = Boolean(decoration) && (isHovered || isDragging)

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Horizontal drag plane at the arrow's world Y. Atan2 around the
    // rotation pivot gives the cursor's bearing — delta between samples
    // is the angular drag.
    //
    // Default pivot is the rideObject's world origin (= node-local
    // origin) which is correct when the mesh origin coincides with the
    // shape being rotated (roof-segment, elevator). Nodes that bake
    // pose into their geometry (chimney) can override via
    // `descriptor.rotationCenter`, which we apply through the
    // rideObject's matrixWorld so the descriptor stays in node-local
    // coordinates.
    rideObject.updateMatrixWorld()
    const centerWorld =
      descriptor.rotationCenter !== undefined
        ? new Vector3(
            ...descriptor.rotationCenter(node as never, createSceneApi(useScene)),
          ).applyMatrix4(rideObject.matrixWorld)
        : new Vector3().setFromMatrixPosition(rideObject.matrixWorld)
    const arrowWorld = new Vector3(...position).applyMatrix4(rideObject.matrixWorld)
    const planeY = arrowWorld.y

    // Rotation axis + drag plane. 'horizontal' spins about world-Y on a flat
    // plane; 'node-normal' spins about the node's local +Z (the wall normal)
    // on the plane perpendicular to it. The 2D basis (u, v) lets us measure a
    // consistent bearing in either plane: for horizontal it collapses to the
    // original atan2(z, x).
    const axis = isNodeNormalRot
      ? new Vector3().setFromMatrixColumn(rideObject.matrixWorld, 2).normalize()
      : new Vector3(0, 1, 0)
    const plane = isNodeNormalRot
      ? new Plane().setFromNormalAndCoplanarPoint(axis, centerWorld)
      : new Plane(new Vector3(0, 1, 0), -planeY)
    let basisU: Vector3
    if (isNodeNormalRot) {
      // In-plane reference: world-up projected onto the plane (falls back to
      // world-X if the axis is near-vertical, e.g. a ceiling item).
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

    const ndc = new Vector2()
    const setNDC = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
    }

    setNDC(event.nativeEvent.clientX, event.nativeEvent.clientY)
    raycaster.setFromCamera(ndc, camera)
    const hitWorld = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hitWorld)) return

    const initialAngle = angleOf(hitWorld)
    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode

    document.body.style.cursor = dragCursor
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    setIsDragging(true)
    // Claim active-drag status — see LinearArrow's onStart note.
    dragControls.onStart(handleIndex, initialNode)

    let lastPatch: Partial<AnyNode> | null = null

    // Mirrors LinearArrow: drag publishes the patch (sweepAngle + rotation
    // for curved-stair sweep handles) to `useLiveNodeOverrides` and marks
    // the node dirty. The StairRenderer subscribes to that store and re-
    // renders the curved/spiral mesh with the effective node, so zustand
    // stays at the pre-drag values until commit on release.
    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const currentAngle = angleOf(hit)
      // Normalise so a drag that crosses ±π doesn't flip sign mid-gesture.
      let delta = currentAngle - initialAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI

      // Shift snaps whole-node rotation gizmos (stair, elevator, column…) to
      // 15° increments. Scoped to `shape: 'rotate'` so curved-stair sweep
      // handles keep their continuous feel.
      if (e.shiftKey && descriptor.shape === 'rotate') {
        const step = Math.PI / 12
        delta = Math.round(delta / step) * step
      }

      const patch = descriptor.apply(initialNode as never, delta, sceneApi)
      lastPatch = patch as Partial<AnyNode>
      useLiveNodeOverrides.getState().set(nodeId, patch as Record<string, unknown>)
      useScene.getState().markDirty(nodeId)

      // Whole-node rotate gizmos report how far the node has turned since
      // grab. We hand the live `delta` (the snapped amount, so it tracks the
      // 15° steps under Shift) to a wedge that renders as a CHILD of the node
      // frame — concentric and coplanar with the guide ring. Suppressed below
      // ~0.5° so a fresh grab doesn't flash a zero-width sliver. Horizontal-axis
      // rotation only (the wall-normal spin has no in-plane ring readout).
      if (isRotateShape && !isNodeNormalRot) {
        setRotationDelta(Math.abs(delta) < 0.0087 ? null : delta)
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === dragCursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      setIsDragging(false)
      setRotationDelta(null)
      // Release the active-drag claim — see LinearArrow's onEnd note.
      dragControls.onEnd()
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      // Commit the final patch to zustand, then drop the override so the
      // store is the single source of truth again.
      if (lastPatch) {
        sceneApi.update(nodeId, lastPatch)
      }
      useLiveNodeOverrides.getState().clear(nodeId)
      useScene.getState().markDirty(nodeId)
      cleanup()
    }
    const onCancel = () => {
      // Revert: drop the override + mark dirty so the renderer rebuilds
      // against the original scene values.
      useLiveNodeOverrides.getState().clear(nodeId)
      useScene.getState().markDirty(nodeId)
      cleanup()
    }
    dragCleanupRef.current = cleanup

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // Suppress "declared but unused" for `liveNode` — ArcArrow's apply
  // operates entirely on `initialNode` (snapshot taken inside activate)
  // and `delta` (live cursor angle), so the live store node doesn't
  // appear in the rotation pipeline. The prop is still required because
  // ArrowHandle passes it uniformly to every variant.
  void liveNode

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
      <group
        position={position}
        // The curved arrow is built flat in XZ. For a wall-normal spin, tilt
        // it up about X so it lies in the item-local XY plane (the wall face).
        rotation={isNodeNormalRot ? [Math.PI / 2, 0, rotationY] : [0, rotationY, 0]}
        scale={scale}
      >
        <mesh
          frustumCulled={false}
          geometry={arrowGeometry}
          material={arrowMaterial}
          onPointerDown={activate}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setIsHovered(true)
            // Only show the hover cursor if no drag is already in flight —
            // otherwise we'd stomp `grabbing` back to `grab` mid-gesture.
            if (document.body.style.cursor !== dragCursor) {
              document.body.style.cursor = hoverCursor
            }
          }}
          onPointerLeave={(event) => {
            event.stopPropagation()
            setIsHovered(false)
            if (document.body.style.cursor === hoverCursor) {
              document.body.style.cursor = ''
            }
          }}
          renderOrder={1010}
        />
      </group>
    </>
  )
}

// Free ground-plane move gizmo (the 4-way cross). Press-drag-release: raycast
// the horizontal plane at the node's base, convert the hit into the node's
// parent-local frame, add the delta to the node's drag-start position, grid-
// snap via the descriptor's `snapExtents`, and publish to `useLiveNodeOverrides`
// each move — committing one write to the store on release. Same live-preview
// contract as LinearArrow / ArcArrow; the renderer's mesh follows the override
// so the item slides under the cursor in real time.
function TranslateArrow({
  descriptor,
  node,
  handleIndex,
  dragControls,
  rideObject,
}: {
  descriptor: TranslateHandle<AnyNode>
  node: AnyNode
  handleIndex: number
  dragControls: DragControls
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const arrowGeometry = useMemo(() => createMoveCrossHandleGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

  const placementSceneApi = useMemo(() => createSceneApi(useScene), [])
  const position = descriptor.placement.position(node, placementSceneApi)
  const cursor: Cursor = 'move'
  // 'node-normal' constrains the drag to the wall face (plane ⟂ the node's
  // local +Z). Its cross icon stands up into that plane (tilt about X).
  const isWallPlane = descriptor.plane === 'node-normal'

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Drag plane through the node origin. 'horizontal' uses the world-up
    // normal (slide on the floor); 'node-normal' uses the node's facing
    // direction (its local +Z in world) so the item slides on the wall face.
    // Hits map into the parent frame so the delta composes with `position`
    // (which lives in parent-local space).
    rideObject.updateMatrixWorld()
    const worldOrigin = new Vector3().setFromMatrixPosition(rideObject.matrixWorld)
    const planeNormal = isWallPlane
      ? new Vector3().setFromMatrixColumn(rideObject.matrixWorld, 2).normalize()
      : new Vector3(0, 1, 0)
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, worldOrigin)
    const parent = rideObject.parent
    const parentInverse = new Matrix4()
    if (parent) {
      parent.updateMatrixWorld()
      parentInverse.copy(parent.matrixWorld).invert()
    }

    const ndc = new Vector2()
    const setNDC = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
    }

    setNDC(event.nativeEvent.clientX, event.nativeEvent.clientY)
    raycaster.setFromCamera(ndc, camera)
    const hitWorld = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hitWorld)) return
    const startLocal = hitWorld.clone().applyMatrix4(parentInverse)

    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode
    const initialPos = (initialNode as { position?: readonly [number, number, number] })
      .position ?? [0, 0, 0]

    document.body.style.cursor = cursor
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    setIsDragging(true)
    dragControls.onStart(handleIndex, initialNode)

    let lastPatch: Partial<AnyNode> | null = null

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const curLocal = hit.applyMatrix4(parentInverse)
      // Add the in-plane delta to the drag-start position; the off-plane axis
      // (Y on the floor, Z/depth on a wall) keeps its value. Snap / clamp is
      // the descriptor's job in `apply`.
      const newPos: [number, number, number] = [initialPos[0], initialPos[1], initialPos[2]]
      newPos[0] += curLocal.x - startLocal.x
      if (isWallPlane) {
        newPos[1] += curLocal.y - startLocal.y
      } else {
        newPos[2] += curLocal.z - startLocal.z
      }
      // Grid-snap the two in-plane axes (X + the plane's other free axis).
      const extents = descriptor.snapExtents?.(initialNode as never)
      if (extents) {
        newPos[0] = snapToGrid(newPos[0], extents[0])
        if (isWallPlane) {
          newPos[1] = snapToGrid(newPos[1], extents[1])
        } else {
          newPos[2] = snapToGrid(newPos[2], extents[1])
        }
      }
      const patch = descriptor.apply(initialNode as never, newPos, sceneApi)
      lastPatch = patch as Partial<AnyNode>
      useLiveNodeOverrides.getState().set(nodeId, patch as Record<string, unknown>)
      useScene.getState().markDirty(nodeId)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      setIsDragging(false)
      dragControls.onEnd()
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      if (lastPatch) {
        sceneApi.update(nodeId, lastPatch)
      }
      useLiveNodeOverrides.getState().clear(nodeId)
      useScene.getState().markDirty(nodeId)
      cleanup()
    }
    const onCancel = () => {
      useLiveNodeOverrides.getState().clear(nodeId)
      useScene.getState().markDirty(nodeId)
      cleanup()
    }
    dragCleanupRef.current = cleanup

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const onEnter = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(true)
    document.body.style.cursor = cursor
  }
  const onLeave = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(false)
    if (document.body.style.cursor === cursor) document.body.style.cursor = ''
  }

  // Suppress the unused `isDragging` lint — it only drives the React re-render
  // that keeps hover/drag cursor state in sync.
  void isDragging

  // The cross is built flat in the XZ plane. On a wall, tilt it up about X so
  // it lies in the item-local XY plane (= the wall face).
  const iconRotation: [number, number, number] = isWallPlane ? [Math.PI / 2, 0, 0] : [0, 0, 0]

  return (
    <group position={position} rotation={iconRotation} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
        onPointerDown={activate}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        renderOrder={1010}
      />
    </group>
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

  const onActivate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    sfxEmitter.emit('sfx:item-pick')
    document.body.style.cursor = ''
    setIsHovered(false)
    descriptor.onActivate(node as never, createSceneApi(useScene), createEditorApi())
  }

  const onEnter = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(true)
    document.body.style.cursor = cursor
  }
  const onLeave = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(false)
    if (document.body.style.cursor === cursor) document.body.style.cursor = ''
  }

  if (shape === 'corner-picker') {
    const height = descriptor.nodeHeight?.(node) ?? 1
    return (
      <CornerPickerShape
        height={height}
        isHovered={isHovered}
        onActivate={onActivate}
        onEnter={onEnter}
        onLeave={onLeave}
        position={position}
        zoom={zoom}
      />
    )
  }

  // Default 'arrow' shape — the standard chevron.
  return (
    <ArrowShape
      isHovered={isHovered}
      onActivate={onActivate}
      onEnter={onEnter}
      onLeave={onLeave}
      position={position}
      rotationY={rotationY}
      zoom={zoom}
    />
  )
}

function ArrowShape({
  position,
  rotationY,
  zoom,
  isHovered,
  onActivate,
  onEnter,
  onLeave,
}: {
  position: readonly [number, number, number]
  rotationY: number
  zoom: number
  isHovered: boolean
  onActivate: (event: ThreeEvent<PointerEvent>) => void
  onEnter: (event: ThreeEvent<PointerEvent>) => void
  onLeave: (event: ThreeEvent<PointerEvent>) => void
}) {
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
        onPointerDown={onActivate}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        renderOrder={1010}
      />
    </group>
  )
}

// Wall corner-picker visual: dashed vertical leader from floor up to
// `height` + billboarded hex disc (the click target) + outer ring. The
// hex disc is the only mesh with a pointer-down handler; the dashes and
// ring are decorative.
const CORNER_HEX_RADIUS = 0.16
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
  zoom,
  isHovered,
  onActivate,
  onEnter,
  onLeave,
}: {
  position: readonly [number, number, number]
  height: number
  zoom: number
  isHovered: boolean
  onActivate: (event: ThreeEvent<PointerEvent>) => void
  onEnter: (event: ThreeEvent<PointerEvent>) => void
  onLeave: (event: ThreeEvent<PointerEvent>) => void
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
  const hexMaterial = useMemo(
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
    const next = isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR
    dashMaterial.color.set(next)
    hexMaterial.color.set(next)
    ringMaterial.color.set(next)
  }, [dashMaterial, hexMaterial, ringMaterial, isHovered])
  useEffect(() => () => dashMaterial.dispose(), [dashMaterial])
  useEffect(() => () => hexMaterial.dispose(), [hexMaterial])
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

  const scale = (isHovered ? 1.25 : 1) * zoom

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={dashedGeometry}
        material={dashMaterial}
        position={position}
        renderOrder={1001}
      />
      <group
        position={[position[0], CORNER_FLOOR_OFFSET, position[2]]}
        ref={billboardRef}
        scale={scale}
      >
        <mesh
          material={hexMaterial}
          onPointerDown={onActivate}
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
          renderOrder={1003}
        >
          <circleGeometry args={[CORNER_HEX_RADIUS, 6]} />
        </mesh>
        <mesh material={ringMaterial} renderOrder={1002}>
          <ringGeometry args={[CORNER_HEX_RADIUS, CORNER_HEX_RADIUS * 1.18, 6]} />
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
const TRACKER_CUBE_SIZE = 0.16

function TrackerShape({
  basePosition,
  cubePosition,
  leaderHeight,
  zoom,
  isHovered,
  onActivate,
  onEnter,
  onLeave,
}: {
  basePosition: readonly [number, number, number]
  cubePosition: readonly [number, number, number]
  leaderHeight: number
  zoom: number
  isHovered: boolean
  onActivate: (event: ThreeEvent<PointerEvent>) => void
  onEnter: (event: ThreeEvent<PointerEvent>) => void
  onLeave: (event: ThreeEvent<PointerEvent>) => void
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

  const cubeGeometry = useMemo(
    () => new BoxGeometry(TRACKER_CUBE_SIZE, TRACKER_CUBE_SIZE, TRACKER_CUBE_SIZE),
    [],
  )
  useEffect(() => () => cubeGeometry.dispose(), [cubeGeometry])

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
  const cubeMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        transparent: true,
        opacity: 1,
        // depthTest off keeps the cube visible through any geometry sitting
        // between camera and wall top; depthWrite on so the ink-edge pass
        // catches the cube silhouette from every angle (same reasoning as
        // the chevron — without it the lines fade in/out by view angle).
        depthTest: false,
        depthWrite: true,
      }),
    [],
  )
  useEffect(() => {
    const next = isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR
    dashMaterial.color.set(next)
    cubeMaterial.color.set(next)
  }, [dashMaterial, cubeMaterial, isHovered])
  useEffect(() => () => dashMaterial.dispose(), [dashMaterial])
  useEffect(() => () => cubeMaterial.dispose(), [cubeMaterial])

  const cubeScale = (isHovered ? 1.25 : 1) * zoom

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
      <mesh
        frustumCulled={false}
        geometry={cubeGeometry}
        material={cubeMaterial}
        onPointerDown={onActivate}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        position={cubePosition}
        renderOrder={1003}
        scale={cubeScale}
      />
    </>
  )
}
