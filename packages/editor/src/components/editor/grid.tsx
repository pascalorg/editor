'use client'

import { type AnyNodeId, emitter, type GridEvent, sceneRegistry } from '@pascal-app/core'
import { GRID_LAYER, getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MathUtils, type Mesh, PlaneGeometry, Vector2, Vector3 } from 'three'
import { color, float, fract, fwidth, mix, positionLocal, uniform } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useCeilingEvents } from '../../hooks/use-ceiling-events'
import { useGridEvents } from '../../hooks/use-grid-events'

export const Grid = ({
  cellSize = 0.5,
  cellThickness = 0.5,
  cellColor = '#888888',
  sectionSize = 1,
  sectionThickness = 1,
  sectionColor = '#000000',
  fadeDistance = 100,
  fadeStrength = 1,
  revealRadius = 10,
}: {
  cellSize?: number
  cellThickness?: number
  cellColor?: string
  sectionSize?: number
  sectionThickness?: number
  sectionColor?: string
  fadeDistance?: number
  fadeStrength?: number
  revealRadius?: number
}) => {
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')

  // Use slightly lighter colors for dark themes' grid to make it apparent
  const effectiveCellColor = isDark ? '#555566' : cellColor
  const effectiveSectionColor = isDark ? '#666677' : sectionColor

  const cursorPositionRef = useRef(new Vector2(0, 0))

  const material = useMemo(() => {
    // Use xy since plane geometry is in XY space (before rotation)
    const pos = positionLocal.xy

    // Cursor position uniform
    const cursorPos = uniform(cursorPositionRef.current)

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

    // Cursor reveal effect - distance from cursor
    const cursorDist = pos.sub(cursorPos).length()
    const cursorFade = float(1).sub(cursorDist.div(revealRadius).clamp(0, 1)).smoothstep(0, 1)

    // Mix colors based on section grid
    const gridColor = mix(
      color(effectiveCellColor),
      color(effectiveSectionColor),
      float(sectionThickness).mul(g2).min(1),
    )

    // Baseline alpha: small amount of opacity everywhere the grid exists
    const baseAlpha = float(0.4) // Subtle global visibility

    // Combined alpha with cursor fade and baseline minimum
    const alpha = g1.add(g2).mul(fade).mul(cursorFade.max(baseAlpha))
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
    effectiveCellColor,
    sectionSize,
    sectionThickness,
    effectiveSectionColor,
    fadeDistance,
    fadeStrength,
    revealRadius,
  ])

  const gridRef = useRef<Mesh>(null!)
  const [gridY, setGridY] = useState(0)

  // Use custom raycasting for grid events (independent of mesh events)
  useGridEvents(gridY)
  // Same technique for ceiling-item placement: a math-plane raycast per ceiling,
  // so commits don't depend on hitting the thin, single-sided `ceiling-grid`
  // overlay mesh (which dropped clicks even with the green box showing).
  useCeilingEvents()

  // Track the last world-space cursor hit. The reveal-fade shader reads
  // `positionLocal.xy` (vertex position on the un-transformed plane), and
  // the mesh's -π/2 X rotation maps `positionLocal.y` to world `-Z`
  // relative to the mesh origin. The mesh origin itself is lerped each
  // frame toward the active building's world XZ (see `useFrame` below),
  // so the local-frame cursor must be recomputed every frame from the
  // stored world cursor — otherwise the ring drifts whenever the grid is
  // mid-lerp (e.g. just after a building rotation commits).
  const lastWorldCursorRef = useRef<{ x: number; z: number } | null>(null)
  useEffect(() => {
    const onGridMove = (event: GridEvent) => {
      lastWorldCursorRef.current = { x: event.position[0], z: event.position[2] }
    }

    emitter.on('grid:move', onGridMove)
    return () => {
      emitter.off('grid:move', onGridMove)
    }
  }, [])

  const worldPosScratch = useMemo(() => new Vector3(), [])
  useFrame((_, delta) => {
    const { levelId, buildingId } = useViewer.getState().selection
    // Align the grid's XZ origin to the active building so its visible cell
    // lines pass through building-local snap points (walls snap in
    // building-local coords; a building placed at world (0.25, 0.25) would
    // otherwise leave snapped wall endpoints stranded between grid lines).
    let targetX = 0
    let targetZ = 0
    if (buildingId) {
      const buildingMesh = sceneRegistry.nodes.get(buildingId as AnyNodeId)
      if (buildingMesh) {
        buildingMesh.getWorldPosition(worldPosScratch)
        targetX = worldPosScratch.x
        targetZ = worldPosScratch.z
      }
    }
    let targetY = 0
    if (levelId) {
      const levelMesh = sceneRegistry.nodes.get(levelId)
      if (levelMesh) {
        targetY = levelMesh.position.y
      }
    }
    const t = 12 * delta
    gridRef.current.position.x = MathUtils.lerp(gridRef.current.position.x, targetX, t)
    gridRef.current.position.z = MathUtils.lerp(gridRef.current.position.z, targetZ, t)
    const newY = MathUtils.lerp(gridRef.current.position.y, targetY, t)
    gridRef.current.position.y = newY
    setGridY(newY)

    // Re-derive the local-frame cursor uniform after the grid's XZ has
    // lerped this frame, so the reveal ring stays locked under the world
    // cursor even when the grid origin is mid-transition.
    const world = lastWorldCursorRef.current
    if (world) {
      cursorPositionRef.current.set(
        world.x - gridRef.current.position.x,
        -(world.z - gridRef.current.position.z),
      )
    }
  })

  const showGrid = useViewer((state) => state.showGrid)

  // Pass the geometry as a prop instead of a JSX child so the mesh
  // is never reconciled with R3F's empty placeholder `BufferGeometry`.
  // Combined with the grid's `MeshBasicNodeMaterial`, the child-attach
  // path can submit a `Draw(0, 1, 0, 0)` on the first frame before
  // `<planeGeometry>` attaches — which WebGPU flags as "Vertex buffer
  // slot 0 ... was not set" (see `wall-move-side-handles.tsx`).
  const geometry = useMemo(
    () => new PlaneGeometry(fadeDistance * 2, fadeDistance * 2),
    [fadeDistance],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      layers={GRID_LAYER}
      material={material}
      ref={gridRef}
      rotation-x={-Math.PI / 2}
      visible={showGrid}
    />
  )
}
