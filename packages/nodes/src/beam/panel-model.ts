import {
  type AnyNode,
  type AnyNodeId,
  BEAM_MATERIAL_LABELS,
  BEAM_SIZE_PRESETS,
  BEAM_TOP_REFERENCE_LABELS,
  BEAM_TOP_REFERENCES,
  type BeamMaterial,
  type BeamNode,
  type BeamTopReference,
  beamSizePresetPatch,
  beamTopReferenceOf,
  beamTopReferencePatch,
  matchBeamSizePreset,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import type { NodePanelModel } from '@pascal-app/editor'

type Nodes = Record<AnyNodeId, AnyNode>

const CUSTOM = 'custom'

/** The Size choices: every stock size, and Custom while the beam is no stock size. */
export function beamSizeOptions(current: string | null) {
  return [
    ...(current === CUSTOM ? [{ label: 'Custom', value: CUSTOM }] : []),
    ...BEAM_SIZE_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  ]
}

/** Which Size choice a beam is: its stock size, or Custom. */
export function beamSizeValue(beam: BeamNode): string {
  return matchBeamSizePreset(beam)?.id ?? CUSTOM
}

export const BEAM_MATERIAL_OPTIONS = (Object.keys(BEAM_MATERIAL_LABELS) as BeamMaterial[]).map(
  (material) => ({ label: BEAM_MATERIAL_LABELS[material], value: material }),
)

/** The Top choices: the references, and Custom while the top is typed in. */
export function beamTopOptions(current: string | null) {
  return [
    ...BEAM_TOP_REFERENCES.map((top) => ({ label: BEAM_TOP_REFERENCE_LABELS[top], value: top })),
    ...(current === CUSTOM ? [{ label: 'Custom', value: CUSTOM }] : []),
  ]
}

export function beamTopValue(nodes: Nodes, beam: BeamNode): string {
  return beamTopReferenceOf(nodes, beam) ?? CUSTOM
}

/** The one value every beam shares, or null for a mixed selection. */
function shared(values: string[]): string | null {
  return values.every((value) => value === values[0]) ? (values[0] ?? null) : null
}

/** Writes one patch per beam in a single undo step. */
function updateAll(beams: BeamNode[], patch: (beam: BeamNode) => Partial<BeamNode>) {
  runAsSingleSceneHistoryStep(useScene, () =>
    useScene
      .getState()
      .updateNodes(beams.map((beam) => ({ id: beam.id as AnyNodeId, data: patch(beam) }))),
  )
}

/** Steps through a list of choices, wrapping round. */
function cycle<T extends string>(list: readonly T[], current: T | string, step: 1 | -1): T {
  const index = list.indexOf(current as T)
  return list[(index + step + list.length) % list.length]!
}

/**
 * The beam's settings as panel rows (the XR wand's panel) and as controls the multi-selection
 * inspector applies to every selected beam at once: size, material, top. A porch's beams take a
 * new size together.
 */
export const beamPanelModel: NodePanelModel<BeamNode> = {
  rows: ({ node, nodes, update }) => {
    const sizes = BEAM_SIZE_PRESETS.map((preset) => preset.id as string)
    const materials = BEAM_MATERIAL_OPTIONS.map((option) => option.value)
    const size = beamSizeValue(node)
    const top = beamTopValue(nodes, node)
    return [
      {
        id: 'beam-size',
        kind: 'cycle',
        section: 'Beam',
        label: 'Size',
        value: BEAM_SIZE_PRESETS.find((preset) => preset.id === size)?.label ?? 'Custom',
        next: () => update(beamSizePresetPatch(node, cycle(sizes, size, 1))),
        previous: () => update(beamSizePresetPatch(node, cycle(sizes, size, -1))),
      },
      {
        id: 'beam-material',
        kind: 'cycle',
        section: 'Beam',
        label: 'Material',
        value: BEAM_MATERIAL_LABELS[node.material],
        next: () => update({ material: cycle(materials, node.material, 1) }),
        previous: () => update({ material: cycle(materials, node.material, -1) }),
      },
      {
        id: 'beam-top',
        kind: 'cycle',
        section: 'Beam',
        label: 'Top',
        value: top === CUSTOM ? 'Custom' : BEAM_TOP_REFERENCE_LABELS[top as BeamTopReference],
        next: () => update(beamTopReferencePatch(nodes, node, cycle(BEAM_TOP_REFERENCES, top, 1))),
        previous: () =>
          update(beamTopReferencePatch(nodes, node, cycle(BEAM_TOP_REFERENCES, top, -1))),
      },
    ]
  },
  multiControls: ({ selection, nodes }) => {
    if (selection.length === 0) return []
    const size = shared(selection.map(beamSizeValue))
    const top = shared(selection.map((beam) => beamTopValue(nodes, beam)))
    return [
      {
        id: 'beam-size',
        kind: 'select',
        section: 'Beam',
        label: 'Size',
        options: beamSizeOptions(size),
        value: size,
        onChange: (id) => {
          if (id !== CUSTOM) updateAll(selection, (beam) => beamSizePresetPatch(beam, id))
        },
      },
      {
        id: 'beam-material',
        kind: 'select',
        section: 'Beam',
        label: 'Material',
        options: BEAM_MATERIAL_OPTIONS,
        value: shared(selection.map((beam) => beam.material)),
        onChange: (material) =>
          updateAll(selection, () => ({ material: material as BeamMaterial })),
      },
      {
        id: 'beam-top',
        kind: 'select',
        section: 'Beam',
        label: 'Top',
        options: beamTopOptions(top),
        value: top,
        onChange: (reference) => {
          if (reference === CUSTOM) return
          updateAll(selection, (beam) =>
            beamTopReferencePatch(nodes, beam, reference as BeamTopReference),
          )
        },
      },
    ]
  },
}
