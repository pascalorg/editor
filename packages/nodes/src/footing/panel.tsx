'use client'

import {
  type AnyNodeId,
  FOOTING_MINIMUM,
  FOOTING_SIZES,
  type FootingDesign,
  type FootingNode,
  type FootingShape,
  footingDesign,
  footingPlan,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  formatLinearMeasurement,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

const IN = 0.0254

/** A footing size in metres, shown in inches on an imperial plan (feet would show 8 in as 0.67). */
function SizeField({
  label,
  value,
  min = 0.01,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  onCommit: (meters: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const imperial = useViewer((state) => state.unit) === 'imperial'
  const toShown = (meters: number) => (imperial ? meters / IN : meters)
  return (
    <MetricControl
      className="h-9 text-xs"
      label={label}
      min={toShown(min)}
      onChange={(next) => setDraft(next)}
      onCommit={(next) => {
        setDraft(null)
        onCommit(imperial ? next * IN : next)
      }}
      precision={imperial ? 2 : 3}
      restoreOnCommit={false}
      step={imperial ? 0.5 : 0.5 * IN}
      unit={imperial ? 'in' : 'm'}
      value={draft ?? toShown(value)}
    />
  )
}

/** The footing a shape change leaves: in the same place, at the new shape's sizes. */
function reshaped(footing: FootingNode, shape: FootingShape): Partial<FootingNode> {
  const plan = footingPlan(footing)
  if (!plan || plan.shape === shape) return {}
  if (plan.shape === 'strip')
    return {
      shape,
      ...FOOTING_SIZES.pad,
      center: [(plan.start[0] + plan.end[0]) / 2, (plan.start[1] + plan.end[1]) / 2],
      rotation: -Math.atan2(plan.end[1] - plan.start[1], plan.end[0] - plan.start[0]),
      start: undefined,
      end: undefined,
    }
  // A strip along the pad's local x, its width long.
  const half = plan.width / 2
  const [ux, uz] = [Math.cos(plan.rotation), -Math.sin(plan.rotation)]
  return {
    shape,
    ...FOOTING_SIZES.strip,
    start: [plan.center[0] - ux * half, plan.center[1] - uz * half],
    end: [plan.center[0] + ux * half, plan.center[1] + uz * half],
    center: undefined,
    length: undefined,
    rotation: undefined,
  }
}

/**
 * The depth field shows how far under grade the bottom goes as poured: a depth is the least, and a
 * thickened slab (or a grade beam) may reach deeper than the one stored or asked.
 */
export function footingDepthShown(
  footing: Pick<FootingNode, 'depth'>,
  design: Pick<FootingDesign, 'gradeY' | 'bottomY'> | null,
): number {
  return design ? design.gradeY - design.bottomY : (footing.depth ?? 0)
}

/**
 * How far under grade the footing goes with no depth of its own: a thickened slab or a grade beam
 * reaches past the grade by its own size, so a depth only counts beyond this.
 */
export function footingDepthReach(
  nodes: Parameters<typeof footingDesign>[0],
  footing: FootingNode,
) {
  const shallowest = footingDesign(nodes, { ...footing, depth: 0 })
  return shallowest ? Math.max(0, shallowest.gradeY - shallowest.bottomY) : 0
}

/**
 * The depth to store for one typed, never under the reach. Under a slab no depth means the reach,
 * so one that goes no further is none; elsewhere no depth is the building's, which may be deeper.
 */
export function footingDepthPatch(
  meters: number,
  reach: number,
  underSlab: boolean,
): Pick<FootingNode, 'depth'> {
  if (underSlab) return { depth: meters > reach + 0.001 ? meters : undefined }
  return { depth: Math.max(meters, reach) }
}

export default function FootingPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const footing = selectedId ? nodes[selectedId as AnyNodeId] : undefined
  if (footing?.type !== 'footing') return null
  const design = footingDesign(nodes, footing)
  const reach = footingDepthReach(nodes, footing)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const update = (patch: Partial<FootingNode>) => useScene.getState().updateNode(footing.id, patch)
  const against = (y: number) =>
    y > design!.gradeY
      ? `${length(y - design!.gradeY)} over grade`
      : `${length(design!.gradeY - y)} under grade`
  // Under a slab a footing is an interior one: no depth is asked of it, it goes down to the grade.
  const underSlab = design?.foundation.type === 'slab' && design.foundation.support === 'footing'
  const small =
    footing.width < FOOTING_MINIMUM.width - 1e-6 ||
    footing.thickness < FOOTING_MINIMUM.thickness - 1e-6 ||
    (footing.shape === 'pad' && (footing.length ?? footing.width) < FOOTING_MINIMUM.width - 1e-6)

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={footing.name ?? i18n._({ id: 'node.footing.panel.footing', message: 'Footing' })}
      width={300}
    >
      <PanelSection title={i18n._({ id: 'node.footing.panel.footing', message: 'Footing' })}>
        <SegmentedControl
          onChange={(shape: FootingShape) => update(reshaped(footing, shape))}
          options={[
            { label: i18n._({ id: 'node.footing.panel.strip', message: 'Strip' }), value: 'strip' },
            { label: i18n._({ id: 'node.footing.panel.pad', message: 'Pad' }), value: 'pad' },
          ]}
          value={footing.shape}
        />
        <SizeField
          label={i18n._({ id: 'node.footing.panel.width', message: 'Width' })}
          onCommit={(width) => update({ width })}
          value={footing.width}
        />
        {footing.shape === 'pad' && (
          <SizeField
            label={i18n._({ id: 'node.footing.panel.length', message: 'Length' })}
            onCommit={(length) => update({ length })}
            value={footing.length ?? footing.width}
          />
        )}
        <SizeField
          label={i18n._({ id: 'node.footing.panel.thickness', message: 'Thickness' })}
          onCommit={(thickness) => update({ thickness })}
          value={footing.thickness}
        />
        <SizeField
          label={
            footing.depth !== undefined || underSlab
              ? i18n._({ id: 'node.footing.panel.depthUnderGrade', message: 'Depth under grade' })
              : i18n._({
                  id: 'node.footing.panel.depthUnderGradeBuildingS',
                  message: "Depth under grade (building's)",
                })
          }
          min={Math.max(0.01, reach)}
          onCommit={(depth) => update(footingDepthPatch(depth, reach, underSlab))}
          value={footingDepthShown(footing, design)}
        />
        {reach > 0.01 && (
          <p className="px-0.5 text-muted-foreground text-xs" data-footing-reach>
            {i18n._({ id: 'node.footing.panel.atLeast', message: 'At least' })} {length(reach)}:{' '}
            {design?.foundation.support === 'piles'
              ? i18n._({
                  id: 'node.footing.panel.theGradeBeamReachesThisFar',
                  message: 'the grade beam reaches this far.',
                })
              : design?.foundation.type === 'raised'
                ? i18n._({
                    id: 'node.footing.panel.theFootingSThicknessUnderThe',
                    message: 'the footing’s thickness under the floor reaches this far.',
                  })
                : i18n._({
                    id: 'node.footing.panel.theSlabAndTheFootingS',
                    message: 'the slab and the footing’s thickness reach this far.',
                  })}
          </p>
        )}
        {footing.depth !== undefined && (
          <button
            className="self-start rounded-full border border-border/50 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => update({ depth: undefined })}
            type="button"
          >
            {underSlab
              ? i18n._({ id: 'node.footing.panel.clearTheDepth', message: 'Clear the depth' })
              : i18n._({
                  id: 'node.footing.panel.useTheBuildingSDepth',
                  message: "Use the building's depth",
                })}
          </button>
        )}
        {design && (
          <p className="px-0.5 text-muted-foreground text-xs" data-footing-readout>
            {i18n._({ id: 'node.footing.panel.top', message: 'Top' })} {against(design.topY)}
            {i18n._({ id: 'node.footing.panel.bottom', message: ', bottom' })}{' '}
            {against(design.bottomY)}.{' '}
            {design.foundation.support === 'piles'
              ? footing.shape === 'strip'
                ? i18n._({
                    id: 'node.footing.panel.aGradeBeamOnPilesAs',
                    message: 'A grade beam on piles, as the building is.',
                  })
                : i18n._({
                    id: 'node.footing.panel.aPileCapOnOnePile',
                    message: 'A pile cap on one pile, as the building is.',
                  })
              : design.foundation.type === 'slab'
                ? i18n._({
                    id: 'node.footing.panel.aThickenedSlabUnderTheFloor',
                    message: 'A thickened slab under the floor slab.',
                  })
                : footing.shape === 'strip'
                  ? i18n._({
                      id: 'node.footing.panel.aStemWallCarriesTheFloor',
                      message: 'A stem wall carries the floor.',
                    })
                  : i18n._({
                      id: 'node.footing.panel.aPierCarriesTheFloor',
                      message: 'A pier carries the floor.',
                    })}
          </p>
        )}
        {small && (
          <p
            className="rounded-lg bg-accent/30 px-2.5 py-2 text-muted-foreground text-xs"
            role="status"
          >
            {i18n._({
              id: 'node.footing.panel.ircR4031AsksAFooting',
              message: 'IRC R403.1 asks a footing at least 12 in wide and 6 in thick.',
            })}
          </p>
        )}
      </PanelSection>
      <PanelSection title={i18n._({ id: 'node.footing.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.footing.panel.delete', message: 'Delete' })}
            onClick={() => {
              useScene.getState().deleteNode(footing.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
