import { MATERIAL_CATALOG, type MaterialCatalogItem } from '../material-library'
import type { ProceduralItemNode } from './node'
import type { Recipe } from './recipe'

type ProceduralFinish = NonNullable<Recipe['slots'][number]['finish']>

// Textured tones average source WebP RGB pixels (wood) or decoded KTX2 mip 0 (metal)
// under apps/editor/public/material; flat finishes use their preset color.
export const FINISH_LIBRARY_REFS = {
  glass: [{ ref: 'library:preset-glass', color: '#87ceeb' }],
  metal: [
    { ref: 'library:metal-steel', color: '#636363' },
    { ref: 'library:metal-chrome', color: '#c8ccce' },
    { ref: 'library:metal-brass', color: '#b08d57' },
    { ref: 'library:metal-copper', color: '#cc845b' },
    { ref: 'library:metal-polished', color: '#f3f3f3' },
    { ref: 'library:preset-metal', color: '#c7ccd2' },
  ],
  wood: [
    { ref: 'library:wood-finewood27', color: '#a77440' },
    { ref: 'library:wood-woodplank48', color: '#88654c' },
    { ref: 'library:wood-hungarianparquet2', color: '#663020' },
    { ref: 'library:wood-squareparquet21', color: '#3e220d' },
  ],
} as const satisfies Record<
  ProceduralFinish,
  readonly { ref: `library:${string}`; color: string }[]
>

export function proceduralFinishLibraryColor(ref: string): string | undefined {
  return Object.values(FINISH_LIBRARY_REFS)
    .flat()
    .find((preset) => preset.ref === ref)?.color
}

export function resolveProceduralFinishRef(
  finish: ProceduralFinish,
  color: string,
): `library:${string}` | undefined {
  return nearestColor<Pick<LibraryColorMatch, 'ref' | 'color'>>(color, FINISH_LIBRARY_REFS[finish])
    ?.ref
}

export type LibraryColorMatch = {
  ref: `library:${string}`
  color: string
  name: string
  distance: number
}

function hexToLab(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
  const linear = (offset: number) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const r = linear(1)
  const g = linear(3)
  const b = linear(5)
  // sRGB uses D65; normalize XYZ by that white point before converting to Lab.
  const f = (value: number) =>
    value > (6 / 29) ** 3 ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

function nearestColor<T extends { color: string }>(hex: string, candidates: readonly T[]) {
  const lab = hexToLab(hex)
  if (!lab) return null
  let nearest: (T & { distance: number }) | null = null
  for (const entry of candidates) {
    const candidate = hexToLab(entry.color)
    if (!candidate) continue
    const distance = Math.hypot(lab[0] - candidate[0], lab[1] - candidate[1], lab[2] - candidate[2])
    if (!nearest || distance < nearest.distance) nearest = { ...entry, distance }
  }
  return nearest
}

export function nearestLibraryColorRef(
  hex: string,
  catalog: readonly MaterialCatalogItem[] = MATERIAL_CATALOG,
): LibraryColorMatch | null {
  return nearestColor(
    hex,
    catalog
      // Flat swatches are in `colors` and have no populated maps, including non-albedo maps.
      .filter(
        (entry) => entry.category === 'colors' && !Object.values(entry.preset.maps).some(Boolean),
      )
      .map((entry) => ({
        ref: `library:${entry.id}` as const,
        color: entry.preset.mapProperties.color,
        name: entry.label,
      })),
  )
}

export function snapProceduralSlotsToLibrary(
  node: ProceduralItemNode,
  options: { keepOverrides: true } = { keepOverrides: true },
): ProceduralItemNode['slots'] {
  const slots = { ...node.slots }
  for (const slot of node.recipe.slots) {
    if (options.keepOverrides && Object.hasOwn(node.slots, slot.id)) continue
    const ref = slot.finish
      ? resolveProceduralFinishRef(slot.finish, slot.color)
      : nearestLibraryColorRef(slot.color)?.ref
    if (ref) slots[slot.id] = ref
  }
  return slots
}
