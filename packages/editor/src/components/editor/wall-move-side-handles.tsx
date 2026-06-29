'use client'

import {
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  type FenceNode,
  getWallCurveFrameAt,
  getWallThickness,
  isCurvedWall,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Object3D,
  OrthographicCamera,
  Plane,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { endpointReshapeScope } from '../../lib/interaction/scope'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import useInteractionScope, {
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import {
  createArrowHitAreaGeometry,
  createEndpointHitAreaGeometry,
  InvisibleHandleHitArea,
  NO_RAYCAST,
  useInvisibleHitAreaMaterial,
} from './node-arrow-handles'

const HANDLE_OFFSET = 0.27
const HANDLE_MIN_OFFSET = 0.33
const HANDLE_MIN_HEIGHT = 0.4
const HANDLE_TOP_INSET = 0.08
const HEIGHT_HANDLE_OFFSET = 0.26
const MIN_WALL_HEIGHT = 0.5
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'
// Match the door arrows: scale the rendered chevron down to ~two-thirds
// so the in-world handles read as a single UI family.
const ARROW_SCALE = 0.65
const CORNER_HEX_RADIUS = 0.11
const CORNER_DASH_SIZE = 0.1
const CORNER_GAP_SIZE = 0.07
const CORNER_DASH_THICKNESS = 0.006
const CORNER_FLOOR_OFFSET = 0.01

type WallMoveHandle = {
  key: string
  position: [number, number, number]
  rotationY: number
}

// Pre-empt the synthetic `click` the browser fires immediately after a
// drag's pointerup. Without this, PointerMissedHandler treats the click
// as "missed" and deselects the wall when the height arrow drag commits.
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
  // Classic arrow silhouette — chevron head + rectangular shaft — extruded
  // slightly so the handle reads as a 3D plate but stays visually light.
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
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.02,
    bevelOffset: 0,
    bevelSegments: 8,
    curveSegments: 16,
    steps: 1,
  })

  // Centre the extruded plate around y=0 and re-orient it so the depth
  // axis points up: the chevron lies flat in the XZ plane, tip along +X,
  // wings spread across ±Z.
  geometry.translate(0, 0, -0.0225)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function WallMoveSideHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useMovingNode()
  const endpointReshape = useEndpointReshape()
  const isCurveReshape = useIsCurveReshape()

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  // Fence side-move / height / corner-pickers now flow through the
  // registry handle path (see packages/nodes/src/fence/definition.ts).
  // Only walls still need the legacy renderer here — the registry path
  // didn't render correctly for walls specifically and was reverted in
  // commit 0e207a7f; revisit once that's diagnosed.
  const selectedNode = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'wall' ? node : null
  })

  const shouldRender =
    Boolean(selectedNode) &&
    !isFloorplanHovered &&
    mode !== 'delete' &&
    !movingNode &&
    !endpointReshape &&
    !isCurveReshape

  if (!shouldRender || !selectedNode) return null

  return <WallMoveSideHandlesForWall wall={selectedNode} />
}

function WallMoveSideHandlesForWall({ wall }: { wall: WallNode }) {
  // Merge the in-flight drag override so every handle (side-move arrows,
  // height arrow, corner leaders) tracks the live height in real time
  // during a height drag — the scene store stays at the pre-drag value
  // until commit, so reading `wall` alone would freeze them. Same pattern
  // as node-arrow-handles.
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(wall.id))
  const effectiveWall = useMemo(
    () => (liveOverride ? ({ ...wall, ...liveOverride } as WallNode) : wall),
    [wall, liveOverride],
  )

  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    wall.parentId ? (sceneRegistry.nodes.get(wall.parentId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0

    const resolveLevelObject = () => {
      const nextLevelObject = wall.parentId
        ? (sceneRegistry.nodes.get(wall.parentId) ?? null)
        : null
      setLevelObject((currentLevelObject) => {
        if (currentLevelObject === nextLevelObject) {
          return currentLevelObject
        }
        return nextLevelObject
      })

      if (!nextLevelObject) {
        frameId = window.requestAnimationFrame(resolveLevelObject)
      }
    }

    resolveLevelObject()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [wall.parentId])

  const handles = useMemo(() => getWallMoveHandles(effectiveWall), [effectiveWall])

  if (!levelObject || handles.length === 0) return null

  return createPortal(
    <group>
      {handles.map((handle) => (
        <WallMoveArrowHandle handle={handle} key={handle.key} wall={effectiveWall} />
      ))}
      <WallHeightArrowHandle wall={effectiveWall} />
      <WallCornerLeaderHandle endpoint="start" wall={effectiveWall} />
      <WallCornerLeaderHandle endpoint="end" wall={effectiveWall} />
    </group>,
    levelObject,
  )
}

