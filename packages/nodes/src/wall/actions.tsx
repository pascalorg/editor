'use client'
import {
  type AnyNodeId,
  planWallMerge,
  runAsSingleSceneHistoryStep,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  captureElementActionOrigin,
  completeElementAction,
  type FloorplanWallDimensionFaces,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  triggerSFX,
  useFloorplanAnnotationVisibility,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { FoldHorizontal, Scissors } from 'lucide-react'
import { useMemo } from 'react'
import { openWallSplit } from './split-session'

const BUTTON =
  'tooltip-trigger rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50'

/** The wall's action-menu contributions: Split and dimension faces (one wall), Merge (several). */
export default function WallActions() {
  return (
    <>
      <SplitWallAction />
      <DimensionFacesAction />
      <MergeWallsAction />
    </>
  )
}

const DIMENSION_FACES: Record<
  FloorplanWallDimensionFaces,
  { label: string; title: string; next: FloorplanWallDimensionFaces }
> = {
  both: {
    label: 'ID+OD',
    title: 'Dimensions to the interior and exterior faces. Click for interior only',
    next: 'interior',
  },
  interior: {
    label: 'ID',
    title: 'Dimensions to the interior faces (room size). Click for exterior only',
    next: 'exterior',
  },
  exterior: {
    label: 'OD',
    title: 'Dimensions to the exterior faces (outside size). Click for both',
    next: 'both',
  },
}

/**
 * What a selected wall's dimensions measure to — interior faces, exterior
 * faces or both — for its length and its temporary room and outside sizes, in
 * 2D and 3D. A display preference, kept per browser; it changes no geometry.
 */
function DimensionFacesAction() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const wall = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const faces = useFloorplanAnnotationVisibility((s) => s.wallDimensionFaces)
  const setFaces = useFloorplanAnnotationVisibility((s) => s.setWallDimensionFaces)
  if (wall?.type !== 'wall') return null
  // A partition between two rooms has no outside: its dimensions read the same either way.
  if (wall.frontSide === 'interior' && wall.backSide === 'interior') return null
  const option = DIMENSION_FACES[faces]
  return (
    <button
      type="button"
      aria-label={option.title}
      title={option.title}
      className={`${BUTTON} min-w-8 font-medium text-xs tabular-nums`}
      onClick={(event) => {
        event.stopPropagation()
        setFaces(option.next)
      }}
    >
      {option.label}
    </button>
  )
}

function SplitWallAction() {
  const i18n = usePascalI18n()
  const selected = useViewer((s) => s.selection.selectedIds)
  const wall = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const readOnly = useScene((s) => s.readOnly)
  if (wall?.type !== 'wall') return null
  return (
    <button
      type="button"
      aria-label={i18n._({ id: 'node.wall.actions.splitWall', message: 'Split wall' })}
      title={i18n._({ id: 'node.wall.actions.splitWall', message: 'Split wall' })}
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
  const i18n = usePascalI18n()
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
      aria-label={i18n._({ id: 'node.wall.actions.mergeWalls', message: 'Merge walls' })}
      title={
        reason ? undefined : i18n._({ id: 'node.wall.actions.mergeWalls', message: 'Merge walls' })
      }
      disabled={readOnly || reason !== null}
      className={BUTTON}
      onClick={(event) => {
        event.stopPropagation()
        const plan = planWallMerge(useScene.getState().nodes, selected)
        // Walls drilled from one room go back to it; otherwise the merged wall stays selected.
        const origin = captureElementActionOrigin(selected)
        runAsSingleSceneHistoryStep(useScene, () =>
          useScene.getState().applyNodeChanges(plan.changes),
        )
        triggerSFX('sfx:structure-build')
        if (origin) completeElementAction(origin)
        else useViewer.getState().setSelection({ selectedIds: [plan.wallId] })
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
