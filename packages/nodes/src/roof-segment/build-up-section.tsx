'use client'

import {
  LUMBER_DEPTH,
  type MessageDescriptor,
  type PascalI18n,
  ROOFING_THICKNESS,
  type RoofBuildUp,
  type RoofingKind,
  type RoofSegmentNode,
  roofBuildUpDepths,
  roofBuildUpPatch,
  UNDERLAYMENT_THICKNESS,
  type UnderlaymentKind,
  usePascalI18n,
} from '@pascal-app/core'
import { ActionButton, PanelSection, SegmentedControl, SelectControl } from '@pascal-app/editor'
import { useState } from 'react'
import {
  BuildUpReadout,
  editedBuildUp,
  FinishFields,
  FramingSizeFields,
  formatSpacing,
  InsulationFields,
  LAYER_KIND_LABELS,
  NONE,
  PanelFields,
} from '../shared/build-up-controls'
import { formatLayerDepth, formatLayerThickness } from '../shared/layer-thickness'
import {
  keptName,
  namedLayer,
  roofBuildUpOfDeck,
  roofBuildUpPresetOptions,
  roofBuildUpPresetPatch,
  roofBuildUpPresetValue,
} from './panel-model'

const ROOFING_OPTIONS: { label: MessageDescriptor; value: RoofingKind }[] = [
  {
    label: /* i18n */ {
      id: 'node.roofSegment.buildUpSection.asphalt3Tab',
      message: 'Asphalt 3-tab',
    },
    value: 'asphalt-3-tab',
  },
  {
    label: /* i18n */ {
      id: 'node.roofSegment.buildUpSection.architecturalShingle',
      message: 'Architectural shingle',
    },
    value: 'architectural-shingle',
  },
  {
    label: /* i18n */ {
      id: 'node.roofSegment.buildUpSection.standingSeamMetal',
      message: 'Standing-seam metal',
    },
    value: 'standing-seam-metal',
  },
  {
    label: /* i18n */ {
      id: 'node.roofSegment.buildUpSection.concreteTile',
      message: 'Concrete tile',
    },
    value: 'concrete-tile',
  },
  {
    label: /* i18n */ { id: 'node.roofSegment.buildUpSection.clayTile', message: 'Clay tile' },
    value: 'clay-tile',
  },
  {
    label: /* i18n */ { id: 'node.roofSegment.buildUpSection.woodShake', message: 'Wood shake' },
    value: 'wood-shake',
  },
  {
    label: /* i18n */ { id: 'node.roofSegment.buildUpSection.slate', message: 'Slate' },
    value: 'slate',
  },
]

const UNDERLAYMENT_OPTIONS: { label: MessageDescriptor; value: UnderlaymentKind | typeof NONE }[] =
  [
    {
      label: /* i18n */ { id: 'node.roofSegment.buildUpSection.none', message: 'None' },
      value: NONE,
    },
    {
      label: /* i18n */ { id: 'node.roofSegment.buildUpSection.n15Felt', message: '#15 felt' },
      value: 'felt-15',
    },
    {
      label: /* i18n */ { id: 'node.roofSegment.buildUpSection.n30Felt', message: '#30 felt' },
      value: 'felt-30',
    },
    {
      label: /* i18n */ { id: 'node.roofSegment.buildUpSection.synthetic', message: 'Synthetic' },
      value: 'synthetic',
    },
    {
      label: /* i18n */ {
        id: 'node.roofSegment.buildUpSection.iceAndWaterShield',
        message: 'Ice and water shield',
      },
      value: 'ice-and-water',
    },
  ]

/** What each kind is called where the layer has no name of its own. */
const KIND_LABELS: Record<string, MessageDescriptor> = {
  ...Object.fromEntries(
    [...ROOFING_OPTIONS, ...UNDERLAYMENT_OPTIONS].map((o) => [o.value, o.label]),
  ),
  ...LAYER_KIND_LABELS,
}

const kindLabel = (kind: string, i18n: PascalI18n) => {
  const label = KIND_LABELS[kind]
  return label ? i18n._(label) : kind
}

type NamedLayerKey = 'roofing' | 'underlayment' | 'sheathing' | 'insulation' | 'finish'

/**
 * A layer's own name for its material ("GAF Timberline HDZ"), under its kind: the kind's name
 * shows until one is typed, and emptied the name goes.
 */
