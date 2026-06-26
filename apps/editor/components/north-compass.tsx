'use client'

import useScene from '@pascal-app/core/store/use-scene'
import { NORTH_DIRECTION_DEFAULT } from '@pascal-app/core/schema'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'

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
 * NorthCompass reads the camera azimuth from R3F each frame, combines it with
 * the scene's northDirection, and renders the SVG widget as a DOM overlay.
 *
 * Mount this inside the R3F <Canvas> so useFrame is available, but use a
 * React portal / absolute-positioned div trick via useState to push the SVG
 * outside the canvas into normal DOM flow.
 */
export function NorthCompassR3F() {
  const { camera } = useThree()
  const northDirection = useNorthDirection()
  const [bearingDeg, setBearingDeg] = useState(0)

  // Scratch objects — allocated once, reused every frame.
  const _euler = useRef(new THREE.Euler())
  const _quat = useRef(new THREE.Quaternion())

  useFrame(() => {
    // Extract the camera's world yaw (rotation around Y axis).
    camera.getWorldQuaternion(_quat.current)
    _euler.current.setFromQuaternion(_quat.current, 'YXZ')
    const cameraYawRad = _euler.current.y // radians, CCW from +Z in Three.js

    // northDirection is CCW from +X in radians.
    // The angle from camera-forward to north:
    //   northDirection offset from +X → convert to "from +Z": subtract π/2
    //   then subtract camera yaw to get screen-relative bearing.
    //   Negate because screen rotation is clockwise.
    const northFromScreen = -(northDirection - Math.PI / 2 - cameraYawRad)
    const deg = ((northFromScreen * 180) / Math.PI + 360) % 360

    // Only trigger re-render when bearing changes by more than 0.5°.
    setBearingDeg((prev) => (Math.abs(prev - deg) > 0.5 ? deg : prev))
  })

  // This component only drives state; the SVG is rendered by NorthCompass below.
  // Return null here — the parent component renders the SVG in DOM overlay.
  return null
}

/**
 * The full compass widget: a thin wrapper that places the SVG in the
 * bottom-right corner of the viewer and mounts the R3F frame-reader inside
 * the canvas via the viewer's existing <Canvas>.
 *
 * Usage (in viewer-toolbar or viewport wrapper):
 *   <NorthCompassOverlay />
 *   — but the R3F part must live inside the Canvas. See NorthCompassWidget.
 */
export function NorthCompassOverlay({ bearingDeg }: { bearingDeg: number }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 text-foreground/70">
      <CompassSVG bearingDeg={bearingDeg} />
    </div>
  )
}