function buildDashedVerticalGeometry(height: number) {
  // Build each dash as a thin cylinder section so thickness is
  // controllable — native `lineSegments` lock to 1px on WebGL/WebGPU.
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
  const merged = mergeGeometries(dashes, false) ?? new BufferGeometry()
  for (const dash of dashes) dash.dispose()
  return merged
}

function WallCornerLeaderHandle({ wall, endpoint }: { wall: WallNode; endpoint: 'start' | 'end' }) {
  const [isHovered, setIsHovered] = useState(false)
  const { camera } = useThree()
  const billboardRef = useRef<Group>(null)
  const parentWorldQuaternionRef = useRef(new Quaternion())
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom
  const visualScale = isHovered ? 1.25 : 1

  const corner = endpoint === 'start' ? wall.start : wall.end
  const x = corner[0]
  const z = corner[1]
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT

  const dashedGeometry = useMemo(() => buildDashedVerticalGeometry(wallHeight), [wallHeight])
  const hitGeometry = useMemo(() => createEndpointHitAreaGeometry(CORNER_HEX_RADIUS), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
  useEffect(() => () => dashedGeometry.dispose(), [dashedGeometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])

  // Node materials matched to the rest of the file — mixing plain
  // `meshBasicMaterial` with WebGPU node materials trips
  // "Color target has no corresponding fragment stage output".
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

  // Billboard the hex disc to the camera so the picker is always
  // recognisable regardless of viewing angle.
  //
  // Why parent-aware: the disc lives under a `createPortal` into the
  // level object, which itself sits under a building. Both can have
  // non-identity world rotations. `quaternion.copy(camera.quaternion)`
  // alone sets the LOCAL quaternion, so any ancestor rotation rotates
  // the disc away from the camera. We instead solve for a local
  // quaternion whose composition with the parent world quaternion
  // equals the camera's: `local = parentWorld⁻¹ · cameraWorld`.
  useFrame(() => {
    const billboard = billboardRef.current
    if (!billboard) return
    billboard.quaternion.copy(camera.quaternion)
    const parent = billboard.parent
    if (parent) {
      parent.getWorldQuaternion(parentWorldQuaternionRef.current)
      billboard.quaternion.premultiply(parentWorldQuaternionRef.current.invert())
    }
  })

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
        document.body.style.cursor = ''
      }
    }
  }, [])

  const activateEndpointMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    sfxEmitter.emit('sfx:item-pick')
    document.body.style.cursor = 'grabbing'
    useInteractionScope.getState().begin(endpointReshapeScope(wall.id, endpoint))
  }

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={dashedGeometry}
        material={dashMaterial}
        position={[x, 0, z]}
        renderOrder={1001}
      />
      <group position={[x, CORNER_FLOOR_OFFSET, z]} ref={billboardRef} scale={baseScale}>
        <InvisibleHandleHitArea
          geometry={hitGeometry}
          material={hitMaterial}
          onPointerDown={activateEndpointMove}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setIsHovered(true)
            document.body.style.cursor = 'grab'
          }}
          onPointerLeave={(event) => {
            event.stopPropagation()
            setIsHovered(false)
            if (document.body.style.cursor === 'grab') {
              document.body.style.cursor = ''
            }
          }}
          scale={1}
        />
        <group scale={visualScale}>
          <mesh material={hexMaterial} raycast={NO_RAYCAST} renderOrder={1003}>
            <circleGeometry args={[CORNER_HEX_RADIUS, 6]} />
          </mesh>
          <mesh material={ringMaterial} raycast={NO_RAYCAST} renderOrder={1002}>
            <ringGeometry args={[CORNER_HEX_RADIUS, CORNER_HEX_RADIUS * 1.18, 6]} />
          </mesh>
        </group>
      </group>
    </>
  )
}

