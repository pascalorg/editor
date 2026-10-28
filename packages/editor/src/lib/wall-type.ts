import {
  type AnyNodeId,
  type Assembly,
  assemblyThickness,
  CUSTOM_WALL_TYPE_PREFIX,
  DEFAULT_INTERIOR_WALL_PAINT,
  type DrawnWallTypes,
  getWallAssemblyPreset,
  isExteriorWallAssembly,
  parseWallTypes,
  projectWallTypes,
  type SiteNode,
  useScene,
  WALL_ASSEMBLY_PRESETS,
  type WallNode,
  WallTypeDefinition,
  WallTypeDefinitionId,
  wallAssemblyCladding,
  wallAssemblyFinishSlots,
  wallAssemblyPatch,
} from '@pascal-app/core'
import { useMemo } from 'react'

/**
 * The wall types new walls are drawn with, picked in the Build panel before
 * drawing and kept with the editor preferences. A type is a wall assembly
 * preset id, a project wall type id (`custom-…`, saved on the site), or `plain`
 * for a single-layer wall with no assembly.
 *
 * `exterior` builds the walls that hold the outside back (the outline, an open
 * run, the first walls of a plan); `interior` builds the walls a closed circuit
 * of walls encloses (`DrawnWallTypes` in core).
 */
export type WallTypePlacement = 'exterior' | 'interior'
export type WallTypeId = string
export type WallTypes = Record<WallTypePlacement, WallTypeId>

export const PLAIN_WALL_TYPE = 'plain'

export const DEFAULT_WALL_TYPES: WallTypes = {
  exterior: 'exterior-2x6-siding',
  interior: 'interior-2x4-drywall',
}

/**
 * The finishes new walls are drawn with, picked beside their types and kept with
 * them: the cladding product for each cladding kind (so going from siding to
 * stucco and back keeps the siding colour), and the paint every lining gets —
 * both faces of a partition and the inside face of an exterior wall. Absent =
 * the kind's own cladding (`WALL_FINISH_LIBRARY_REF`).
 */
export type WallFinishes = {
  cladding: Partial<Record<string, string>>
  paint: string
}

/**
 * The paint starts at the default interior paint every unpainted face already
 * shows, so a wall drawn with it carries none of its own (`wallAssemblyFinishSlots`).
 */
export const DEFAULT_WALL_FINISHES: WallFinishes = {
  cladding: {},
  paint: DEFAULT_INTERIOR_WALL_PAINT,
}

/**
 * The Rooms group's Exterior wall and Interior wall tiles, beside Walls: single
 * walls of that placement's type and finish wherever they land (`armWallTypeTool`,
 * the tiles of the Shift+E and I shortcuts).
 */
export const WALL_TYPE_TOOLS: ReadonlyArray<{
  placement: WallTypePlacement
  label: string
  iconSrc: string
  /** `ToolShortcutId` of the key that arms it. */
  shortcut: 'exterior-wall' | 'interior-wall'
  title: string
}> = [
  {
    placement: 'exterior',
    label: 'Exterior wall',
    iconSrc: '/icons/walls.webp',
    shortcut: 'exterior-wall',
    title: 'Exterior walls: every wall drawn takes the exterior type and cladding',
  },
  {
    placement: 'interior',
    label: 'Interior wall',
    iconSrc: '/icons/divide-room.webp',
    shortcut: 'interior-wall',
    title: 'Interior walls: every wall drawn takes the interior type and paint',
  },
]

/**
 * The Rooms group's Invisible wall tile (and Railing, beside it): runs of lines the
 * wall tool draws that are no walls of a type (`armWallLineTool`).
 */
export const WALL_LINE_TOOLS: ReadonlyArray<{
  kind: 'invisible' | 'railing'
  label: string
  iconSrc: string
  title: string
  /** The Rooms caption's rest while the tile is armed. */
  caption: string
}> = [
  {
    kind: 'invisible',
    label: 'Invisible wall',
    iconSrc: '/icons/zone.webp',
    title:
      'Invisible walls: divide a room or close off a porch without building a wall. Rooms close on them; they never cut a wall.',
    caption:
      'every line is an invisible wall: rooms close on it, nothing is built. Closed off outside the house, a room becomes a porch.',
  },
  {
    kind: 'railing',
    label: 'Railing',
    iconSrc: '/icons/fence.webp',
    title:
      'Railings: a 36 in guard drawn like walls, posts at most 6 ft apart. Rooms close on it and it takes openings; style and height in the wall panel.',
    caption:
      'every line is a railing: a guard rooms close on, with no studs, siding or footing. Place a door on it for an opening.',
  },
]

export type WallTypeOption = { id: WallTypeId; label: string; group: string }

const GROUP_LABEL: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  masonry: 'Masonry',
}

export const WALL_TYPE_OPTIONS: readonly WallTypeOption[] = [
  ...WALL_ASSEMBLY_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    group: GROUP_LABEL[preset.category] ?? preset.category,
  })),
  { id: PLAIN_WALL_TYPE, label: 'Plain wall (single layer)', group: 'Other' },
]

