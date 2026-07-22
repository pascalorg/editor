'use client'

import { KeyboardControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box3,
  BoxGeometry,
  type BufferAttribute,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  type InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { useGLTFKTX2 } from '../../hooks/use-gltf-ktx2'
import { SCENE_LAYER } from '../../lib/layers'
import useViewer from '../../store/use-viewer'
import BVHEcctrl, { type BVHEcctrlApi, type MovementInput } from './bvh-ecctrl'

// First-person FOV. The orbit camera is 50° (set on the Canvas), which feels
// cramped on foot; ~60° vertical (~90° horizontal at 16:9) restores peripheral
// awareness without wide-angle distortion. Applied only while walking — both
// walkthrough controllers read this and restore the orbit FOV on exit.
export const WALKTHROUGH_FOV = 60

// Eye/capsule geometry mirrors the editor's first-person controller so the
// baked walkthrough feels identical. The capsule centre sits below the eye; the
// camera rides the capsule with a small offset and the controller floats it to
// the ground.
const CAMERA_EYE_OFFSET = 0.45
const CONTROLLER_CENTER_FROM_EYE = 0.85
const SPAWN_EYE_HEIGHT = 1.65
const LOOK_SENSITIVITY = 0.002
const VOID_FALL_RESPAWN_DEPTH = 12

// Crouch (hold Ctrl): swap to a short capsule — it shrinks around the centre,
// so a crouch mid-jump also lowers the head AND raises the feet, letting the
// player thread window openings. Standing back up is gated on headroom.
// The float gap counts toward the effective obstacle height (the capsule rides
// floatHeight above the ground), so crouching also lowers it: crouched span is
// CROUCH_FLOAT_HEIGHT + capsule = 0.25 + 0.7 = 0.95 m — fits a 1 m opening.
export const STAND_CAPSULE: [number, number, number, number] = [0.25, 0.8, 4, 8]
export const CROUCH_CAPSULE: [number, number, number, number] = [0.25, 0.2, 4, 8]
export const STAND_FLOAT_HEIGHT = 0.5
export const CROUCH_FLOAT_HEIGHT = 0.25
export const CROUCH_EYE_OFFSET = 0.1
export const CROUCH_WALK_SPEED = 1
export const CROUCH_RUN_SPEED = 1.4
// Headroom (from the capsule centre, upward) required before uncrouching:
// standing raises the centre by half the length delta plus the float delta,
// and the standing capsule top sits standLength/2 + radius above the centre.
export const STAND_CLEARANCE = 1.25
export const EYE_LERP_SPEED = 12

const standClearanceRaycaster = new Raycaster()
const UP = new Vector3(0, 1, 0)

// Kinds that must not block the player: room helpers, the spawn marker, the
// ceiling/roof shell (you walk under them), and door/window leaves — excluding
// the latter lets you pass any doorway whether the leaf is open or shut (the
// wall already has the opening cut into its baked geometry).
const COLLIDER_EXCLUDED_KINDS = new Set(['zone', 'spawn', 'ceiling', 'roof', 'door', 'window'])

const colliderMaterial = new MeshBasicMaterial({ visible: false })

const keyboardMap: Array<{ name: Exclude<keyof MovementInput, 'joystick'>; keys: string[] }> = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]

const cameraOffset = new Vector3()
const cameraEuler = new Euler(0, 0, 0, 'YXZ')
const spawnQuat = new Quaternion()
const spawnEuler = new Euler(0, 0, 0, 'YXZ')
const spawnPos = new Vector3()

type GlbColliderWorld = { mesh: Mesh; minY: number; dispose: () => void }

