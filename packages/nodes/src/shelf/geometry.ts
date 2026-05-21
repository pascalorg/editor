import { getMaterialPresetByRef } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  createDefaultMaterial,
  createMaterial,
  DEFAULT_SHELF_MATERIAL,
  type RenderShading,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, type Material, Mesh } from 'three'
import type { ShelfNode } from './schema'

/**
 * Pure shelf geometry builder. Takes a `ShelfNode` and returns a `Group`
 * with named child meshes — `shelf-board-<row>`, `shelf-side-<sign>`,
 * `shelf-back`, `shelf-divider-<r>-<c>`, `shelf-bracket-<sign>`,
 * `shelf-post-<corner>`, `shelf-brace-<id>` — so other systems can
 * address them by name if needed.
 *
 * The function is pure: no React, no scene access, no `useScene`. Every
 * piece of geometry is determined by `node` alone. This lets the parity
 * test in `__tests__/geometry.test.ts` compare BufferGeometry vertex /
 * index arrays directly, and lets AI-generated nodes follow the same
 * shape with no editor-specific knowledge.
 *
 * Materials: the kind exposes a single paintable surface via
 * `node.material` / `node.materialPreset` — same shape walls / slabs /
 * stairs use. When neither is set, every mesh shares the
 * `DEFAULT_SHELF_MATERIAL` (off-white). When the user paints, the
 * library preset's properties land on a cloned material here. The cache
 * key includes the preset / material signature so paint changes
 * invalidate without stomping unrelated shelves.
 *
 * Style dispatch lives at the top of the function; each style helper
 * mutates the same `group`.
 */
type ShelfMaterial = Material & {
  depthWrite: boolean
}

const shelfMaterialCache = new Map<string, Material>()

function getShelfMaterial(node: ShelfNode, shading: RenderShading): Material {
  const cacheKey = JSON.stringify({
    shading,
    material: node.material ?? null,
    materialPreset: node.materialPreset ?? null,
  })
  const cached = shelfMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(node.materialPreset)
  const material = preset
    ? createDefaultMaterial('#ffffff', 0.5, shading)
    : node.material
      ? createMaterial(node.material, shading).clone()
      : DEFAULT_SHELF_MATERIAL(shading).clone()

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  const shelfMaterial = material as ShelfMaterial
  shelfMaterial.side = FrontSide
  shelfMaterial.depthWrite = true
  shelfMaterial.needsUpdate = true

  shelfMaterialCache.set(cacheKey, material)
  return material
}

export function buildShelfGeometry(
  node: ShelfNode,
  _ctx?: unknown,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  group.name = 'shelf-geometry'

  const material = getShelfMaterial(node, shading)

  switch (node.style) {
    case 'wall-shelf':
      buildWallShelf(group, node, material)
      break
    case 'bookshelf':
      buildBookshelf(group, node, material)
      break
    case 'open-rack':
      buildOpenRack(group, node, material)
      break
    case 'cubby':
      buildCubby(group, node, material)
      break
  }

  return group
}

// ─── Style helpers ───────────────────────────────────────────────────

/**
 * Wall-shelf: open boards held by end brackets. `rows > 1` stacks
 * evenly-spaced boards from `height/rows` up to `height`. Brackets
 * span from floor to the topmost board.
 */
