import type { MaterialCategory, MaterialSurface } from '../material-kinds'
import {
  getDynamicLibraryMaterials,
  MATERIAL_CATALOG,
  type MaterialCatalogItem,
} from '../material-library'
import type { AgentOperation } from './types'

type SearchMaterialsInput = {
  queries: { query?: string; kind?: MaterialCategory; surface?: MaterialSurface; offset?: number }[]
}

/** The most a group lists at a time: a search's best, a browse by name. */
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

/** A material's id with its words run together, as a piece of it is asked ("plank48"). */
const idRun = (material: MaterialCatalogItem) => material.id.toLowerCase().replace(/[^a-z0-9]/g, '')

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
  if ((word.length >= 4 || /\d/.test(word)) && idRun(material).includes(word)) return true
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

const byName = (a: MaterialCatalogItem, b: MaterialCatalogItem) =>
  a.label.localeCompare(b.label) || a.id.localeCompare(b.id)

/** Colour options for a finish the library lacks: nearest library colour, or exact native. */
const missingMaterialFacts = `paint with color gives the nearest library colour and says how far it moved (ΔE); a native material, paint with material: { properties: { color } }, keeps the exact colour.`

/**
 * `search_materials`: the library's materials by words, best first, and the words none answers;
 * without a query, a browse of a kind, a surface or the whole library. Either lists a page at a
 * time, saying how many more there are and the offset that lists them.
 */
export const searchMaterials: AgentOperation<SearchMaterialsInput> = (_nodes, { queries }) => {
  const library = libraryMaterials()
  const groups = queries.map(({ query = '', kind, surface, offset = 0 }) => {
    const pool = library.filter(
      (material) => (!kind || material.category === kind) && (!surface || suits(material, surface)),
    )
    const asked = {
      ...(query ? { query } : {}),
      ...(kind ? { kind } : {}),
      ...(surface ? { surface } : {}),
      ...(offset ? { offset } : {}),
    }
    const page = (listed: readonly MaterialCatalogItem[], size: number) => {
      const more = listed.length - offset - size
      return {
        results: listed.slice(offset, offset + size).map(asResult),
        ...(more > 0 ? { more, next: offset + size } : {}),
      }
    }
    if (!query.trim()) return { ...asked, ...page([...pool].sort(byName), BROWSE_RESULTS) }
    // A query of words too short or too common to tell materials apart finds nothing; it
    // never browses the library in its place.
    const said = wordsOf(query)
    const words = said.filter(searches)
    if (!words.length) return { ...asked, results: [], missing: said }
    const scored = pool.map((material) => {
      const text = wordsOf(
        `${material.id} ${material.label} ${material.category} ${material.description ?? ''}`,
      )
      return { material, hits: words.filter((word) => answers(material, text, word)) }
    })
    // A three-letter piece nothing answers as a word ("cco" of stucco) is looked for in ids.
    for (const word of words) {
      if (word.length !== 3 || scored.some(({ hits }) => hits.includes(word))) continue
      for (const entry of scored) if (idRun(entry.material).includes(word)) entry.hits.push(word)
    }
    const missing = words.filter((word) => !scored.some(({ hits }) => hits.includes(word)))
    const best = scored
      .filter(({ hits }) => hits.length)
      .sort((a, b) => b.hits.length - a.hits.length || byName(a.material, b.material))
      .map(({ material }) => material)
    return { ...asked, ...page(best, SEARCH_RESULTS), ...(missing.length ? { missing } : {}) }
  })
  const lacking = groups.some((group) => 'missing' in group)
  return {
    result: {
      groups,
      message: `Materials as library:<id> refs for paint: a search best first, a browse by name. A long list says how many more there are (more) and the offset that lists them (next). The words no material answers are under missing: the library lacks them.${lacking ? ` ${missingMaterialFacts}` : ''}`,
    },
  }
}
