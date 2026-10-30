'use client'

import {
  type AnyNodeId,
  type BeamMaterial,
  type BeamNode,
  type BeamPlacement,
  type BeamTopReference,
  beamCeilingPlane,
  beamPlan,
  beamSizeLabel,
  beamSizePresetPatch,
  beamTopElevation,
  beamTopReferencePatch,
  DEFAULT_FRAMING_POST_SIZE,
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
  SelectControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Columns2, Move, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { electedPostFoot, framingPostsUnderBeam } from '../column/post-placement'
import {
  BEAM_MATERIAL_OPTIONS,
  beamSizeOptions,
  beamSizeValue,
  beamTopOptions,
  beamTopValue,
} from './panel-model'

const IN = 0.0254
const CUSTOM = 'custom'

/** A section size in metres, shown in inches on an imperial plan (feet would show 7-1/2 in as 0.63). */
function InchField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (meters: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const imperial = useViewer((state) => state.unit) === 'imperial'
  const toShown = (meters: number) => (imperial ? meters / IN : meters)
  return (
    <MetricControl
      className="h-9 text-xs"
      label={label}
      min={toShown(0.01)}
      onChange={(next) => setDraft(next)}
      onCommit={(next) => {
        setDraft(null)
        onCommit(imperial ? next * IN : next)
      }}
      precision={imperial ? 3 : 4}
      restoreOnCommit={false}
      step={imperial ? 0.25 : 0.005}
      unit={imperial ? 'in' : 'm'}
      value={draft ?? toShown(value)}
    />
  )
}

/** The fields a ply count writes: as many plies of the same board, the width growing with them. */
export function beamPliesPatch(beam: Pick<BeamNode, 'width' | 'plies'>, plies: number) {
  return { plies, width: (beam.width / beam.plies) * plies }
}

/**
 * A beam's panel: its size (a stock size, or a width, depth and plies of its own), what it is made
 * of, how the joists meet it and where its top is, with its length and underside; Move, Delete,
 * and posts under it at each end and every 8 ft.
 */
export default function BeamPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const beam = selectedId ? nodes[selectedId as AnyNodeId] : undefined
  if (beam?.type !== 'beam') return null

  const update = (patch: Partial<BeamNode>) => useScene.getState().updateNode(beam.id, patch)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const size = beamSizeValue(beam)
  const top = beamTopValue(nodes, beam)
  const topY = beamTopElevation(nodes, beam)
  const plane = beamCeilingPlane(nodes, beam)

  return (
    <PanelWrapper
      icon="/icons/beam.svg"
      onClose={() => setSelection({ selectedIds: [] })}
      title={beam.name ?? i18n._({ id: 'node.beam.panel.beam', message: 'Beam' })}
      width={300}
    >
      <PanelSection
        title={i18n._({
          id: 'node.beam.panel.beamSize',
          message: 'Beam {size}',
          values: { size: beamSizeLabel(beam) },
        })}
      >
        <SelectControl
          label={i18n._({ id: 'node.beam.panel.size', message: 'Size' })}
          onChange={(id: string) => {
            if (id !== CUSTOM) update(beamSizePresetPatch(beam, id))
          }}
          options={beamSizeOptions(size)}
          value={size}
        />
        <SelectControl
          label={i18n._({ id: 'node.beam.panel.material', message: 'Material' })}
          onChange={(material: string) => update({ material: material as BeamMaterial })}
          options={BEAM_MATERIAL_OPTIONS}
          value={beam.material}
        />
        <InchField
          label={i18n._({ id: 'node.beam.panel.width', message: 'Width' })}
          onCommit={(width) => update({ width, size: undefined })}
          value={beam.width}
        />
        <InchField
          label={i18n._({ id: 'node.beam.panel.depth', message: 'Depth' })}
          onCommit={(depth) => update({ depth, size: undefined })}
          value={beam.depth}
        />
        <SegmentedControl
          onChange={(plies: string) => update(beamPliesPatch(beam, Number(plies)))}
          options={['1', '2', '3', '4'].map((plies) => ({
            label:
              plies === '1'
                ? i18n._({ id: 'node.beam.panel.n1Ply', message: '1 ply' })
                : i18n._({
                    id: 'node.beam.panel.pliesPlies',
                    message: '{plies} plies',
                    values: { plies },
                  }),
            value: plies,
          }))}
          value={String(beam.plies)}
        />
      </PanelSection>
      <PanelSection title={i18n._({ id: 'node.beam.panel.placement', message: 'Placement' })}>
        <SegmentedControl
          onChange={(placement: BeamPlacement) => update({ placement })}
          options={[
            {
              label: i18n._({ id: 'node.beam.panel.dropped', message: 'Dropped' }),
              value: 'dropped',
            },
            { label: i18n._({ id: 'node.beam.panel.flush', message: 'Flush' }), value: 'flush' },
          ]}
          value={beam.placement}
        />
        <SelectControl
          label={i18n._({ id: 'node.beam.panel.top', message: 'Top' })}
          onChange={(reference: string) => {
            if (reference !== CUSTOM)
              update(beamTopReferencePatch(nodes, beam, reference as BeamTopReference))
          }}
          options={beamTopOptions(top)}
          value={top}
        />
        <MetricControl
          label={i18n._({ id: 'node.beam.panel.topElevation', message: 'Top elevation' })}
          onChange={(value) => update({ topElevation: value })}
          precision={3}
          step={0.01}
          unit="m"
          value={topY}
        />
        <p className="px-0.5 text-muted-foreground text-xs" data-beam-readout>
          {i18n._({
            id: 'node.beam.panel.lengthLongItsUnderside',
            message:
              '{length} long; its underside {underside} over the floor, the ceiling plane {plane}.',
            values: {
              length: length(beamPlan(beam).length),
              underside: length(topY - beam.depth),
              plane: length(plane),
            },
          })}
        </p>
        {beam.topElevation !== undefined && (
          <button
            className="self-start rounded-full border border-border/50 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => update({ topElevation: undefined })}
            type="button"
          >
            {i18n._({
              id: 'node.beam.panel.followTheCeilingPlane',
              message: 'Follow the ceiling plane',
            })}
          </button>
        )}
      </PanelSection>
      <PanelSection title={i18n._({ id: 'node.beam.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Columns2 className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.beam.panel.addPosts', message: 'Add posts' })}
            onClick={() => {
              const posts = beam.parentId
                ? framingPostsUnderBeam({
                    nodes,
                    beam,
                    choices: { size: DEFAULT_FRAMING_POST_SIZE, base: 'none' },
                    foot: electedPostFoot(nodes, beam.parentId),
                  })
                : []
              if (posts.length === 0) return
              const standing = Object.values(nodes).filter(
                (node) => node.type === 'column' && node.role === 'post',
              ).length
              useScene.getState().createNodes(
                posts.map((post, index) => ({
                  node: { ...post, name: `Post ${standing + index + 1}` },
                  parentId: beam.parentId as AnyNodeId,
                })),
              )
              triggerSFX('sfx:structure-build')
            }}
          />
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.beam.panel.move', message: 'Move' })}
            onClick={() => {
              triggerSFX('sfx:item-pick')
              useEditor.getState().setMovingNode(beam)
            }}
          />
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.beam.panel.delete', message: 'Delete' })}
            onClick={() => {
              useScene.getState().deleteNode(beam.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
