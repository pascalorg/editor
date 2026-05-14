'use client'

import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import type { ShelfNode } from './schema'

// Note: useNodeEvents from @pascal-app/viewer has a hardcoded kind list and
// doesn't yet know about 'shelf'. Phase 4 generalizes it via the registry —
// until then, shelf selection works via R3F's default raycast (clicks bubble
// through; the editor's selection manager hit-tests the registered Object3D).

/**
 * Registry-driven shelf renderer. Renders top board + brackets as inline R3F
 * primitives so React owns the scene graph end-to-end — no imperative
 * children swap.
 *
 * The pure `buildShelfGeometry` function in `./geometry.ts` produces the same
 * shape outside of React (used by tests + reachable by AI-authored consumers
 * that want a Three.js Group). Keeping both costs nothing because the shape
 * primitives are tiny.
 */
const ShelfRenderer = ({ node }: { node: ShelfNode }) => {
  const ref = useRef<Group>(null!)
  const liveTransform = useLiveTransforms((state) => state.get(node.id))

  useRegistry(node.id, 'shelf', ref)

  const color = useMemo(() => new Color(node.color), [node.color])
  const topY = node.height + node.thickness / 2

  // Bracket dimensions mirror buildShelfGeometry — keep these in sync if the
  // geometry function evolves. Phase 4 may consolidate.
  const inset = Math.min(0.12, node.width / 6)
  const bracketHeight = Math.max(0.01, node.height)
  const bracketWidth =
    node.bracketStyle === 'industrial'
      ? Math.max(0.04, node.depth * 0.2)
      : Math.max(0.02, node.depth * 0.12)
  const bracketDepth = node.bracketStyle === 'industrial' ? node.depth * 0.95 : node.depth * 0.7

  useEffect(() => {
    // biome-ignore lint/suspicious/noConsole: dev-only verification log
    console.info('[shelf] rendered', node.id, 'at', node.position)
  }, [node.id, node.position])

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={liveTransform?.rotation ? [0, liveTransform.rotation, 0] : node.rotation}
      visible={node.visible}
    >
      {/* Top board */}
      <mesh position={[0, topY, 0]} name="shelf-top">
        <boxGeometry args={[node.width, node.thickness, node.depth]} />
        <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
      </mesh>

      {/* Brackets (skipped for 'hidden' style) */}
      {node.bracketStyle !== 'hidden' && (
        <>
          <mesh
            position={[-(node.width / 2 - inset), bracketHeight / 2, 0]}
            name="shelf-bracket-left"
          >
            <boxGeometry args={[bracketWidth, bracketHeight, bracketDepth]} />
            <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
          </mesh>
          <mesh
            position={[node.width / 2 - inset, bracketHeight / 2, 0]}
            name="shelf-bracket-right"
          >
            <boxGeometry args={[bracketWidth, bracketHeight, bracketDepth]} />
            <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
          </mesh>
        </>
      )}
    </group>
  )
}

export default ShelfRenderer
