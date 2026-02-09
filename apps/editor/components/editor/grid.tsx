'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { MathUtils, type Mesh } from 'three'

import { color, float, fract, fwidth, mix, positionLocal } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useGridEvents } from '@/hooks/use-grid-events'

export const Grid = ({
  cellSize = 0.5,
  cellThickness = 0.5,
  cellColor = '#888888',
  sectionSize = 1,
  sectionThickness = 1,
  sectionColor = '#000000',
  fadeDistance = 100,
  fadeStrength = 1,
}: {
  cellSize?: number
  cellThickness?: number
  cellColor?: string
  sectionSize?: number
  sectionThickness?: number
  sectionColor?: string
  fadeDistance?: number
  fadeStrength?: number
}) => {
  const material = useMemo(() => {
    // Use xy since plane geometry is in XY space (before rotation)
    const pos = positionLocal.xy

    // Grid line function using fwidth for anti-aliasing
    // Returns 1 on grid lines, 0 elsewhere
    const getGrid = (size: number, thickness: number) => {
      const r = pos.div(size)
      const fw = fwidth(r)
      // Distance to nearest grid line for each axis
      const grid = fract(r.sub(0.5)).sub(0.5).abs()
      // Anti-aliased step: divide by fwidth and clamp
      const lineX = float(1).sub(
        grid.x
          .div(fw.x)
          .add(1 - thickness)
          .min(1),
      )
      const lineY = float(1).sub(
        grid.y
          .div(fw.y)
          .add(1 - thickness)
          .min(1),
      )
      // Combine both axes - max gives us lines in both directions
      return lineX.max(lineY)
    }

    const g1 = getGrid(cellSize, cellThickness)
    const g2 = getGrid(sectionSize, sectionThickness)

    // Distance fade from center
    const dist = pos.length()
    const fade = float(1).sub(dist.div(fadeDistance).min(1)).pow(fadeStrength)

    // Mix colors based on section grid
    const gridColor = mix(
      color(cellColor),
      color(sectionColor),
      float(sectionThickness).mul(g2).min(1),
    )

    // Combined alpha
    const alpha = g1.add(g2).mul(fade)
    const finalAlpha = mix(alpha.mul(0.75), alpha, g2)

    return new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: gridColor,
      opacityNode: finalAlpha,
      depthWrite: false,
    })
  }, [
    cellSize,
    cellThickness,
    cellColor,
    sectionSize,
    sectionThickness,
    sectionColor,
    fadeDistance,
    fadeStrength,
  ])

  const gridRef = useRef<Mesh>(null!)
  const [gridY, setGridY] = useState(0)

  // Use custom raycasting for grid events (independent of mesh events)
  useGridEvents(gridY)

  useFrame((_, delta) => {
    const currentLevelId = useViewer.getState().selection.levelId
    let targetY = 0
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId)
      if (levelMesh) {
        targetY = levelMesh.position.y
      } else {
        // Fallback: compute from level node data when mesh isn't registered yet
        const levelNode = useScene.getState().nodes[currentLevelId]
        if (levelNode && 'level' in levelNode) {
          const levelMode = useViewer.getState().levelMode
          const LEVEL_HEIGHT = 2.5
          const EXPLODED_GAP = 5
          targetY =
            ((levelNode as any).level || 0) *
            (LEVEL_HEIGHT + (levelMode === 'exploded' ? EXPLODED_GAP : 0))
        }
      }
    }
    const newY = MathUtils.lerp(gridRef.current.position.y, targetY, 12 * delta)
    gridRef.current.position.y = newY
    setGridY(newY)
  })

  return (
    <mesh rotation-x={-Math.PI / 2} material={material} ref={gridRef}>
      <planeGeometry args={[fadeDistance * 2, fadeDistance * 2]} />
    </mesh>
  )
}
