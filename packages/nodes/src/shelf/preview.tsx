'use client'

import { useMemo } from 'react'
import { Color } from 'three'
import type { ShelfNode } from './schema'

/**
 * Translucent preview of a shelf. Used by:
 * - The placement tool's cursor (ShelfTool) — at the cursor position
 * - The move tool (MoveRegistryNodeTool) — at the drag target position
 *
 * Renders the same primitives as the actual ShelfRenderer, but with
 * `transparent: true, opacity: 0.5` so the user can see what they're
 * placing/moving without it being a hard solid.
 */
const ShelfPreview = ({ node }: { node: ShelfNode }) => {
  const color = useMemo(() => new Color(node.color), [node.color])
  const topY = node.height + node.thickness / 2

  const inset = Math.min(0.12, node.width / 6)
  const bracketHeight = Math.max(0.01, node.height)
  const bracketWidth =
    node.bracketStyle === 'industrial'
      ? Math.max(0.04, node.depth * 0.2)
      : Math.max(0.02, node.depth * 0.12)
  const bracketDepth = node.bracketStyle === 'industrial' ? node.depth * 0.95 : node.depth * 0.7

  return (
    <group>
      <mesh position={[0, topY, 0]}>
        <boxGeometry args={[node.width, node.thickness, node.depth]} />
        <meshStandardMaterial color={color} transparent opacity={0.5} />
      </mesh>
      {node.bracketStyle !== 'hidden' && (
        <>
          <mesh position={[-(node.width / 2 - inset), bracketHeight / 2, 0]}>
            <boxGeometry args={[bracketWidth, bracketHeight, bracketDepth]} />
            <meshStandardMaterial color={color} transparent opacity={0.5} />
          </mesh>
          <mesh position={[node.width / 2 - inset, bracketHeight / 2, 0]}>
            <boxGeometry args={[bracketWidth, bracketHeight, bracketDepth]} />
            <meshStandardMaterial color={color} transparent opacity={0.5} />
          </mesh>
        </>
      )}
    </group>
  )
}

export default ShelfPreview
