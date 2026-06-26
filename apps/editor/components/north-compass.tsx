'use client'

import { NORTH_DIRECTION_DEFAULT } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store/use-scene'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useNorthBridge } from './north-compass-bridge'

/**
 * Reads the northDirection from the first Site node in the scene.
 * Falls back to NORTH_DIRECTION_DEFAULT (π/2) if no site or no field.
 */
function useNorthDirection(): number {
  const nodes = useScene((state) => state.nodes)
  for (const node of Object.values(nodes)) {
    if (node.type === 'site') {
      const dir = (node as { northDirection?: unknown }).northDirection
      return typeof dir === 'number' ? dir : NORTH_DIRECTION_DEFAULT
    }
  }
  return NORTH_DIRECTION_DEFAULT
}

/**
 * A pure-SVG north-arrow compass widget rendered in a corner of the viewport.
 * The `bearingDeg` prop is the angle (clockwise degrees from screen-up) that
 * the north arrow should point — 0 means north faces straight up, 90 means
 * north faces right, etc.
 */
function CompassSVG({ bearingDeg }: { bearingDeg: number }) {
  return (
    <div
      aria-label={`North arrow, ${Math.round(bearingDeg)}° clockwise from screen top`}
      className="pointer-events-none select-none"
      role="img"
      style={{ width: 44, height: 44 }}
    >
      <svg
        fill="none"
        height="44"
        viewBox="0 0 44 44"
        width="44"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring */}
        <circle
          cx="22"
          cy="22"
          r="20"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="1"
        />

        {/* Rotating group — north arrow */}
        <g
          style={{
            transformOrigin: '22px 22px',
            transform: `rotate(${bearingDeg}deg)`,
          }}
        >
          {/* North half of needle — red */}
          <path
            d="M22 6 L25.5 22 L22 20 L18.5 22 Z"
            fill="#ef4444"
            opacity="0.95"
          />
          {/* South half of needle — muted */}
          <path
            d="M22 38 L18.5 22 L22 24 L25.5 22 Z"
            fill="currentColor"
            opacity="0.30"
          />
          {/* Centre dot */}
          <circle cx="22" cy="22" fill="currentColor" opacity="0.5" r="1.5" />
        </g>

        {/* "N" label — always screen-up, outside the rotating group */}
        <text
          dominantBaseline="middle"
          fill="currentColor"
          fontSize="7"
          fontWeight="600"
          opacity="0.55"
          textAnchor="middle"
          x="22"
          y="5"
        >
          N
        </text>
      </svg>
    </div>
  )
}

/**
 * Mounts inside the R3F <Canvas>. Reads the camera azimuth every frame,
 * combines it with the scene's northDirection, and pushes the result to
 * the bridge store so NorthCompassWidget (outside the canvas) can render it.
 */
export function NorthCompassR3F() {
  const { camera } = useThree()
  const northDirection = useNorthDirection()
  const setBearingDeg = useNorthBridge((s) => s.setBearingDeg)

  // Scratch objects — allocated once, reused every frame.
  const _euler = useRef(new THREE.Euler())
  const _quat = useRef(new THREE.Quaternion())
  const _prevDeg = useRef(0)

  useFrame(() => {
    camera.getWorldQuaternion(_quat.current)
    _euler.current.setFromQuaternion(_quat.current, 'YXZ')
    const cameraYawRad = _euler.current.y

    const northFromScreen = -(northDirection - Math.PI / 2 - cameraYawRad)
    const deg = ((northFromScreen * 180) / Math.PI + 360) % 360

    // Only trigger re-render when bearing changes by more than 0.5°.
    if (Math.abs(_prevDeg.current - deg) > 0.5) {
      _prevDeg.current = deg
      setBearingDeg(deg)
    }
  })

  return null
}

/**
 * DOM overlay — place this outside the Canvas, over the viewport.
 * Reads the bearing from the bridge store.
 */
export function NorthCompassWidget() {
  const bearingDeg = useNorthBridge((s) => s.bearingDeg)
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 text-foreground/70">
      <CompassSVG bearingDeg={bearingDeg} />
    </div>
  )
}

/**
 * Low-level overlay if you want to pass bearingDeg manually.
 */
export function NorthCompassOverlay({ bearingDeg }: { bearingDeg: number }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 text-foreground/70">
      <CompassSVG bearingDeg={bearingDeg} />
    </div>
  )
}
