'use client'

import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentSchema,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Mesh,
  type Object3D,
  OrthographicCamera,
  Plane,
  Shape,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

const SIDE_HANDLE_OFFSET = 0.24
const LENGTH_HANDLE_OFFSET = 0.24
const HEIGHT_HANDLE_OFFSET = 0.24
const ARROW_SCALE = 0.65
const MIN_SEGMENT_WIDTH = 0.4
const MIN_SEGMENT_LENGTH = 0.4
const MIN_SEGMENT_HEIGHT = 0.1
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'
const GROUND_MENU_SIDE_CLEARANCE = 0.68
const GROUND_MENU_SPACING = 0.32
const GROUND_ICON_SIZE = 0.22
const GROUND_MENU_SIDE_HYSTERESIS = 0.1
const GROUND_MENU_LERP_RATE = 14

// Synthetic `click` after a drag's pointerup would deselect the segment via
// the canvas-level PointerMissedHandler. Mirrors the window/door handles.
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

export function StairSegmentHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedSegment = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'stair-segment' ? node : null
  })

  const shouldRender =
    Boolean(selectedSegment) && !isFloorplanHovered && mode !== 'delete' && !movingNode

  if (!shouldRender || !selectedSegment) return null
  return <StairSegmentHandlesForSegment segmentNode={selectedSegment} />
}

