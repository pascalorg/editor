'use client'

import {
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  type FenceNode,
  getWallCurveFrameAt,
  getWallThickness,
  isCurvedWall,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Object3D,
  OrthographicCamera,
  Plane,
  Shape,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

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
const CORNER_HEX_RADIUS = 0.16
const CORNER_DASH_SIZE = 0.1
const CORNER_GAP_SIZE = 0.07
const CORNER_DASH_THICKNESS = 0.006
const CORNER_FLOOR_OFFSET = 0.01
const GROUND_MENU_FACE_CLEARANCE = 0.85
const GROUND_MENU_SPACING = 0.32
const GROUND_ICON_SIZE = 0.22
const GROUND_ICON_LIFT = 0.1
// Dead-zone width (world units) around the wall plane before the menu
// commits to the opposite face. Prevents per-frame flicker when the
// camera orbits along the wall plane and floating-point jitter pushes
// the camera-to-wall projection across zero.
const GROUND_MENU_SIDE_HYSTERESIS = 0.1
// Per-second lerp factor for position + rotation. Picked so a side-flip
// finishes in ~250 ms — fast enough to feel responsive, slow enough that
// the eye reads it as the three icons swinging around the wall together
// instead of three separate teleports.
const GROUND_MENU_LERP_RATE = 14

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
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelOffset: 0,
    bevelSegments: 10,
    curveSegments: 16,
    steps: 1,
  })

  // Centre the extruded plate around y=0 and re-orient it so the depth
  // axis points up: the chevron lies flat in the XZ plane, tip along +X,
  // wings spread across ±Z.
  geometry.translate(0, 0, -0.04)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function WallMoveSideHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  const movingWallEndpoint = useEditor((state) => state.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedNode = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'wall' || node?.type === 'fence' ? node : null
  })

  const shouldRender =
    Boolean(selectedNode) &&
    !isFloorplanHovered &&
    mode !== 'delete' &&
    !movingNode &&
    !movingWallEndpoint &&
    !movingFenceEndpoint &&
    !curvingWall &&
    !curvingFence

  if (!shouldRender || !selectedNode) return null

  return selectedNode.type === 'wall' ? (
    <WallMoveSideHandlesForWall wall={selectedNode} />
  ) : (
    <WallMoveSideHandlesForFence fence={selectedNode} />
  )
}

function WallMoveSideHandlesForWall({ wall }: { wall: WallNode }) {
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

  const handles = useMemo(() => getWallMoveHandles(wall), [wall])

  if (!levelObject || handles.length === 0) return null

  return createPortal(
    <group>
      {handles.map((handle) => (
        <WallMoveArrowHandle handle={handle} key={handle.key} wall={wall} />
      ))}
      <WallHeightArrowHandle wall={wall} />
      <WallCornerLeaderHandle endpoint="start" wall={wall} />
      <WallCornerLeaderHandle endpoint="end" wall={wall} />
      <WallGroundActionMenuV2 wall={wall} />
    </group>,
    levelObject,
  )
}

