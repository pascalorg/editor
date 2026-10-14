import {
  getDynamicLibraryMaterials,
  MATERIAL_CATALOG,
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialSurface,
} from '../material-library'
import type { AgentOperation } from './types'

type SearchMaterialsInput = {
  queries: { query?: string; kind?: MaterialCategory; surface?: MaterialSurface; offset?: number }[]
}

/** The most a group lists: a search's best, a browse's first by name. */
const SEARCH_RESULTS = 12
const BROWSE_RESULTS = 150

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

/** A word that searches: three letters or more, or any word with a digit ("48" of a plank). */
const searches = (word: string) => (word.length > 2 || /\d/.test(word)) && !STOP_WORDS.has(word)

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
  // A piece of an id ("plank48" of wood-woodplank48): its words run together there.
  const id = material.id.toLowerCase().replace(/[^a-z0-9]/g, '')
  if ((word.length >= 4 || /\d/.test(word)) && id.includes(word)) return true
  const shade = SHADES[word]
  const colour = shadeOf(material.previewColor)
  if (shade && colour && shade(colour)) return true
  // A surface word asks for a material made for it (floor is flooring), not one that can go there.
  const surface = SURFACE_WORDS[word] ?? SURFACE_WORDS[stem(word)]
  return !!surface && !!material.surfaces?.includes(surface)
}

/** Pascal's library, then what the host registered besides (a registration never shadows one). */
function libraryMaterials(): MaterialCatalogItem[] {
  const pascal = new Set(MATERIAL_CATALOG.map((material) => material.id))
  return [
    ...MATERIAL_CATALOG,
    ...getDynamicLibraryMaterials().filter((material) => !pascal.has(material.id)),
  ]
}

const asResult = (material: MaterialCatalogItem) => ({
  ref: `library:${material.id}`,
  label: material.label,
  kind: material.category,
  surfaces: material.surfaces ?? [],
  ...(material.previewColor ? { color: material.previewColor } : {}),
})

/**
 * `search_materials`: the library's materials by words, best first, and the words none answers;
 * without words, a browse of a kind, a surface or the whole library.
 */
export const searchMaterials: AgentOperation<SearchMaterialsInput> = (_nodes, { queries }) => {
  const library = libraryMaterials()
  return {
    result: {
      groups: queries.map(({ query = '', kind, surface, offset = 0 }) => {
        const words = wordsOf(query).filter(searches)
        const pool = library.filter(
          (material) =>
            (!kind || material.category === kind) && (!surface || suits(material, surface)),
        )
        const asked = {
          ...(query ? { query } : {}),
          ...(kind ? { kind } : {}),
          ...(surface ? { surface } : {}),
        }
        if (!words.length) {
          const listed = [...pool].sort(
            (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
          )
          const more = listed.length - offset - BROWSE_RESULTS
          return {
            ...asked,
            ...(offset ? { offset } : {}),
            results: listed.slice(offset, offset + BROWSE_RESULTS).map(asResult),
            ...(more > 0 ? { more, next: offset + BROWSE_RESULTS } : {}),
          }
        }
        const scored = pool.map((material) => {
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
          .slice(0, SEARCH_RESULTS)
        return {
          ...asked,
          results: best.map(({ material }) => asResult(material)),
          ...(missing.length ? { missing } : {}),
        }
      }),
      message:
        'Materials as library:<id> refs for paint: a search best first, a browse by name (a long one says how many more, and the offset that lists them: next). The words no material answers are under missing: the library lacks them.',
    },
  }
}
