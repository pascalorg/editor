'use client'
import {
  type AnyNodeId,
  type MessageDescriptor,
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
  { label: MessageDescriptor; title: MessageDescriptor; next: FloorplanWallDimensionFaces }
> = {
  both: {
    label: /* i18n */ {
      id: 'node.wall.actions.idOd',
      message: 'ID+OD',
      comment: 'Short button text: ID is the interior dimension, OD the outside dimension.',
    },
    title: /* i18n */ {
      id: 'node.wall.actions.dimensionsToTheInteriorAndExterior',
      message: 'Dimensions to the interior and exterior faces. Click for interior only',
    },
    next: 'interior',
  },
  interior: {
    label: /* i18n */ {
      id: 'node.wall.actions.id',
      message: 'ID',
      comment: 'Short button text: interior dimension, measured to the interior faces.',
    },
    title: /* i18n */ {
      id: 'node.wall.actions.dimensionsToTheInteriorFacesRoom',
      message: 'Dimensions to the interior faces (room size). Click for exterior only',
    },
    next: 'exterior',
  },
  exterior: {
    label: /* i18n */ {
      id: 'node.wall.actions.od',
      message: 'OD',
      comment: 'Short button text: outside dimension, measured to the exterior faces.',
    },
    title: /* i18n */ {
      id: 'node.wall.actions.dimensionsToTheExteriorFacesOutside',
      message: 'Dimensions to the exterior faces (outside size). Click for both',
    },
    next: 'both',
  },
}

/**
 * What a selected wall's dimensions measure to — interior faces, exterior
 * faces or both — for its length and its temporary room and outside sizes, in
 * 2D and 3D. A display preference, kept per browser; it changes no geometry.
 */
function DimensionFacesAction() {
  const i18n = usePascalI18n()
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
  const title = i18n._(option.title)
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className={`${BUTTON} min-w-8 font-medium text-xs tabular-nums`}
      onClick={(event) => {
        event.stopPropagation()
        setFaces(option.next)
      }}
    >
      {i18n._(option.label)}
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
  // null: not a wall selection (render nothing); otherwise why it can't merge (undefined when the
  // plan gave no reason of its own), or null.
  const merge = useMemo(() => {
    if (selected.length < 2 || selected.some((id) => nodes[id]?.type !== 'wall')) return null
    try {
      planWallMerge(nodes, selected)
      return { reason: null }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : undefined }
    }
  }, [nodes, selected])
  if (!merge) return null
  // Worded here rather than in the memo, so a change of language reaches it.
  const reason =
    merge.reason === undefined
      ? i18n._({
          id: 'node.wall.actions.theseWallsCannotBeMerged',
          message: 'These walls cannot be merged.',
        })
      : merge.reason
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
