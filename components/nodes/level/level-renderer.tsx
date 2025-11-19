'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { useGridFadeControls } from '@/components/editor/infinite-floor'
import { InfiniteGrid } from '@/components/editor/infinite-grid'
import { ProximityGrid } from '@/components/editor/proximity-grid'
import { useEditor } from '@/hooks/use-editor'
import type { LevelNode, WindowNode } from '@/lib/scenegraph/schema/index'
import { LevelNodeEditor } from './level-node'

interface LevelRendererProps {
  node: LevelNode
}

const showGrid = true // Todo: make configurable

export const LevelRenderer = memo(({ node }: LevelRendererProps) => {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const isActiveFloor = selectedFloorId === node.id
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  return (
    <>
      {isActiveFloor && <LevelNodeEditor />}
      {showGrid && (
        <group raycast={() => null}>
          {node.level === 0 ? (
            // Base level: show infinite grid
            isActiveFloor ? (
              <InfiniteGrid
                fadeDistance={fadeDistance}
                fadeStrength={fadeStrength}
                gridSize={TILE_SIZE}
                lineColor="#ffffff"
                lineWidth={1.0}
              />
            ) : (
              levelMode === 'exploded' && (
                <InfiniteGrid
                  fadeDistance={fadeDistance}
                  fadeStrength={fadeStrength}
                  gridSize={TILE_SIZE}
                  lineColor="#ffffff"
                  lineWidth={1.0}
                />
              )
            )
          ) : (
            // Non-base level: show proximity-based grid around elements
            <>
              {isActiveFloor && (
                <ProximityGrid
                  components={[]} // TODO: Migrate to use node tree
                  fadeWidth={0.5}
                  floorId={node.id}
                  gridSize={TILE_SIZE}
                  lineColor="#ffffff"
                  lineWidth={1.0}
                  maxSize={GRID_SIZE}
                  offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                  opacity={0.3}
                  padding={1.5}
                  previewRoof={null}
                />
              )}
              {!isActiveFloor && levelMode === 'exploded' && (
                <ProximityGrid
                  components={[]} // TODO: Migrate to use node tree
                  fadeWidth={0.5}
                  floorId={node.id}
                  gridSize={TILE_SIZE}
                  lineColor="#ffffff"
                  lineWidth={1.0}
                  maxSize={GRID_SIZE}
                  offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                  opacity={0.15}
                  padding={1.5}
                  previewCustomRoom={null}
                  previewRoof={null}
                  previewRoom={null}
                  previewWall={null}
                />
              )}
            </>
          )}
        </group>
      )}
    </>
  )
})

LevelRenderer.displayName = 'LevelRenderer'