function StairSegmentHandlesForSegment({ segmentNode }: { segmentNode: StairSegmentNode }) {
  // Portal into the stair's PARENT (level / building / scene root), not the
  // stair group itself: StairRenderer attaches useNodeEvents handlers on the
  // stair group, so hovering anything inside the group bubbles up and sets
  // `hoveredId = stairId`. The post-processing outline then traces every
  // descendant of the stair group — which would include our icons. Mirrors
  // the door fix (handles live under the level, not the wall).
  const stairId = segmentNode.parentId
  const stairParentId = useScene((state) => {
    const stair = stairId ? (state.nodes[stairId as AnyNodeId] as StairNode | undefined) : undefined
    return stair?.parentId ?? null
  })

  const [stairObject, setStairObject] = useState<Object3D | null>(() =>
    stairId ? (sceneRegistry.nodes.get(stairId as AnyNodeId) ?? null) : null,
  )
  const [segmentObject, setSegmentObject] = useState<Mesh | null>(
    () => (sceneRegistry.nodes.get(segmentNode.id as AnyNodeId) as Mesh | undefined) ?? null,
  )
  const [parentObject, setParentObject] = useState<Object3D | null>(() =>
    stairParentId ? (sceneRegistry.nodes.get(stairParentId as AnyNodeId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const nextStair = stairId ? (sceneRegistry.nodes.get(stairId as AnyNodeId) ?? null) : null
      const nextSegment =
        (sceneRegistry.nodes.get(segmentNode.id as AnyNodeId) as Mesh | undefined) ?? null
      const nextParent = stairParentId
        ? (sceneRegistry.nodes.get(stairParentId as AnyNodeId) ?? null)
        : null
      setStairObject((current) => (current === nextStair ? current : nextStair))
      setSegmentObject((current) => (current === nextSegment ? current : nextSegment))
      setParentObject((current) => (current === nextParent ? current : nextParent))
      if (!(nextStair && nextSegment && nextParent)) {
        frameId = window.requestAnimationFrame(resolve)
      }
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [stairId, segmentNode.id, stairParentId])

  const stairPoseRef = useRef<Group>(null)
  const segmentPoseRef = useRef<Group>(null)

  useFrame(() => {
    const stairPose = stairPoseRef.current
    const segmentPose = segmentPoseRef.current
    if (!(stairPose && segmentPose && stairObject && segmentObject)) return
    // Two-layer transform mirror so the handles ride along even when nothing
    // in React triggers a re-render: StairSystem writes the stair group's
    // pose AND the per-segment chained pose imperatively each frame.
    stairPose.position.copy(stairObject.position)
    stairPose.quaternion.copy(stairObject.quaternion)
    segmentPose.position.copy(segmentObject.position)
    segmentPose.quaternion.copy(segmentObject.quaternion)
  })

  if (!(stairObject && segmentObject && parentObject)) return null

  return createPortal(
    <group ref={stairPoseRef}>
      <group ref={segmentPoseRef}>
        <StairSegmentSideArrow side="left" segmentNode={segmentNode} stairObject={stairObject} />
        <StairSegmentSideArrow side="right" segmentNode={segmentNode} stairObject={stairObject} />
        <StairSegmentLengthArrow segmentNode={segmentNode} stairObject={stairObject} />
        {segmentNode.segmentType === 'stair' ? (
          <StairSegmentHeightArrow segmentNode={segmentNode} stairObject={stairObject} />
        ) : null}
        <StairSegmentGroundActionMenu segmentNode={segmentNode} segmentObject={segmentObject} />
      </group>
    </group>,
    parentObject,
  )
}

// Shared arrow material/geometry/scale boilerplate hoisted into one hook so
// each arrow variant only carries its drag logic.
function useArrowVisuals(cursor: 'ew-resize' | 'ns-resize') {
  const [isHovered, setIsHovered] = useState(false)
  const geometry = useMemo(() => createArrowHandleGeometry(), [])
  const material = useMemo(
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
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE

  useEffect(() => {
    material.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [material, isHovered])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
    }
  }, [cursor])

  return { geometry, material, scale, isHovered, setIsHovered }
}

function StairSegmentSideArrow({
  side,
  segmentNode,
  stairObject,
}: {
  side: 'left' | 'right'
  segmentNode: StairSegmentNode
  stairObject: Object3D
}) {
  const { geometry, material, scale, setIsHovered } = useArrowVisuals('ew-resize')
  const { camera, raycaster, gl } = useThree()
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const activateWidthResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    stairObject.updateMatrixWorld()
    // The segment's local origin is at its back-bottom-center inside the
    // stair group. Center the raycast plane on the segment's mid-body so
    // the picked depth matches what the user sees.
    const segmentRot = segmentNode.rotation
    const segmentLocalX = new Vector3(Math.cos(segmentRot), 0, -Math.sin(segmentRot))
    const segmentLocalZ = new Vector3(Math.sin(segmentRot), 0, Math.cos(segmentRot))
    const centerStair = new Vector3()
      .copy(new Vector3(...segmentNode.position))
      .addScaledVector(segmentLocalZ, segmentNode.length / 2)
      .add(new Vector3(0, segmentNode.height / 2, 0))
    const centerWorld = centerStair.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, centerWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, centerWorld)

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
    const hitStair = stairObject.worldToLocal(hitWorld.clone())

    const initialWidth = segmentNode.width
    const initialPositionX = segmentNode.position[0]
    const initialPositionZ = segmentNode.position[2]
    // sign === +1: right arrow grows from the segment's left edge anchor.
    // sign === -1: left arrow grows from the right edge anchor.
    const sign = side === 'right' ? 1 : -1
    const initialPointerX = hitStair.x
    const initialPointerZ = hitStair.z
    const armX = segmentLocalX.x
    const armZ = segmentLocalX.z
    const segmentId = segmentNode.id as AnyNodeId

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingStairSegmentWidth(segmentNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const hitLocal = stairObject.worldToLocal(hit.clone())
      const dx = hitLocal.x - initialPointerX
      const dz = hitLocal.z - initialPointerZ
      const armDelta = dx * armX + dz * armZ
      const widthDelta = sign * armDelta
      const newWidth = Math.max(MIN_SEGMENT_WIDTH, initialWidth + widthDelta)
      // Slide the centerline so the opposite edge stays put under the user.
      const half = (newWidth - initialWidth) / 2
      const newPositionX = initialPositionX + sign * half * armX
      const newPositionZ = initialPositionZ + sign * half * armZ
      useScene.getState().updateNode(segmentId, {
        width: newWidth,
        position: [newPositionX, segmentNode.position[1], newPositionZ],
      })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ew-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingStairSegmentWidth(null)
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

  const direction = side === 'right' ? 1 : -1
  const x = direction * (segmentNode.width / 2 + SIDE_HANDLE_OFFSET)
  // Centerline of the segment body: vertically at half height, lengthwise
  // at half run.
  const y = segmentNode.height / 2
  const z = segmentNode.length / 2
  const rotationY = side === 'right' ? 0 : Math.PI

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        material={material}
        onPointerDown={activateWidthResize}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'ew-resize'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'ew-resize') {
            document.body.style.cursor = ''
          }
        }}
        renderOrder={1010}
      />
    </group>
  )
}

