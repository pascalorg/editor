'use client'

import {
  type AnyNodeId,
  type DoorNode,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Color,
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
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

const SIDE_HANDLE_OFFSET = 0.24
const HEIGHT_HANDLE_OFFSET = 0.24
// Arrows are sized for walls by default; doors are smaller features, so we
// scale the rendered chevron down to about two-thirds.
const ARROW_SCALE = 0.65
const MIN_DOOR_HEIGHT = 0.5
const MIN_DOOR_WIDTH = 0.3
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'

// Pre-empt the synthetic `click` the browser fires immediately after a
// drag's pointerup. Registered at window-level capture so it runs before
// the canvas-level PointerMissedHandler — whose "click on empty space ⇒
// deselect" rule would otherwise eat the door selection at the end of a
// handle drag. `once: true` makes the listener self-detach; the setTimeout
// is a failsafe in case no click ever follows.
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
  // Same chevron+shaft silhouette used for wall handles, kept local so the
  // two files stay independent.
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

export function DoorSideHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedDoor = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'door' ? node : null
  })

  const shouldRender =
    Boolean(selectedDoor) && !isFloorplanHovered && mode !== 'delete' && !movingNode

  if (!shouldRender || !selectedDoor) return null
  return <DoorSideHandlesForDoor door={selectedDoor} />
}

function DoorSideHandlesForDoor({ door }: { door: DoorNode }) {
  // Portal into the LEVEL (the wall's parent), not the wall itself. The
  // selection/hover outline pass traverses descendants of the hovered
  // object — if handles were children of the wall mesh they'd get outlined
  // whenever the wall is hovered. A wrapper group below mirrors the wall's
  // pose each frame so the handles still ride along with the wall.
  const wallParentId = useScene((state) => {
    const wallNode = door.parentId
      ? (state.nodes[door.parentId as AnyNodeId] as WallNode | undefined)
      : undefined
    return wallNode?.parentId ?? null
  })

  const [wallObject, setWallObject] = useState<Object3D | null>(() =>
    door.parentId ? (sceneRegistry.nodes.get(door.parentId) ?? null) : null,
  )
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    wallParentId ? (sceneRegistry.nodes.get(wallParentId as AnyNodeId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const nextWall = door.parentId ? (sceneRegistry.nodes.get(door.parentId) ?? null) : null
      const nextLevel = wallParentId
        ? (sceneRegistry.nodes.get(wallParentId as AnyNodeId) ?? null)
        : null
      setWallObject((current) => (current === nextWall ? current : nextWall))
      setLevelObject((current) => (current === nextLevel ? current : nextLevel))
      if (!nextWall || !nextLevel) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [door.parentId, wallParentId])

  const wrapperRef = useRef<Group>(null)

  // Copy the wall mesh's pose into the wrapper every frame. WallSystem
  // imperatively writes position/rotation outside React, so a React-side
  // reactive read would lag during edits.
  useFrame(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !wallObject) return
    wrapper.position.copy(wallObject.position)
    wrapper.quaternion.copy(wallObject.quaternion)
  })

  if (!levelObject || !wallObject) return null

  const rotation: [number, number, number] =
    typeof door.rotation === 'number'
      ? [0, door.rotation, 0]
      : (door.rotation ?? [0, 0, 0])

  return createPortal(
    <group ref={wrapperRef}>
      <group position={door.position} rotation={rotation}>
        <DoorSideArrow door={door} side="left" wallObject={wallObject} />
        <DoorSideArrow door={door} side="right" wallObject={wallObject} />
        <DoorHeightArrowHandle door={door} wallObject={wallObject} />
      </group>
    </group>,
    levelObject,
  )
}

