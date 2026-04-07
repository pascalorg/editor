'use client'

import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import useViewer from '../../store/use-viewer'

const MOVE_SPEED = 5
const EYE_HEIGHT = 1.6

const _direction = new Vector3()
const _forward = new Vector3()
const _right = new Vector3()

export const WalkthroughControls = () => {
  const controlsRef = useRef<any>(null!)
  const walkthroughMode = useViewer((s: any) => s.walkthroughMode)
  const keys = useRef({ w: false, a: false, s: false, d: false })
  const camera = useThree((s) => s.camera)

  // Set initial eye height
  useEffect(() => {
    if (walkthroughMode) {
      camera.position.y = EYE_HEIGHT
    }
  }, [walkthroughMode, camera])

  // Keyboard handlers
  useEffect(() => {
    if (!walkthroughMode) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toLowerCase()

      // ESC exits walkthrough mode completely
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useViewer.getState().setWalkthroughMode(false)
        return
      }

      if (key === 'w' || key === 'arrowup') keys.current.w = true
      if (key === 'a' || key === 'arrowleft') keys.current.a = true
      if (key === 's' || key === 'arrowdown') keys.current.s = true
      if (key === 'd' || key === 'arrowright') keys.current.d = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') keys.current.w = false
      if (key === 'a' || key === 'arrowleft') keys.current.a = false
      if (key === 's' || key === 'arrowdown') keys.current.s = false
      if (key === 'd' || key === 'arrowright') keys.current.d = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // Reset keys on cleanup
      keys.current = { w: false, a: false, s: false, d: false }
    }
  }, [walkthroughMode])

  // Release pointer lock when walkthrough mode is turned off
  useEffect(() => {
    if (!walkthroughMode && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [walkthroughMode])

  // Movement loop
  useFrame((_, delta) => {
    if (!(walkthroughMode && controlsRef.current)) return

    _direction.set(0, 0, 0)

    // Get camera forward and right vectors (XZ plane only)
    camera.getWorldDirection(_forward)
    _forward.y = 0
    _forward.normalize()

    _right.crossVectors(_forward, camera.up).normalize()

    if (keys.current.w) _direction.add(_forward)
    if (keys.current.s) _direction.sub(_forward)
    if (keys.current.d) _direction.add(_right)
    if (keys.current.a) _direction.sub(_right)

    if (_direction.lengthSq() > 0) {
      _direction.normalize().multiplyScalar(MOVE_SPEED * delta)
      camera.position.add(_direction)
      // Keep eye height constant
      camera.position.y = EYE_HEIGHT
    }
  })

  const handleClick = useCallback(() => {
    if (walkthroughMode && controlsRef.current) {
      // Feature detection: some browsers (Facebook/Instagram in-app, older Safari)
      // don't support pointer lock on the canvas element
      if (typeof controlsRef.current.lock === 'function') {
        try {
          controlsRef.current.lock()
        } catch {
          // Silently ignore — pointer lock unavailable in this browser context
        }
      }
    }
  }, [walkthroughMode])

  // Click to lock
  useEffect(() => {
    if (!walkthroughMode) return
    const canvas = document.querySelector('canvas')
    if (!canvas) return

    canvas.addEventListener('click', handleClick)
    return () => canvas.removeEventListener('click', handleClick)
  }, [walkthroughMode, handleClick])

  if (!walkthroughMode) return null

  // Skip PointerLockControls on browsers that don't support pointer lock
  // (Facebook/Instagram in-app browsers, some iOS WebViews)
  if (typeof document !== 'undefined' && !('requestPointerLock' in HTMLElement.prototype)) {
    return null
  }

  return <PointerLockControls ref={controlsRef} />
}