function StairSegmentLengthArrow({
  segmentNode,
  stairObject,
}: {
  segmentNode: StairSegmentNode
  stairObject: Object3D
}) {
  const { geometry, material, scale, setIsHovered } = useArrowVisuals('ew-resize')
  const { camera, raycaster, gl } = useThree()
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const activateLengthResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    stairObject.updateMatrixWorld()
    const segmentRot = segmentNode.rotation
    const segmentLocalZ = new Vector3(Math.sin(segmentRot), 0, Math.cos(segmentRot))
    const centerStair = new Vector3()
      .copy(new Vector3(...segmentNode.position))
      .addScaledVector(segmentLocalZ, segmentNode.length / 2)
      .add(new Vector3(0, segmentNode.height / 2, 0))
    const centerWorld = centerStair.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, centerWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, centerWorld)

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
    const hitStair = stairObject.worldToLocal(hitWorld.clone())

    const initialLength = segmentNode.length
    const initialPointerX = hitStair.x
    const initialPointerZ = hitStair.z
    const armX = segmentLocalZ.x
    const armZ = segmentLocalZ.z
    const segmentId = segmentNode.id as AnyNodeId

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingStairSegmentLength(segmentNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const hitLocal = stairObject.worldToLocal(hit.clone())
      const dx = hitLocal.x - initialPointerX
      const dz = hitLocal.z - initialPointerZ
      // Project the pointer delta onto the segment's run direction. The
      // segment's local origin (Z=0 face) stays anchored, so the run
      // simply extends/contracts toward the back.
      const lengthDelta = dx * armX + dz * armZ
      const newLength = Math.max(MIN_SEGMENT_LENGTH, initialLength + lengthDelta)
      useScene.getState().updateNode(segmentId, { length: newLength })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ew-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingStairSegmentLength(null)
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

  // Anchor at the back face (Z = length) of the segment, halfway up the
  // body. Arrow geometry's chevron tip is at local +X, so rotate -π/2
  // around Y to swing it toward +Z (outward from the segment).
  const z = segmentNode.length + LENGTH_HANDLE_OFFSET
  const y = segmentNode.height / 2

  return (
    <group position={[0, y, z]} rotation={[0, -Math.PI / 2, 0]} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        material={material}
        onPointerDown={activateLengthResize}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'ew-resize'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'ew-resize') {
            document.body.style.cursor = ''
          }
        }}
        renderOrder={1010}
      />
    </group>
  )
}

