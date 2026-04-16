'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Euler, Vector3 } from 'three'
import useEditor from '../../store/use-editor'

// Average human eye height in meters
const EYE_HEIGHT = 1.65
// Movement speed in meters per second
const MOVE_SPEED = 5
// Sprint multiplier when holding Shift
const SPRINT_MULTIPLIER = 2
// Vertical float speed in meters per second
const VERTICAL_SPEED = 3
// Mouse look sensitivity
const MOUSE_SENSITIVITY = 0.002
// Min Y position (eye height above ground)
const MIN_Y = EYE_HEIGHT

// Reusable vectors to avoid allocations in the render loop
const _forward = new Vector3()
const _right = new Vector3()
const _moveVector = new Vector3()
const _euler = new Euler(0, 0, 0, 'YXZ')

export const FirstPersonControls = () => {
  const { camera, gl } = useThree()
  const keysRef = useRef<Set<string>>(new Set())
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const isLockedRef = useRef(false)
  const initializedRef = useRef(false)

  // Initialize camera for first-person view: start at center of scene, on the ground
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    // Place camera at the origin (center of grid) at eye height, looking along +X
    camera.position.set(0, EYE_HEIGHT, 0)
    yawRef.current = 0
    pitchRef.current = 0
  }, [camera])

  // Pointer lock and event handlers
  useEffect(() => {
    const canvas = gl.domElement

    const requestLock = () => {
      if (!isLockedRef.current) {
        canvas.requestPointerLock()
      }
    }

    const handlePointerLockChange = () => {
      isLockedRef.current = document.pointerLockElement === canvas
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isLockedRef.current) return

      yawRef.current -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      // Clamp pitch to prevent flipping (almost straight up/down)
      pitchRef.current = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, pitchRef.current),
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const code = e.code

      // Movement keys
      if (
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code === 'KeyQ' ||
        code === 'KeyE' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight'
      ) {
        e.preventDefault()
        e.stopPropagation()
        keysRef.current.add(code)
      }

      // ESC exits first-person mode
      if (code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (document.pointerLockElement === canvas) {
          document.exitPointerLock()
        }
        useEditor.getState().setFirstPersonMode(false)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code)
    }

    canvas.addEventListener('click', requestLock)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    document.addEventListener('mousemove', handleMouseMove)
    // Use capture phase so we intercept movement keys before the global keyboard handler
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp)

    return () => {
      canvas.removeEventListener('click', requestLock)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp)
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock()
      }
      keysRef.current.clear()
    }
  }, [gl])

  // Per-frame movement and camera rotation
  useFrame((_, delta) => {
    // Clamp delta to avoid huge jumps (e.g. tab switching)
    const dt = Math.min(delta, 0.1)
    const keys = keysRef.current

    const isSprinting = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const speed = MOVE_SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1)

    // Calculate forward and right vectors on the XZ plane (ignore pitch for movement)
    _forward.set(-Math.sin(yawRef.current), 0, -Math.cos(yawRef.current))
    _right.set(Math.cos(yawRef.current), 0, -Math.sin(yawRef.current))

    _moveVector.set(0, 0, 0)

    if (keys.has('KeyW')) _moveVector.add(_forward)
    if (keys.has('KeyS')) _moveVector.sub(_forward)
    if (keys.has('KeyA')) _moveVector.sub(_right)
    if (keys.has('KeyD')) _moveVector.add(_right)

    // Normalize diagonal movement so it's not faster
    if (_moveVector.lengthSq() > 0) {
      _moveVector.normalize().multiplyScalar(speed * dt)
      camera.position.add(_moveVector)
    }

    // Vertical movement (Q = up, E = down)
    if (keys.has('KeyQ')) {
      camera.position.y += VERTICAL_SPEED * dt
    }
    if (keys.has('KeyE')) {
      camera.position.y -= VERTICAL_SPEED * dt
    }

    // Clamp Y so camera never goes below ground level + eye height
    if (camera.position.y < MIN_Y) {
      camera.position.y = MIN_Y
    }

    // Apply look rotation
    _euler.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(_euler)
  })

  return null
}

/**
 * Overlay UI for first-person mode: crosshair, controls hint, exit button.
 * Rendered as a regular DOM overlay (not inside the Canvas).
 */
export const FirstPersonOverlay = ({ onExit }: { onExit: () => void }) => {
  const handleExit = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    onExit()
  }, [onExit])

  // Track the R3F canvas's bounding rect so the crosshair centers over
  // the actual viewer area instead of the whole browser viewport. The
  // overlay is mounted under a `fixed inset-0` wrapper in the editor
  // layout, which pushes it across the entire page, so a naive
  // `flex items-center justify-center` ends up centering on the
  // browser window — not the Canvas — whenever the sidebar is visible.
  // Re-measure on resize so the crosshair follows panel collapses and
  // window drags.
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    const update = () => {
      setCanvasRect(canvas.getBoundingClientRect())
    }
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])

  return (
    <>
      {/* Crosshair — positioned to match the canvas bounding rect so
          it sits in the viewer's visual center, not the browser
          viewport's center. Falls back to `inset: 0` full-screen
          centering if the canvas hasn't been measured yet (first
          render before the effect runs). */}
      <div
        className="pointer-events-none fixed z-40 flex items-center justify-center"
        style={
          canvasRect
            ? {
                left: canvasRect.left,
                top: canvasRect.top,
                width: canvasRect.width,
                height: canvasRect.height,
              }
            : { inset: 0 }
        }
      >
        <div className="relative h-6 w-6">
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/60" />
          <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-white/60" />
        </div>
      </div>

      {/* Exit button — top-right */}
      <div className="fixed top-4 right-4 z-50">
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border/40 bg-background/90 px-4 py-2 font-medium text-foreground text-sm shadow-lg backdrop-blur-xl transition-colors hover:bg-background"
          onClick={handleExit}
          type="button"
        >
          <kbd className="rounded border border-border/50 bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
          Exit Street View
        </button>
      </div>

      {/* Controls hint — bottom-center */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
        <div className="flex items-center gap-4 rounded-2xl border border-border/35 bg-background/80 px-5 py-3 shadow-lg backdrop-blur-xl">
          <ControlHint label="Move" keys={['W', 'A', 'S', 'D']} />
          <div className="h-5 w-px bg-border/30" />
          <ControlHint label="Up" keys={['Q']} />
          <ControlHint label="Down" keys={['E']} />
          <div className="h-5 w-px bg-border/30" />
          <ControlHint label="Sprint" keys={['Shift']} />
          <div className="h-5 w-px bg-border/30" />
          <span className="text-muted-foreground/60 text-xs">Click to look around</span>
        </div>
      </div>
    </>
  )
}

function ControlHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="font-medium text-[10px] text-muted-foreground/60 tracking-[0.03em]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {keys.map((key) => (
          <kbd
            className="flex h-5 min-w-5 items-center justify-center rounded border border-border/50 bg-accent/40 px-1 font-mono text-[10px] text-foreground/80 leading-none"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}
