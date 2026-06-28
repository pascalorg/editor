'use client'

import { type AnyNodeId, emitter, type GridEvent, sceneRegistry } from '@pascal-app/core'
import { GRID_LAYER, getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DoubleSide, type Mesh, PlaneGeometry, Quaternion, Vector2, Vector3 } from 'three'
import { color, float, fract, fwidth, mix, positionLocal, uniform } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useCeilingEvents } from '../../hooks/use-ceiling-events'
import { useGridEvents } from '../../hooks/use-grid-events'
import { getPlacementSurface } from '../../lib/active-placement-surface'
import useEditor, { isGridSnapActive } from '../../store/use-editor'
import { getMovingNode } from '../../store/use-interaction-scope'

// Reveal radius (m) of the cursor-local grid patch shown while placing/moving in
// grid-snap mode — much tighter than the idle reveal so only the area you're
// about to snap into lights up.
const PLACEMENT_REVEAL_RADIUS = 12

const UP = new Vector3(0, 1, 0)
// PlaneGeometry faces +Z; this is the orientation that lays it flat (its normal
// → world +Y), equivalent to the old `rotation-x={-π/2}`.
const PLANE_LOCAL_NORMAL = new Vector3(0, 0, 1)
const HORIZONTAL_QUATERNION = new Quaternion().setFromUnitVectors(PLANE_LOCAL_NORMAL, UP)

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
  // Scratch for reading a moving node's world Y (surface elevation) each frame.
  const worldPosRef = useRef(new Vector3())
  // Scratch for the wall-anchored branch: invert the plane orientation to map the
  // ghost into plane-local XY (the cursor reveal) without re-centring the mesh.
  const invQuatRef = useRef(new Quaternion())
  const wallCursorRef = useRef(new Vector3())
  // Last Y pushed to `gridY` state, so the per-frame surface follow only triggers
  // a React re-render when the height actually changes (not every frame).
  const lastGridYRef = useRef<number | null>(null)

  // Reveal radius + baseline alpha are uniforms so a placement/move can shrink
  // the grid to a tight cursor patch (and drop the always-on baseline) without
  // rebuilding the shader. Driven each frame in `useFrame`.
  const revealRadiusUniform = useMemo(() => uniform(revealRadius), [revealRadius])
  const baseAlphaUniform = useMemo(() => uniform(0.4), [])
  // Created once and driven by `.value` each frame (see `useFrame`). Keying this
  // on `cellSize` rebuilt the uniform AND the material `useMemo` below on every
  // `gridSnapStep` change — a full shader recompile that stalled hard whenever
  // the grid resolution changed. The live cell size is a uniform write only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: created once on purpose; `.value` is driven each frame.
  const cellSizeUniform = useMemo(() => uniform(cellSize), [])
  const patchAlphaUniform = useMemo(() => uniform(1), [])

  const material = useMemo(() => {
    // Use xy since plane geometry is in XY space (before rotation)
    const pos = positionLocal.xy

    // Cursor position uniform
    const cursorPos = uniform(cursorPositionRef.current)

    // Grid line function using fwidth for anti-aliasing
    // Returns 1 on grid lines, 0 elsewhere
    const getGrid = (size: number | typeof cellSizeUniform, thickness: number) => {
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

    const g1 = getGrid(cellSizeUniform, cellThickness)
    const g2 = getGrid(sectionSize, sectionThickness)

    // Distance fade from center
    const dist = pos.length()
    const fade = float(1).sub(dist.div(fadeDistance).min(1)).pow(fadeStrength)

    // Cursor reveal effect - distance from cursor
    const cursorDist = pos.sub(cursorPos).length()
    const cursorFade = float(1)
      .sub(cursorDist.div(revealRadiusUniform).clamp(0, 1))
      .smoothstep(0, 1)

    // Mix colors based on section grid
    const gridColor = mix(
      color(effectiveCellColor),
      color(effectiveSectionColor),
      float(sectionThickness).mul(g2).min(1),
    )

    // Combined alpha with cursor fade and baseline minimum
    const alpha = g1.add(g2).mul(fade).mul(cursorFade.max(baseAlphaUniform))
    const boostedAlpha = alpha.mul(patchAlphaUniform).min(1)
    const finalAlpha = mix(boostedAlpha.mul(0.75), boostedAlpha, g2)

    return new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: gridColor,
      opacityNode: finalAlpha,
      depthWrite: false,
      // `depthTest` is toggled per-frame in `useFrame`: ON for the floor lattice
      // (so the ground occludes a sub-floor grid) and OFF on a wall (so the
      // lattice shows through the wall when the opening is handled from the far
      // side). Default ON for the floor case.
      depthTest: true,
      // Wall-plane placements are handled from either side of the wall, so the
      // lattice must render from both faces.
      side: DoubleSide,
    })
  }, [
    cellThickness,
    effectiveCellColor,
    sectionSize,
    sectionThickness,
    effectiveSectionColor,
    fadeDistance,
    fadeStrength,
    revealRadiusUniform,
    baseAlphaUniform,
    cellSizeUniform,
    patchAlphaUniform,
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
  // `positionLocal.xy` (vertex position on the un-transformed plane), and the
  // laid-flat orientation maps `positionLocal.y` to world `-Z` relative to the
  // mesh origin. The cursor is recomputed every frame from the stored world hit
  // so the reveal stays put regardless of where the mesh origin sits.
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

  useFrame(() => {
    const { levelId } = useViewer.getState().selection
    let levelY = 0
    if (levelId) {
      const levelMesh = sceneRegistry.nodes.get(levelId)
      if (levelMesh) {
        levelY = levelMesh.position.y
      }
    }

    // Resolve the surface the active ghost is snapped to (contact point +
    // normal). A fresh GLB item / drawn kind publishes via the surface module; a
    // moving node is read straight off its mesh (treated as horizontal). Null
    // when nothing is being placed.
    const published = getPlacementSurface()
    const movingForGrid = getMovingNode()
    let surfacePoint: Vector3 | null = null
    let surfaceNormal = UP
    if (published) {
      surfacePoint = published.point
      surfaceNormal = published.normal
    } else if (movingForGrid) {
      const ghostMesh = sceneRegistry.nodes.get(movingForGrid.id as AnyNodeId)
      if (ghostMesh) surfacePoint = ghostMesh.getWorldPosition(worldPosRef.current)
    }

    const gridMesh = gridRef.current
    const onWall = surfacePoint != null && Math.abs(surfaceNormal.y) < 0.5
    if (onWall && surfacePoint) {
      // Wall-anchored lattice: orient the plane into the wall and pin the mesh to
      // the plane's FOOT (the point on the wall plane closest to the world origin)
      // — never the moving ghost. Sliding the opening along the wall then only
      // moves the reveal patch (the cursor uniform); the snap lattice stays put.
      // (Copying `surfacePoint` here made the grid follow the item — useless.)
      gridMesh.quaternion.setFromUnitVectors(PLANE_LOCAL_NORMAL, surfaceNormal)
      const planeOffset = surfacePoint.dot(surfaceNormal)
      gridMesh.position.copy(surfaceNormal).multiplyScalar(planeOffset)
      // Cursor → plane-local XY: rotate (ghost − anchor) by the inverse plane
      // orientation. Both lie in the plane, so the resulting local Z is ~0.
      invQuatRef.current.copy(gridMesh.quaternion).invert()
      wallCursorRef.current
        .copy(surfacePoint)
        .sub(gridMesh.position)
        .applyQuaternion(invQuatRef.current)
      cursorPositionRef.current.set(wallCursorRef.current.x, wallCursorRef.current.y)
      if (lastGridYRef.current !== surfacePoint.y) {
        lastGridYRef.current = surfacePoint.y
        setGridY(surfacePoint.y)
      }
    } else {
      // Horizontal: keep the lattice anchored to world XZ (0,0); only the Y
      // origin follows the surface height (floor / shelf top). Snap directly —
      // the old lerp made the grid visibly drift up to a new floor height.
      // Cursor uniform tracks the world cursor (mirrored on Z for the flat plane).
      const targetY = surfacePoint ? surfacePoint.y : levelY
      gridMesh.position.set(0, targetY, 0)
      gridMesh.quaternion.copy(HORIZONTAL_QUATERNION)
      const world = lastWorldCursorRef.current
      if (world) {
        cursorPositionRef.current.set(world.x, -world.z)
      }
      if (lastGridYRef.current !== targetY) {
        lastGridYRef.current = targetY
        setGridY(targetY)
      }
    }

    // Floor grid depth-tests against the scene (ground occludes a sub-floor
    // lattice); the wall grid ignores depth so it stays visible through the wall
    // when the opening is being handled from the opposite side.
    if (material.depthTest === onWall) {
      material.depthTest = !onWall
      material.needsUpdate = true
    }

    // The grid is a placement aid: a tight cursor patch (no always-on baseline)
    // shown whenever the active context is in grid-snap mode — ANY armed
    // draft/build tool (wall / slab / fence / ceiling / zone / column / MEP / …),
    // a node move, or a reshape — and hidden in select/idle, paint, and non-grid
    // (lines/off) modes. `isGridSnapActive()` already derives the snap context
    // from the interaction scope OR the armed build tool and is true only when
    // that context resolves to grid, so it IS the gate. (Previously this also
    // required a ghost in flight, so a merely-armed draft tool showed nothing.)
    const snapPatchVisible = isGridSnapActive()
    revealRadiusUniform.value = PLACEMENT_REVEAL_RADIUS
    baseAlphaUniform.value = 0
    cellSizeUniform.value = useEditor.getState().gridSnapStep
    patchAlphaUniform.value = 1.5
    gridRef.current.visible = snapPatchVisible
  })

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
    // Orientation is driven imperatively in `useFrame` (horizontal by default,
    // tilted into the wall plane while placing on a wall), so no static rotation.
    <mesh
      geometry={geometry}
      layers={GRID_LAYER}
      material={material}
      ref={gridRef}
      renderOrder={1}
    />
  )
}
