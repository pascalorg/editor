import type { BaseNode, GridItem, WallNode } from '@/lib/nodes/types'
import { useMemo } from 'react'
import { TILE_SIZE } from '../editor'

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
      <group position={gridItemPosition}>
        {node.type === 'wall' && <Wall node={node as WallNode} />}
      </group>
      {node.children.map((childNode) => (
        <NodeRenderer key={childNode.id} node={childNode} />
      ))}
    </>
  )
}

function Wall({ node }: { node: WallNode }) {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={'red'} />
    </mesh>
  )
}
