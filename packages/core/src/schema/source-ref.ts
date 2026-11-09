import { z } from 'zod'
import { PROVENANCE_MAX_ID_BYTES, PROVENANCE_MAX_NAMESPACE_BYTES } from './provenance'

/**
 * One source reference as a string: `<ns>:<id>[::<sub>]`, the address form of a
 * typed provenance ref `{ ns, id }` (plan item I-01, owner decision D5) plus an
 * optional sub-part. Sub-records that carry provenance (an assembly layer's
 * `src`) store it in this form.
 *
 * - `ns`: the source namespace, ≤ 48 bytes. It may carry its own qualifier
 *   (`ifc:<file>`), so the id starts after the last single `:`.
 * - `id`: the source id, verbatim, ≤ 160 bytes, without `:`.
 * - `sub`: everything after the first `::`, ≤ 160 bytes.
 * No part is empty. Like the typed ref (`ProvenanceRef`, whose byte caps these
 * are), every character is printable ASCII, spaces included, one byte each;
 * importers percent-encode anything else.
 */

export type ParsedSourceRef = { ns: string; id: string; sub?: string }

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/

export function parseSourceRef(value: string): ParsedSourceRef | null {
  if (!PRINTABLE_ASCII.test(value)) return null
  const subAt = value.indexOf('::')
  const head = subAt < 0 ? value : value.slice(0, subAt)
  const sub = subAt < 0 ? undefined : value.slice(subAt + 2)
  const colon = head.lastIndexOf(':')
  if (colon < 0) return null
  const ns = head.slice(0, colon)
  const id = head.slice(colon + 1)
  if (
    ns.length > PROVENANCE_MAX_NAMESPACE_BYTES ||
    ns.split(':').some((part) => part.length === 0)
  ) {
    return null
  }
  if (id.length === 0 || id.length > PROVENANCE_MAX_ID_BYTES) return null
  if (sub === undefined) return { ns, id }
  if (sub.length === 0 || sub.length > PROVENANCE_MAX_ID_BYTES) return null
  return { ns, id, sub }
}

export const SourceRefString = z.string().refine((value) => parseSourceRef(value) !== null, {
  message: 'Expected a source reference <ns>:<id>[::<sub>]',
})
