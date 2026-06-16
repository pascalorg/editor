import { type GeometryContext, getMaterialPresetByRef } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  createDefaultMaterial,
  createMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import { BoxGeometry, Group, type Material, Mesh } from 'three'
import { sanitizeShelfDimensions } from './dimensions'
import type { ShelfNode } from './schema'
import { SHELF_SLOT_DEFAULT_COLOR, type ShelfSlotId } from './slots'

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
 * Materials: the kind exposes per-slot paintable surfaces through
 * `node.slots`, while `node.material` / `node.materialPreset` remain as
 * legacy whole-shelf fallbacks. Every generated mesh is tagged with the
 * slot it belongs to so paint mode can target shelves, frame, or back.
 *
 * Style dispatch lives at the top of the function; each style helper
 * mutates the same `group`.
 */
type ShelfSlotMaterials = Record<ShelfSlotId, Material>

function getShelfSlotMaterial(
  node: ShelfNode,
  slotId: ShelfSlotId,
  materials: GeometryContext['materials'],
  shading: RenderShading,
): Material {
  const ref = node.slots?.[slotId]
  if (ref) {
    const resolved = resolveMaterialRef(ref, materials, shading)
    if (resolved) return resolved
  }
  // Legacy whole-shelf paint applies to every slot when set (no per-slot override).
  if (node.materialPreset) {
    const preset = getMaterialPresetByRef(node.materialPreset)
    if (preset) {
      const base = createDefaultMaterial('#ffffff', 0.5, shading)
      applyMaterialPresetToMaterials(base, preset)
      return base
    }
  }
  if (node.material) return createMaterial(node.material, shading)
  return createDefaultMaterial(SHELF_SLOT_DEFAULT_COLOR, 0.9, shading)
}

function stampShelfSlot(mesh: Mesh, slotId: ShelfSlotId): Mesh {
  mesh.userData.slotId = slotId
  return mesh
}

// A board's front/back faces land on the frame's outer faces (posts / back panel)
// — coplanar surfaces the depth buffer can't separate, which flickers as z-fighting.
// Recess 1mm so the board sits just inside: the meshes still overlap (no gap), but
// no faces are coplanar. Depth is always recessed (boards reach into the back panel
// / posts). Width is recessed only at call sites where boards span OVER posts
// (open-rack / no-sides bookshelf); boards that ABUT side panels keep full width so
// they meet the sides flush — abutting faces are back-to-back and never fight.
const BOARD_INSET = 0.001

// Frame members that pass under the top board (dividers / back / corner posts) reach
// y=unitHeight, coplanar with the top board's top face → z-fighting. Drop their top 1mm so
// the board cleanly caps them; their bottom stays on the floor.
const FRAME_TOP_INSET = 0.001

function cappedFrameY(unitHeight: number): { height: number; centerY: number } {
  const height = Math.max(unitHeight - FRAME_TOP_INSET, 0.001)
  return { height, centerY: height / 2 }
}

function boardGeometry(
  width: number,
  thickness: number,
  depth: number,
  insetWidth = false,
): BoxGeometry {
  return new BoxGeometry(
    insetWidth ? Math.max(width - 2 * BOARD_INSET, 0.001) : width,
    thickness,
    Math.max(depth - 2 * BOARD_INSET, 0.001),
  )
}

export function buildShelfGeometry(
  rawNode: ShelfNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const node = sanitizeShelfDimensions(rawNode)
  const group = new Group()
  group.name = 'shelf-geometry'

  const materials: ShelfSlotMaterials = {
    shelves: getShelfSlotMaterial(node, 'shelves', ctx?.materials, shading),
    frame: getShelfSlotMaterial(node, 'frame', ctx?.materials, shading),
    back: getShelfSlotMaterial(node, 'back', ctx?.materials, shading),
  }

  switch (node.style) {
    case 'wall-shelf':
      buildWallShelf(group, node, materials)
      break
    case 'bookshelf':
      buildBookshelf(group, node, materials)
      break
    case 'open-rack':
      buildOpenRack(group, node, materials)
      break
    case 'cubby':
      buildCubby(group, node, materials)
      break
  }

  // Boards/brackets cast + receive shadows like the other geometry-driven
  // kinds (fence, slab). Set once here rather than on every `new Mesh` above.
  for (const child of group.children) {
    child.castShadow = true
    child.receiveShadow = true
  }

  return group
}

