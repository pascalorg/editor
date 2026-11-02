import type { DesignBrief, Treatment } from '../agent-tools/design-brief'

/**
 * The facade a brief states, in words, and a later brief of the turn against the first. The brief's
 * `facade` axis states a treatment (the material families it is clad in, its bands, what else it
 * carries, the rhythm of its openings); a later brief that states a plainer one is a fact to show.
 * Reading what the building has against it is the facade tools' own, and not here. It never
 * refuses a write.
 */

type Cladding = NonNullable<Treatment['cladding']>[number]
type Element = NonNullable<Treatment['elements']>[number]

const CLADDING_WORDS: Record<Cladding, string> = {
  brick: 'brick',
  stone: 'stone',
  render: 'render',
  siding: 'siding',
  wood: 'wood',
  metal: 'metal',
}

const ELEMENT_WORDS: Record<Element, string> = {
  corners: 'corner chains',
  surrounds: 'opening surrounds',
  shutters: 'shutters',
  balconies: 'balconies',
  entrance: 'an entrance unit',
  'curtain-wall': 'curtain-wall glazing',
  porch: 'a porch',
  guard: 'guards',
  posts: 'posts',
}

const list = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '')

/** A treatment in words: "brick cladding, base and cornice bands, shutters and a regular rhythm". */
function treatmentWords(treatment: Treatment): string {
  return list(
    [
      treatment.cladding?.length
        ? `${list(treatment.cladding.map((family) => CLADDING_WORDS[family]))} cladding`
        : null,
      treatment.bands?.length
        ? `${list(treatment.bands)} ${treatment.bands.length === 1 ? 'band' : 'bands'}`
        : null,
      ...(treatment.elements ?? []).map((element) => ELEMENT_WORDS[element]),
      treatment.rhythm ? `a ${treatment.rhythm} rhythm` : null,
    ].filter((part): part is string => part !== null),
  )
}

/** What a treatment asks of a facade: one for each family, band and element, one for a regular rhythm. */
const demands = (treatment: Treatment) =>
  (treatment.cladding?.length ?? 0) +
  (treatment.bands?.length ?? 0) +
  (treatment.elements?.length ?? 0) +
  (treatment.rhythm === 'regular' ? 1 : 0)

export type FacadeRevision = {
  code: 'facade_revised_simpler'
  message: string
  /** A facade finding informs: the brief is free to revise, and what the building has is the facade tools' to say. */
  severity: 'info'
}

/**
 * The finding where a later brief of the turn states a plainer treatment than the first one did:
 * it asks for fewer families, bands, elements, or a free rhythm for a regular one. A brief is free
 * to revise, so this is a fact to show. Null when either brief states no treatment.
 */
export function facadeRevision(
  first: Treatment | undefined,
  brief: Pick<DesignBrief, 'axes'> | null | undefined,
): FacadeRevision | null {
  const latest = brief?.axes?.facade?.treatment
  if (!(first && latest) || demands(latest) >= demands(first)) return null
  return {
    code: 'facade_revised_simpler',
    severity: 'info',
    message: `The facade was revised during the turn: from ${treatmentWords(first)} to ${treatmentWords(latest) || 'no stated treatment'}.`,
  }
}
