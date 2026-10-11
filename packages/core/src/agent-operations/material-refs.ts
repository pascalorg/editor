import { refuse } from '../agent-tools/refusal'
import {
  getCatalogMaterialById,
  MATERIAL_CATALOG,
  type MaterialSurface,
  parseMaterialRef,
} from '../material-library'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'

const SURFACE_WORDS: Record<MaterialSurface, string> = {
  roof: 'roofing',
  wall: 'wall material',
  floor: 'flooring',
  ceiling: 'ceiling material',
  furniture: 'joinery material',
  outdoor: 'outdoor material',
}

/** The surface a kind's finish covers, as the library tags materials; a roof's `wall` role is a wall. */
const KIND_SURFACES: Record<string, MaterialSurface> = {
  roof: 'roof',
  'roof-segment': 'roof',
  dormer: 'roof',
  wall: 'wall',
  column: 'wall',
  slab: 'floor',
  stair: 'floor',
  'stair-segment': 'floor',
  ceiling: 'ceiling',
  fence: 'outdoor',
  chimney: 'outdoor',
  door: 'furniture',
  window: 'furniture',
  item: 'furniture',
  cabinet: 'furniture',
  shelf: 'furniture',
}

/** The surface a node's finish goes on, by its kind and the role or field painted. */
export function finishSurface(type: string, role?: string): MaterialSurface | undefined {
  const surface = KIND_SURFACES[type]
  return surface === 'roof' && role && /^wall(MaterialPreset)?$/.test(role) ? 'wall' : surface
}

const wordsOf = (asked: string) =>
  asked
    .toLowerCase()
    .replace(/^library:/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
const named = (entry: { id: string; label: string }) => `library:${entry.id} (${entry.label})`
const suits = (entry: { surfaces?: readonly MaterialSurface[] }, surface: MaterialSurface) =>
  entry.surfaces?.includes(surface) ?? false

/**
 * Library ids nearest a name asked for: those that suit the surface first (a roof's roofing, a
 * wall's wall materials, as the library tags them), then by the words they share with it.
 */
export function nearestLibraryMaterials(
  asked: string,
  surface?: MaterialSurface,
  count = 3,
): string[] {
  const words = wordsOf(asked)
  const score = (text: string) => words.filter((word) => text.includes(word)).length
  return MATERIAL_CATALOG.map((entry) => ({
    entry,
    fit: surface && suits(entry, surface) ? 1 : 0,
    score: score(`${entry.id} ${entry.label}`.toLowerCase()),
  }))
    .sort((a, b) => b.fit - a.fit || b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, count)
    .map(({ entry }) => named(entry))
}

/**
 * A material ref that renders: a library id the catalog holds (`library:<id>`, or the bare id), or
 * a scene material (`scene:<id>`, which only the host's store can check). Anything else would fall
 * back to a default with no word (an unknown preset came out grey), so it is refused, naming
 * the nearest library ids for the surface; when the library has nothing of the kind like it, the
 * refusal says so, and that a colour is the nearest (a corrugated roof was once offered bricks).
 */
export function requireMaterialRef(
  asked: string,
  field?: string,
  surface?: MaterialSurface,
  /** Whether to point to `paint` for a colour (paint passes it); else a flat library colour. */
  {
    paint = false,
    materials,
  }: {
    paint?: boolean
    materials?: Readonly<Record<SceneMaterialId, SceneMaterial>>
  } = {},
): string {
  const parsed = parseMaterialRef(asked.includes(':') ? asked : `library:${asked}`)
  if (parsed?.kind === 'scene') {
    if (materials !== undefined && !Object.hasOwn(materials, parsed.id))
      refuse(
        'unknown_material',
        `Scene material ${asked} is not in this scene; nothing was painted.`,
        { material: asked },
      )
    return asked
  }
  // A community material (`library:mtl_…`): the host checks it against its catalog.
  if (parsed?.kind === 'library' && parsed.id.startsWith('mtl_')) return asked
  if (parsed?.kind === 'library' && getCatalogMaterialById(parsed.id)) return `library:${parsed.id}`
  const words = wordsOf(asked)
  const shares = (text: string) => words.some((word) => text.toLowerCase().includes(word))
  const kind = surface ? MATERIAL_CATALOG.filter((entry) => suits(entry, surface)) : []
  const alike = kind.filter((entry) => shares(`${entry.id} ${entry.label}`))
  const nearest = nearestLibraryMaterials(asked, surface)
  // Only names sharing a word: with none, the ranking is alphabetical and names bricks for a roof.
  const byName = nearestLibraryMaterials(asked).filter(shares)
  const head = `${field ? `${field}: ` : ''}${asked} is not in the material library`
  const colour = paint
    ? 'a colour with paint'
    : 'a flat colour, library:preset-<colour> (library:preset-midgrey, library:preset-tan)'
  const message =
    surface && !alike.length
      ? `${head}, which has no ${SURFACE_WORDS[surface]} like it. Its ${SURFACE_WORDS[surface]}: ${
          kind.length ? kind.slice(0, 5).map(named).join(', ') : 'none'
        }.${byName.length ? ` Nearest by name: ${byName.join(', ')}.` : ''} Or ${colour} is the nearest.`
      : `${head}. Nearest: ${nearest.join(', ')}; or give ${colour}.`
  return refuse(
    'unknown_material',
    `${message} search_materials finds a library material by words.`,
    {
      material: asked,
      ...(field ? { field } : {}),
      nearest,
    },
  )
}