function StairSegmentHeightArrow({
  segmentNode,
  stairObject,
}: {
  segmentNode: StairSegmentNode
  stairObject: Object3D
}) {
  const { geometry, material, scale, setIsHovered } = useArrowVisuals('ns-resize')
  const { camera, raycaster, gl } = useThree()
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const activateHeightResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    stairObject.updateMatrixWorld()
    const segmentRot = segmentNode.rotation
    const segmentLocalZ = new Vector3(Math.sin(segmentRot), 0, Math.cos(segmentRot))
    const centerStair = new Vector3()
      .copy(new Vector3(...segmentNode.position))
      .addScaledVector(segmentLocalZ, segmentNode.length / 2)
      .add(new Vector3(0, segmentNode.height / 2, 0))
    const centerWorld = centerStair.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, centerWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, centerWorld)

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

    const initialHeight = segmentNode.height
    const initialPointerY = hitWorld.y
    const segmentId = segmentNode.id as AnyNodeId

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingStairSegmentHeight(segmentNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      // Bottom of the segment stays at local Y = 0; only the top moves.
      // Y is unaffected by the stair group's rotation (rotation is around
      // Y), so world Y delta == local Y delta.
      const delta = hit.y - initialPointerY
      const newHeight = Math.max(MIN_SEGMENT_HEIGHT, initialHeight + delta)
      useScene.getState().updateNode(segmentId, { height: newHeight })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingStairSegmentHeight(null)
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

  // Sit above the top of the segment, centered along width and length.
  const y = segmentNode.height + HEIGHT_HANDLE_OFFSET
  const z = segmentNode.length / 2

  return (
    <group position={[0, y, z]}>
      <group rotation={[0, Math.PI / 2, Math.PI / 2]} scale={scale}>
        <mesh
          frustumCulled={false}
          geometry={geometry}
          material={material}
          onPointerDown={activateHeightResize}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setIsHovered(true)
            document.body.style.cursor = 'ns-resize'
          }}
          onPointerLeave={(event) => {
            event.stopPropagation()
            setIsHovered(false)
            if (document.body.style.cursor === 'ns-resize') {
              document.body.style.cursor = ''
            }
          }}
          renderOrder={1010}
        />
      </group>
    </group>
  )
}

function StairSegmentGroundActionMenu({
  segmentNode,
  segmentObject,
}: {
  segmentNode: StairSegmentNode
  segmentObject: Mesh
}) {
  const menuGroupRef = useRef<Group>(null)
  const sideRef = useRef<number>(1)
  const initializedForSegmentIdRef = useRef<string | null>(null)
  const cameraLocalScratch = useMemo(() => new Vector3(), [])

  useFrame((state, dt) => {
    const menu = menuGroupRef.current
    if (!menu) return

    // Work in segment-local space: the wrapper this menu lives under already
    // applies the segment's chained transform, so a flat +X axis is the
    // segment's width-axis side and +Z is the run direction.
    segmentObject.updateMatrixWorld()
    cameraLocalScratch.copy(state.camera.position)
    segmentObject.worldToLocal(cameraLocalScratch)

    const projection = cameraLocalScratch.x

    const isFresh = initializedForSegmentIdRef.current !== segmentNode.id
    const currentSide = sideRef.current
    let nextSide: number
    if (isFresh) {
      nextSide = projection >= 0 ? 1 : -1
    } else if (currentSide >= 0 && projection < -GROUND_MENU_SIDE_HYSTERESIS) {
      nextSide = -1
    } else if (currentSide < 0 && projection > GROUND_MENU_SIDE_HYSTERESIS) {
      nextSide = 1
    } else {
      nextSide = currentSide
    }
    sideRef.current = nextSide

    const offset = segmentNode.width / 2 + GROUND_MENU_SIDE_CLEARANCE
    const targetX = nextSide * offset
    const targetZ = segmentNode.length / 2
    // Stays glued to the segment's base — for chained segments this is the
    // top of the previous segment, not the absolute slab. That's what the
    // user expects: the menu rides with the segment as the chain shifts.
    const targetY = 0
    // Rotate the menu so its local +X (where icons fan out) aligns with the
    // segment's run (+Z): rotY = -π/2 for +X side, +π/2 for -X side.
    const targetRot = nextSide >= 0 ? -Math.PI / 2 : Math.PI / 2

    if (isFresh) {
      menu.position.set(targetX, targetY, targetZ)
      menu.rotation.y = targetRot
      initializedForSegmentIdRef.current = segmentNode.id
      return
    }

    const t = 1 - Math.exp(-dt * GROUND_MENU_LERP_RATE)
    menu.position.x += (targetX - menu.position.x) * t
    menu.position.z += (targetZ - menu.position.z) * t
    menu.position.y = targetY

    let rotDelta = targetRot - menu.rotation.y
    while (rotDelta > Math.PI) rotDelta -= 2 * Math.PI
    while (rotDelta < -Math.PI) rotDelta += 2 * Math.PI
    menu.rotation.y += rotDelta * t
  })

  const items: Array<'duplicate' | 'delete'> = ['duplicate', 'delete']
  const centerIndex = (items.length - 1) / 2

  return (
    <group ref={menuGroupRef}>
      {/* Inner 180° flip so the icons read upright from the camera's side
          after the outer menu's camera-facing Y rotation. */}
      <group rotation={[0, Math.PI, 0]}>
        {items.map((kind, index) => (
          <StairSegmentGroundActionIcon
            key={kind}
            kind={kind}
            offsetIndex={index - centerIndex}
            segmentNode={segmentNode}
          />
        ))}
      </group>
    </group>
  )
}