// ─── Style helpers ───────────────────────────────────────────────────

/**
 * Wall-shelf: open boards held by end brackets. `rows > 1` stacks
 * evenly-spaced boards from `height/rows` up to `height`. Brackets
 * span from floor to the topmost board.
 */
function buildWallShelf(group: Group, node: ShelfNode, materials: ShelfSlotMaterials) {
  for (const y of boardCenterYs(node)) {
    const board = stampShelfSlot(
      new Mesh(boardGeometry(node.width, node.thickness, node.depth), materials.shelves),
      'shelves',
    )
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
    const bracket = stampShelfSlot(
      new Mesh(new BoxGeometry(bracketWidth, bracketHeight, bracketDepth), materials.frame),
      'frame',
    )
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
function buildBookshelf(group: Group, node: ShelfNode, materials: ShelfSlotMaterials) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.withSides ? node.width - 2 * node.thickness : node.width

  // Top + bottom + intermediate boards. No sides => boards span over corner
  // posts, so inset their width too; with sides they abut the panels (flush).
  for (const y of boardCenterYs(node)) {
    const board = stampShelfSlot(
      new Mesh(
        boardGeometry(innerWidth, node.thickness, node.depth, !node.withSides),
        materials.shelves,
      ),
      'shelves',
    )
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  if (node.withBottom) {
    const bottom = stampShelfSlot(
      new Mesh(boardGeometry(innerWidth, node.thickness, node.depth), materials.shelves),
      'shelves',
    )
    bottom.name = 'shelf-board-bottom'
    bottom.position.set(0, node.thickness / 2, 0)
    group.add(bottom)
  }

  // Side panels (or corner posts) — span the full unit height.
  if (node.withSides) {
    for (const sign of [-1, 1] as const) {
      const side = stampShelfSlot(
        new Mesh(new BoxGeometry(node.thickness, unitHeight, node.depth), materials.frame),
        'frame',
      )
      side.name = `shelf-side-${sign === -1 ? 'left' : 'right'}`
      side.position.set(sign * (node.width / 2 - node.thickness / 2), unitHeight / 2, 0)
      group.add(side)
    }
  } else {
    addCornerPosts(group, node, materials.frame, unitHeight, 'rack')
  }

  if (node.withBack) {
    const fy = cappedFrameY(unitHeight)
    const back = stampShelfSlot(
      new Mesh(new BoxGeometry(innerWidth, fy.height, node.thickness), materials.back),
      'back',
    )
    back.name = 'shelf-back'
    back.position.set(0, fy.centerY, -(node.depth / 2 - node.thickness / 2))
    group.add(back)
  }

  // Vertical dividers between columns
  if (node.columns > 1) {
    const fy = cappedFrameY(unitHeight)
    const colStep = innerWidth / node.columns
    for (let c = 1; c < node.columns; c++) {
      const x = -innerWidth / 2 + c * colStep
      const divider = stampShelfSlot(
        // A full-height divider crosses the shelves, so its depth must sit
        // INSIDE the boards' (already recessed) depth: embedded at each crossing
        // (the board occludes it — no coplanar fight) and tucked inside the back
        // panel, rather than proud at the front / coplanar with the back.
        new Mesh(
          new BoxGeometry(node.thickness, fy.height, node.depth - 4 * BOARD_INSET),
          materials.frame,
        ),
        'frame',
      )
      divider.name = `shelf-divider-col-${c}`
      divider.position.set(x, fy.centerY, 0)
      group.add(divider)
    }
  }
}

/**
 * Open-rack: four corner posts + horizontal boards. `withBack` adds an
 * X-brace on the back face for stability. `withSides` / `bracketStyle`
 * are ignored (the rack defines its own posts).
 */
function buildOpenRack(group: Group, node: ShelfNode, materials: ShelfSlotMaterials) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.width
  const boardThickness = Math.max(0.02, node.thickness * 0.8)

  for (const y of boardCenterYs(node)) {
    const board = stampShelfSlot(
      new Mesh(boardGeometry(innerWidth, boardThickness, node.depth, true), materials.shelves),
      'shelves',
    )
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  addCornerPosts(group, node, materials.frame, unitHeight, 'rack')

  if (node.withBack) {
    const braceThickness = Math.max(0.015, node.thickness * 0.6)
    for (const y of [boardThickness, unitHeight - boardThickness] as const) {
      const brace = stampShelfSlot(
        new Mesh(
          new BoxGeometry(node.width - braceThickness * 2, braceThickness, braceThickness),
          materials.frame,
        ),
        'frame',
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
function buildCubby(group: Group, node: ShelfNode, materials: ShelfSlotMaterials) {
  const unitHeight = node.height + node.thickness
  const innerWidth = node.width - 2 * node.thickness

  for (const y of boardCenterYs(node)) {
    const board = stampShelfSlot(
      new Mesh(boardGeometry(innerWidth, node.thickness, node.depth), materials.shelves),
      'shelves',
    )
    board.name = `shelf-board-${boardRowIndex(node, y)}`
    board.position.set(0, y, 0)
    group.add(board)
  }

  if (node.withBottom) {
    const bottom = stampShelfSlot(
      new Mesh(boardGeometry(innerWidth, node.thickness, node.depth), materials.shelves),
      'shelves',
    )
    bottom.name = 'shelf-board-bottom'
    bottom.position.set(0, node.thickness / 2, 0)
    group.add(bottom)
  }

  for (const sign of [-1, 1] as const) {
    const side = stampShelfSlot(
      new Mesh(new BoxGeometry(node.thickness, unitHeight, node.depth), materials.frame),
      'frame',
    )
    side.name = `shelf-side-${sign === -1 ? 'left' : 'right'}`
    side.position.set(sign * (node.width / 2 - node.thickness / 2), unitHeight / 2, 0)
    group.add(side)
  }

  const fy = cappedFrameY(unitHeight)
  const back = stampShelfSlot(
    new Mesh(new BoxGeometry(innerWidth, fy.height, node.thickness), materials.back),
    'back',
  )
  back.name = 'shelf-back'
  back.position.set(0, fy.centerY, -(node.depth / 2 - node.thickness / 2))
  group.add(back)

  if (node.columns > 1) {
    const colStep = innerWidth / node.columns
    const rowStep = node.height / node.rows
    for (let r = 0; r < node.rows; r++) {
      // Without a bottom board the lowest cell opens onto the floor, so its
      // divider must reach y=0 rather than rest on a (missing) board top.
      const cellBottomY = r === 0 && !node.withBottom ? 0 : node.thickness + r * rowStep
      const cellTopY = node.thickness + (r + 1) * rowStep
      const dividerHeight = cellTopY - cellBottomY - node.thickness
      if (dividerHeight <= 0) continue
      for (let c = 1; c < node.columns; c++) {
        const x = -innerWidth / 2 + c * colStep
        const divider = stampShelfSlot(
          // Same depth recess as the boards: the divider sits flush with the
          // shelf fronts (not proud) and its back tucks inside the back panel,
          // so it neither overflows the boards at the front nor z-fights the
          // back panel down the centre. Height is flush (the board faces it
          // meets top/bottom are back-to-back, so they don't fight).
          new Mesh(boardGeometry(node.thickness, dividerHeight, node.depth), materials.frame),
          'frame',
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
  const fy = cappedFrameY(unitHeight)
  const postThickness =
    postStyle === 'rack' ? Math.max(0.025, node.thickness * 1.5) : Math.max(0.02, node.thickness)
  const inset = postThickness / 2
  for (const xSign of [-1, 1] as const) {
    for (const zSign of [-1, 1] as const) {
      const post = stampShelfSlot(
        new Mesh(new BoxGeometry(postThickness, fy.height, postThickness), material),
        'frame',
      )
      post.name = `shelf-post-${xSign === -1 ? 'l' : 'r'}${zSign === -1 ? 'b' : 'f'}`
      post.position.set(
        xSign * (node.width / 2 - inset),
        fy.centerY,
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
  const safe = sanitizeShelfDimensions(node)
  const ys = boardCenterYs(safe).map((y) => y + safe.thickness / 2)
  const bottomApplies = safe.style === 'cubby' || safe.style === 'bookshelf'
  if (safe.withBottom && bottomApplies) ys.unshift(safe.thickness)
  return ys
}
