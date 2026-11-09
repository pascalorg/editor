import {
  type AnyNodeId,
  CEILING_BUILD_UP_PRESETS,
  type CeilingBuildUp,
  type CeilingNode,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import type { NodePanelModel } from '@pascal-app/editor'

const NONE = 'none'
const CUSTOM = 'custom'

/** The Preset choices for the `current` value: none, the presets, and Custom while it is. */
export function ceilingBuildUpPresetOptions(current: string | null) {
  return [
    { label: 'None (a bare surface)', value: NONE },
    ...(current === CUSTOM ? [{ label: 'Custom', value: CUSTOM }] : []),
    ...CEILING_BUILD_UP_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  ]
}

export function ceilingBuildUpPresetValue(buildUp: CeilingBuildUp | undefined): string {
  return buildUp ? (buildUp.presetId ?? CUSTOM) : NONE
}

/** The patch a Preset choice writes; `null` for Custom, which is no choice. */
export function ceilingBuildUpPresetPatch(id: string): Partial<CeilingNode> | null {
  if (id === NONE) return { buildUp: undefined }
  const preset = CEILING_BUILD_UP_PRESETS.find((entry) => entry.id === id)
  return preset ? { buildUp: preset.buildUp } : null
}

/** Multi-selected ceilings take one layers preset together, in one undo step. */
export const ceilingPanelModel: NodePanelModel<CeilingNode> = {
  rows: () => [],
  multiControls: ({ selection }) => {
    if (selection.length === 0) return []
    const values = selection.map((ceiling) => ceilingBuildUpPresetValue(ceiling.buildUp))
    const value = values.every((entry) => entry === values[0]) ? values[0]! : null
    return [
      {
        id: 'ceiling-layers-preset',
        kind: 'select',
        section: 'Layers',
        label: 'Preset',
        options: ceilingBuildUpPresetOptions(value),
        value,
        onChange: (id) => {
          const patch = ceilingBuildUpPresetPatch(id)
          if (!patch) return
          runAsSingleSceneHistoryStep(useScene, () =>
            useScene
              .getState()
              .updateNodes(
                selection.map((ceiling) => ({ id: ceiling.id as AnyNodeId, data: patch })),
              ),
          )
        },
      },
    ]
  },
}
