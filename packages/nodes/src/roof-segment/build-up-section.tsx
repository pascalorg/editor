'use client'

import {
  LUMBER_DEPTH,
  ROOFING_THICKNESS,
  type RoofBuildUp,
  type RoofingKind,
  type RoofSegmentNode,
  roofBuildUpDepths,
  roofBuildUpPatch,
  UNDERLAYMENT_THICKNESS,
  type UnderlaymentKind,
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

const ROOFING_OPTIONS: { label: string; value: RoofingKind }[] = [
  { label: 'Asphalt 3-tab', value: 'asphalt-3-tab' },
  { label: 'Architectural shingle', value: 'architectural-shingle' },
  { label: 'Standing-seam metal', value: 'standing-seam-metal' },
  { label: 'Concrete tile', value: 'concrete-tile' },
  { label: 'Clay tile', value: 'clay-tile' },
  { label: 'Wood shake', value: 'wood-shake' },
  { label: 'Slate', value: 'slate' },
]

const UNDERLAYMENT_OPTIONS: { label: string; value: UnderlaymentKind | typeof NONE }[] = [
  { label: 'None', value: NONE },
  { label: '#15 felt', value: 'felt-15' },
  { label: '#30 felt', value: 'felt-30' },
  { label: 'Synthetic', value: 'synthetic' },
  { label: 'Ice and water shield', value: 'ice-and-water' },
]

/** What each kind is called where the layer has no name of its own. */
const KIND_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    [...ROOFING_OPTIONS, ...UNDERLAYMENT_OPTIONS].map((o) => [o.value, o.label]),
  ),
  osb: 'OSB',
  plywood: 'Plywood',
  batt: 'Batt',
  blown: 'Blown',
  rigid: 'Rigid board',
  drywall: 'Drywall',
  plaster: 'Plaster',
  'wood-plank': 'Wood plank',
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
        placeholder={KIND_LABELS[layer.kind] ?? layer.kind}
        spellCheck={false}
        value={draft ?? layer.name ?? ''}
      />
    </label>
  )
}

/** A layer as a line of the readout: its name, else its kind's. */
const layerLabel = (layer: { kind: string; name?: string }) =>
  layer.name ?? KIND_LABELS[layer.kind] ?? layer.kind

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
  const drawn = roofBuildUpOfDeck(node.deckThickness)
  const { structure } = drawn
  return (
    <>
      <BuildUpReadout label="Roofing" value={layerLabel(drawn.roofing)} />
      {drawn.underlayment && (
        <BuildUpReadout label="Underlayment" value={layerLabel(drawn.underlayment)} />
      )}
      <BuildUpReadout
        label="Sheathing"
        value={`${layerLabel(drawn.sheathing)} ${formatLayerThickness(drawn.sheathing.thickness, unit)}`}
      />
      <BuildUpReadout
        label={structure.system === 'trusses' ? 'Trusses' : 'Rafters'}
        value={`${structure.size} @ ${formatSpacing(structure.spacing, unit)}`}
      />
      <BuildUpReadout label="Deck" value={formatLayerDepth(node.deckThickness, unit)} />
      <BuildUpReadout label="Covering" value={formatLayerDepth(node.shingleThickness, unit)} />
      <ActionButton
        className="rounded-full"
        label="Edit layers"
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
    <PanelSection title="Layers">
      <SelectControl
        label="Preset"
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
            label="Roofing"
            onChange={(kind) => edit({ roofing: { kind, thickness: ROOFING_THICKNESS[kind] } })}
            options={ROOFING_OPTIONS}
            value={buildUp.roofing.kind}
          />
          <LayerNameField
            label="Roofing name"
            layer={buildUp.roofing}
            onCommit={(name) => rename('roofing', name)}
          />
          <SelectControl
            label="Underlayment"
            onChange={(kind) =>
              edit({
                underlayment:
                  kind === NONE ? undefined : { kind, thickness: UNDERLAYMENT_THICKNESS[kind] },
              })
            }
            options={UNDERLAYMENT_OPTIONS}
            value={buildUp.underlayment?.kind ?? NONE}
          />
          {buildUp.underlayment && (
            <LayerNameField
              label="Underlayment name"
              layer={buildUp.underlayment}
              onCommit={(name) => rename('underlayment', name)}
            />
          )}
          <PanelFields
            label="Sheathing"
            layer={buildUp.sheathing}
            onChange={(sheathing) =>
              sheathing && edit({ sheathing: keptName(buildUp.sheathing, sheathing) })
            }
            unit={unit}
          />
          <LayerNameField
            label="Sheathing name"
            layer={buildUp.sheathing}
            onCommit={(name) => rename('sheathing', name)}
          />
          <SegmentedControl
            onChange={(system) => edit({ structure: { ...buildUp.structure, system } })}
            options={[
              { label: 'Rafters', value: 'rafters' },
              { label: 'Trusses', value: 'trusses' },
            ]}
            value={buildUp.structure.system}
          />
          <FramingSizeFields
            framing={buildUp.structure}
            onChange={(change) => edit({ structure: { ...buildUp.structure, ...change } })}
            sizeLabel={buildUp.structure.system === 'trusses' ? 'Top chord' : 'Rafters'}
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
              label="Insulation name"
              layer={buildUp.insulation}
              onCommit={(name) => rename('insulation', name)}
            />
          )}
          <FinishFields
            label="Interior finish"
            layer={buildUp.finish}
            onChange={(finish) => edit({ finish: keptName(buildUp.finish, finish) })}
            unit={unit}
          />
          {buildUp.finish && (
            <LayerNameField
              label="Finish name"
              layer={buildUp.finish}
              onCommit={(name) => rename('finish', name)}
            />
          )}
          <BuildUpReadout label="Deck" value={formatLayerDepth(depths.deck, unit)} />
          <BuildUpReadout label="Covering" value={formatLayerDepth(depths.covering, unit)} />
          {onApplyToRoof && (
            <ActionButton
              className="rounded-full"
              label="Apply to all planes of this roof"
              onClick={onApplyToRoof}
            />
          )}
        </>
      )}
    </PanelSection>
  )
}
