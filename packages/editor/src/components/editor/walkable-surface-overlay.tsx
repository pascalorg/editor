'use client'

import { type LevelNode, sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Mesh, type Object3D } from 'three'
import type { NavigationGraph } from '../../lib/navigation'
import { measureNavigationPerf, mergeNavigationPerfMeta } from '../../lib/navigation-performance'
import {
  filterWallOverlayCells,
  WALKABLE_FILL_OPACITY,
  WALKABLE_OVERLAY_Y_OFFSET,
} from '../../lib/walkable-surface'
import useNavigation from '../../store/use-navigation'

const WALKABLE_DARK_FILL = '#34d399'
const WALKABLE_LIGHT_FILL = '#16a34a'
const WALL_BLOCKED_DARK_FILL = '#f87171'
const WALL_BLOCKED_LIGHT_FILL = '#dc2626'
const FLAT_SURFACE_EPSILON = 1e-5

const DISABLE_RAYCAST: Mesh['raycast'] = () => {}

type OverlayQuad = {
  heights: [number, number, number, number]
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

type OverlayMergeCell = {
  col: number
  heights: [number, number, number, number]
  maxX: number
  maxZ: number
  minX: number
  minZ: number
  row: number
}

function getMergedOverlayQuads(cells: OverlayMergeCell[], cellSize: number) {
  const rowBuckets = new Map<number, OverlayMergeCell[]>()
  const quads: OverlayQuad[] = []

  for (const cell of cells) {
    const bucket = rowBuckets.get(cell.row)
    if (bucket) {
      bucket.push(cell)
    } else {
      rowBuckets.set(cell.row, [cell])
    }
  }

  for (const cells of rowBuckets.values()) {
    cells.sort((left, right) => left.col - right.col)

    let flatRun: {
      cell: OverlayMergeCell
      maxX: number
      minX: number
    } | null = null

    const flushFlatRun = () => {
      if (!flatRun) {
        return
      }

      quads.push({
        heights: flatRun.cell.heights,
        maxX: flatRun.maxX,
        maxZ: flatRun.cell.maxZ,
        minX: flatRun.minX,
        minZ: flatRun.cell.minZ,
      })
      flatRun = null
    }

    for (const cell of cells) {
      const isFlat =
        Math.abs(cell.heights[0] - cell.heights[1]) <= FLAT_SURFACE_EPSILON &&
        Math.abs(cell.heights[0] - cell.heights[2]) <= FLAT_SURFACE_EPSILON &&
        Math.abs(cell.heights[0] - cell.heights[3]) <= FLAT_SURFACE_EPSILON

      if (!isFlat) {
        flushFlatRun()
        quads.push({
          heights: cell.heights,
          maxX: cell.maxX,
          maxZ: cell.maxZ,
          minX: cell.minX,
          minZ: cell.minZ,
        })
        continue
      }

      if (
        flatRun &&
        Math.abs(cell.minX - flatRun.maxX) <= cellSize * 0.08 &&
        flatRun.cell.heights.every(
          (height, index) => Math.abs(height - cell.heights[index]!) <= FLAT_SURFACE_EPSILON,
        )
      ) {
        flatRun.maxX = cell.maxX
        continue
      }

      flushFlatRun()
      flatRun = {
        cell,
        maxX: cell.maxX,
        minX: cell.minX,
      }
    }

    flushFlatRun()
  }

  return quads
}

function getWalkableOverlayQuads(graph: NavigationGraph, levelId: LevelNode['id']) {
  const cellIndices = graph.cellsByLevel.get(levelId) ?? []
  const halfCell = graph.cellSize / 2
  return getMergedOverlayQuads(
    cellIndices.flatMap((cellIndex) => {
      const cell = graph.cells[cellIndex]
      if (!cell) {
        return []
      }

      return [
        {
          col: cell.gridX,
          heights: cell.cornerHeights,
          maxX: cell.center[0] + halfCell,
          maxZ: cell.center[2] + halfCell,
          minX: cell.center[0] - halfCell,
          minZ: cell.center[2] - halfCell,
          row: cell.gridY,
        } satisfies OverlayMergeCell,
      ]
    }),
    graph.cellSize,
  )
}

function getWallBlockedOverlayQuads(graph: NavigationGraph, levelId: LevelNode['id']) {
  const cells = graph.wallBlockedCellsByLevel.get(levelId) ?? []
  const levelBaseY = graph.levelBaseYById.get(levelId) ?? 0
  return getMergedOverlayQuads(
    cells.map((cell) => ({
      col: Math.round(cell.x / graph.cellSize),
      heights: cell.cornerSurfaceY.map((height) => height + levelBaseY) as [
        number,
        number,
        number,
        number,
      ],
      maxX: cell.x + cell.width,
      maxZ: cell.y + cell.height,
      minX: cell.x,
      minZ: cell.y,
      row: Math.round(cell.y / graph.cellSize),
    })),
    graph.cellSize,
  )
}

function buildOverlayGeometry(
  graph: NavigationGraph,
  levelId: LevelNode['id'] | null,
  quadsBuilder: (graph: NavigationGraph, levelId: LevelNode['id']) => OverlayQuad[],
  perfKey: string,
  triangleMetaKey: string,
  quadMetaKey: string,
): BufferGeometry | null {
  if (!levelId) {
    return null
  }

  return measureNavigationPerf(perfKey, () => {
    const quads = quadsBuilder(graph, levelId)
    if (quads.length === 0) {
      mergeNavigationPerfMeta({
        [quadMetaKey]: 0,
        [triangleMetaKey]: 0,
      })
      return null
    }

    const levelBaseY = graph.levelBaseYById.get(levelId) ?? 0
    const positions: number[] = []
    const indices: number[] = []
    let vertexIndex = 0

    for (const quad of quads) {
      const y00 = quad.heights[0] - levelBaseY + WALKABLE_OVERLAY_Y_OFFSET
      const y10 = quad.heights[1] - levelBaseY + WALKABLE_OVERLAY_Y_OFFSET
      const y11 = quad.heights[2] - levelBaseY + WALKABLE_OVERLAY_Y_OFFSET
      const y01 = quad.heights[3] - levelBaseY + WALKABLE_OVERLAY_Y_OFFSET

      positions.push(
        quad.minX,
        y00,
        quad.minZ,
        quad.maxX,
        y10,
        quad.minZ,
        quad.maxX,
        y11,
        quad.maxZ,
        quad.minX,
        y01,
        quad.maxZ,
      )
      indices.push(
        vertexIndex,
        vertexIndex + 1,
        vertexIndex + 2,
        vertexIndex,
        vertexIndex + 2,
        vertexIndex + 3,
      )
      vertexIndex += 4
    }

    mergeNavigationPerfMeta({
      [quadMetaKey]: quads.length,
      [triangleMetaKey]: quads.length * 2,
    })

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  })
}

export function WalkableSurfaceOverlay({ graph }: { graph: NavigationGraph }) {
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const theme = useViewer((state) => state.theme)
  const wallOverlayFilters = useNavigation((state) => state.wallOverlayFilters)
  const resolvedLevelId = useMemo<LevelNode['id'] | null>(() => {
    if (selectedLevelId && graph.cellsByLevel.has(selectedLevelId as LevelNode['id'])) {
      return selectedLevelId as LevelNode['id']
    }

    return graph.cells[0]?.levelId ?? null
  }, [graph, selectedLevelId])
  const walkableGeometry = useMemo(
    () =>
      buildOverlayGeometry(
        graph,
        resolvedLevelId,
        getWalkableOverlayQuads,
        'walkableOverlay3d.geometryBuildMs',
        'walkableOverlay3dTriangleCount',
        'walkableOverlay3dQuadCount',
      ),
    [graph, resolvedLevelId],
  )
  const wallBlockedGeometry = useMemo(
    () =>
      buildOverlayGeometry(
        {
          ...graph,
          wallBlockedCellsByLevel: new Map(
            resolvedLevelId
              ? [
                  [
                    resolvedLevelId,
                    filterWallOverlayCells(
                      graph.wallDebugCellsByLevel.get(resolvedLevelId) ?? [],
                      wallOverlayFilters,
                    ),
                  ] as const,
                ]
              : [],
          ),
        },
        resolvedLevelId,
        getWallBlockedOverlayQuads,
        'wallBlockedOverlay3d.geometryBuildMs',
        'wallBlockedOverlay3dTriangleCount',
        'wallBlockedOverlay3dQuadCount',
      ),
    [graph, resolvedLevelId, wallOverlayFilters],
  )
  const [portalTarget, setPortalTarget] = useState<Object3D | null>(null)

  useEffect(() => () => walkableGeometry?.dispose(), [walkableGeometry])
  useEffect(() => () => wallBlockedGeometry?.dispose(), [wallBlockedGeometry])

  useEffect(() => {
    let frame = 0

    const resolvePortalTarget = () => {
      const nextTarget = resolvedLevelId ? (sceneRegistry.nodes.get(resolvedLevelId) ?? null) : null
      setPortalTarget((currentTarget) =>
        currentTarget === nextTarget ? currentTarget : nextTarget,
      )

      if (!nextTarget && resolvedLevelId) {
        frame = window.requestAnimationFrame(resolvePortalTarget)
      }
    }

    resolvePortalTarget()

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [resolvedLevelId])

  if (!(portalTarget && (walkableGeometry || wallBlockedGeometry))) {
    return null
  }

  return createPortal(
    <group renderOrder={20}>
      {wallBlockedGeometry && (
        <mesh raycast={DISABLE_RAYCAST} renderOrder={1}>
          <primitive attach="geometry" object={wallBlockedGeometry} />
          <meshBasicMaterial
            color={theme === 'dark' ? WALL_BLOCKED_DARK_FILL : WALL_BLOCKED_LIGHT_FILL}
            depthTest={false}
            depthWrite={false}
            opacity={0.32}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            side={DoubleSide}
            toneMapped={false}
            transparent
          />
        </mesh>
      )}
      {walkableGeometry && (
        <mesh raycast={DISABLE_RAYCAST} renderOrder={2}>
          <primitive attach="geometry" object={walkableGeometry} />
          <meshBasicMaterial
            color={theme === 'dark' ? WALKABLE_DARK_FILL : WALKABLE_LIGHT_FILL}
            depthTest={false}
            depthWrite={false}
            opacity={Math.max(WALKABLE_FILL_OPACITY, 0.38)}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            side={DoubleSide}
            toneMapped={false}
            transparent
          />
        </mesh>
      )}
    </group>,
    portalTarget,
  )
}