function DoorSideArrow({
  door,
  side,
  wallObject,
}: {
  door: DoorNode
  side: 'left' | 'right'
  wallObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useMemo(
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
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'ew-resize') {
        document.body.style.cursor = ''
      }
      dragCleanupRef.current?.()
    }
  }, [])

  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const activateWidthResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Door center in world space. The raycast plane is vertical, normal
    // pointed at the camera through the door — same setup as the height
    // arrow, but here we read the pointer's wall-local X to derive width
    // rather than Y to derive height.
    wallObject.updateMatrixWorld()
    const centerWorld = new Vector3(door.position[0], door.position[1], door.position[2])
    centerWorld.applyMatrix4(wallObject.matrixWorld)

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
    const hitLocal = wallObject.worldToLocal(hitWorld.clone())

    const initialWidth = door.width
    const initialPositionX = door.position[0]
    const initialPositionZ = door.position[2]
    const rotY =
      typeof door.rotation === 'number'
        ? door.rotation
        : (door.rotation?.[1] ?? 0)
    // Door-local +X expressed in wall-local: rotating (1,0,0) by rotY around Y.
    const armX = Math.cos(rotY)
    const armZ = -Math.sin(rotY)
    // sign === +1 grows the door from the door-local right edge (left edge
    // anchored), sign === -1 grows from the left edge (right edge anchored).
    const sign = side === 'right' ? 1 : -1
    const initialPointerX = hitLocal.x
    const initialPointerZ = hitLocal.z

    const wallNode = door.wallId
      ? (useScene.getState().nodes[door.wallId as AnyNodeId] as WallNode | undefined)
      : undefined
    const wallLength = wallNode
      ? Math.hypot(
          wallNode.end[0] - wallNode.start[0],
          wallNode.end[1] - wallNode.start[1],
        )
      : Number.POSITIVE_INFINITY

    // The anchor (opposite edge) stays fixed in wall-local space. Its
    // wall-local X position determines how much room is left for the door
    // to grow without spilling off the wall.
    const anchorWallX = initialPositionX - sign * (initialWidth / 2) * armX
    const headroomRight = Math.max(0, wallLength - anchorWallX)
    const headroomLeft = Math.max(0, anchorWallX)
    // For typical axis-aligned doors (|armX| === 1), `sign * armX` is ±1
    // and the grow direction in wall-local X matches the visible direction.
    // Fall back to the larger headroom for non-axis-aligned cases.
    const growDir = sign * armX
    const headroomAlongArm =
      growDir > 0 ? headroomRight : growDir < 0 ? headroomLeft : Math.max(headroomLeft, headroomRight)
    const maxWidth = Math.max(MIN_DOOR_WIDTH, headroomAlongArm)

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingDoorWidth(door)
    // Suppress R3F node pointer events until pointerup completes; without
    // this, the pointerup at the end of the drag synthesizes a click on
    // whatever wall/mesh is under the cursor and re-selects it.
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const doorId = door.id as AnyNodeId

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersectionWorld = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersectionWorld)) return
      const intersectionLocal = wallObject.worldToLocal(intersectionWorld.clone())
      const dx = intersectionLocal.x - initialPointerX
      const dz = intersectionLocal.z - initialPointerZ
      // Project pointer delta onto door-local +X (in wall-local), then sign
      // it so dragging the arrow outward always grows the door.
      const armDelta = dx * armX + dz * armZ
      const widthDelta = sign * armDelta
      const newWidth = Math.min(maxWidth, Math.max(MIN_DOOR_WIDTH, initialWidth + widthDelta))
      const half = (newWidth - initialWidth) / 2
      const newPositionX = initialPositionX + sign * half * armX
      const newPositionZ = initialPositionZ + sign * half * armZ
      useScene.getState().updateNode(doorId, {
        width: newWidth,
        position: [newPositionX, door.position[1], newPositionZ],
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
      useEditor.getState().setResizingDoorWidth(null)
      useViewer.getState().setHandleDragging(false)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      // Swallow the synthetic `click` the browser fires right after this
      // pointerup. PointerMissedHandler would otherwise treat it as an
      // empty-canvas click and deselect the door. A window-level capture
      // listener pre-empts the canvas listener before it can run.
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
  const x = direction * (door.width / 2 + SIDE_HANDLE_OFFSET)
  const rotationY = side === 'right' ? 0 : Math.PI

  return (
    <group position={[x, 0, 0]} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
        // Same WebGPU "Vertex buffer slot 0" workaround as WallMoveArrowHandle:
        // pass geometry as a prop + disable frustum culling.
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
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

function DoorHeightArrowHandle({
  door,
  wallObject,
}: {
  door: DoorNode
  wallObject: Object3D
}) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useMemo(
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
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      dragCleanupRef.current?.()
    }
  }, [])

  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const handleY = door.height / 2 + HEIGHT_HANDLE_OFFSET

  const activateHeightResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Door center in world space. Wall mesh only rotates around Y, so a
    // vertical raycast plane through that point maps pointer Y to door Y
    // 1:1 — no extra wall-rotation bookkeeping needed.
    wallObject.updateMatrixWorld()
    const centerWorld = new Vector3(door.position[0], door.position[1], door.position[2])
    centerWorld.applyMatrix4(wallObject.matrixWorld)

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
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return

    const initialHeight = door.height
    const initialPositionY = door.position[1]
    // Bottom of the door in wall-local Y. Most doors sit on the floor
    // (bottom = 0), but lifted openings preserve their bottom by anchoring
    // the resize there.
    const bottomLocalY = initialPositionY - initialHeight / 2
    const initialPointerY = hit.y
    const doorId = door.id as AnyNodeId
    const wallNode = door.wallId
      ? (useScene.getState().nodes[door.wallId as AnyNodeId] as WallNode | undefined)
      : undefined
    const maxHeightCap = wallNode?.height ?? Number.POSITIVE_INFINITY
    const maxHeight = Math.max(MIN_DOOR_HEIGHT, maxHeightCap - bottomLocalY)

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingDoorHeight(door)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      const delta = intersection.y - initialPointerY
      const newHeight = Math.min(
        maxHeight,
        Math.max(MIN_DOOR_HEIGHT, initialHeight + delta),
      )
      const newPositionY = bottomLocalY + newHeight / 2
      useScene.getState().updateNode(doorId, {
        height: newHeight,
        position: [door.position[0], newPositionY, door.position[2]],
      })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingDoorHeight(null)
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
    <group position={[0, handleY, 0]}>
      <group rotation={[0, Math.PI / 2, Math.PI / 2]} scale={scale}>
        <mesh
          frustumCulled={false}
          geometry={arrowGeometry}
          material={arrowMaterial}
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

