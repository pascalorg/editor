'use client'

import {
  type AnyNodeId,
  sceneRegistry,
  useScene,
  type WallNode,
  type WindowNode,
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
// Match the door arrow scale so the in-world chrome reads as one family.
const ARROW_SCALE = 0.65
const MIN_WINDOW_HEIGHT = 0.3
const MIN_WINDOW_WIDTH = 0.3
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'

// Mirror of door-side-handles `swallowNextClick`: pre-empt the synthetic
// `click` the browser fires immediately after a drag's pointerup, so the
// canvas-level PointerMissedHandler doesn't see "click on empty space" and
// deselect the window the user just resized.
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
  // Same chevron+shaft silhouette used for wall and door handles, kept
  // local so each handle file stays independent.
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

export function WindowSideHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedWindow = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'window' ? node : null
  })

  const shouldRender =
    Boolean(selectedWindow) && !isFloorplanHovered && mode !== 'delete' && !movingNode

  if (!shouldRender || !selectedWindow) return null
  return <WindowSideHandlesForWindow windowNode={selectedWindow} />
}

function WindowSideHandlesForWindow({ windowNode }: { windowNode: WindowNode }) {
  // Same portal-into-the-level pattern as DoorSideHandles: parenting handles
  // under the wall mesh would make them part of the selection/hover outline
  // pass. A wrapper group below mirrors the wall's pose each frame.
  const wallParentId = useScene((state) => {
    const wallNode = windowNode.parentId
      ? (state.nodes[windowNode.parentId as AnyNodeId] as WallNode | undefined)
      : undefined
    return wallNode?.parentId ?? null
  })

  const [wallObject, setWallObject] = useState<Object3D | null>(() =>
    windowNode.parentId ? (sceneRegistry.nodes.get(windowNode.parentId) ?? null) : null,
  )
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    wallParentId ? (sceneRegistry.nodes.get(wallParentId as AnyNodeId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const nextWall = windowNode.parentId
        ? (sceneRegistry.nodes.get(windowNode.parentId) ?? null)
        : null
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
  }, [windowNode.parentId, wallParentId])

  const wrapperRef = useRef<Group>(null)

  useFrame(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !wallObject) return
    wrapper.position.copy(wallObject.position)
    wrapper.quaternion.copy(wallObject.quaternion)
  })

  if (!levelObject || !wallObject) return null

  const rotation: [number, number, number] =
    typeof windowNode.rotation === 'number'
      ? [0, windowNode.rotation, 0]
      : (windowNode.rotation ?? [0, 0, 0])

  return createPortal(
    <group ref={wrapperRef}>
      <group position={windowNode.position} rotation={rotation}>
        <WindowSideArrow side="left" wallObject={wallObject} windowNode={windowNode} />
        <WindowSideArrow side="right" wallObject={wallObject} windowNode={windowNode} />
        <WindowHeightArrowHandle edge="top" wallObject={wallObject} windowNode={windowNode} />
        <WindowHeightArrowHandle edge="bottom" wallObject={wallObject} windowNode={windowNode} />
      </group>
    </group>,
    levelObject,
  )
}

