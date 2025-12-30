'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { GridTiles } from '@/components/editor/grid-tiles'
import { useGridFadeControls } from '@/components/editor/infinite-floor'
import { InfiniteGrid } from '@/components/editor/infinite-grid'
import { ProximityGrid } from '@/components/editor/proximity-grid'
import { useEditor } from '@/hooks/use-editor'
import type { LevelNode, WindowNode } from '@pascal/core'
import { LevelNodeEditor } from './level-node'

interface LevelRendererProps {
  nodeId: LevelNode['id']
}

const showGrid = true // Todo: make configurable

export const LevelRenderer = memo(({ nodeId }: LevelRendererProps) => {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const isActiveFloor = selectedFloorId === nodeId

  const { fadeDistance, fadeStrength } = useGridFadeControls()

  // const { nodeLevel } = useEditor(
  //   useShallow((state) => {
  //     const handle = state.graph.getNodeById(nodeId)
  //     const node = handle?.data() as LevelNode | undefined
  //     return {
  //       nodeLevel: node?.level,
  //     }
  //   }),
  // )

  return (
    <>
      {isActiveFloor && <LevelNodeEditor />}
      {showGrid && (
        <group raycast={() => null}>
          {isActiveFloor && (
            <>
              <InfiniteGrid
                fadeDistance={fadeDistance}
                fadeStrength={fadeStrength}
                gridSize={TILE_SIZE}
                lineColor="#ffffff"
                lineWidth={1.0}
              />
              <GridTiles />
            </>
          )}

          {/*       <ProximityGrid
                   components={[]} // TODO: Migrate to use node tree
                   fadeWidth={0.5}
                   floorId={nodeId}
                   gridSize={TILE_SIZE}
                   lineColor="#ffffff"
                   lineWidth={1.0}
                   maxSize={GRID_SIZE}
                   offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                   opacity={0.3}
                   padding={1.5}
                   previewRoof={null}
                 />
               )} */}
        </group>
      )}
    </>
  )
})

LevelRenderer.displayName = 'LevelRenderer'