function WallGroundActionMenuV2({ wall }: { wall: WallNode }) {
  // Subscribe to children so the curve icon hides/shows reactively when
  // doors / windows / wall-attached items get added or removed.
  const canCurve = useScene((state) => {
    return !(wall.children ?? []).some((childId) => {
      const child = state.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = (child as { asset?: { attachTo?: string } }).asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
  })

  const menuGroupRef = useRef<Group>(null)
  const sideRef = useRef<number>(1)
  const initializedForWallIdRef = useRef<string | null>(null)

  // Per-frame transform update — geometry, side decision, and target pose
  // are all (re)computed inside useFrame instead of being captured from
  // render closures, so the menu tracks the wall through edit paths that
  // bypass React (e.g. mid-drag `useLiveNodeOverrides` writes), and the
  // side decision can carry frame-to-frame hysteresis.
  useFrame((state, dt) => {
    const menu = menuGroupRef.current
    if (!menu) return

    // Curved walls: chord midpoint is off the centerline, so we sample
    // the curve frame at t=0.5 to get a true centerline midpoint + a
    // perpendicular normal — keeps the menu equidistant on either face.
    const curveFrame = isCurvedWall(wall) ? getWallCurveFrameAt(wall, 0.5) : null
    let midX: number
    let midZ: number
    let dirX: number
    let dirZ: number
    let normalX: number
    let normalZ: number

    if (curveFrame) {
      midX = curveFrame.point.x
      midZ = curveFrame.point.y
      normalX = curveFrame.normal.x
      normalZ = curveFrame.normal.y
      dirX = curveFrame.normal.y
      dirZ = -curveFrame.normal.x
    } else {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) return
      midX = (wall.start[0] + wall.end[0]) / 2
      midZ = (wall.start[1] + wall.end[1]) / 2
      dirX = dx / len
      dirZ = dz / len
      normalX = -dirZ
      normalZ = dirX
    }

    // Offset from the wall *face* (centerline + half-thickness), so the
    // menu always sits clearly outside the wall mesh.
    const offset = getWallThickness(wall) / 2 + GROUND_MENU_FACE_CLEARANCE

    const projection =
      (state.camera.position.x - midX) * normalX +
      (state.camera.position.z - midZ) * normalZ

    const isFreshWall = initializedForWallIdRef.current !== wall.id

    // Hysteresis: only flip when the camera is clearly past the wall
    // plane. The previous binary `projection >= 0 ? 1 : -1` flickered
    // on grazing orbits and the resulting per-frame 180° flip is what
    // visually fanned the three icons across each other — the outer
    // two (curve, delete) crossed while the centre one (duplicate,
    // offsetIndex 0) barely moved, reading as "icons move one at a time."
    const currentSide = sideRef.current
    let nextSide: number
    if (isFreshWall) {
      nextSide = projection >= 0 ? 1 : -1
    } else if (currentSide >= 0 && projection < -GROUND_MENU_SIDE_HYSTERESIS) {
      nextSide = -1
    } else if (currentSide < 0 && projection > GROUND_MENU_SIDE_HYSTERESIS) {
      nextSide = 1
    } else {
      nextSide = currentSide
    }
    sideRef.current = nextSide

    const targetX = midX + normalX * offset * nextSide
    const targetZ = midZ + normalZ * offset * nextSide
    const targetRot = Math.atan2(-nextSide * dirZ, nextSide * dirX)

    if (isFreshWall) {
      // First frame for this wall — snap so the menu doesn't slide in
      // from the previous wall's pose (or the default origin).
      menu.position.set(targetX, GROUND_ICON_LIFT, targetZ)
      menu.rotation.y = targetRot
      initializedForWallIdRef.current = wall.id
      return
    }

    const t = 1 - Math.exp(-dt * GROUND_MENU_LERP_RATE)
    menu.position.x += (targetX - menu.position.x) * t
    menu.position.z += (targetZ - menu.position.z) * t
    menu.position.y = GROUND_ICON_LIFT

    // Shortest angular path — a ~180° side-flip target must rotate the
    // short way around, otherwise the menu unwinds the long way and the
    // icons trace an even more dramatic arc.
    let rotDelta = targetRot - menu.rotation.y
    while (rotDelta > Math.PI) rotDelta -= 2 * Math.PI
    while (rotDelta < -Math.PI) rotDelta += 2 * Math.PI
    menu.rotation.y += rotDelta * t
  })

  // Don't render an empty menu shell for degenerate walls.
  const segLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (segLength < 1e-6) return null

  const items: Array<'curve' | 'duplicate' | 'delete'> = []
  if (canCurve) items.push('curve')
  items.push('duplicate')
  items.push('delete')
  const centerIndex = (items.length - 1) / 2

  return (
    <group ref={menuGroupRef}>
      {items.map((kind, index) => (
        <WallGroundActionIconV2
          key={kind}
          kind={kind}
          offsetIndex={index - centerIndex}
          wall={wall}
        />
      ))}
    </group>
  )
}

function WallGroundActionIconV2({
  wall,
  kind,
  offsetIndex,
}: {
  wall: WallNode
  kind: 'curve' | 'duplicate' | 'delete'
  offsetIndex: number
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
        // `alphaTest` discards the transparent background pixels of the
        // SVG icon outright. Without it the WebGPU node-material pipeline
        // alpha-blends the plane as a translucent square, which is what
        // shows up when the wall sits between the camera and the icon
        // (because `depthTest: false` keeps the plane drawing over the
        // wall).
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

    if (kind === 'curve') {
      useViewer.getState().setSelection({ selectedIds: [] })
      useEditor.getState().setCurvingWall(wall)
      return
    }
    if (kind === 'delete') {
      sfxEmitter.emit('sfx:structure-delete')
      useViewer.getState().setSelection({ selectedIds: [] })
      useScene.getState().deleteNode(wall.id as AnyNodeId)
      return
    }
    // duplicate
    useScene.temporal.getState().pause()
    const input = structuredClone(wall) as Record<string, unknown>
    delete input.id
    const existingMetadata =
      input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : {}
    input.metadata = { ...existingMetadata, isNew: true }
    try {
      const dup = WallNode.parse(input)
      useScene.getState().createNode(dup, dup.parentId as AnyNodeId)
      useEditor.getState().setMovingNode(dup)
    } catch (err) {
      console.error('Failed to duplicate wall', err)
      useScene.temporal.getState().resume()
    }
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  return (
    <group
      onPointerDown={onPointerDown}
      onPointerEnter={(event) => {
        event.stopPropagation()
        setIsHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerLeave={(event) => {
        event.stopPropagation()
        setIsHovered(false)
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = ''
        }
      }}
      position={[offsetIndex * GROUND_MENU_SPACING, 0, 0]}
      scale={scale}
    >
      <mesh material={material} renderOrder={1004} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GROUND_ICON_SIZE, GROUND_ICON_SIZE]} />
      </mesh>
    </group>
  )
}

// Lucide icon paths — match the Spline / Copy / Trash2 icons the HTML
// floating menu uses. Stroke is white so material.color can tint them.
const ICON_SVGS: Record<'curve' | 'duplicate' | 'delete', string> = {
  curve: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/></svg>`,
  duplicate: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  delete: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
}

const ICON_TEXTURE_CACHE = new Map<string, CanvasTexture>()
const ICON_TEXTURE_SIZE = 128

function getIconTexture(kind: 'curve' | 'duplicate' | 'delete'): CanvasTexture {
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
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.25 : 1) * zoom

  const corner = endpoint === 'start' ? wall.start : wall.end
  const x = corner[0]
  const z = corner[1]
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT

  const dashedGeometry = useMemo(() => buildDashedVerticalGeometry(wallHeight), [wallHeight])
  useEffect(() => () => dashedGeometry.dispose(), [dashedGeometry])

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
  // recognisable regardless of viewing angle. Assumes the parent level
  // has no rotation, which is the standard case.
  useFrame(() => {
    if (billboardRef.current) {
      billboardRef.current.quaternion.copy(camera.quaternion)
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
    sfxEmitter.emit('sfx:item-pick')
    document.body.style.cursor = 'grabbing'
    useEditor.getState().setMovingWallEndpoint({ wall, endpoint })
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
      <group position={[x, CORNER_FLOOR_OFFSET, z]} ref={billboardRef} scale={scale}>
        <mesh
          material={hexMaterial}
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

function WallHeightArrowHandle({ wall }: { wall: WallNode }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        depthTest: true,
        depthWrite: true,
        transparent: false,
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
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT
  const handleY = wallHeight + HEIGHT_HANDLE_OFFSET

  const activateHeightResize = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
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

    document.body.style.cursor = 'ns-resize'
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setResizingWallHeight(wall)
    // Suppress R3F node pointer events until pointerup completes so the
    // synthesized click doesn't reroute selection to whatever mesh sits
    // under the cursor at release.
    useViewer.getState().setHandleDragging(true)
    useScene.temporal.getState().pause()

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const intersection = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return
      const newHeight = Math.max(MIN_WALL_HEIGHT, initialHeight + (intersection.y - initialY))
      useScene.getState().updateNode(wallId, { height: newHeight })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'ns-resize') {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setResizingWallHeight(null)
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
    <group position={[midX, handleY, midZ]} rotation={[0, wallAngle, 0]}>
      <group rotation={[0, Math.PI / 2, Math.PI / 2]} scale={scale}>
        <mesh
          // Geometry-as-prop + frustumCulled={false} — see WallMoveArrowHandle.
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
          renderOrder={1002}
        />
      </group>
    </group>
  )
}

function WallMoveArrowHandle({ wall, handle }: { wall: WallNode; handle: WallMoveHandle }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        depthTest: true,
        depthWrite: true,
        transparent: false,
        opacity: 1,
      }),
    [],
  )
  const { camera } = useThree()

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1

  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE

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
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const activateWallMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    document.body.style.cursor = 'grabbing'

    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(wall)
    useEditor.getState().setMovingWallEndpoint(null)
    useEditor.getState().setMovingFenceEndpoint(null)
    useEditor.getState().setCurvingWall(null)
    useEditor.getState().setCurvingFence(null)
    // Keep the wall selected so it stays the active item once the move
    // commits; the `!movingNode` guard on the handles hides them mid-drag.
  }

  return (
    <group position={handle.position} rotation={[0, handle.rotationY, 0]} scale={scale}>
      <mesh
        // Pass geometry as a prop (not `<primitive attach="geometry">`)
        // so the mesh is never rendered with R3F's default empty
        // `BufferGeometry`. Combined with `frustumCulled={false}`, the
        // primitive-attach path emits a `Draw(0, 1, 0, 0)` on the first
        // frame and WebGPU flags "Vertex buffer slot 0 ... was not set".
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
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
        renderOrder={1002}
      />
    </group>
  )
}

function FenceMoveArrowHandle({ fence, handle }: { fence: FenceNode; handle: WallMoveHandle }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])
  const arrowMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        depthTest: true,
        depthWrite: true,
        transparent: false,
        opacity: 1,
      }),
    [],
  )
  const { camera } = useThree()

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE

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
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])

  const activateFenceMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    document.body.style.cursor = 'grabbing'

    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(fence)
    useEditor.getState().setMovingWallEndpoint(null)
    useEditor.getState().setMovingFenceEndpoint(null)
    useEditor.getState().setCurvingWall(null)
    useEditor.getState().setCurvingFence(null)
    // Keep the fence selected so it stays active once the move commits.
  }

  return (
    <group position={handle.position} rotation={[0, handle.rotationY, 0]} scale={scale}>
      <mesh
        // Pass geometry as a prop — see WallMoveArrowHandle for the
        // WebGPU "Vertex buffer slot 0 ... was not set" rationale.
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}

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
        renderOrder={1002}
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