function buildWallShelf(group: Group, node: ShelfNode, material: Material) {
  for (const y of boardCenterYs(node)) {
    const board = new Mesh(new BoxGeometry(node.width, node.thickness, node.depth), material)
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  if (node.bracketStyle === 'hidden') return

  const inset = Math.min(0.12, node.width / 6)
  const bracketHeight = Math.max(0.01, node.height)
  const bracketWidth =
    node.bracketStyle === 'industrial'
      ? Math.max(0.04, node.depth * 0.2)
      : Math.max(0.02, node.depth * 0.12)
  const bracketDepth = node.bracketStyle === 'industrial' ? node.depth * 0.95 : node.depth * 0.7

  for (const sign of [-1, 1] as const) {
    const bracket = new Mesh(new BoxGeometry(bracketWidth, bracketHeight, bracketDepth), material)
    bracket.name = `shelf-bracket-${sign === -1 ? 'left' : 'right'}`
    bracket.position.set(sign * (node.width / 2 - inset), bracketHeight / 2, 0)
    group.add(bracket)
  }
}

/**
 * Bookshelf: full-height cabinet with side panels, multiple shelf boards,
 * optional back, and inner vertical dividers if `columns > 1`. When
 * `withSides === false`, side panels become slim corner posts (a rack
 * silhouette).
 */
function buildBookshelf(group: Group, node: ShelfNode, material: Material) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.withSides ? node.width - 2 * node.thickness : node.width

  // Top + bottom + intermediate boards
  for (const y of boardCenterYs(node)) {
    const board = new Mesh(new BoxGeometry(innerWidth, node.thickness, node.depth), material)
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  if (node.withBottom) {
    const bottom = new Mesh(new BoxGeometry(innerWidth, node.thickness, node.depth), material)
    bottom.name = 'shelf-board-bottom'
    bottom.position.set(0, node.thickness / 2, 0)
    group.add(bottom)
  }

  // Side panels (or corner posts) — span the full unit height.
  if (node.withSides) {
    for (const sign of [-1, 1] as const) {
      const side = new Mesh(new BoxGeometry(node.thickness, unitHeight, node.depth), material)
      side.name = `shelf-side-${sign === -1 ? 'left' : 'right'}`
      side.position.set(sign * (node.width / 2 - node.thickness / 2), unitHeight / 2, 0)
      group.add(side)
    }
  } else {
    addCornerPosts(group, node, material, unitHeight, 'rack')
  }

  if (node.withBack) {
    const back = new Mesh(new BoxGeometry(innerWidth, unitHeight, node.thickness), material)
    back.name = 'shelf-back'
    back.position.set(0, unitHeight / 2, -(node.depth / 2 - node.thickness / 2))
    group.add(back)
  }

  // Vertical dividers between columns
  if (node.columns > 1) {
    const colStep = innerWidth / node.columns
    for (let c = 1; c < node.columns; c++) {
      const x = -innerWidth / 2 + c * colStep
      const divider = new Mesh(new BoxGeometry(node.thickness, unitHeight, node.depth), material)
      divider.name = `shelf-divider-col-${c}`
      divider.position.set(x, unitHeight / 2, 0)
      group.add(divider)
    }
  }
}

/**
 * Open-rack: four corner posts + horizontal boards. `withBack` adds an
 * X-brace on the back face for stability. `withSides` / `bracketStyle`
 * are ignored (the rack defines its own posts).
 */
function buildOpenRack(group: Group, node: ShelfNode, material: Material) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.width
  const boardThickness = Math.max(0.02, node.thickness * 0.8)

  for (const y of boardCenterYs(node)) {
    const board = new Mesh(new BoxGeometry(innerWidth, boardThickness, node.depth), material)
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  addCornerPosts(group, node, material, unitHeight, 'rack')

  if (node.withBack) {
    const braceThickness = Math.max(0.015, node.thickness * 0.6)
    for (const y of [boardThickness, unitHeight - boardThickness] as const) {
      const brace = new Mesh(
        new BoxGeometry(node.width - braceThickness * 2, braceThickness, braceThickness),
        material,
      )
      brace.name = `shelf-brace-h-${y < unitHeight / 2 ? 'bottom' : 'top'}`
      brace.position.set(0, y, -(node.depth / 2 - braceThickness / 2))
      group.add(brace)
    }
  }
}

/**
 * Cubby: closed grid of pigeonholes. Always has sides + back + horizontal
 * boards + vertical dividers. `withBack` / `withSides` are forced on
 * because the cubby shape requires them.
 */
function buildCubby(group: Group, node: ShelfNode, material: Material) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.width - 2 * node.thickness

  for (const y of boardCenterYs(node)) {
    const board = new Mesh(new BoxGeometry(innerWidth, node.thickness, node.depth), material)
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  if (node.withBottom) {
    const bottom = new Mesh(new BoxGeometry(innerWidth, node.thickness, node.depth), material)
    bottom.name = 'shelf-board-bottom'
    bottom.position.set(0, node.thickness / 2, 0)
    group.add(bottom)
  }

  for (const sign of [-1, 1] as const) {
    const side = new Mesh(new BoxGeometry(node.thickness, unitHeight, node.depth), material)
    side.name = `shelf-side-${sign === -1 ? 'left' : 'right'}`
    side.position.set(sign * (node.width / 2 - node.thickness / 2), unitHeight / 2, 0)
    group.add(side)
  }

  const back = new Mesh(new BoxGeometry(innerWidth, unitHeight, node.thickness), material)
  back.name = 'shelf-back'
  back.position.set(0, unitHeight / 2, -(node.depth / 2 - node.thickness / 2))
  group.add(back)

  if (node.columns > 1) {
    const colStep = innerWidth / node.columns
    const rowStep = node.height / node.rows
    for (let r = 0; r < node.rows; r++) {
      const cellBottomY = node.thickness + r * rowStep
      const cellTopY = node.thickness + (r + 1) * rowStep
      const dividerHeight = cellTopY - cellBottomY - node.thickness
      if (dividerHeight <= 0) continue
      for (let c = 1; c < node.columns; c++) {
        const x = -innerWidth / 2 + c * colStep
        const divider = new Mesh(
          new BoxGeometry(node.thickness, dividerHeight, node.depth),
          material,
        )
        divider.name = `shelf-divider-${r}-${c}`
        divider.position.set(x, cellBottomY + dividerHeight / 2, 0)
        group.add(divider)
      }
    }
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────

/**
 * Y positions of every shelf board's vertical center, in floor-to-top
 * order. The topmost board's center is at `height + thickness/2`; lower
 * boards are evenly spaced from `height/rows` to `height` (matching the
 * legacy v1 wall-shelf where the only board is at `height + thickness/2`).
 */
function boardCenterYs(node: ShelfNode): number[] {
  const ys: number[] = []
  const step = node.height / node.rows
  for (let r = 1; r <= node.rows; r++) {
    ys.push(r * step + node.thickness / 2)
  }
  return ys
}

/** Convert a Y position back to its row index (0 = bottom row). */
function boardRowIndex(node: ShelfNode, y: number): number {
  const step = node.height / node.rows
  return Math.round((y - node.thickness / 2) / step) - 1
}

/**
 * Place four corner posts at `(±width/2 ∓ inset, height/2, ±depth/2 ∓ inset)`.
 * Used by `open-rack` and the no-sides variant of `bookshelf`.
 */
function addCornerPosts(
  group: Group,
  node: ShelfNode,
  material: Material,
  unitHeight: number,
  postStyle: 'rack' | 'leg',
) {
  const postThickness =
    postStyle === 'rack' ? Math.max(0.025, node.thickness * 1.5) : Math.max(0.02, node.thickness)
  const inset = postThickness / 2
  for (const xSign of [-1, 1] as const) {
    for (const zSign of [-1, 1] as const) {
      const post = new Mesh(new BoxGeometry(postThickness, unitHeight, postThickness), material)
      post.name = `shelf-post-${xSign === -1 ? 'l' : 'r'}${zSign === -1 ? 'b' : 'f'}`
      post.position.set(
        xSign * (node.width / 2 - inset),
        unitHeight / 2,
        zSign * (node.depth / 2 - inset),
      )
      group.add(post)
    }
  }
}

/**
 * Y of the top surface of each shelf row (top of the board). Used by
 * `capabilities.surfaces.custom` so items host at the right Y on
 * whichever row the cursor targets. When `withBottom` is on (cubby /
 * bookshelf only — wall-shelf and open-rack ignore the toggle), the
 * top of the bottom board is exposed as an additional surface so items
 * can host in the lowest cell.
 */
export function shelfRowSurfaceYs(node: ShelfNode): number[] {
  const ys = boardCenterYs(node).map((y) => y + node.thickness / 2)
  const bottomApplies = node.style === 'cubby' || node.style === 'bookshelf'
  if (node.withBottom && bottomApplies) ys.unshift(node.thickness)
  return ys
}
