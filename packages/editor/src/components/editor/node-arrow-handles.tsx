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
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Object3D,
  OrthographicCamera,
  Plane,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { createEditorApi } from '../../lib/editor-api'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

const ARROW_SCALE = 0.65
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'

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

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const node = useScene((state) =>
    selectedId ? (state.nodes[selectedId as AnyNodeId] ?? null) : null,
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
    !movingNode

  if (!shouldRender || !node || !descriptors) return null
  return <NodeArrowHandlesForNode descriptors={descriptors} node={node} />
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

  if (!portalObject || !outerRide || (innerRideId !== null && !innerRide)) return null

  // `arrowFrame` is the Object3D used as the spatial reference for the
  // per-arrow drag math — its world matrix maps node-local coords to
  // world. In 'parent' mode that's the outer ride (= the node mesh
  // itself). In 'grandparent' mode it's the inner ride (= the node mesh)
  // because the inner group mirrors the node's local pose under the
  // wall-riding outer wrapper.
  const arrowFrame = innerRide ?? outerRide

  const arrows = descriptors.map((descriptor, index) => (
    <ArrowHandle
      descriptor={descriptor}
      // Descriptors come from a per-node-kind static list, so index is a
      // stable identity within this node's selection cycle.
      key={index}
      node={node}
      rideObject={arrowFrame}
    />
  ))

  return createPortal(
    <group ref={outerRef}>
      {innerRideId !== null ? <group ref={innerRef}>{arrows}</group> : arrows}
    </group>,
    portalObject,
  )
}

function ArrowHandle({
  descriptor,
  node,
  rideObject,
}: {
  descriptor: HandleDescriptor
  node: AnyNode
  rideObject: Object3D
}) {
  if (descriptor.kind === 'linear-resize' || descriptor.kind === 'radial-resize') {
    return <LinearArrow descriptor={descriptor} node={node} rideObject={rideObject} />
  }
  if (descriptor.kind === 'arc-resize') {
    return <ArcArrow descriptor={descriptor} node={node} rideObject={rideObject} />
  }
  if (descriptor.kind === 'tap-action') {
    return <TapActionArrow descriptor={descriptor} node={node} />
  }
  // endpoint-move not yet implemented.
  return null
}

function useArrowMaterial(): MeshBasicNodeMaterial {
  return useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
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
  bound: number | ((node: AnyNode, sceneApi: ReturnType<typeof createSceneApi>) => number) | undefined,
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
  rideObject,
}: {
  descriptor: LinearResizeHandle<AnyNode> | RadialResizeHandle<AnyNode>
  node: AnyNode
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
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

  const cursor = pickCursor(descriptor)
  const position = descriptor.placement.position(node)
  const baseRotationY = descriptor.placement.rotationY?.(node) ?? 0
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
    const hitLocal = rideObject.worldToLocal(hitWorld.clone())

    // Capture node + initial value at drag start so `apply` can reference
    // pre-drag state (e.g. door right-width anchors the LEFT edge at
    // `initial.position[0] - initial.width/2` — using the live node would
    // drift as width updates each frame).
    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode
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
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      const intersectionLocal = rideObject.worldToLocal(intersection.clone())
      const currentPointer =
        descriptor.axis === 'x'
          ? intersectionLocal.x
          : descriptor.axis === 'y'
            ? intersectionLocal.y
            : intersectionLocal.z
      const delta = currentPointer - initialPointer
      const next = Math.min(
        maxBound,
        Math.max(minBound, initialValue + delta * factor),
      )
      // apply sees the node-at-drag-start so it can compute anchors from
      // pre-drag geometry (door-width re-centers on the opposite edge).
      const patch = descriptor.apply(initialNode as never, next, sceneApi)
      sceneApi.update(nodeId, patch as Partial<AnyNode>)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setHandleDragging(false)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      cleanup()
    }
    const onCancel = () => cleanup()
    dragCleanupRef.current = cleanup

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // For axis === 'y' (vertical handles), tilt the chevron up via local
  // X+Z rotation chain matching DoorHeightArrowHandle.
  const innerRotation: [number, number, number] =
    descriptor.axis === 'y' ? [0, Math.PI / 2, Math.PI / 2] : [0, 0, 0]

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
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
  rideObject,
}: {
  descriptor: ArcResizeHandle<AnyNode>
  node: AnyNode
  rideObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
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

  const position = descriptor.placement.position(node)
  const rotationY = descriptor.placement.rotationY?.(node) ?? 0
  const cursor: Cursor = 'ew-resize'

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Horizontal drag plane at the arrow's world Y. Atan2 around the
    // node's local origin (= rideObject world center) gives the cursor's
    // bearing — delta between samples is the angular drag.
    rideObject.updateMatrixWorld()
    const centerWorld = new Vector3()
    rideObject.getWorldPosition(centerWorld)
    const arrowWorld = new Vector3(...position).applyMatrix4(rideObject.matrixWorld)
    const planeY = arrowWorld.y
    const plane = new Plane(new Vector3(0, 1, 0), -planeY)

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

    const initialAngle = Math.atan2(hitWorld.z - centerWorld.z, hitWorld.x - centerWorld.x)
    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode

    document.body.style.cursor = cursor
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const currentAngle = Math.atan2(hit.z - centerWorld.z, hit.x - centerWorld.x)
      // Normalise so a drag that crosses ±π doesn't flip sign mid-gesture.
      let delta = currentAngle - initialAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI

      const patch = descriptor.apply(initialNode as never, delta, sceneApi)
      sceneApi.update(nodeId, patch as Partial<AnyNode>)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setHandleDragging(false)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      cleanup()
    }
    const onCancel = () => cleanup()
    dragCleanupRef.current = cleanup

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
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

  const position = descriptor.placement.position(node)
  const rotationY = descriptor.placement.rotationY?.(node) ?? 0
  const shape = descriptor.shape ?? 'arrow'
  const cursor: Cursor =
    descriptor.cursor ?? (shape === 'corner-picker' ? 'move' : 'ew-resize')

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
  // viewing angle. Assumes the parent level has no rotation (the standard
  // case for walls / fences).
  useFrame(() => {
    if (billboardRef.current) {
      billboardRef.current.quaternion.copy(camera.quaternion)
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