function WallHeightArrowHandle({ wall }: { wall: WallNode }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const hitGeometry = useMemo(() => createArrowHitAreaGeometry(), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
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
  const baseScale = zoom * ARROW_SCALE
  const scale = (isHovered ? 1.12 : 1) * baseScale
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
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  // Sit on the visual centre of the wall — for curved walls that's the
  // arc apex at t=0.5, not the chord midpoint. Use the curve tangent for
  // the yaw so the arrow's local frame matches the wall direction at the
  // apex, consistent with `getWallMoveHandles`.
  const curveFrame = isCurvedWall(wall) ? getWallCurveFrameAt(wall, 0.5) : null
  const midX = curveFrame ? curveFrame.point.x : (wall.start[0] + wall.end[0]) / 2
  const midZ = curveFrame ? curveFrame.point.y : (wall.start[1] + wall.end[1]) / 2
  const dirX = curveFrame ? curveFrame.tangent.x : wall.end[0] - wall.start[0]
  const dirZ = curveFrame ? curveFrame.tangent.y : wall.end[1] - wall.start[1]
  const wallAngle = Math.atan2(-dirZ, dirX)
  // `wall` is the override-merged effective wall (see
  // WallMoveSideHandlesForWall), so this height is already live during a drag.
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT
  const handleY = wallHeight + HEIGHT_HANDLE_OFFSET

  const activateHeightResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const levelObject = wall.parentId ? sceneRegistry.nodes.get(wall.parentId) : null
    if (!levelObject) return

    // Vertical plane through the wall midpoint whose normal points toward
    // the camera (projected to horizontal). Raycasting against it converts
    // pointer movement into a world-space Y value.
    const midpointWorld = new Vector3(midX, 0, midZ).applyMatrix4(levelObject.matrixWorld)
    const planeNormal = new Vector3().subVectors(camera.position, midpointWorld).setY(0)
    if (planeNormal.lengthSq() === 0) return
    planeNormal.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, midpointWorld)

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

    const initialHeight = wall.height ?? DEFAULT_WALL_HEIGHT
    const initialY = hit.y
    const wallId = wall.id as AnyNodeId
    let pendingHeight = initialHeight

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useInteractionScope.getState().begin({ kind: 'handle-drag', nodeId: wallId, handle: 'height' })
    // Suppress R3F node pointer events until pointerup completes so the
    // synthesized click doesn't reroute selection to whatever mesh sits
    // under the cursor at release.
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()

    // Drag publishes `{ height }` to `useLiveNodeOverrides` and marks
    // the wall dirty so `WallSystem.updateWallGeometry` rebuilds against
    // the override-merged value (via `getEffectiveWall`). Zustand stays
    // at the pre-drag height until pointerup commits one tracked write.
    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      const newHeight = Math.max(MIN_WALL_HEIGHT, initialHeight + (intersection.y - initialY))
      pendingHeight = newHeight
      useLiveNodeOverrides.getState().set(wallId, { height: newHeight })
      useScene.getState().markDirty(wallId)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
      useViewer.getState().setInputDragging(false)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      // Commit: write the final override-merged value to zustand once
      // (tracked, undoable), then drop the override so the renderer
      // falls back to the scene store.
      if (pendingHeight !== initialHeight) {
        useScene.getState().updateNode(wallId, { height: pendingHeight })
      }
      useLiveNodeOverrides.getState().clear(wallId)
      useScene.getState().markDirty(wallId)
      cleanup()
    }
    const onCancel = () => {
      // Revert: drop the override, mark dirty so the geometry rebuilds
      // against the original scene height.
      useLiveNodeOverrides.getState().clear(wallId)
      useScene.getState().markDirty(wallId)
      cleanup()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <group position={[midX, handleY, midZ]} rotation={[0, wallAngle, 0]}>
      <group rotation={[0, Math.PI / 2, Math.PI / 2]}>
        <InvisibleHandleHitArea
          geometry={hitGeometry}
          material={hitMaterial}
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
          scale={baseScale}
        />
        <mesh
          // Geometry-as-prop + frustumCulled={false} — see WallMoveArrowHandle.
          frustumCulled={false}
          geometry={arrowGeometry}
          material={arrowMaterial}
          raycast={NO_RAYCAST}
          renderOrder={1002}
          scale={scale}
        />
      </group>
    </group>
  )
}

function WallMoveArrowHandle({ wall, handle }: { wall: WallNode; handle: WallMoveHandle }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const hitGeometry = useMemo(() => createArrowHitAreaGeometry(), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
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
  const { camera } = useThree()

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1

  const baseScale = zoom * ARROW_SCALE
  const scale = (isHovered ? 1.12 : 1) * baseScale

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
        document.body.style.cursor = ''
      }
    }
  }, [])

  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const activateWallMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    document.body.style.cursor = 'grabbing'

    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(wall)
    useInteractionScope.getState().endIf((s) => s.kind === 'reshaping' && s.reshape === 'endpoint')
    useInteractionScope.getState().endIf((s) => s.kind === 'reshaping' && s.reshape === 'curve')
    // Keep the wall selected so it stays the active item once the move
    // commits; the `!movingNode` guard on the handles hides them mid-drag.
  }

  return (
    <group position={handle.position} rotation={[0, handle.rotationY, 0]}>
      <InvisibleHandleHitArea
        geometry={hitGeometry}
        material={hitMaterial}
        onPointerDown={activateWallMove}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'grab') {
            document.body.style.cursor = ''
          }
        }}
        scale={baseScale}
      />
      <mesh
        // Pass geometry as a prop (not `<primitive attach="geometry">`)
        // so the mesh is never rendered with R3F's default empty
        // `BufferGeometry`. Combined with `frustumCulled={false}`, the
        // primitive-attach path emits a `Draw(0, 1, 0, 0)` on the first
        // frame and WebGPU flags "Vertex buffer slot 0 ... was not set".
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1002}
        scale={scale}
      />
    </group>
  )
}

