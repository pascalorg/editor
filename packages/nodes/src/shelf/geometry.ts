import { BoxGeometry, type BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three'
import type { ShelfNode } from './schema'

/**
 * Pure shelf geometry builder. Takes a `ShelfNode` and returns a `Group`
 * containing the top board + bracket meshes — no React, no scene access.
 *
 * Two reasons this is its own pure function (not inlined into the renderer):
 *
 * 1. **Geometry parity testing.** Phase 4's pixel-diff test compares the
 *    BufferGeometry vertex/index arrays returned by this function against
 *    a snapshot — pure functions are trivial to test, JSX is not.
 * 2. **AI-authored nodes.** This is the file an AI is most likely to
 *    generate. Pure, deterministic, takes typed input, returns Three.js
 *    primitives. No React or registry knowledge required.
 */
export function buildShelfGeometry(node: ShelfNode): Group {
  const group = new Group()
  group.name = 'shelf-geometry'

  const material = new MeshStandardMaterial({
    color: new Color(node.color),
    roughness: 0.65,
    metalness: 0.05,
  })

  // Top board, centered at (0, height + thickness/2, 0)
  const topBoardGeometry: BufferGeometry = new BoxGeometry(node.width, node.thickness, node.depth)
  const topBoard = new Mesh(topBoardGeometry, material)
  topBoard.name = 'shelf-top'
  topBoard.position.set(0, node.height + node.thickness / 2, 0)
  group.add(topBoard)

  // Brackets — two below the top, near each end. Style varies the look.
  for (const sign of [-1, 1] as const) {
    const bracket = buildBracket(node, sign, material)
    if (bracket) {
      bracket.name = `shelf-bracket-${sign === -1 ? 'left' : 'right'}`
      group.add(bracket)
    }
  }

  return group
}

function buildBracket(node: ShelfNode, sign: -1 | 1, material: MeshStandardMaterial): Mesh | null {
  // 'hidden' style: skip visible brackets entirely.
  if (node.bracketStyle === 'hidden') return null

  const inset = Math.min(0.12, node.width / 6)
  const x = sign * (node.width / 2 - inset)
  // Bracket height: from floor (0) up to the underside of the top board.
  const bracketHeight = Math.max(0.01, node.height)

  const bracketWidth =
    node.bracketStyle === 'industrial'
      ? Math.max(0.04, node.depth * 0.2)
      : Math.max(0.02, node.depth * 0.12)
  const bracketDepth = node.bracketStyle === 'industrial' ? node.depth * 0.95 : node.depth * 0.7

  const geometry = new BoxGeometry(bracketWidth, bracketHeight, bracketDepth)
  const mesh = new Mesh(geometry, material)
  mesh.position.set(x, bracketHeight / 2, 0)
  return mesh
}
