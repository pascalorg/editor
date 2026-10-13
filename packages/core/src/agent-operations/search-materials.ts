import {
  MATERIAL_CATALOG,
  type MaterialCatalogItem,
  type MaterialSurface,
} from '../material-library'
import type { AgentOperation } from './types'

type SearchMaterialsInput = { queries: { query: string; surface?: MaterialSurface }[] }

/**
 * Building words as the library writes them: a plan or a brief says timber, weatherboard, render
 * where the library says wood, siding, stucco.
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

/** Surface words: a material suiting the surface answers them. */
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

/** Words that tell no material from another: "white render for the walls" asks for three things. */
const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'some', 'like', 'its'])

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Whether a material can go on a surface: one that names no surface goes anywhere (flat colours). */
const suits = (material: MaterialCatalogItem, surface: MaterialSurface) =>
  !material.surfaces || material.surfaces.includes(surface)

/**
 * Whether a material answers a query word: by a word of its text (whole, or begun by a form of four
 * letters or more: tile answers tiles, for never answers forest), the trade vocabulary, shade or
 * the surface it is made for.
 */
function answers(material: MaterialCatalogItem, text: readonly string[], word: string): boolean {
  const forms = [word, stem(word), ...(SAME[word] ?? []), ...(SAME[stem(word)] ?? [])]
  const said = (token: string, form: string) =>
    token === form || stem(token) === form || (form.length >= 4 && token.startsWith(form))
  if (forms.some((form) => text.some((token) => said(token, form)))) return true
  const shade = SHADES[word]
  const colour = shadeOf(material.previewColor)
  if (shade && colour && shade(colour)) return true
  // A surface word asks for a material made for it (floor is flooring), not one that can go there.
  const surface = SURFACE_WORDS[word] ?? SURFACE_WORDS[stem(word)]
  return !!surface && !!material.surfaces?.includes(surface)
}

/** `search_materials`: the library's materials by words, best first, and the words none answers. */
export const searchMaterials: AgentOperation<SearchMaterialsInput> = (_nodes, { queries }) => ({
  result: {
    groups: queries.map(({ query, surface }) => {
      const words = wordsOf(query).filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      const scored = MATERIAL_CATALOG.filter(
        (material) => !surface || suits(material, surface),
      ).map((material) => {
        const text = wordsOf(
          `${material.id} ${material.label} ${material.category} ${material.description ?? ''}`,
        )
        return { material, hits: words.filter((word) => answers(material, text, word)) }
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
      'Materials best first, as library:<id> refs for paint. The words no material answers are under missing: the library lacks them.',
  },
})
