import {
  type AnyNodeId,
  isGlazedRoofSegment,
  ROOF_BUILD_UP_PRESETS,
  type RoofBuildUp,
  type RoofSegmentNode,
  roofBuildUpPatch,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import type { NodePanelModel } from '@pascal-app/editor'

const NONE = 'none'
const CUSTOM = 'custom'

/** The Preset choices for the `current` value: none, the presets, and Custom while it is. */
export function roofBuildUpPresetOptions(current: string | null) {
  return [
    { label: 'None (deck and shingle)', value: NONE },
    ...(current === CUSTOM ? [{ label: 'Custom', value: CUSTOM }] : []),
    ...ROOF_BUILD_UP_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  ]
}

export function roofBuildUpPresetValue(buildUp: RoofBuildUp | undefined): string {
  return buildUp ? (buildUp.presetId ?? CUSTOM) : NONE
}

/** The patch a Preset choice writes; `null` for Custom, which is no choice. */
export function roofBuildUpPresetPatch(id: string): Partial<RoofSegmentNode> | null {
  if (id === NONE) return { buildUp: undefined }
  const preset = ROOF_BUILD_UP_PRESETS.find((entry) => entry.id === id)
  return preset ? roofBuildUpPatch(preset.buildUp) : null
}

// The layers a plane without any is drawn as live in core, where Bones frames such a plane by them.
export { roofBuildUpOfDeck } from '@pascal-app/core'

/** A layer with `name`, trimmed; empty takes the name off, the kind's own name standing for it. */
export function namedLayer<T extends { name?: string }>(layer: T, name: string): T {
  const { name: _name, ...rest } = layer
  const trimmed = name.trim().slice(0, 60)
  return (trimmed ? { ...rest, name: trimmed } : rest) as T
}

/** `next` keeps `previous`'s name while it is the same kind of material (a new thickness, say). */
export function keptName<T extends { kind: string; name?: string }>(
  previous: T | undefined,
  next: T | undefined,
): T | undefined {
  if (!next || next.name !== undefined || previous?.name === undefined) return next
  return next.kind === previous.kind ? { ...next, name: previous.name } : next
}

/** Multi-selected planes take one layers preset together, in one undo step. */
export const roofSegmentPanelModel: NodePanelModel<RoofSegmentNode> = {
  rows: () => [],
  multiControls: ({ selection }) => {
    const planes = selection.filter((plane) => !isGlazedRoofSegment(plane))
    if (planes.length === 0) return []
    const values = planes.map((plane) => roofBuildUpPresetValue(plane.buildUp))
    const value = values.every((entry) => entry === values[0]) ? values[0]! : null
    return [
      {
        id: 'roof-segment-layers-preset',
        kind: 'select',
        section: 'Layers',
        label: 'Preset',
        options: roofBuildUpPresetOptions(value),
        value,
        onChange: (id) => {
          const patch = roofBuildUpPresetPatch(id)
          if (!patch) return
          runAsSingleSceneHistoryStep(useScene, () =>
            useScene
              .getState()
              .updateNodes(planes.map((plane) => ({ id: plane.id as AnyNodeId, data: patch }))),
          )
        },
      },
    ]
  },
}
