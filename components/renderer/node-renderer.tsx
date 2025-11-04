import type { BaseNode, GridItem, WallNode } from '@/lib/nodes/types'
import { useMemo } from 'react'
import { TILE_SIZE } from '../editor'
import { WallRenderer } from './wall-renderer'

interface NodeRendererProps {
  node: BaseNode
}

export function NodeRenderer({ node }: NodeRendererProps) {
  const gridItemPosition = useMemo(() => {
    const gridItem = node as unknown as GridItem
    if (gridItem.position) {
      const [x, y] = gridItem.position
      return [x * TILE_SIZE, 0, y * TILE_SIZE] as [number, number, number]
    }
    return [0, 0, 0] as [number, number, number]
  }, [node])

  return (
    <>
      <group
        position={gridItemPosition}
        rotation-y={(node as unknown as GridItem).rotation || 0}
        visible={node.visible}
      >
        {node.type === 'wall' && (
          <>
            <WallRenderer node={node as WallNode} />
            {/* DEBUG REAL POSITION / SIZE */}
            {/* <mesh position-x={((node as unknown as GridItem).size?.[0] * TILE_SIZE) / 2}>
              <boxGeometry args={[(node as unknown as GridItem).size?.[0] * TILE_SIZE, 1, 1]} />
              <meshStandardMaterial color="pink" />
            </mesh> */}
          </>
        )}
        {/* TODO: Add other node type renderers here */}
      </group>
      {node.children.map((childNode) => (
        <NodeRenderer key={childNode.id} node={childNode} />
      ))}
    </>
  )
}