const PLAIN_OPTION = WALL_TYPE_OPTIONS[WALL_TYPE_OPTIONS.length - 1]!

/** Whether `id` is a project wall type id (it may still be missing from this project). */
export function isProjectWallTypeId(id: string): boolean {
  return id.startsWith(CUSTOM_WALL_TYPE_PREFIX) && WallTypeDefinitionId.safeParse(id).success
}

function isWallTypeId(value: unknown): value is WallTypeId {
  return (
    typeof value === 'string' &&
    (value === PLAIN_WALL_TYPE || !!getWallAssemblyPreset(value) || isProjectWallTypeId(value))
  )
}

export function normalizeWallTypes(value: unknown): WallTypes {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    exterior: isWallTypeId(record.exterior) ? record.exterior : DEFAULT_WALL_TYPES.exterior,
    interior: isWallTypeId(record.interior) ? record.interior : DEFAULT_WALL_TYPES.interior,
  }
}

const isFinishRef = (value: unknown): value is string =>
  typeof value === 'string' && (value.startsWith('library:') || /^#[\da-f]{6}$/i.test(value))

export function normalizeWallFinishes(value: unknown): WallFinishes {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const cladding = (
    record.cladding && typeof record.cladding === 'object' ? record.cladding : {}
  ) as Record<string, unknown>
  return {
    cladding: Object.fromEntries(
      Object.entries(cladding).filter((entry): entry is [string, string] => isFinishRef(entry[1])),
    ),
    paint: isFinishRef(record.paint) ? record.paint : DEFAULT_WALL_FINISHES.paint,
  }
}

/** The project's own wall types, as the scene holds them now (`SiteNode.wallTypes`). */
export function currentProjectWallTypes(): WallTypeDefinition[] {
  const { nodes, rootNodeIds } = useScene.getState()
  return projectWallTypes(nodes, rootNodeIds)
}

function siteOf(state: ReturnType<typeof useScene.getState>): SiteNode | undefined {
  for (const id of state.rootNodeIds) {
    const node = state.nodes[id]
    if (node?.type === 'site') return node
  }
  return undefined
}

/** The project's own wall types, kept current as they are saved, edited or undone. */
export function useProjectWallTypes(): WallTypeDefinition[] {
  const saved = useScene((state) => siteOf(state)?.wallTypes)
  return useMemo(() => parseWallTypes(saved), [saved])
}

/**
 * A type's name and stack: a preset's, or a project type's. Null for a plain wall,
 * and for a project type this project does not have (picked in another project).
 */
export function resolveWallType(
  id: WallTypeId,
  projectTypes: readonly WallTypeDefinition[] = currentProjectWallTypes(),
): { label: string; assembly: Assembly; project: boolean } | null {
  const preset = getWallAssemblyPreset(id)
  if (preset) return { label: preset.label, assembly: preset.assembly, project: false }
  const own = projectTypes.find((type) => type.id === id)
  return own ? { label: own.label, assembly: own.assembly, project: true } : null
}

/**
 * The type a placement draws with: its pick, or the placement's default when the
 * pick is a project type this project does not have.
 */
export function availableWallType(
  id: WallTypeId,
  placement: WallTypePlacement,
  projectTypes: readonly WallTypeDefinition[] = currentProjectWallTypes(),
): WallTypeId {
  return isProjectWallTypeId(id) && !resolveWallType(id, projectTypes)
    ? DEFAULT_WALL_TYPES[placement]
    : id
}

/** The placement whose list a stack belongs in, read from its layers (`isExteriorWallAssembly`). */
export function wallTypePlacementOf(assembly: Assembly): WallTypePlacement {
  return isExteriorWallAssembly(assembly) ? 'exterior' : 'interior'
}

/**
 * The types a placement's list offers: the presets that build that kind of wall,
 * then the project's own, then the plain wall (in both). `current` is listed
 * even off its placement, so a pick made before the lists split still shows.
 */
export function wallTypeOptions(
  placement: WallTypePlacement,
  projectTypes: readonly WallTypeDefinition[],
  current?: WallTypeId,
): WallTypeOption[] {
  const options: WallTypeOption[] = [
    ...WALL_ASSEMBLY_PRESETS.filter(
      (preset) => wallTypePlacementOf(preset.assembly) === placement || preset.id === current,
    ).map((preset) => ({ id: preset.id, label: preset.label, group: 'Presets' })),
    ...projectTypes
      .filter((type) => wallTypePlacementOf(type.assembly) === placement || type.id === current)
      .map((type) => ({ id: type.id, label: type.label, group: 'This project' })),
  ]
  return [...options, PLAIN_OPTION]
}

/**
 * The wall patch a type gives a new wall: its assembly, the thickness it sums to,
 * and the `slots` of the finishes picked for it (`wallAssemblyFinishSlots`).
 */
export function wallTypePatch(
  id: WallTypeId,
  finishes?: WallFinishes,
  projectTypes: readonly WallTypeDefinition[] = currentProjectWallTypes(),
): Partial<WallNode> {
  const type = resolveWallType(id, projectTypes)
  if (!type) return {}
  const assembly = structuredClone(type.assembly)
  const slots = finishes
    ? wallAssemblyFinishSlots(assembly, {
        cladding: finishes.cladding[wallAssemblyCladding(assembly) ?? ''],
        paint: finishes.paint,
      })
    : {}
  return { ...wallAssemblyPatch(assembly), ...(Object.keys(slots).length > 0 ? { slots } : {}) }
}

export function drawnWallTypesOf(types: WallTypes, finishes?: WallFinishes): DrawnWallTypes {
  const projectTypes = currentProjectWallTypes()
  const patch = (placement: WallTypePlacement) =>
    wallTypePatch(
      availableWallType(types[placement], placement, projectTypes),
      finishes,
      projectTypes,
    )
  return { exterior: patch('exterior'), interior: patch('interior') }
}

/**
 * The thickness a type draws at, or undefined for a plain wall (the wall default).
 * With its placement, a project type this project lacks reads as that placement's default.
 */
export function wallTypeThickness(
  id: WallTypeId,
  placement?: WallTypePlacement,
): number | undefined {
  const projectTypes = currentProjectWallTypes()
  const type = resolveWallType(
    placement ? availableWallType(id, placement, projectTypes) : id,
    projectTypes,
  )
  return type ? assemblyThickness(type.assembly) : undefined
}

/** The most layers a wall type's stack holds (`Assembly.layers`). */
export const WALL_TYPE_LAYER_LIMIT = 12

/** The most wall types a project keeps on its site (`SiteNode.wallTypes`). */
export const PROJECT_WALL_TYPE_LIMIT = 64

/**
 * Why no new wall type can be made in this project — it keeps `PROJECT_WALL_TYPE_LIMIT`
 * already — or null while it has room: what "New wall type…" and "Duplicate as a new
 * type…" say when they are off.
 */
export function newWallTypeBlockedReason(
  projectTypes: readonly WallTypeDefinition[],
): string | null {
  return projectTypes.length >= PROJECT_WALL_TYPE_LIMIT
    ? `This project keeps ${PROJECT_WALL_TYPE_LIMIT} wall types, the most it can. Delete one to make another.`
    : null
}

/**
 * What saving a project wall type came to: `saved`, or why not — the scene has no
 * site to keep it on, its stack has more layers than a wall type holds, the project
 * keeps as many types as it can and this one is new, or it does not parse.
 */
export type WallTypeSaveResult =
  | 'saved'
  | 'no-site'
  | 'too-many-layers'
  | 'too-many-types'
  | 'invalid'

/** What the wall type editor says when a type was not saved. */
export const WALL_TYPE_SAVE_FAILURE: Record<Exclude<WallTypeSaveResult, 'saved'>, string> = {
  'no-site': 'This project has no site to keep wall types on, so the type was not saved.',
  'too-many-layers': `A wall type holds at most ${WALL_TYPE_LAYER_LIMIT} layers. Remove one to save it.`,
  'too-many-types': `This project keeps ${PROJECT_WALL_TYPE_LIMIT} wall types, the most it can. Delete one to save another.`,
  invalid:
    'These layers do not make a wall type (one framing core, every layer a thickness), so it was not saved.',
}

/**
 * Saves a project wall type on the site, in place of the one with its id or after
 * the others: one undo step, saved and shared with the project. Nothing is written
 * unless it comes to `saved` (`WallTypeSaveResult`): a stack of more than
 * `WALL_TYPE_LAYER_LIMIT` layers, or a new type past `PROJECT_WALL_TYPE_LIMIT`, would
 * leave a site that no longer parses.
 */
export function saveProjectWallType(type: WallTypeDefinition): WallTypeSaveResult {
  const state = useScene.getState()
  const site = siteOf(state)
  if (!site) return 'no-site'
  if ((type.assembly?.layers?.length ?? 0) > WALL_TYPE_LAYER_LIMIT) return 'too-many-layers'
  const parsed = WallTypeDefinition.safeParse(type)
  if (!parsed.success) return 'invalid'
  const current = projectWallTypes(state.nodes, state.rootNodeIds)
  const editing = current.some((entry) => entry.id === type.id)
  if (!editing && current.length >= PROJECT_WALL_TYPE_LIMIT) return 'too-many-types'
  const next = editing
    ? current.map((entry) => (entry.id === type.id ? parsed.data : entry))
    : [...current, parsed.data]
  state.updateNode(site.id as AnyNodeId, { wallTypes: next } as Partial<SiteNode>)
  return 'saved'
}

/** Removes a project wall type from the site. Walls drawn with it keep their stack. */
export function deleteProjectWallType(id: WallTypeId): void {
  const state = useScene.getState()
  const site = siteOf(state)
  if (!site) return
  const next = projectWallTypes(state.nodes, state.rootNodeIds).filter((type) => type.id !== id)
  state.updateNode(
    site.id as AnyNodeId,
    {
      wallTypes: next.length > 0 ? next : undefined,
    } as Partial<SiteNode>,
  )
}
