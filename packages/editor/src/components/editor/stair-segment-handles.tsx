'use client'

import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Color,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Mesh,
  type Object3D,
  OrthographicCamera,
  Plane,
  RingGeometry,
  Shape,
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
        <StairSegmentSideArrow
          segmentNode={segmentNode}
          segmentObject={segmentObject}
          side="left"
        />
        <StairSegmentSideArrow
          segmentNode={segmentNode}
          segmentObject={segmentObject}
          side="right"
        />
        <StairSegmentLengthArrow segmentNode={segmentNode} segmentObject={segmentObject} />
        {segmentNode.segmentType === 'stair' ? (
          <StairSegmentHeightArrow segmentNode={segmentNode} segmentObject={segmentObject} />
        ) : null}
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
  segmentObject,
}: {
  side: 'left' | 'right'
  segmentNode: StairSegmentNode
  segmentObject: Mesh
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

    // Work in the SEGMENT's own local frame, not the stair group's. The
    // chain (`syncSegmentMeshTransforms`) writes the segment mesh's
    // rotation/position imperatively each frame based on prior siblings'
    // `attachmentSide`; the node's own `rotation`/`position` are stale for
    // anything past the first segment. `segmentObject.worldToLocal` is the
    // only correct projection.
    segmentObject.updateMatrixWorld()
    const centerSegment = new Vector3(0, segmentNode.height / 2, segmentNode.length / 2)
    const centerWorld = centerSegment.clone().applyMatrix4(segmentObject.matrixWorld)

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
    const hitLocal = segmentObject.worldToLocal(hitWorld.clone())

    const initialWidth = segmentNode.width
    // Segment-local +X is always the width axis, regardless of chain
    // rotation. Right arrow's pointer-delta-in-+X is the width grow signal;
    // left arrow's pointer-delta-in-+X is negated.
    const sign = side === 'right' ? 1 : -1
    const initialPointerX = hitLocal.x
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
      const hitLocal = segmentObject.worldToLocal(hit.clone())
      // Width grows symmetrically around the chain centerline — the chain
      // owns segment.position so we can't anchor the opposite edge by
      // writing back to it (the next frame's `syncSegmentMeshTransforms`
      // would clobber the write).
      const widthDelta = sign * (hitLocal.x - initialPointerX)
      const newWidth = Math.max(MIN_SEGMENT_WIDTH, initialWidth + widthDelta)
      useScene.getState().updateNode(segmentId, { width: newWidth })
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
  segmentObject,
}: {
  segmentNode: StairSegmentNode
  segmentObject: Mesh
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

    // Segment-local frame for the same chained-rotation reason the side
    // arrows use it — see comment in StairSegmentSideArrow.
    segmentObject.updateMatrixWorld()
    const centerSegment = new Vector3(0, segmentNode.height / 2, segmentNode.length / 2)
    const centerWorld = centerSegment.clone().applyMatrix4(segmentObject.matrixWorld)

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
    const hitLocal = segmentObject.worldToLocal(hitWorld.clone())

    const initialLength = segmentNode.length
    const initialPointerZ = hitLocal.z
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
      const hitLocal = segmentObject.worldToLocal(hit.clone())
      // Segment-local +Z is the run direction. The segment's back-face
      // (Z=0) is the chain anchor, so the run simply extends/contracts
      // toward the back as the pointer's +Z component grows.
      const lengthDelta = hitLocal.z - initialPointerZ
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
  segmentObject,
}: {
  segmentNode: StairSegmentNode
  segmentObject: Mesh
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

    // Segment-local frame anchor for the raycast plane — Y math itself is
    // rotation-invariant, but the plane center needs to be at the actual
    // mesh position (the chain owns it, not segmentNode.position).
    segmentObject.updateMatrixWorld()
    const centerSegment = new Vector3(0, segmentNode.height / 2, segmentNode.length / 2)
    const centerWorld = centerSegment.clone().applyMatrix4(segmentObject.matrixWorld)

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

// ───────────────────────────────────────────────────────────────────────
// Parent-stair handles — ground-anchored action menu for the whole stair
// (move / duplicate / delete). Mirrors the per-segment ground menu above
// so a selected stair shows in-world chrome instead of the screen-space
// `<FloatingActionMenu>`.
// ───────────────────────────────────────────────────────────────────────

export function StairHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedStair = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'stair' ? node : null
  })

  const shouldRender =
    Boolean(selectedStair) && !isFloorplanHovered && mode !== 'delete' && !movingNode

  if (!shouldRender || !selectedStair) return null
  return <StairHandlesForStair stairNode={selectedStair} />
}