function StairSegmentGroundActionIcon({
  kind,
  offsetIndex,
  segmentNode,
}: {
  kind: 'duplicate' | 'delete'
  offsetIndex: number
  segmentNode: StairSegmentNode
}) {
  const [isHovered, setIsHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.2 : 1) * zoom

  const texture = useMemo(() => getIconTexture(kind), [kind])
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        map: texture,
        side: DoubleSide,
        alphaTest: 0.4,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    [texture],
  )

  useEffect(() => {
    material.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [material, isHovered])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'pointer') {
        document.body.style.cursor = ''
      }
    }
  }, [])

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    sfxEmitter.emit('sfx:item-pick')
    document.body.style.cursor = ''
    setIsHovered(false)

    if (kind === 'delete') {
      sfxEmitter.emit('sfx:structure-delete')
      useViewer.getState().setSelection({ selectedIds: [] })
      useScene.getState().deleteNode(segmentNode.id as AnyNodeId)
      return
    }

    // Duplicate: createNodesAction appends to the parent's children, so the
    // clone lands at the END of the chain. Force `attachmentSide: 'front'`
    // so it cleanly continues from whatever segment is currently last —
    // copying the original's side could turn it into a U-turn relative to
    // the new chain end, which is almost never what the user wants.
    const input = structuredClone(segmentNode) as Record<string, unknown>
    delete input.id
    input.attachmentSide = 'front'
    const existingMetadata =
      input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : {}
    input.metadata = { ...existingMetadata, isNew: true }
    try {
      const dup = StairSegmentSchema.parse(input)
      useScene.getState().createNode(dup, dup.parentId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [dup.id] })
    } catch (err) {
      console.error('Failed to duplicate stair segment', err)
    }
  }

  return (
    <group position={[offsetIndex * GROUND_MENU_SPACING, 0, 0]} scale={scale}>
      <mesh
        material={material}
        // Handlers on the mesh itself (not the outer group) so each icon
        // owns its own raycast target. With `depthTest: false` the icons
        // can show up in multiple intersection lists at a glancing camera
        // angle; gating on `intersections[0]?.object === event.object`
        // makes sure only the truly front-most icon takes the hover.
        onPointerDown={onPointerDown}
        onPointerOut={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'pointer') {
            document.body.style.cursor = ''
          }
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          if (event.intersections[0]?.object !== event.object) return
          setIsHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        renderOrder={1010}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[GROUND_ICON_SIZE, GROUND_ICON_SIZE]} />
      </mesh>
    </group>
  )
}

const ICON_SVGS: Record<'duplicate' | 'delete', string> = {
  duplicate: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  delete: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
}

const ICON_TEXTURE_CACHE = new Map<string, CanvasTexture>()
const ICON_TEXTURE_SIZE = 128

function getIconTexture(kind: 'duplicate' | 'delete'): CanvasTexture {
  const cached = ICON_TEXTURE_CACHE.get(kind)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = ICON_TEXTURE_SIZE
  canvas.height = ICON_TEXTURE_SIZE
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  ICON_TEXTURE_CACHE.set(kind, texture)

  const img = new Image()
  img.onload = () => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE)
    ctx.drawImage(img, 0, 0, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE)
    texture.needsUpdate = true
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVGS[kind])}`

  return texture
}