function WindowSideArrow({
  side,
  wallObject,
  windowNode,
}: {
  side: 'left' | 'right'
  wallObject: Object3D
  windowNode: WindowNode
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

    // Window center in world space. Raycast plane is vertical through the
    // window, normal pointed at the camera — same setup as the height
    // arrow but we read the pointer's wall-local X to derive width.
    wallObject.updateMatrixWorld()
    const centerWorld = new Vector3(
      windowNode.position[0],
      windowNode.position[1],
      windowNode.position[2],
    )
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

    const initialWidth = windowNode.width
    const initialPositionX = windowNode.position[0]
    const initialPositionZ = windowNode.position[2]
    const rotY =
      typeof windowNode.rotation === 'number'
        ? windowNode.rotation
        : (windowNode.rotation?.[1] ?? 0)
    // Window-local +X expressed in wall-local: rotating (1,0,0) by rotY around Y.
    const armX = Math.cos(rotY)
    const armZ = -Math.sin(rotY)
    // sign === +1 grows the window from the window-local right edge (left
    // edge anchored), sign === -1 grows from the left edge (right edge
    // anchored).
    const sign = side === 'right' ? 1 : -1
    const initialPointerX = hitLocal.x
    const initialPointerZ = hitLocal.z

    const wallNode = windowNode.wallId
      ? (useScene.getState().nodes[windowNode.wallId as AnyNodeId] as WallNode | undefined)
      : undefined
    const wallLength = wallNode
      ? Math.hypot(wallNode.end[0] - wallNode.start[0], wallNode.end[1] - wallNode.start[1])
      : Number.POSITIVE_INFINITY

    const anchorWallX = initialPositionX - sign * (initialWidth / 2) * armX
    const headroomRight = Math.max(0, wallLength - anchorWallX)
    const headroomLeft = Math.max(0, anchorWallX)
    const growDir = sign * armX
    const headroomAlongArm =
      growDir > 0
        ? headroomRight
        : growDir < 0
          ? headroomLeft
          : Math.max(headroomLeft, headroomRight)
    const maxWidth = Math.max(MIN_WINDOW_WIDTH, headroomAlongArm)

    document.body.style.cursor = 'ew-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingWindowWidth(windowNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const windowId = windowNode.id as AnyNodeId

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersectionWorld = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersectionWorld)) return
      const intersectionLocal = wallObject.worldToLocal(intersectionWorld.clone())
      const dx = intersectionLocal.x - initialPointerX
      const dz = intersectionLocal.z - initialPointerZ
      const armDelta = dx * armX + dz * armZ
      const widthDelta = sign * armDelta
      const newWidth = Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, initialWidth + widthDelta))
      const half = (newWidth - initialWidth) / 2
      const newPositionX = initialPositionX + sign * half * armX
      const newPositionZ = initialPositionZ + sign * half * armZ
      useScene.getState().updateNode(windowId, {
        width: newWidth,
        position: [newPositionX, windowNode.position[1], newPositionZ],
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
      useEditor.getState().setResizingWindowWidth(null)
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
  const x = direction * (windowNode.width / 2 + SIDE_HANDLE_OFFSET)
  const rotationY = side === 'right' ? 0 : Math.PI

  return (
    <group position={[x, 0, 0]} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh
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

function WindowHeightArrowHandle({
  edge,
  wallObject,
  windowNode,
}: {
  edge: 'top' | 'bottom'
  wallObject: Object3D
  windowNode: WindowNode
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

  const edgeSign = edge === 'top' ? 1 : -1
  const handleY = edgeSign * (windowNode.height / 2 + HEIGHT_HANDLE_OFFSET)
  // Top arrow points up via the door-style [0, π/2, π/2]; flipping the Z
  // roll sends the chevron tip to -Y for the bottom arrow.
  const arrowInnerRotation: [number, number, number] =
    edge === 'top' ? [0, Math.PI / 2, Math.PI / 2] : [0, Math.PI / 2, -Math.PI / 2]

  const activateHeightResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    wallObject.updateMatrixWorld()
    const centerWorld = new Vector3(
      windowNode.position[0],
      windowNode.position[1],
      windowNode.position[2],
    )
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

    const initialHeight = windowNode.height
    const initialPositionY = windowNode.position[1]
    // Anchor the OPPOSITE edge in wall-local Y so only the dragged edge
    // moves. Top arrow → bottom edge stays; bottom arrow → top edge stays.
    const bottomLocalY = initialPositionY - initialHeight / 2
    const topLocalY = initialPositionY + initialHeight / 2
    const anchorY = edge === 'top' ? bottomLocalY : topLocalY
    const initialPointerY = hit.y
    const windowId = windowNode.id as AnyNodeId
    const wallNode = windowNode.wallId
      ? (useScene.getState().nodes[windowNode.wallId as AnyNodeId] as WallNode | undefined)
      : undefined
    const maxHeightCap = wallNode?.height ?? Number.POSITIVE_INFINITY
    // Top arrow grows upward → wall headroom above the bottom anchor.
    // Bottom arrow grows downward → all of the top anchor's wall-local Y
    // is available (the wall floor at Y=0 is the absolute clamp).
    const maxHeight =
      edge === 'top'
        ? Math.max(MIN_WINDOW_HEIGHT, maxHeightCap - bottomLocalY)
        : Math.max(MIN_WINDOW_HEIGHT, topLocalY)

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingWindowHeight(windowNode)
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      // Dragging the top arrow up grows height; dragging the bottom arrow
      // down also grows height — so flip the pointer delta sign for the
      // bottom arrow.
      const delta = (intersection.y - initialPointerY) * edgeSign
      const newHeight = Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, initialHeight + delta))
      const newPositionY = edge === 'top' ? anchorY + newHeight / 2 : anchorY - newHeight / 2
      useScene.getState().updateNode(windowId, {
        height: newHeight,
        position: [windowNode.position[0], newPositionY, windowNode.position[2]],
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
      useEditor.getState().setResizingWindowHeight(null)
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
      <group rotation={arrowInnerRotation} scale={scale}>
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

