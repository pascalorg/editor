'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Camera, type PerspectiveCamera, type Quaternion, Vector3 } from 'three'
import {
  createDroneInput,
  DRONE_SLOW_MULTIPLIER,
  type DroneLook,
  droneInputForKey,
  readDroneInput,
  seedDroneLook,
  stepDroneFlight,
  turnFirstPersonLook,
} from '../../lib/drone-flight'
import useViewer from '../../store/use-viewer'
import { WALKTHROUGH_FOV } from './glb-walkthrough-controller'
import { applyWalkthroughCameraClipping } from './viewer-camera'

const TYPING_TARGET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="textbox"], [role="dialog"], [role="alertdialog"]'

function isTypingTarget(target: EventTarget | null) {
  const element = target as { closest?: (selector: string) => unknown; isContentEditable?: boolean }
  return !!element && (element.isContentEditable === true || !!element.closest?.(TYPING_TARGET))
}

function requestLock(canvas: HTMLCanvasElement) {
  // The request can reject asynchronously (the browser's re-lock cooldown);
  // clicking the canvas asks again.
  const result = canvas.requestPointerLock?.() as Promise<void> | undefined
  if (result && typeof result.catch === 'function') result.catch(() => {})
}

function exitWalkthrough() {
  useViewer.getState().setWalkthroughMode(false)
}

export type DroneControllerProps = {
  /** Freezes flight and look, e.g. while the host renders a still. */
  paused?: boolean
  /** Leaves the drone: Esc, or losing the pointer lock it held. Ends the walkthrough by default. */
  onExit?: () => void
}

/**
 * The free-flying drone camera for any scene, parametric or baked: no gravity,
 * floor or collision, so it needs no collider. Picks up from the current camera
 * pose. Pointer lock drives look (click the canvas to lock); WASD / arrows move
 * along the view, Space or E rises, Q or Ctrl sinks, Shift boosts, Alt slows,
 * P frees the cursor (click or P resumes) and Esc leaves.
 */
export function DroneController({ paused = false, onExit }: DroneControllerProps) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const lookRef = useRef<DroneLook>({ yaw: 0, pitch: 0 })
  const heldKeysRef = useRef(new Set<string>())
  const inputRef = useRef(createDroneInput())
  const velocityRef = useRef(new Vector3())
  const suspendRef = useRef(false)
  const pausedRef = useRef(paused)
  const onExitRef = useRef(onExit)
  const entryPoseRef = useRef<{
    camera: Camera
    position: Vector3
    quaternion: Quaternion
  } | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  // First person needs foreshortening: fly a perspective camera, and give the
  // projection back on exit.
  useEffect(() => {
    const previousMode = useViewer.getState().cameraMode
    if (previousMode === 'orthographic') useViewer.getState().setCameraMode('perspective')
    return () => {
      if (previousMode === 'orthographic') useViewer.getState().setCameraMode('orthographic')
    }
  }, [])

  // Take off from the pose the camera had on entry. Leaving orthographic swaps
  // in a fresh perspective camera, which inherits that pose.
  useEffect(() => {
    const entry = entryPoseRef.current
    if (!entry) {
      entryPoseRef.current = {
        camera,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
      }
    } else if (entry.camera !== camera) {
      camera.position.copy(entry.position)
      camera.quaternion.copy(entry.quaternion)
      camera.updateMatrixWorld(true)
    }
    seedDroneLook(lookRef.current, camera.quaternion)
    velocityRef.current.set(0, 0, 0)
  }, [camera])

  useEffect(() => {
    const perspective = camera as PerspectiveCamera
    if (!perspective.isPerspectiveCamera) return
    const previousFov = perspective.fov
    perspective.fov = WALKTHROUGH_FOV
    perspective.updateProjectionMatrix()
    const restoreClipping = applyWalkthroughCameraClipping(perspective)
    return () => {
      restoreClipping()
      perspective.fov = previousFov
      perspective.updateProjectionMatrix()
    }
  }, [camera])

  useEffect(() => {
    const canvas = gl.domElement
    const heldKeys = heldKeysRef.current
    let wasLocked = false
    const exit = () => (onExitRef.current ?? exitWalkthrough)()

    // Keyboard focus may still sit on the button that started the flight, where
    // Space would press it again.
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && !canvas.contains(activeElement)) {
      activeElement.blur()
    }

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas || pausedRef.current) return
      turnFirstPersonLook(
        lookRef.current,
        event.movementX,
        event.movementY,
        heldKeys.has('AltLeft') || heldKeys.has('AltRight') ? DRONE_SLOW_MULTIPLIER : 1,
      )
    }
    const onClick = () => {
      if (document.pointerLockElement !== canvas) requestLock(canvas)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        exit()
        return
      }
      // P toggles a cursor pause: frees the pointer without leaving the drone —
      // e.g. for an OS screenshot, which needs a movable cursor.
      if (event.code === 'KeyP') {
        event.preventDefault()
        event.stopPropagation()
        if (document.pointerLockElement === canvas) {
          suspendRef.current = true
          heldKeys.clear()
          useViewer.getState().setWalkthroughSuspended(true)
          document.exitPointerLock()
        } else if (suspendRef.current) {
          requestLock(canvas)
        }
        return
      }
      if (!droneInputForKey(event.code)) return
      event.preventDefault()
      event.stopPropagation()
      // Paused, or a system shortcut (⌘⇧4 screenshot): the drone holds still.
      if (suspendRef.current || event.metaKey) return
      heldKeys.add(event.code)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      heldKeys.delete(event.code)
    }
    const onBlur = () => heldKeys.clear()
    const onPointerLockChange = () => {
      if (document.pointerLockElement === canvas) {
        wasLocked = true
        suspendRef.current = false
        useViewer.getState().setWalkthroughSuspended(false)
      } else if (suspendRef.current) {
        // Deliberately released (P) — keep flying once resumed.
      } else if (wasLocked) {
        // Esc while locked: the browser releases the pointer and swallows the key.
        exit()
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    // The toggle that mounted the drone is a user gesture, so the lock is
    // usually granted straight away; the canvas click covers a refusal.
    if (document.pointerLockElement !== canvas) requestLock(canvas)

    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      heldKeys.clear()
      useViewer.getState().setWalkthroughSuspended(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }
  }, [gl])

  useFrame((_, delta) => {
    if (pausedRef.current) return
    readDroneInput(heldKeysRef.current, inputRef.current)
    stepDroneFlight(camera, lookRef.current, inputRef.current, velocityRef.current, delta)
  }, 2.5)

  return null
}