function StairHandlesForStair({ stairNode }: { stairNode: StairNode }) {
  // Same portal-into-parent trick as `StairSegmentHandlesForSegment`: the
  // stair group has `useNodeEvents` handlers, so anything rendered inside
  // it bubbles up and would be traced by the outline post-process.
  const stairParentId = stairNode.parentId

  const [stairObject, setStairObject] = useState<Object3D | null>(
    () => sceneRegistry.nodes.get(stairNode.id as AnyNodeId) ?? null,
  )
  const [parentObject, setParentObject] = useState<Object3D | null>(() =>
    stairParentId ? (sceneRegistry.nodes.get(stairParentId as AnyNodeId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const nextStair = sceneRegistry.nodes.get(stairNode.id as AnyNodeId) ?? null
      const nextParent = stairParentId
        ? (sceneRegistry.nodes.get(stairParentId as AnyNodeId) ?? null)
        : null
      setStairObject((current) => (current === nextStair ? current : nextStair))
      setParentObject((current) => (current === nextParent ? current : nextParent))
      if (!(nextStair && nextParent)) {
        frameId = window.requestAnimationFrame(resolve)
      }
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [stairNode.id, stairParentId])

  const stairPoseRef = useRef<Group>(null)

  useFrame(() => {
    const stairPose = stairPoseRef.current
    if (!(stairPose && stairObject)) return
    // Mirror the stair group's pose so the menu rides along when the stair
    // is moved imperatively (e.g. mid-drag from `MoveRoofTool`).
    stairPose.position.copy(stairObject.position)
    stairPose.quaternion.copy(stairObject.quaternion)
  })

  if (!(stairObject && parentObject)) return null

  const isCurvedOrSpiral = stairNode.stairType === 'curved' || stairNode.stairType === 'spiral'

  return createPortal(
    <group ref={stairPoseRef}>
      {isCurvedOrSpiral ? (
        <>
          <CurvedStairRiseArrow stairNode={stairNode} stairObject={stairObject} />
          <CurvedStairWidthArrow stairNode={stairNode} stairObject={stairObject} />
          <CurvedStairInnerRadiusArrow stairNode={stairNode} stairObject={stairObject} />
          <CurvedStairSweepArrow end="start" stairNode={stairNode} stairObject={stairObject} />
          <CurvedStairSweepArrow end="end" stairNode={stairNode} stairObject={stairObject} />
        </>
      ) : null}
    </group>,
    parentObject,
  )
}

// ───────────────────────────────────────────────────────────────────────
// Curved / spiral stair arrows — three handles that map to the stair-level
// parametric params (totalRise, width, innerRadius). Curved stairs have no
// `stair-segment` children, so the segment arrows above don't apply.
// ───────────────────────────────────────────────────────────────────────

const CURVED_RISE_OFFSET = 0.35
const CURVED_RADIAL_OFFSET = 0.16
// Width arrow sits a bit further out than the inner radius arrow — pulls the
// handle clear of the curved stair's outer body so it doesn't read as part of
// the geometry. The companion ring hugs the outer edge with its own smaller
// padding so it visually traces the stair's outer perimeter.
const CURVED_WIDTH_HANDLE_OFFSET = 0.5
const CURVED_OUTER_RING_OFFSET = 0.2
const CURVED_INNER_RING_OFFSET = 0.2
const MIN_CURVED_RISE = 0.3
const MIN_CURVED_WIDTH = 0.4
// Match the renderer floors so dragging can't push past what the geometry
// will actually accept (`renderer.tsx` clamps innerRadius this way).
const MIN_CURVED_INNER_RADIUS_SPIRAL = 0.05
const MIN_CURVED_INNER_RADIUS_CURVED = 0.2
// Sweep arrows: two handles, one per arc end, anchored on the outer rim at
// midAngle = 0 — same axis as the width arrow but on a closer radial step
// so the width arrow sits visibly further out than the sweep cluster. ±Z
// offset keeps the chevrons from stacking: +Z is the END handle (grows
// the +sweep/2 edge), -Z is the START handle.
const CURVED_SWEEP_RADIAL_OFFSET = 0.3
const CURVED_SWEEP_LATERAL_OFFSET = 0.24
// Sweep clamps. Min is one short step's worth so the stair doesn't collapse
// past visibility; max stops a hair shy of a full turn so the start / end
// edges don't fight for the same pixel.
const MIN_CURVED_SWEEP = Math.PI / 12
const MAX_CURVED_SWEEP = Math.PI * 2 - 0.05

type CurvedStairGeometry = {
  isSpiral: boolean
  stepCount: number
  totalRise: number
  innerRadius: number
  outerRadius: number
  width: number
  sweepAngle: number
  stepSweep: number
  midRadius: number
  topAngle: number
  minInnerRadius: number
}

function readCurvedStairGeometry(stairNode: StairNode): CurvedStairGeometry {
  const isSpiral = stairNode.stairType === 'spiral'
  const stepCount = Math.max(2, Math.round(stairNode.stepCount ?? 10))
  const totalRise = Math.max(stairNode.totalRise ?? 2.5, 0.1)
  const width = Math.max(stairNode.width ?? 1, MIN_CURVED_WIDTH)
  const minInnerRadius = isSpiral ? MIN_CURVED_INNER_RADIUS_SPIRAL : MIN_CURVED_INNER_RADIUS_CURVED
  const innerRadius = Math.max(minInnerRadius, stairNode.innerRadius ?? 0.9)
  const outerRadius = innerRadius + width
  const sweepAngle = stairNode.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
  const stepSweep = sweepAngle / stepCount
  return {
    isSpiral,
    stepCount,
    totalRise,
    innerRadius,
    outerRadius,
    width,
    sweepAngle,
    stepSweep,
    midRadius: (innerRadius + outerRadius) / 2,
    topAngle: sweepAngle / 2 - stepSweep / 2,
    minInnerRadius,
  }
}

function CurvedStairRiseArrow({
  stairNode,
  stairObject,
}: {
  stairNode: StairNode
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

  const activateRiseResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    stairObject.updateMatrixWorld()

    const geom = readCurvedStairGeometry(stairNode)
    // Spiral stairs anchor over the central pillar (local origin) so the
    // rise arrow rides the column. Curved stairs anchor over the upper
    // step's midline, where the user expects the "top of the run" to be.
    const anchorLocal = geom.isSpiral
      ? new Vector3(0, geom.totalRise, 0)
      : new Vector3(
          geom.midRadius * Math.cos(geom.topAngle),
          geom.totalRise,
          geom.midRadius * Math.sin(geom.topAngle),
        )
    const anchorWorld = anchorLocal.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, anchorWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)

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

    const initialRise = geom.totalRise
    const initialPointerY = hitWorld.y
    const stairId = stairNode.id as AnyNodeId

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingCurvedStairRise(stairNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      // Y is unaffected by the stair group's rotation (rotation is Y-axis
      // only), so world Y delta == local Y delta.
      const delta = hit.y - initialPointerY
      const newRise = Math.max(MIN_CURVED_RISE, initialRise + delta)
      useScene.getState().updateNode(stairId, { totalRise: newRise })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingCurvedStairRise(null)
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

  const geom = readCurvedStairGeometry(stairNode)
  // Spiral: sit over the central pillar so the arrow tracks the column.
  // Curved: sit over the upper step's midline (the visual "top" of the run).
  const x = geom.isSpiral ? 0 : geom.midRadius * Math.cos(geom.topAngle)
  const z = geom.isSpiral ? 0 : geom.midRadius * Math.sin(geom.topAngle)
  const y = geom.totalRise + CURVED_RISE_OFFSET

  return (
    <group position={[x, y, z]}>
      <group rotation={[0, Math.PI / 2, Math.PI / 2]} scale={scale}>
        <mesh
          frustumCulled={false}
          geometry={geometry}
          material={material}
          onPointerDown={activateRiseResize}
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

function CurvedStairWidthArrow({
  stairNode,
  stairObject,
}: {
  stairNode: StairNode
  stairObject: Object3D
}) {
  const { geometry, material, scale, isHovered, setIsHovered } = useArrowVisuals('ew-resize')
  const isResizingWidth = useEditor((state) => state.resizingCurvedStairWidth?.id === stairNode.id)
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

    const geom = readCurvedStairGeometry(stairNode)
    // midAngle = 0 puts the radial axis along stair-local +X.
    const anchorLocal = new Vector3(geom.outerRadius, geom.totalRise / 2, 0)
    const anchorWorld = anchorLocal.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, anchorWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)

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
    const hitLocal = stairObject.worldToLocal(hitWorld.clone())

    const initialWidth = geom.width
    const initialPointerX = hitLocal.x
    const stairId = stairNode.id as AnyNodeId

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingCurvedStairWidth(stairNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const hitLocal = stairObject.worldToLocal(hit.clone())
      // At midAngle = 0 the radial axis is +X, so the outward pointer delta
      // is simply the X delta in stair-local space.
      const widthDelta = hitLocal.x - initialPointerX
      const newWidth = Math.max(MIN_CURVED_WIDTH, initialWidth + widthDelta)
      useScene.getState().updateNode(stairId, { width: newWidth })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ew-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingCurvedStairWidth(null)
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

  const geom = readCurvedStairGeometry(stairNode)
  const x = geom.outerRadius + CURVED_WIDTH_HANDLE_OFFSET
  const y = geom.totalRise / 2
  const showOuterRing = isHovered || isResizingWidth

  return (
    <>
      {showOuterRing ? (
        // Ring hugs the outer edge — sits just outside the stair body so it
        // traces the perimeter, independent of where the arrow handle floats.
        <CurvedStairRing radius={geom.outerRadius + CURVED_OUTER_RING_OFFSET} y={y} />
      ) : null}
      <group position={[x, y, 0]} scale={scale}>
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
    </>
  )
}

// Thin ring drawn at a given stair-local radius, floating at the companion
// arrow's height so the two read as one connected guide. Uses the arrow's
// color so the handle and its guide ring feel like a single piece of chrome.
function CurvedStairRing({ radius, y }: { radius: number; y: number }) {
  const ringGeom = useMemo(() => {
    const inner = Math.max(radius - 0.015, 0.001)
    const outer = radius + 0.015
    return new RingGeometry(inner, outer, 96)
  }, [radius])

  const ringMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    [],
  )

  useEffect(() => () => ringGeom.dispose(), [ringGeom])
  useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

  return (
    <mesh
      geometry={ringGeom}
      material={ringMaterial}
      position={[0, y, 0]}
      renderOrder={1009}
      rotation={[-Math.PI / 2, 0, 0]}
    />
  )
}

function CurvedStairInnerRadiusArrow({
  stairNode,
  stairObject,
}: {
  stairNode: StairNode
  stairObject: Object3D
}) {
  const { geometry, material, scale, isHovered, setIsHovered } = useArrowVisuals('ew-resize')
  const isResizingInner = useEditor(
    (state) => state.resizingCurvedStairInnerRadius?.id === stairNode.id,
  )
  const { camera, raycaster, gl } = useThree()
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const activateInnerRadiusResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    stairObject.updateMatrixWorld()

    const geom = readCurvedStairGeometry(stairNode)
    const anchorLocal = new Vector3(geom.innerRadius, geom.totalRise / 2, 0)
    const anchorWorld = anchorLocal.clone().applyMatrix4(stairObject.matrixWorld)

    const planeNormal = new Vector3().subVectors(camera.position, anchorWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)

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
    const hitLocal = stairObject.worldToLocal(hitWorld.clone())

    const initialInnerRadius = geom.innerRadius
    const initialOuterRadius = geom.outerRadius
    const initialPointerX = hitLocal.x
    const minInnerRadius = geom.minInnerRadius
    const maxInnerRadius = initialOuterRadius - MIN_CURVED_WIDTH
    const stairId = stairNode.id as AnyNodeId

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingCurvedStairInnerRadius(stairNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const hitLocal = stairObject.worldToLocal(hit.clone())
      // +X pointer delta = inner edge moving outward = innerRadius grows.
      const innerDelta = hitLocal.x - initialPointerX
      const newInnerRadius = Math.min(
        maxInnerRadius,
        Math.max(minInnerRadius, initialInnerRadius + innerDelta),
      )
      // Keep the outer edge pinned in place — width absorbs the change so the
      // outer rim doesn't shift with the inner one.
      const newWidth = initialOuterRadius - newInnerRadius
      useScene.getState().updateNode(stairId, {
        innerRadius: newInnerRadius,
        width: newWidth,
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
      useEditor.getState().setResizingCurvedStairInnerRadius(null)
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

  const geom = readCurvedStairGeometry(stairNode)
  const x = geom.innerRadius - CURVED_RADIAL_OFFSET
  const y = geom.totalRise / 2
  const showInnerRing = isHovered || isResizingInner
  // Pull the ring inward from the inner edge by its own offset — clamped so a
  // tiny inner radius (e.g. spiral default 0.05) doesn't push the ring through
  // the center.
  const innerRingRadius = Math.max(geom.innerRadius - CURVED_INNER_RING_OFFSET, 0.05)

  return (
    <>
      {showInnerRing ? <CurvedStairRing radius={innerRingRadius} y={y} /> : null}
      <group position={[x, y, 0]} rotation={[0, Math.PI, 0]} scale={scale}>
        <mesh
          frustumCulled={false}
          geometry={geometry}
          material={material}
          onPointerDown={activateInnerRadiusResize}
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
    </>
  )
}

// Sweep arrows — one tangent handle per arc end, so each side of the sweep
// can be extended / retracted independently. The opposite edge is held
// world-fixed by nudging `stairNode.rotation` by half the applied delta:
//   - END handle:   sweep += Δ, rotation += Δ/2   (start edge stays put)
//   - START handle: sweep -= Δ, rotation -= Δ/2   (end edge stays put,
//                                                  because rotation shifts
//                                                  the midpoint *with* the
//                                                  moving start)
// where Δ is the world angular delta of the cursor from drag-start. Working
// in world space (not stair-local) sidesteps the moving-frame problem —
// updating `rotation` mid-drag rotates the local frame, but the cursor's
// world position doesn't shift under the user's mouse.
function CurvedStairSweepArrow({
  end,
  stairNode,
  stairObject,
}: {
  end: 'start' | 'end'
  stairNode: StairNode
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

  const activateSweepResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    stairObject.updateMatrixWorld()

    const geom = readCurvedStairGeometry(stairNode)
    const initialSweep = geom.sweepAngle
    const initialRotation = stairNode.rotation as number
    const sweepSign = Math.sign(initialSweep) || 1

    // Drag plane = horizontal slab at the arrow's Y. The cursor's projection
    // onto this plane gives a stable world-space (X,Z) point we can convert
    // into an angle around the stair's center.
    const centerWorld = new Vector3()
    stairObject.getWorldPosition(centerWorld)
    const planeY = centerWorld.y + geom.totalRise / 2
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

    const initialPointerAngle = Math.atan2(hitWorld.z - centerWorld.z, hitWorld.x - centerWorld.x)

    const stairId = stairNode.id as AnyNodeId

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingCurvedStairSweep(stairNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return

      const currentPointerAngle = Math.atan2(hit.z - centerWorld.z, hit.x - centerWorld.x)
      // Normalize the angular delta to [-π, π] so a drag that crosses the
      // ±π wrap-around point doesn't flip sign mid-gesture.
      let delta = currentPointerAngle - initialPointerAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI

      // END handle: cursor angle delta == change in the end edge's world
      // angle → sweep += Δ. START handle: same delta, but it's the start
      // edge moving, so sweep shrinks by Δ.
      const sweepDelta = end === 'end' ? delta : -delta
      const targetSweep = initialSweep + sweepDelta
      // Clamp magnitude; preserve original winding sign.
      const clampedAbs = Math.min(
        MAX_CURVED_SWEEP,
        Math.max(MIN_CURVED_SWEEP, Math.abs(targetSweep)),
      )
      const newSweep = sweepSign * clampedAbs
      const appliedSweepDelta = newSweep - initialSweep
      // Three.js R_y(rot) maps stair-local angle θ to world angle (θ − rot).
      // So the world position of an edge is (local_angle − rotation). To make
      // the *grabbed* edge follow the cursor while the *other* edge stays
      // world-fixed:
      //   END  fixed-start:  Δ_world_start = −ΔS/2 − ΔR = 0 → ΔR = −ΔS/2
      //   START fixed-end:   Δ_world_end   = +ΔS/2 − ΔR = 0 → ΔR = +ΔS/2
      // The previous +/-ΔS/2 mapping had both signs flipped — the cursor
      // ended up controlling the opposite edge.
      const rotationShift = end === 'end' ? -appliedSweepDelta / 2 : appliedSweepDelta / 2
      const newRotation = initialRotation + rotationShift

      useScene.getState().updateNode(stairId, {
        sweepAngle: newSweep,
        rotation: newRotation,
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
      useEditor.getState().setResizingCurvedStairSweep(null)
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

  // Both handles cluster beside the width arrow at the +X rim anchor
  // (midAngle = 0). END sits on the +Z side of the anchor, START on -Z, so
  // the spatial layout matches: drag END toward +Z (CCW) to grow, drag
  // START toward -Z (CW) to grow. sweepSign flips the side assignment for
  // CW-wound stairs so the spatial mapping holds either way.
  const geom = readCurvedStairGeometry(stairNode)
  const sweepSign = Math.sign(geom.sweepAngle) || 1
  const x = geom.outerRadius + CURVED_SWEEP_RADIAL_OFFSET
  const z =
    end === 'end'
      ? sweepSign * CURVED_SWEEP_LATERAL_OFFSET
      : -sweepSign * CURVED_SWEEP_LATERAL_OFFSET
  const y = geom.totalRise / 2
  // At anchor midAngle = 0 the CCW tangent is world +Z; three.js R_y(-π/2)
  // maps local +X (chevron tip) → +Z. END handle points +Z (grow CCW),
  // START handle points -Z (grow CW). sweepSign flips both for CW-wound
  // stairs so each chevron still points in its own grow direction.
  const rotationY = end === 'end' ? -sweepSign * (Math.PI / 2) : sweepSign * (Math.PI / 2)

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        material={material}
        onPointerDown={activateSweepResize}
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
