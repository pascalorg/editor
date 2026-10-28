import {
  BEAM_MATERIAL_LABELS,
  BEAM_SIZE_PRESETS,
  BEAM_TOP_REFERENCE_LABELS,
  BEAM_TOP_REFERENCES,
  type BeamMaterial,
  type BeamTopReference,
  beamSizePreset,
  DEFAULT_BEAM_SIZE_PRESET_ID,
  type ToolOption,
} from '@pascal-app/core'
import { create } from 'zustand'

/** What the beam tool draws with: its size, material and where its top goes. */
export type BeamDraftChoices = {
  preset: string
  material: BeamMaterial
  top: BeamTopReference
}

/**
 * The beam tool's choices, kept apart from the editor's tool defaults: a host clears those when it
 * arms a tool from its tile, which would forget the size just picked.
 */
export const useBeamDraft = create<
  BeamDraftChoices & { set: (patch: Partial<BeamDraftChoices>) => void }
>((set) => ({
  preset: DEFAULT_BEAM_SIZE_PRESET_ID,
  material: 'sawn',
  top: 'ceiling-dropped',
  set: (patch) => set(patch),
}))

/** The stock sizes come in four families; a treated beam is a sawn size. */
type BeamFamily = 'sawn' | 'lvl' | 'glulam' | 'steel'

const familyOf = (material: BeamMaterial): BeamFamily =>
  material === 'pressure-treated' ? 'sawn' : material

/** The size a family starts at when its material is picked. */
const FAMILY_SIZE: Record<BeamFamily, string> = {
  sawn: DEFAULT_BEAM_SIZE_PRESET_ID,
  lvl: '(2)lvl-1-3/4x11-7/8',
  glulam: 'glulam-5-1/8x12',
  steel: 'W8x10',
}

const MATERIAL_DESCRIPTIONS: Record<BeamMaterial, string> = {
  sawn: 'A solid timber or 2x plies nailed up, inside where it stays dry',
  'pressure-treated': 'Treated sawn lumber, for a porch, a deck or anything in the weather',
  lvl: 'Laminated veneer lumber: a stiff beam for a long span inside',
  glulam: 'Glued-laminated timber: long spans, often left exposed',
  steel: 'A steel W shape, for the longest spans',
}

const TOP_DESCRIPTIONS: Record<BeamTopReference, string> = {
  'ceiling-dropped':
    'Hangs under the ceiling plane, the top of the walls: the joists or rafters bear on it',
  'ceiling-flush':
    'In the ceiling framing, its underside on the ceiling plane: the joists hang from its sides',
  'floor-flush': 'Its top flush with the floor over it, in the floor framing',
  'floor-under':
    "Under the floor's framing: a girder in a crawl space, or a deck's beam under its joists",
}

const subscribe = (onChange: () => void) => useBeamDraft.subscribe(() => onChange())

/** The material row: picking another family brings its usual size along. */
const materialOption: ToolOption = {
  id: 'beam-material',
  label: 'Material',
  choices: (Object.keys(BEAM_MATERIAL_LABELS) as BeamMaterial[]).map((material) => ({
    value: material,
    label: BEAM_MATERIAL_LABELS[material],
    description: MATERIAL_DESCRIPTIONS[material],
  })),
  subscribe,
  value: () => useBeamDraft.getState().material,
  set: (value) => {
    const material = value as BeamMaterial
    const preset = beamSizePreset(useBeamDraft.getState().preset)
    const keeps = preset && familyOf(preset.material) === familyOf(material)
    useBeamDraft
      .getState()
      .set({ material, ...(keeps ? {} : { preset: FAMILY_SIZE[familyOf(material)] }) })
  },
}

/** One Size row per family, shown while its material is the one picked. */
const sizeOptions: ToolOption[] = (['sawn', 'lvl', 'glulam', 'steel'] as const).map((family) => ({
  id: `beam-size-${family}`,
  label: 'Size',
  choices: BEAM_SIZE_PRESETS.filter((preset) => familyOf(preset.material) === family).map(
    (preset) => ({ value: preset.id, label: preset.label.replace(/ (LVL|GLB)$/, '') }),
  ),
  subscribe,
  value: () => useBeamDraft.getState().preset,
  set: (value) => useBeamDraft.getState().set({ preset: value }),
  visible: {
    subscribe,
    value: () => familyOf(useBeamDraft.getState().material) === family,
  },
}))

const topOption: ToolOption = {
  id: 'beam-top',
  label: 'Top',
  choices: BEAM_TOP_REFERENCES.map((top) => ({
    value: top,
    label: BEAM_TOP_REFERENCE_LABELS[top],
    description: TOP_DESCRIPTIONS[top],
  })),
  subscribe,
  value: () => useBeamDraft.getState().top,
  set: (value) => useBeamDraft.getState().set({ top: value as BeamTopReference }),
}

/** The Beam tool's rows in the Build panel: material, size, top. */
export const beamToolOptions: readonly ToolOption[] = [materialOption, ...sizeOptions, topOption]