function LayerNameField({
  label,
  layer,
  onCommit,
}: {
  label: string
  layer: { kind: string; name?: string }
  onCommit: (name: string) => void
}) {
  const i18n = usePascalI18n()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-black/4 px-3 text-sm dark:bg-[#2C2C2E]">
      <span className="shrink-0 select-none text-muted-foreground">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-foreground outline-none placeholder:text-muted-foreground/60"
        maxLength={60}
        onBlur={() => {
          if (draft !== null && draft.trim() !== (layer.name ?? '')) onCommit(draft)
          setDraft(null)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        placeholder={kindLabel(layer.kind, i18n)}
        spellCheck={false}
        value={draft ?? layer.name ?? ''}
      />
    </label>
  )
}

/** A layer as a line of the readout: its name, else its kind's. */
const layerLabel = (layer: { kind: string; name?: string }, i18n: PascalI18n) =>
  layer.name ?? kindLabel(layer.kind, i18n)

/**
 * A plane without layers draws its deck and shingle thicknesses as they are. The readout says
 * which layers that deck is (`roofBuildUpOfDeck`: the default preset over the framing it holds),
 * and "Edit layers" gives the plane those layers to edit.
 */
function DrawnLayers({
  node,
  onUpdate,
  unit,
}: {
  node: RoofSegmentNode
  onUpdate: (patch: Partial<RoofSegmentNode>) => void
  unit: 'metric' | 'imperial'
}) {
  const i18n = usePascalI18n()
  const drawn = roofBuildUpOfDeck(node.deckThickness)
  const { structure } = drawn
  return (
    <>
      <BuildUpReadout
        label={i18n._({ id: 'node.roofSegment.buildUpSection.roofing', message: 'Roofing' })}
        value={layerLabel(drawn.roofing, i18n)}
      />
      {drawn.underlayment && (
        <BuildUpReadout
          label={i18n._({
            id: 'node.roofSegment.buildUpSection.underlayment',
            message: 'Underlayment',
          })}
          value={layerLabel(drawn.underlayment, i18n)}
        />
      )}
      <BuildUpReadout
        label={i18n._({ id: 'node.roofSegment.buildUpSection.sheathing', message: 'Sheathing' })}
        value={`${layerLabel(drawn.sheathing, i18n)} ${formatLayerThickness(drawn.sheathing.thickness, unit)}`}
      />
      <BuildUpReadout
        label={
          structure.system === 'trusses'
            ? i18n._({ id: 'node.roofSegment.buildUpSection.trusses', message: 'Trusses' })
            : i18n._({ id: 'node.roofSegment.buildUpSection.rafters', message: 'Rafters' })
        }
        value={`${structure.size} @ ${formatSpacing(structure.spacing, unit, i18n)}`}
      />
      <BuildUpReadout
        label={i18n._({ id: 'node.roofSegment.buildUpSection.deck', message: 'Deck' })}
        value={formatLayerDepth(node.deckThickness, unit)}
      />
      <BuildUpReadout
        label={i18n._({ id: 'node.roofSegment.buildUpSection.covering', message: 'Covering' })}
        value={formatLayerDepth(node.shingleThickness, unit)}
      />
      <ActionButton
        className="rounded-full"
        label={i18n._({ id: 'node.roofSegment.buildUpSection.editLayers', message: 'Edit layers' })}
        onClick={() => onUpdate(roofBuildUpPatch(drawn))}
      />
    </>
  )
}

export function RoofBuildUpSection({
  node,
  onApplyToRoof,
  onUpdate,
  unit,
}: {
  node: RoofSegmentNode
  /** Present when the plane's roof has other planes to take the same layers. */
  onApplyToRoof?: () => void
  onUpdate: (patch: Partial<RoofSegmentNode>) => void
  unit: 'metric' | 'imperial'
}) {
  const i18n = usePascalI18n()
  const buildUp = node.buildUp
  const edit = (change: Partial<RoofBuildUp>) => {
    if (buildUp) onUpdate(roofBuildUpPatch(editedBuildUp(buildUp, change)))
  }
  // a name is no change of material: the preset the layers came from stays theirs
  const rename = (key: NamedLayerKey, name: string) => {
    const layer = buildUp?.[key]
    if (buildUp && layer) onUpdate(roofBuildUpPatch({ ...buildUp, [key]: namedLayer(layer, name) }))
  }
  const depths = buildUp ? roofBuildUpDepths(buildUp) : null

  return (
    <PanelSection
      title={i18n._({ id: 'node.roofSegment.buildUpSection.layers', message: 'Layers' })}
    >
      <SelectControl
        label={i18n._({ id: 'node.roofSegment.buildUpSection.preset', message: 'Preset' })}
        onChange={(id) => {
          const patch = roofBuildUpPresetPatch(id)
          if (patch) onUpdate(patch)
        }}
        options={roofBuildUpPresetOptions(roofBuildUpPresetValue(buildUp))}
        value={roofBuildUpPresetValue(buildUp)}
      />
      {!buildUp && <DrawnLayers node={node} onUpdate={onUpdate} unit={unit} />}
      {buildUp && depths && (
        <>
          <SelectControl
            label={i18n._({ id: 'node.roofSegment.buildUpSection.roofing', message: 'Roofing' })}
            onChange={(kind) => edit({ roofing: { kind, thickness: ROOFING_THICKNESS[kind] } })}
            options={ROOFING_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
            value={buildUp.roofing.kind}
          />
          <LayerNameField
            label={i18n._({
              id: 'node.roofSegment.buildUpSection.roofingName',
              message: 'Roofing name',
            })}
            layer={buildUp.roofing}
            onCommit={(name) => rename('roofing', name)}
          />
          <SelectControl
            label={i18n._({
              id: 'node.roofSegment.buildUpSection.underlayment',
              message: 'Underlayment',
            })}
            onChange={(kind) =>
              edit({
                underlayment:
                  kind === NONE ? undefined : { kind, thickness: UNDERLAYMENT_THICKNESS[kind] },
              })
            }
            options={UNDERLAYMENT_OPTIONS.map((option) => ({
              ...option,
              label: i18n._(option.label),
            }))}
            value={buildUp.underlayment?.kind ?? NONE}
          />
          {buildUp.underlayment && (
            <LayerNameField
              label={i18n._({
                id: 'node.roofSegment.buildUpSection.underlaymentName',
                message: 'Underlayment name',
              })}
              layer={buildUp.underlayment}
              onCommit={(name) => rename('underlayment', name)}
            />
          )}
          <PanelFields
            label={i18n._({
              id: 'node.roofSegment.buildUpSection.sheathing',
              message: 'Sheathing',
            })}
            layer={buildUp.sheathing}
            onChange={(sheathing) =>
              sheathing && edit({ sheathing: keptName(buildUp.sheathing, sheathing) })
            }
            unit={unit}
          />
          <LayerNameField
            label={i18n._({
              id: 'node.roofSegment.buildUpSection.sheathingName',
              message: 'Sheathing name',
            })}
            layer={buildUp.sheathing}
            onCommit={(name) => rename('sheathing', name)}
          />
          <SegmentedControl
            onChange={(system) => edit({ structure: { ...buildUp.structure, system } })}
            options={[
              {
                label: i18n._({
                  id: 'node.roofSegment.buildUpSection.rafters',
                  message: 'Rafters',
                }),
                value: 'rafters',
              },
              {
                label: i18n._({
                  id: 'node.roofSegment.buildUpSection.trusses',
                  message: 'Trusses',
                }),
                value: 'trusses',
              },
            ]}
            value={buildUp.structure.system}
          />
          <FramingSizeFields
            framing={buildUp.structure}
            onChange={(change) => edit({ structure: { ...buildUp.structure, ...change } })}
            sizeLabel={
              buildUp.structure.system === 'trusses'
                ? i18n._({ id: 'node.roofSegment.buildUpSection.topChord', message: 'Top chord' })
                : i18n._({ id: 'node.roofSegment.buildUpSection.rafters', message: 'Rafters' })
            }
            unit={unit}
          />
          <InsulationFields
            framingDepth={LUMBER_DEPTH[buildUp.structure.size]}
            layer={buildUp.insulation}
            onChange={(insulation) =>
              edit({ insulation: keptName(buildUp.insulation, insulation) })
            }
            unit={unit}
          />
          {buildUp.insulation && (
            <LayerNameField
              label={i18n._({
                id: 'node.roofSegment.buildUpSection.insulationName',
                message: 'Insulation name',
              })}
              layer={buildUp.insulation}
              onCommit={(name) => rename('insulation', name)}
            />
          )}
          <FinishFields
            label={i18n._({
              id: 'node.roofSegment.buildUpSection.interiorFinish',
              message: 'Interior finish',
            })}
            layer={buildUp.finish}
            onChange={(finish) => edit({ finish: keptName(buildUp.finish, finish) })}
            unit={unit}
          />
          {buildUp.finish && (
            <LayerNameField
              label={i18n._({
                id: 'node.roofSegment.buildUpSection.finishName',
                message: 'Finish name',
              })}
              layer={buildUp.finish}
              onCommit={(name) => rename('finish', name)}
            />
          )}
          <BuildUpReadout
            label={i18n._({ id: 'node.roofSegment.buildUpSection.deck', message: 'Deck' })}
            value={formatLayerDepth(depths.deck, unit)}
          />
          <BuildUpReadout
            label={i18n._({ id: 'node.roofSegment.buildUpSection.covering', message: 'Covering' })}
            value={formatLayerDepth(depths.covering, unit)}
          />
          {onApplyToRoof && (
            <ActionButton
              className="rounded-full"
              label={i18n._({
                id: 'node.roofSegment.buildUpSection.applyToAllPlanesOfThis',
                message: 'Apply to all planes of this roof',
              })}
              onClick={onApplyToRoof}
            />
          )}
        </>
      )}
    </PanelSection>
  )
}
