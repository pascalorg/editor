'use client'
import {
  type AnyNodeId,
  planWallMerge,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { Tooltip, TooltipContent, TooltipTrigger, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { FoldHorizontal, Scissors } from 'lucide-react'
import { useMemo } from 'react'
import { openWallSplit } from './split-session'

const BUTTON =
  'tooltip-trigger rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50'

/** The wall's action-menu contributions: Split (one wall) and Merge (several). */
export default function WallActions() {
  return (
    <>
      <SplitWallAction />
      <MergeWallsAction />
    </>
  )
}

function SplitWallAction() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const wall = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const readOnly = useScene((s) => s.readOnly)
  if (wall?.type !== 'wall') return null
  return (
    <button
      type="button"
      aria-label="Split wall"
      title="Split wall"
      disabled={readOnly}
      className={BUTTON}
      onClick={(event) => {
        event.stopPropagation()
        openWallSplit(wall)
      }}
    >
      <Scissors className="size-4" />
    </button>
  )
}

/** Joins selected walls that continue each other into one — the inverse of Split. */
function MergeWallsAction() {
  const selected = useViewer((s) => s.selection.selectedIds) as AnyNodeId[]
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  // null: not a wall selection (render nothing); otherwise why it can't merge, or null.
  const merge = useMemo(() => {
    if (selected.length < 2 || selected.some((id) => nodes[id]?.type !== 'wall')) return null
    try {
      planWallMerge(nodes, selected)
      return { reason: null }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : 'These walls cannot be merged.' }
    }
  }, [nodes, selected])
  if (!merge) return null
  const { reason } = merge
  const button = (
    <button
      type="button"
      aria-label="Merge walls"
      title={reason ? undefined : 'Merge walls'}
      disabled={readOnly || reason !== null}
      className={BUTTON}
      onClick={(event) => {
        event.stopPropagation()
        const plan = planWallMerge(useScene.getState().nodes, selected)
        runAsSingleSceneHistoryStep(useScene, () =>
          useScene.getState().applyNodeChanges(plan.changes),
        )
        useViewer.getState().setSelection({ selectedIds: [plan.wallId] })
        triggerSFX('sfx:structure-build')
      }}
    >
      <FoldHorizontal className="size-4" />
    </button>
  )
  if (!reason) return button
  // A disabled button gets no hover events, so the reason hangs off a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  )
}
