'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  getWallMidpointHandlePoint,
  nodeRegistry,
  type SlabNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { useMovingNode } from '../../store/use-interaction-scope'
import { NodeActionMenu } from '../editor/node-action-menu'

/**
 * Floating Move / Duplicate / Delete buttons that appear above the
 * selected registered kind in the floor plan view.
 *
 * Lives outside the floorplan-panel.tsx monolith. Reads selection from
 * `useViewer`, finds the rendered `[data-node-id]` <g> inside the floor
 * plan scene, polls its bounding rect via rAF while open, and portals
 * an HTML overlay positioned at the top of the bounding box.
 *
 * Buttons:
 *  - Move: sets `movingNode` in useEditor. Enabled when the kind has
 *    `capabilities.movable`, `def.floorplanMoveTarget`, OR
 *    `def.affordanceTools.move` (slab / ceiling). The
 *    `<FloorplanRegistryMoveOverlay>` / dispatcher picks the right path.
 *    Walls are excluded — their move is reached via the side-arrow
 *    handles emitted from `def.floorplan`, not via a menu button.
 *  - Add hole (slab + ceiling only): inserts a small default-square
 *    hole at the polygon centroid via `updateNode`. Mirrors the legacy
 *    `handleAddHole` in `floating-action-menu.tsx`.
 *  - Duplicate: deep-clones the node, marks it new, sets it as the
 *    movingNode (placement cursor) — same UX pattern as 3D duplicate.
 *  - Delete: calls `deleteNode(id)`. Cascade is handled by the registry's
 *    `relations.cascadeDelete` if declared on the def.
 *
 * Hidden while in a move state (so we don't show buttons over a ghost).
 */
