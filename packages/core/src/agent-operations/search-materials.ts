import type { MATERIAL_SURFACES } from '../agent-tools/search-materials'
import {
  MATERIAL_CATALOG,
  type MaterialCatalogItem,
  type MaterialSurface,
} from '../material-library'
import type { AgentOperation } from './types'

type Surface = (typeof MATERIAL_SURFACES)[number]
type SearchMaterialsInput = { queries: { query: string; surface?: Surface }[] }

/**
 * Building words as the library writes them. A general vocabulary of trade terms, not one per
 * query: the library says wood, siding, stucco where a plan or a brief says timber, weatherboard,
 * render.
 */
const SAME: Record<string, string[]> = {
  timber: ['wood'],
  weatherboard: ['siding', 'clapboard'],
  cladding: ['siding', 'clapboard', 'board', 'batten'],
  render: ['stucco', 'plaster'],
  rendered: ['stucco', 'plaster'],
  sheeting: ['metal', 'seam'],
  sheet: ['metal', 'seam'],
  decking: ['wood', 'plank', 'board'],
  paving: ['stone', 'tile', 'concrete', 'ground'],
  pavers: ['stone', 'tile', 'concrete'],
  gray: ['grey'],
  grey: ['gray'],
}

/** Surface words: a material suiting the surface matches them. */
const SURFACE_WORDS: Record<string, MaterialSurface> = {
  roof: 'roof',
  roofing: 'roof',
  wall: 'wall',
  facade: 'wall',
  floor: 'floor',
  flooring: 'floor',
  ceiling: 'ceiling',
  soffit: 'ceiling',
  outdoor: 'outdoor',
  garden: 'outdoor',
}

type Shade = { luminance: number; saturation: number }

/** Shade words, by the material's colour: relative luminance (0 black, 1 white) and saturation. */
const SHADES: Record<string, (shade: Shade) => boolean> = {
  dark: ({ luminance }) => luminance < 0.25,
  black: ({ luminance }) => luminance < 0.08,
  light: ({ luminance }) => luminance > 0.6,
  pale: ({ luminance }) => luminance > 0.6,
  white: ({ luminance }) => luminance > 0.75,
  grey: ({ luminance, saturation }) => luminance > 0.04 && luminance < 0.75 && saturation < 0.2,
  gray: ({ luminance, saturation }) => luminance > 0.04 && luminance < 0.75 && saturation < 0.2,
}

function shadeOf(hex: string | undefined): Shade | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!match) return null
  const srgb = [0, 2, 4].map((i) => Number.parseInt(match[1]!.slice(i, i + 2), 16) / 255)
  const [r, g, b] = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const max = Math.max(...srgb)
  return {
    luminance: 0.2126 * r! + 0.7152 * g! + 0.0722 * b!,
    saturation: max ? (max - Math.min(...srgb)) / max : 0,
  }
}

const stem = (word: string) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)

/** Whether a material answers a query word: by its text, the trade vocabulary, shade or surface. */
function answers(material: MaterialCatalogItem, text: string, word: string): boolean {
  const forms = [word, stem(word), ...(SAME[word] ?? []), ...(SAME[stem(word)] ?? [])]
  if (forms.some((form) => text.includes(form))) return true
  const shade = SHADES[word]
  const colour = shadeOf(material.previewColor)
  if (shade && colour && shade(colour)) return true
  const surface = SURFACE_WORDS[word] ?? SURFACE_WORDS[stem(word)]
  return !!surface && !!material.surfaces?.includes(surface)
}

/** `search_materials`: the library's materials by words, best first, and the words none answers. */
export const searchMaterials: AgentOperation<SearchMaterialsInput> = (_nodes, { queries }) => ({
  result: {
    groups: queries.map(({ query, surface }) => {
      const words = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
      const pool = MATERIAL_CATALOG.filter(
        (material) => !surface || material.surfaces?.includes(surface),
      )
      const scored = pool.map((material) => {
        const text =
          `${material.id} ${material.label} ${material.category} ${material.description ?? ''}`.toLowerCase()
        const hits = words.filter((word) => answers(material, text, word))
        return { material, hits }
      })
      const missing = words.filter((word) => !scored.some(({ hits }) => hits.includes(word)))
      const best = scored
        .filter(({ hits }) => hits.length)
        .sort(
          (a, b) =>
            b.hits.length - a.hits.length || a.material.label.localeCompare(b.material.label),
        )
        .slice(0, 12)
      return {
        query,
        ...(surface ? { surface } : {}),
        results: best.map(({ material }) => ({
          ref: `library:${material.id}`,
          label: material.label,
          kind: material.category,
          surfaces: material.surfaces ?? [],
          ...(material.previewColor ? { color: material.previewColor } : {}),
        })),
        ...(missing.length ? { missing } : {}),
      }
    }),
    message:
      'Materials best first, as library:<id> refs for paint, slots or presets. Words no material answers are under missing: the library lacks them.',
  },
})