/** Effective visibility — an invisible ancestor hides the whole subtree. */
function isEffectivelyVisible(object: Object3D) {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function kindOf(object: Object3D): string | undefined {
  let current: Object3D | null = object
  while (current) {
    const kind = (current.userData as { kind?: string }).kind
    if (kind) return kind
    current = current.parent
  }
  return undefined
}

// Coerce any position attribute (quantized/interleaved) to a plain Float32 one
// so mergeGeometries can combine geometries that don't share an array type.
function toFloat32Position(source: BufferAttribute | InterleavedBufferAttribute) {
  const array = new Float32Array(source.count * 3)
  for (let i = 0; i < source.count; i++) {
    array[i * 3] = source.getX(i)
    array[i * 3 + 1] = source.getY(i)
    array[i * 3 + 2] = source.getZ(i)
  }
  return new Float32BufferAttribute(array, 3)
}

const FALLBACK_THICKNESS = 0.08
const GROUND_MIN = 2000

/** A thin position-only floor box whose top face sits at `topY`. */
function boxFloorGeometry(
  cx: number,
  topY: number,
  cz: number,
  width: number,
  depth: number,
): BufferGeometry {
  const box = new BoxGeometry(width, FALLBACK_THICKNESS, depth).toNonIndexed()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', (box.getAttribute('position') as BufferAttribute).clone())
  box.dispose()
  geometry.applyMatrix4(new Matrix4().makeTranslation(cx, topY - FALLBACK_THICKNESS / 2, cz))
  return geometry
}

// Fallback ground so the player never falls into the void: a single large
// ground plane at the lowest level (level 0). Upper levels rely on their own
// baked slabs — a slab-less upper floor lets you fall down to the ground, which
// the ground plane catches. (Mirrors the editor walkthrough's site ground.)
function addFallbackFloors(scene: Object3D, geometries: BufferGeometry[]) {
  const sceneBounds = new Box3()
  for (const geometry of geometries) {
    geometry.computeBoundingBox()
    if (geometry.boundingBox) sceneBounds.union(geometry.boundingBox)
  }

  const center = new Vector3()
  const levelPos = new Vector3()
  let lowestLevelY = Number.POSITIVE_INFINITY

  scene.traverse((object) => {
    if ((object.userData as { kind?: string }).kind !== 'level') return
    object.updateWorldMatrix(true, false)
    object.getWorldPosition(levelPos)
    lowestLevelY = Math.min(lowestLevelY, levelPos.y)
  })

  if (sceneBounds.isEmpty()) return
  sceneBounds.getCenter(center)
  const groundY = Number.isFinite(lowestLevelY) ? lowestLevelY : sceneBounds.min.y
  geometries.push(boxFloorGeometry(center.x, groundY, center.z, GROUND_MIN, GROUND_MIN))
}

/** Merge the baked GLB's walkable/blocking meshes into one BVH collider. */
function buildGlbColliderWorld(scene: Object3D): GlbColliderWorld | null {
  scene.updateWorldMatrix(true, true)
  const geometries: BufferGeometry[] = []

  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    // Zone fills live on a separate layer (and never collide).
    if (!mesh.layers.isEnabled(SCENE_LAYER)) return
    if (!isEffectivelyVisible(mesh)) return
    const kind = kindOf(mesh)
    if (kind && COLLIDER_EXCLUDED_KINDS.has(kind)) return
    const position = mesh.geometry?.getAttribute('position')
    if (!position || position.count < 3) return

    const geometry = new BufferGeometry()
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    geometry.setAttribute('position', toFloat32Position(source.getAttribute('position')))
    if (mesh.geometry.index) source.dispose()
    geometry.applyMatrix4(mesh.matrixWorld)
    geometries.push(geometry)
  })

  if (geometries.length === 0) return null

  addFallbackFloors(scene, geometries)

  const merged = mergeGeometries(geometries, false)
  for (const geometry of geometries) geometry.dispose()
  if (!merged || merged.getAttribute('position') == null) {
    merged?.dispose()
    return null
  }
  ;(merged as any).computeBoundsTree = computeBoundsTree
  ;(merged as any).disposeBoundsTree = disposeBoundsTree
  ;(merged as any).computeBoundsTree({ maxLeafSize: 12, strategy: 0 })
  merged.computeBoundingBox()

  const mesh = new Mesh(merged, colliderMaterial)
  mesh.raycast = acceleratedRaycast
  mesh.visible = true
  mesh.userData = {
    type: 'STATIC',
    friction: 0.8,
    restitution: 0.05,
    excludeFloatHit: false,
    excludeCollisionCheck: false,
  }
  mesh.updateMatrixWorld(true)

  return {
    mesh,
    minY: merged.boundingBox?.min.y ?? 0,
    dispose: () => {
      ;(merged as any).disposeBoundsTree?.()
      merged.dispose()
    },
  }
}

/** The baked spawn marker's eye position + yaw, if the artifact carries one. */
function resolveGlbSpawn(
  scene: Object3D,
): { position: [number, number, number]; yaw: number } | null {
  let spawn: Object3D | null = null
  scene.traverse((object) => {
    if ((object.userData as { kind?: string }).kind === 'spawn') spawn = object
  })
  if (!spawn) return null
  const node = spawn as Object3D
  node.updateWorldMatrix(true, false)
  node.getWorldPosition(spawnPos)
  node.getWorldQuaternion(spawnQuat)
  spawnEuler.setFromQuaternion(spawnQuat, 'YXZ')
  return {
    position: [spawnPos.x, spawnPos.y + SPAWN_EYE_HEIGHT, spawnPos.z],
    yaw: spawnEuler.y,
  }
}

