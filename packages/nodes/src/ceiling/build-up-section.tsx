'use client'

import {
  type CeilingBuildUp,
  type CeilingFraming,
  type CeilingNode,
  ceilingBuildUpThickness,
  LUMBER_DEPTH,
  type MessageDescriptor,
  usePascalI18n,
} from '@pascal-app/core'
import { PanelSection, SelectControl } from '@pascal-app/editor'
import {
  BuildUpReadout,
  editedBuildUp,
  FinishFields,
  FramingSizeFields,
  InsulationFields,
  NONE,
  PanelFields,
} from '../shared/build-up-controls'
import { formatLayerDepth } from '../shared/layer-thickness'
import {
  ceilingBuildUpPresetOptions,
  ceilingBuildUpPresetPatch,
  ceilingBuildUpPresetValue,
} from './panel-model'

const INCH = 0.0254

const FRAMING_OPTIONS: {
  label: MessageDescriptor
  value: CeilingFraming['system'] | typeof NONE
}[] = [
  { label: /* i18n */ { id: 'node.ceiling.buildUpSection.none', message: 'None' }, value: NONE },
  {
    label: /* i18n */ {
      id: 'node.ceiling.buildUpSection.ceilingJoists',
      message: 'Ceiling joists',
    },
    value: 'joists',
  },
  {
    label: /* i18n */ {
      id: 'node.ceiling.buildUpSection.trussBottomChords',
      message: 'Truss bottom chords',
    },
    value: 'truss-chords',
  },
]

const NEW_FRAMING: Record<CeilingFraming['system'], CeilingFraming> = {
  joists: { system: 'joists', size: '2x6', spacing: 16 * INCH },
  'truss-chords': { system: 'truss-chords', size: '2x4', spacing: 24 * INCH },
}

export function CeilingBuildUpSection({
  node,
  onUpdate,
  unit,
}: {
  node: CeilingNode
  onUpdate: (patch: Partial<CeilingNode>) => void
  unit: 'metric' | 'imperial'
}) {
  const i18n = usePascalI18n()
  const buildUp = node.buildUp
  const edit = (change: Partial<CeilingBuildUp>) => {
    if (buildUp) onUpdate({ buildUp: editedBuildUp(buildUp, change) })
  }
  const framing = buildUp?.framing

  return (
    <PanelSection title={i18n._({ id: 'node.ceiling.buildUpSection.layers', message: 'Layers' })}>
      <SelectControl
        label={i18n._({ id: 'node.ceiling.buildUpSection.preset', message: 'Preset' })}
        onChange={(id) => {
          const patch = ceilingBuildUpPresetPatch(id)
          if (patch) onUpdate(patch)
        }}
        options={ceilingBuildUpPresetOptions(ceilingBuildUpPresetValue(buildUp))}
        value={ceilingBuildUpPresetValue(buildUp)}
      />
      {buildUp && (
        <>
          <FinishFields
            label={i18n._({ id: 'node.ceiling.buildUpSection.finish', message: 'Finish' })}
            layer={buildUp.finish}
            onChange={(finish) => edit({ finish })}
            unit={unit}
          />
          <SelectControl
            label={i18n._({ id: 'node.ceiling.buildUpSection.framing', message: 'Framing' })}
            onChange={(system) =>
              edit({
                framing:
                  system === NONE
                    ? undefined
                    : framing
                      ? { ...framing, system }
                      : NEW_FRAMING[system],
              })
            }
            options={FRAMING_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
            value={framing?.system ?? NONE}
          />
          {framing && (
            <FramingSizeFields
              framing={framing}
              onChange={(change) => edit({ framing: { ...framing, ...change } })}
              sizeLabel={
                framing.system === 'joists'
                  ? i18n._({ id: 'node.ceiling.buildUpSection.joists', message: 'Joists' })
                  : i18n._({
                      id: 'node.ceiling.buildUpSection.bottomChord',
                      message: 'Bottom chord',
                    })
              }
              unit={unit}
            />
          )}
          <PanelFields
            added={0.75 * INCH}
            label={i18n._({ id: 'node.ceiling.buildUpSection.decking', message: 'Decking' })}
            layer={buildUp.decking}
            onChange={(decking) => edit({ decking })}
            optional
            unit={unit}
          />
          <InsulationFields
            framingDepth={LUMBER_DEPTH[framing?.size ?? '2x4']}
            layer={buildUp.insulation}
            onChange={(insulation) => edit({ insulation })}
            unit={unit}
          />
          <BuildUpReadout
            label={i18n._({ id: 'node.ceiling.buildUpSection.thickness', message: 'Thickness' })}
            value={formatLayerDepth(ceilingBuildUpThickness(buildUp), unit)}
          />
          <div className="px-1 text-[11px] text-muted-foreground">
            {i18n._({
              id: 'node.ceiling.buildUpSection.theHeightIsTheFinishedUnderside',
              message: 'The height is the finished underside; the layers rise from it.',
            })}
          </div>
        </>
      )}
    </PanelSection>
  )
}
