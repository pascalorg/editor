'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  createSceneApi,
  getWallMidpointHandlePoint,
  type NodeQuickAction,
  nodeRegistry,
  runAsSingleSceneHistoryStep,
  type SlabNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type MouseEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useReducedMotion } from '../../hooks/use-reduced-motion'
import { resolveMoveActionNode } from '../../lib/direct-manipulation'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import {
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
} from '../../lib/fresh-planar-placement'
import { curveReshapeScope } from '../../lib/interaction/scope'
import { playBlockedQuickActionFeedback } from '../../lib/quick-action-feedback'
import { collectQuickActionNodeScope } from '../../lib/quick-action-nodes'
import { sfxEmitter } from '../../lib/sfx-bus'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'
import useInteractionScope, {
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { NodeActionMenu } from '../editor/node-action-menu'
import { IconRefGlyph } from '../ui/icon-ref'

function SideAddGlyph({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <rect x="8" y="7" width="9" height="10" rx="1.75" />
      <path d="M12.5 7v10" />
      {direction === 'left' ? (
        <>
          <path d="M6.5 12H2.75" />
          <path d="m5.5 9.75-2.75 2.25 2.75 2.25" />
        </>
      ) : (
        <>
          <path d="M17.5 12h3.75" />
          <path d="m18.5 9.75 2.75 2.25-2.75 2.25" />
        </>
      )}
    </svg>
  )
}

// Builtin string tokens map to the generic glyphs above; kind-owned marks
// arrive as IconRef objects and render through the shared IconRefGlyph.
// Mirrors the 3D floating-action-menu (2D ↔ 3D parity).
function QuickActionIcon({ action }: { action: NodeQuickAction }) {
  const icon = action.icon
  if (!icon) return null
  if (typeof icon === 'object') return <IconRefGlyph icon={icon} size={14} />
  switch (icon) {
    case 'add-left':
      return <SideAddGlyph direction="left" />
    case 'add-right':
      return <SideAddGlyph direction="right" />
    default:
      return null
  }
}

function collectQuickActionNodes(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedId: string | null,
): Record<AnyNodeId, AnyNode> | null {
  if (!selectedId) return null
  const selected = nodes[selectedId as AnyNodeId]
  const def = selected ? nodeRegistry.get(selected.type) : undefined
  if (!def?.quickActions) return null
  return collectQuickActionNodeScope(nodes, selectedId, def.quickActionNodeScope)
}

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
 *  - Curve (wall only): enters curve reshape mode. The selected wall's
 *    midpoint curve handle remains visible so it can be dragged in plan.
 *  - Add hole (slab + ceiling only): inserts a small default-square
 *    hole at the polygon centroid via `updateNode`. Mirrors the legacy
 *    `handleAddHole` in `floating-action-menu.tsx`.
 *  - Duplicate: deep-clones the node, marks it new, sets it as the
 *    movingNode (placement cursor) — same UX pattern as 3D duplicate.
 *  - Delete: calls `deleteNode(id)`. Cascade is handled by the registry's
 *    `relations.cascadeDelete` if declared on the def.
 *
 * Hidden while moving or curving so the menu does not compete with the active affordance.
 */
export function FloorplanRegistryActionMenu() {
  const reducedMotion = useReducedMotion()
  // Sole selection only — a multi-selection gets the group menu
  // (`FloorplanGroupActionMenu`), whose actions target the whole selection.
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : undefined,
  ) as AnyNodeId | undefined
  const movingNode = useMovingNode()
  const isCurveReshape = useIsCurveReshape()
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
  const canCurve = useScene((s) => {
    if (!selectedId) return false
    const selectedNode = s.nodes[selectedId]
    if (!selectedNode) return false
    const definition = nodeRegistry.get(selectedNode.type)
    const canCurveNode = getFloorplanNodeExtension(definition)?.actionMenu?.canCurve
    return (
      !!definition?.floorplanAffordances?.curve &&
      !!canCurveNode?.({
        node: selectedNode as never,
        nodes: s.nodes,
      })
    )
  })
  const def = selectedKind ? nodeRegistry.get(selectedKind) : null
  const isRegistryKind = !!def
  const isVisible =
    isRegistryKind &&
    def?.presentation?.actionMenu !== false &&
    !movingNode &&
    !isCurveReshape &&
    isFloorplanHovered
  const isWall = selectedKind === 'wall'
  const quickActionNodes = useScene(
    useShallow((s) => collectQuickActionNodes(s.nodes, selectedId ?? null)),
  )

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

  const quickActions =
    quickActionNodes && nodeRegistry.get(node.type)?.quickActions
      ? (nodeRegistry.get(node.type)?.quickActions?.({
          node: node as never,
          nodes: quickActionNodes,
        }) ?? [])
      : []

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
    const sceneNodes = useScene.getState().nodes
    setMovingNode(resolveMoveActionNode(node, sceneNodes) as never)
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

  const handleCurve = () => {
    if (!canCurve) return
    sfxEmitter.emit('sfx:item-pick')
    useInteractionScope.getState().begin(curveReshapeScope(node.id))
  }

  const handleDuplicate = () => {
    if (!node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    if (duplicatesAsFreshSubtree(node as AnyNode)) {
      const draftId = createFreshPlacementSubtree(node.id as AnyNodeId)
      const draft = draftId ? useScene.getState().nodes[draftId] : null
      if (draft) {
        setMovingNode(draft as never)
        setMovingNodeOrigin('2d')
        useScene.temporal.getState().resume()
        return
      }
      useScene.temporal.getState().resume()
      return
    }
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

  const handleQuickAction = (action: NodeQuickAction, event: MouseEvent<HTMLButtonElement>) => {
    if (action.disabled) {
      if (action.blockedFeedback) {
        playBlockedQuickActionFeedback(event.currentTarget, reducedMotion)
      }
      return
    }
    const run = () => action.run({ node, sceneApi: createSceneApi(useScene) })
    const result = action.history === 'single' ? runAsSingleSceneHistoryStep(useScene, run) : run()
    if (result?.selectedIds) useViewer.getState().setSelection({ selectedIds: result.selectedIds })
    if (result?.selectedIds) {
      const selectedDifferentNode = result.selectedIds.some((id) => id !== node.id)
      sfxEmitter.emit(selectedDifferentNode ? 'sfx:item-place' : 'sfx:item-pick')
    }
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-30 flex w-max flex-col items-center"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 32px))',
      }}
    >
      <NodeActionMenu
        onAddHole={canAddHole ? handleAddHole : undefined}
        onCurve={canCurve ? handleCurve : undefined}
        onDelete={canDelete ? handleDelete : undefined}
        onDuplicate={canDuplicate ? handleDuplicate : undefined}
        onMove={canMove ? handleMove : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
      {quickActions.length > 0 ? (
        <div
          className="pointer-events-auto mt-1 inline-flex w-max items-center justify-center gap-0.5 rounded-lg border border-border/50 bg-background/90 px-1.5 py-1 shadow-md backdrop-blur-md"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          {quickActions.map((action) => (
            <button
              aria-disabled={action.disabled || undefined}
              aria-label={action.title ?? action.label}
              className={cn(
                'tooltip-trigger flex items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
                action.disabled &&
                  'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
              )}
              disabled={action.disabled && !action.blockedFeedback}
              key={action.id}
              onClick={(event) => handleQuickAction(action, event)}
              title={action.title ?? action.label}
              type="button"
            >
              <span className="flex items-center gap-1.5" data-quick-action-feedback>
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-current">
                  <QuickActionIcon action={action} />
                </span>
                <span className="whitespace-nowrap leading-none" data-quick-action-label>
                  {action.label}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