export function FloorplanRegistryActionMenu() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const movingNode = useMovingNode()
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingNodeOrigin = useEditor((s) => s.setMovingNodeOrigin)
  // Gate on floorplan hover so this 2D menu never coexists with the 3D
  // FloatingActionMenu in split view — that menu hides while the floorplan
  // is hovered, so this one must only show then. Mirrors the legacy
  // FloorplanActionMenuLayer guard. Without it a registry kind (e.g. a
  // duct) shows two Duplicate buttons whenever the pointer is outside the
  // 2D panel.
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)

  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Only show for registered kinds (skip legacy kinds — they have their
  // own FloorplanActionMenuLayer entries).
  const selectedKind = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const def = selectedKind ? nodeRegistry.get(selectedKind) : null
  const isRegistryKind = !!def
  const isVisible = isRegistryKind && !movingNode && isFloorplanHovered
  const isWall = selectedKind === 'wall'

  useEffect(() => {
    if (!(isVisible && selectedId)) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const sceneEl = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
      const svgEl = sceneEl?.ownerSVGElement ?? null
      const ctm = sceneEl?.getScreenCTM() ?? null
      if (!(sceneEl && svgEl && ctm)) {
        setPosition(null)
        return
      }

      // Walls: anchor at the wall midpoint in screen space so the menu
      // sits over the centre of the wall (not the top of its screen-axis
      // bounding box). Menu itself stays horizontal. Read live overrides
      // too so the anchor tracks the wall during side-arrow / endpoint
      // drags. For curved walls `getWallMidpointHandlePoint` returns the
      // apex point on the arc at t=0.5, matching what the renderer draws.
      if (isWall) {
        const sceneNode = useScene.getState().nodes[selectedId] as WallNode | undefined
        if (!sceneNode) {
          setPosition(null)
          return
        }
        const overrides = useLiveNodeOverrides.getState().get(selectedId) as
          | Partial<WallNode>
          | undefined
        const wall = (overrides ? { ...sceneNode, ...overrides } : sceneNode) as WallNode
        const planMid = getWallMidpointHandlePoint(wall)
        const midPt = svgEl.createSVGPoint()
        midPt.x = planMid.x
        midPt.y = planMid.y
        const midScreen = midPt.matrixTransform(ctm)
        setPosition({ left: midScreen.x, top: midScreen.y })
        return
      }

      const el = sceneEl.querySelector(`[data-node-id="${selectedId}"]`) as SVGGElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        setPosition({ left: rect.left + rect.width / 2, top: rect.top })
      } else {
        setPosition(null)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVisible, selectedId, isWall])

  if (!(isVisible && selectedId && position && def)) return null

  const node = useScene.getState().nodes[selectedId]
  if (!node) return null

  // Move button is enabled when any of:
  //   - `capabilities.movable` (generic translate-on-XZ — shelf / spawn / fence)
  //   - `def.floorplanMoveTarget` (anchor-aware 2D — door / window / item)
  //   - `def.affordanceTools.move` (kind-owned 3D mover — slab / ceiling / wall)
  // From the menu's perspective all three are "this kind can move from
  // the floor plan." The `MoveTool` dispatcher resolves the right path —
  // walls land on their bespoke `MoveWallTool` (perpendicular slide
  // with linked-wall cascade) via `affordanceTools.move`.
  const canMove =
    !!def.capabilities.movable || !!def.floorplanMoveTarget || !!def.affordanceTools?.move
  const canDuplicate = def.capabilities.duplicable !== false
  const canDelete = def.capabilities.deletable !== false
  const canAddHole = node.type === 'slab' || node.type === 'ceiling'

  const handleMove = () => {
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node as never)
    // 2D-owned move: `FloorplanRegistryMoveOverlay` runs the whole gesture.
    // Mark the origin (after `setMovingNode`, which resets it to null) so
    // `ToolManager` keeps the 3D affordance mover from also adopting the node
    // and reverting it on unmount. Mirrors the orange move-dot path.
    setMovingNodeOrigin('2d')
    // Match the legacy 3D `floating-action-menu`: clear selection so
    // selection-gated affordances unmount during the drag. Specifically
    // the slab / ceiling boundary editor (`ToolManager` shows it when
    // `selectedSlabId !== undefined`) would otherwise stay visible
    // and render its vertex / edge handles on top of the moving mesh
    // in split-view 3D. The move overlay reads `movingNode`, not the
    // selection, so clearing it doesn't disturb the move itself; the
    // commit path re-selects the node when it ends.
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  const handleAddHole = () => {
    if (!canAddHole) return
    const surfaceNode = node as SlabNode | CeilingNode
    const polygon = surfaceNode.polygon
    if (!polygon || polygon.length < 3) return

    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = surfaceNode.holes ?? []
    const currentMetadata = currentHoles.map(
      (_, index) => surfaceNode.holeMetadata?.[index] ?? { source: 'manual' as const },
    )
    sfxEmitter.emit('sfx:structure-build')
    useScene.getState().updateNode(
      selectedId as AnyNodeId,
      {
        holes: [...currentHoles, newHole],
        holeMetadata: [...currentMetadata, { source: 'manual' as const }],
      } as Partial<AnyNode>,
    )
  }

  const handleDuplicate = () => {
    if (!node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    const cloned = structuredClone(node) as AnyNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    // Mark fresh + hand to the placement cursor so the copy follows the
    // pointer and only lands on the next click — same gesture for every
    // kind. Polyline runs (duct / pipe / lineset) ride the same path:
    // `FloorplanRegistryMoveOverlay` translates their whole `path`, so they
    // no longer need the old "offset + drop already-placed" special case.
    cloned.metadata = { ...prevMeta, isNew: true }
    const parsed = def.schema.parse(cloned) as AnyNode
    useScene.getState().createNode(parsed, node.parentId as AnyNodeId)
    setMovingNode(parsed as never)
    useScene.temporal.getState().resume()
  }

  const handleDelete = () => {
    sfxEmitter.emit('sfx:item-delete')
    useScene.getState().deleteNode(selectedId)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 32px))',
      }}
    >
      <NodeActionMenu
        onAddHole={canAddHole ? handleAddHole : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        onDuplicate={canDuplicate ? handleDuplicate : undefined}
        onMove={canMove ? handleMove : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  )
}