function FenceMoveArrowHandle({ fence, handle }: { fence: FenceNode; handle: WallMoveHandle }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const hitGeometry = useMemo(() => createArrowHitAreaGeometry(), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
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
  const { camera } = useThree()

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE
  const scale = (isHovered ? 1.12 : 1) * baseScale

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
        document.body.style.cursor = ''
      }
    }
  }, [])

  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const activateFenceMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    document.body.style.cursor = 'grabbing'

    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(fence)
    useInteractionScope.getState().endIf((s) => s.kind === 'reshaping' && s.reshape === 'endpoint')
    useInteractionScope.getState().endIf((s) => s.kind === 'reshaping' && s.reshape === 'curve')
    // Keep the fence selected so it stays active once the move commits.
  }

  return (
    <group position={handle.position} rotation={[0, handle.rotationY, 0]}>
      <InvisibleHandleHitArea
        geometry={hitGeometry}
        material={hitMaterial}
        onPointerDown={activateFenceMove}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'grab') {
            document.body.style.cursor = ''
          }
        }}
        scale={baseScale}
      />
      <mesh
        // Pass geometry as a prop — see WallMoveArrowHandle for the
        // WebGPU "Vertex buffer slot 0 ... was not set" rationale.
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1002}
        scale={scale}
      />
    </group>
  )
}

function getWallMoveHandles(wall: WallNode): WallMoveHandle[] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)

  if (length < 1e-6) {
    return []
  }

  const frame = isCurvedWall(wall) ? getWallCurveFrameAt(wall, 0.5) : null
  const normal: [number, number] = frame
    ? [frame.normal.x, frame.normal.y]
    : [-dz / length, dx / length]
  const midpoint: [number, number] = frame
    ? [frame.point.x, frame.point.y]
    : [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT
  const handleHeight = Math.max(wallHeight - HANDLE_TOP_INSET, HANDLE_MIN_HEIGHT)
  const offset = Math.max(getWallThickness(wall) / 2 + HANDLE_OFFSET, HANDLE_MIN_OFFSET)

  return [
    buildWallMoveHandle('front', midpoint, normal, offset, handleHeight),
    buildWallMoveHandle('back', midpoint, [-normal[0], -normal[1]], offset, handleHeight),
  ]
}

function WallMoveSideHandlesForFence({ fence }: { fence: FenceNode }) {
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    fence.parentId ? (sceneRegistry.nodes.get(fence.parentId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0

    const resolveLevelObject = () => {
      const nextLevelObject = fence.parentId
        ? (sceneRegistry.nodes.get(fence.parentId) ?? null)
        : null
      setLevelObject((currentLevelObject) => {
        if (currentLevelObject === nextLevelObject) {
          return currentLevelObject
        }
        return nextLevelObject
      })

      if (!nextLevelObject) {
        frameId = window.requestAnimationFrame(resolveLevelObject)
      }
    }

    resolveLevelObject()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [fence.parentId])

  const handles = useMemo(() => getFenceMoveHandles(fence), [fence])

  if (!levelObject || handles.length === 0) return null

  return createPortal(
    <group>
      {handles.map((handle) => (
        <FenceMoveArrowHandle fence={fence} handle={handle} key={handle.key} />
      ))}
    </group>,
    levelObject,
  )
}

function getFenceMoveHandles(fence: FenceNode): WallMoveHandle[] {
  const dx = fence.end[0] - fence.start[0]
  const dz = fence.end[1] - fence.start[1]
  const length = Math.hypot(dx, dz)

  if (length < 1e-6) {
    return []
  }

  const midpoint: [number, number] = [
    (fence.start[0] + fence.end[0]) / 2,
    (fence.start[1] + fence.end[1]) / 2,
  ]
  const normal: [number, number] = [-dz / length, dx / length]
  const fenceHeight = fence.height ?? 1.8
  const handleHeight = Math.max(fenceHeight - HANDLE_TOP_INSET, HANDLE_MIN_HEIGHT)
  const offset = Math.max((fence.thickness ?? 0.1) / 2 + HANDLE_OFFSET, HANDLE_MIN_OFFSET)

  return [
    buildWallMoveHandle('front', midpoint, normal, offset, handleHeight),
    buildWallMoveHandle('back', midpoint, [-normal[0], -normal[1]], offset, handleHeight),
  ]
}

function buildWallMoveHandle(
  key: string,
  midpoint: [number, number],
  direction: [number, number],
  offset: number,
  height: number,
): WallMoveHandle {
  return {
    key,
    position: [midpoint[0] + direction[0] * offset, height, midpoint[1] + direction[1] * offset],
    rotationY: Math.atan2(-direction[1], direction[0]),
  }
}