/**
 * First-person walkthrough controller for the baked GLB. Reuses the editor's
 * `BVHEcctrl` capsule character controller (gravity, jump, sprint, ground-float,
 * mesh collision) fed a collider built from the artifact's own geometry — so the
 * baked viewer walks the building with the same physics as the editor, without
 * the parametric scene. Pointer-lock drives look; WASD moves; Space jumps; Shift
 * sprints. Door/window interaction stays in `GlbScene` (its centre-ray HUD).
 */
export function GlbWalkthroughController({ url }: { url: string }) {
  const { camera, gl } = useThree()
  const gltf = useGLTFKTX2(url) as unknown as { scene: Object3D }

  const worldRef = useRef<GlbColliderWorld | null>(null)
  const controllerRef = useRef<BVHEcctrlApi | null>(null)
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const crouchKeyRef = useRef(false)
  const suspendRef = useRef(false)
  const eyeOffsetRef = useRef(CAMERA_EYE_OFFSET)
  const [crouched, setCrouched] = useState(false)
  const [start, setStart] = useState<{ position: [number, number, number] } | null>(null)
  const [world, setWorld] = useState<GlbColliderWorld | null>(null)

  // Build the collider on the first frame (priority after GlbScene's level loop,
  // which snaps the floors to their stacked world positions in walkthrough) so it
  // matches the rendered building rather than a mid-lerp / exploded layout.
  const builtRef = useRef(false)
  useFrame(() => {
    if (builtRef.current) return
    builtRef.current = true
    setWorld(buildGlbColliderWorld(gltf.scene))
  }, 6)

  // First-person needs a perspective camera — an orthographic projection has no
  // foreshortening and makes the walkthrough unusable. Force perspective while
  // walking and restore the prior projection on exit.
  useEffect(() => {
    const prevMode = useViewer.getState().cameraMode
    if (prevMode === 'orthographic') useViewer.getState().setCameraMode('perspective')
    return () => {
      if (prevMode === 'orthographic') useViewer.getState().setCameraMode('orthographic')
    }
  }, [])

  // Widen FOV while walking; the baked walkthrough rides the default 50° orbit
  // camera, which feels cramped on foot. Keyed on `camera` so it re-applies if
  // the instance swaps (e.g. the ortho→perspective switch above), restoring the
  // prior FOV on exit.
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const prevFov = cam.fov
    cam.fov = WALKTHROUGH_FOV
    cam.updateProjectionMatrix()
    return () => {
      cam.fov = prevFov
      cam.updateProjectionMatrix()
    }
  }, [camera])

  useEffect(() => {
    worldRef.current = world
    if (world) {
      const triangles = world.mesh.geometry.getAttribute('position').count / 3
      console.warn('[glb-walkthrough] collider built', {
        triangles,
        minY: world.minY,
        hasBoundsTree: !!(world.mesh.geometry as { boundsTree?: unknown }).boundsTree,
        spawn: resolveGlbSpawn(gltf.scene),
      })
    } else {
      console.warn('[glb-walkthrough] NO collider world (no eligible meshes)')
    }
    return () => {
      world?.dispose()
      worldRef.current = null
    }
  }, [world, gltf.scene])

  // Resolve the spawn once the collider exists; the capsule centre sits below
  // the eye, then the controller floats it onto the ground.
  useEffect(() => {
    if (!world || start) return
    const spawn = resolveGlbSpawn(gltf.scene)
    const eye = spawn?.position ?? [0, SPAWN_EYE_HEIGHT, 0]
    yawRef.current = spawn?.yaw ?? 0
    pitchRef.current = 0
    setStart({ position: [eye[0], eye[1] - CONTROLLER_CENTER_FROM_EYE, eye[2]] })
  }, [world, start, gltf.scene])

  // Pointer-lock look + click-to-lock fallback + Esc/unlock to exit. Once the
  // pointer has been locked, releasing it (Esc — the browser swallows that
  // keydown, so we can't rely on it; or any other unlock) leaves the walkthrough
  // in a single press rather than just freeing the cursor.
  useEffect(() => {
    const canvas = gl.domElement
    let wasLocked = false
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      yawRef.current -= event.movementX * LOOK_SENSITIVITY
      pitchRef.current = Math.max(
        -(Math.PI / 2 - 0.05),
        Math.min(Math.PI / 2 - 0.05, pitchRef.current - event.movementY * LOOK_SENSITIVITY),
      )
    }
    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // When locked, the browser intercepts Esc to release the pointer and the
      // pointerlockchange handler below exits; this only covers Esc while the
      // pointer is already free (e.g. lock never engaged).
      if (event.code === 'Escape' && document.pointerLockElement !== canvas) {
        useViewer.getState().setWalkthroughMode(false)
      }
      // P toggles a cursor pause (advertised in the HUD): frees the pointer
      // without leaving the walkthrough — e.g. for an OS screenshot, which
      // needs a movable cursor — and click or P resumes.
      if (event.code === 'KeyP') {
        if (document.pointerLockElement === canvas) {
          suspendRef.current = true
          useViewer.getState().setWalkthroughSuspended(true)
          document.exitPointerLock()
        } else if (suspendRef.current) {
          const result = canvas.requestPointerLock?.() as Promise<void> | undefined
          if (result && typeof result.catch === 'function') result.catch(() => {})
        }
      }
      // While paused (P), crouch is frozen as-is — ⌃⇧⌘4 (clipboard screenshot)
      // must not toggle it under the user.
      if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !suspendRef.current) {
        crouchKeyRef.current = true
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !suspendRef.current) {
        crouchKeyRef.current = false
      }
    }
    const onBlur = () => {
      if (!suspendRef.current) crouchKeyRef.current = false
    }
    const onPointerLockChange = () => {
      if (document.pointerLockElement === canvas) {
        wasLocked = true
        suspendRef.current = false
        useViewer.getState().setWalkthroughSuspended(false)
      } else if (suspendRef.current) {
        // Deliberately released (screenshot pause) — stay in walkthrough.
      } else if (wasLocked) {
        useViewer.getState().setWalkthroughMode(false)
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      useViewer.getState().setWalkthroughSuspended(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }
  }, [gl])

  // Lock the pointer the moment the walkthrough is ready, so the user doesn't
  // have to click the canvas first. The walkthrough toggle is itself a user
  // gesture; if the browser still rejects the request (no transient activation
  // left), the click-to-lock fallback above covers it.
  useEffect(() => {
    if (!(world && start)) return
    const canvas = gl.domElement
    if (document.pointerLockElement === canvas) return
    const result = canvas.requestPointerLock?.() as Promise<void> | undefined
    if (result && typeof result.catch === 'function') result.catch(() => {})
  }, [gl, world, start])

  const setControllerApi = useCallback((api: BVHEcctrlApi | null) => {
    controllerRef.current = api
  }, [])

  const hasStandingClearance = useCallback((position: Vector3) => {
    const mesh = worldRef.current?.mesh
    if (!mesh) return true
    standClearanceRaycaster.set(position, UP)
    standClearanceRaycaster.far = STAND_CLEARANCE
    return standClearanceRaycaster.intersectObject(mesh, false).length === 0
  }, [])

  // Drive the camera from the capsule each frame + respawn if it falls into void.
  useFrame((_, delta) => {
    const group = controllerRef.current?.group
    if (!group) return

    if (start && world && group.position.y < world.minY - VOID_FALL_RESPAWN_DEPTH) {
      group.position.set(start.position[0], start.position[1], start.position[2])
      controllerRef.current?.resetLinVel()
    }

    // Crouch follows the held key; standing back up waits for headroom.
    // Frozen while the cursor pause is active.
    if (!suspendRef.current && crouchKeyRef.current !== crouched) {
      if (crouchKeyRef.current) setCrouched(true)
      else if (hasStandingClearance(group.position)) setCrouched(false)
    }
    const targetEyeOffset = crouched ? CROUCH_EYE_OFFSET : CAMERA_EYE_OFFSET
    eyeOffsetRef.current +=
      (targetEyeOffset - eyeOffsetRef.current) * Math.min(1, delta * EYE_LERP_SPEED)

    group.rotation.y = 0
    camera.position.copy(group.position).add(cameraOffset.set(0, eyeOffsetRef.current, 0))
    cameraEuler.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(cameraEuler)
    camera.updateMatrixWorld(true)
  }, 2.5)

  if (!(world && start)) return null

  return (
    <KeyboardControls map={keyboardMap}>
      <BVHEcctrl
        acceleration={26}
        airDragFactor={0.3}
        colliderCapsuleArgs={crouched ? CROUCH_CAPSULE : STAND_CAPSULE}
        colliderMeshes={[world.mesh]}
        collisionCheckIteration={3}
        collisionPushBackDamping={0.1}
        collisionPushBackThreshold={0.001}
        deceleration={30}
        delay={0}
        fallGravityFactor={4}
        floatCheckType="BOTH"
        floatDampingC={36}
        floatHeight={crouched ? CROUCH_FLOAT_HEIGHT : STAND_FLOAT_HEIGHT}
        floatPullBackHeight={0.35}
        floatSensorRadius={0.15}
        floatSpringK={1200}
        gravity={9.81}
        jumpVel={5}
        maxRunSpeed={crouched ? CROUCH_RUN_SPEED : 5}
        maxSlope={1.2}
        maxWalkSpeed={crouched ? CROUCH_WALK_SPEED : 2}
        position={start.position}
        ref={setControllerApi}
      />
    </KeyboardControls>
  )
}
