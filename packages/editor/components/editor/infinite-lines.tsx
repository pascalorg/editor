'use client'

import { Line } from '@react-three/drei'
import { useCallback } from 'react'

export function InfiniteLines() {
  const disabledRaycast = useCallback(() => null, [])
  return (
    <group raycast={disabledRaycast}>
      {/* X axis (red) */}
      <Line
        color="white"
        dashed
        dashSize={0.5}
        gapSize={0.25}
        lineWidth={1}
        opacity={0.4}
        points={[
          [-1000, 0, 0],
          [1000, 0, 0],
        ]}
      />
      {/* Y axis (green) - vertical */}
      <Line
        color="white"
        dashed
        dashSize={0.5}
        gapSize={0.25}
        lineWidth={1}
        opacity={0.4}
        points={[
          [0, -1000, 0],
          [0, 1000, 0],
        ]}
      />
      {/* Z axis (blue) */}
      <Line
        color="white"
        dashed
        dashSize={0.5}
        gapSize={0.25}
        lineWidth={1}
        opacity={0.4}
        points={[
          [0, 0, -1000],
          [0, 0, 1000],
        ]}
      />
    </group>
  )
}
